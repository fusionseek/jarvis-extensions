/**
 * 对着构建产物跑：宿主替身在线缆另一端扮演 Jarvis，经 `junkClean.engine` 调 `status / run / action`。
 *
 * **从不执行真的 `mo`**：`process.locate` / `process.run` 全是桩，输出由测试按脚本推到订阅 token 上；
 * 操作日志是临时目录里的真文件，`files.stat / tail` 按宿主语义读它。
 */
import test, { beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createTestHost } from "../../../sdk/dist/testing.js";
import { hostFiles, RUN, sampleOutput } from "./support.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const LOG = "~/Library/Logs/mole/operations.log";
const ALL = ["process.run", "files.read", "terminal.run"];

/** 每条测试自己摆的场面。 */
let scenario;
let directory;
let logPath;
let files;

const host = createTestHost({
  async: {
    "process.locate": async (params) => scenario.locate(params.executable),
    "process.run": async (params, h) => scenario.run(params, h),
    "process.cancel": async (params) => scenario.cancel(params.token),
    "files.stat": async ({ path }) => files.stat(path),
    "files.tail": async ({ path, offset }) => files.tail(path, offset),
    "terminal.run": async ({ id }) => {
      scenario.terminal.push(id);
    },
  },
});
await import(join(here, "..", "dist", "extension.js")); // IIFE：加载即 defineExtension

const found = (path = "/opt/homebrew/bin/mo") => async () => ({ path, source: "discovered" });

/** 一次性把输出推完再退出的进程。`--version` 也走它。 */
const scripted = (lines, result = { exitCode: 0, stderr: "" }) => (params, h) => {
  scenario.runs.push(params);
  if (lines.length) h.emit(params.token, { lines });
  return result;
};

/** 由测试一步一步推的进程：`out()` 推输出、`exit()` 退出、`fail()` 以宿主错误拒绝。 */
function controlled() {
  const proc = { started: false };
  scenario.run = (params, h) => {
    scenario.runs.push(params);
    if (params.arguments[0] !== "clean") return { exitCode: 0, stderr: "" };
    proc.started = true;
    proc.token = params.token;
    proc.out = (...lines) => h.emit(params.token, { lines });
    return new Promise((resolve, reject) => {
      proc.exit = (exitCode = 0, stderr = "") => resolve({ exitCode, stderr });
      proc.fail = (error) => reject(error);
    });
  };
  scenario.cancel = (token) => {
    scenario.cancels.push(token);
    if (token === proc.token) proc.fail({ code: "cancelled", message: "已取消" });
  };
  return proc;
}

/**
 * 让桩、订阅与扩展里的 `await` 续体全部落定。
 *
 * 不用 `host.settle()`：它要等全部在途调用兑现，而一个还没退出的 `process.run`（或故意挂着的 `locate`）
 * 就是在途调用——会等成死锁。桩都不用定时器、读文件是同步的，一轮宏任务就足以把微任务队列排空；多转几轮只为保险。
 */
async function flush() {
  for (let round = 0; round < 4; round += 1) await new Promise((resolve) => setImmediate(resolve));
}

const appendLog = (...lines) => appendFileSync(logPath, lines.map((line) => `${line}\n`).join(""));
const op = (action, path, detail) => `[t] [clean run=${RUN}] ${action} ${path}${detail ? ` (${detail})` : ""}`;
const callRun = (granted = ALL, preferences = {}) => host.callService({ service: "mole", method: "run", preferences, granted });
const callStatus = (preferences = {}, granted = ALL) => host.callService({ service: "mole", method: "status", preferences, granted });
const totalFreed = (report) => report.sections.reduce((sum, section) => sum + section.freedBytes, 0);

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "mole-service-"));
  logPath = join(directory, "operations.log");
  files = hostFiles(logPath);
  scenario = {
    locate: found(),
    run: scripted(["Mole version 1.59.1"]),
    cancel: async () => undefined,
    runs: [],
    cancels: [],
    terminal: [],
  };
});
afterEach(() => rmSync(directory, { recursive: true, force: true }));

// ── status ──────────────────────────────────────────────────────────────

test("status：找到了就报路径与版本，没有动作", async () => {
  const outcome = await callStatus();
  assert.deepEqual(outcome.result, { ok: true, value: { ready: true, summary: "/opt/homebrew/bin/mo · v1.59.1", actions: [] } });
  assert.deepEqual(scenario.runs.map((r) => [r.executable, r.arguments]), [["/opt/homebrew/bin/mo", ["--version"]]]);
});

test("status：版本读不出（输出不认识、或进程被拒）时只报路径，照样可用", async () => {
  scenario.run = scripted(["something else"]);
  assert.equal((await callStatus()).result.value.summary, "/opt/homebrew/bin/mo");
  scenario.run = () => {
    throw { code: "host.failure", message: "起不来" };
  };
  const outcome = await callStatus();
  assert.equal(outcome.result.value.ready, true);
  assert.equal(outcome.result.value.summary, "/opt/homebrew/bin/mo");
});

test("status：`mo --version` 卡住时 5 秒放弃、中断它，照样报可用", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let token;
  scenario.run = (params) => {
    token = params.token;
    return new Promise(() => undefined);
  };
  scenario.cancel = (cancelled) => scenario.cancels.push(cancelled);
  const pending = callStatus();
  await flush();
  t.mock.timers.tick(4_999);
  await flush();
  assert.deepEqual(scenario.cancels, [], "还没到点");
  t.mock.timers.tick(1);
  const outcome = await pending;
  assert.deepEqual(outcome.result.value, { ready: true, summary: "/opt/homebrew/bin/mo", actions: [] });
  assert.deepEqual(scenario.cancels, [token]);
});

test("status：没找到给「在终端中安装」；填错的路径不给（装一个新的救不了写错的路径）", async () => {
  const asked = [];
  scenario.locate = async (executable) => {
    asked.push(executable);
    return { path: null, problem: "notFound" };
  };
  const notFound = (await callStatus({ command: "   " })).result.value;
  assert.deepEqual(notFound, {
    ready: false,
    summary: "没有找到 mo 命令",
    problem: "没有找到 mo 命令",
    actions: [{ id: "install", title: "在终端中安装", prominent: true }],
  });
  assert.equal((await callStatus({ command: " mole-dev " })).result.value.problem, "没有找到 mole-dev 命令");
  assert.deepEqual(asked, ["mo", "mole-dev"], "交给宿主的是去掉空白的命令，空的回到 mo");

  scenario.locate = async () => ({ path: null, problem: "missing" });
  const missing = (await callStatus({ command: "~/tools/mo" })).result.value;
  assert.equal(missing.problem, "填的路径 ~/tools/mo 不存在");
  assert.deepEqual(missing.actions, []);

  scenario.locate = async () => ({ path: null, problem: "notExecutable" });
  const plain = (await callStatus({ command: "/x/mo" })).result.value;
  assert.equal(plain.summary, "/x/mo 不是可执行文件");
  assert.deepEqual(plain.actions, []);
  assert.equal(scenario.runs.length, 0, "找不到时不跑任何进程");
});

test("status：没授权 process.run 时直接说，不调宿主；宿主拒绝定位时照它说的写", async () => {
  const before = host.invocations.length;
  const denied = (await callStatus({}, ["files.read"])).result.value;
  assert.equal(denied.ready, false);
  assert.match(denied.problem, /还没有允许这个扩展运行命令/);
  assert.deepEqual(denied.actions, []);
  assert.equal(host.invocations.length, before, "一次宿主调用都没有");

  scenario.locate = async () => {
    throw { code: "capability.undeclared", message: "路径的文件名必须是 mo" };
  };
  const undeclared = (await callStatus({ command: "/x/other" })).result.value;
  assert.deepEqual(undeclared, { ready: false, summary: "路径的文件名必须是 mo", problem: "路径的文件名必须是 mo", actions: [] });
});

// ── action ──────────────────────────────────────────────────────────────

test("action install：在终端里跑 manifest 里那段脚本，让宿主盯着 status", async () => {
  const outcome = await host.callService({ service: "mole", method: "action", actionId: "install", granted: ALL });
  assert.deepEqual(outcome.result, {
    ok: true,
    value: { message: "正在终端里安装 Mole…装好后会自动换成 Mole 清理。", watchStatus: true },
  });
  assert.deepEqual(scenario.terminal, ["install"]);
});

test("action：不认识的动作是 invalid.argument；没授权 terminal.run 是 permission.denied，不开终端", async () => {
  const unknown = await host.callService({ service: "mole", method: "action", actionId: "uninstall", granted: ALL });
  assert.equal(unknown.result.ok, false);
  assert.equal(unknown.result.error.code, "invalid.argument");
  const denied = await host.callService({ service: "mole", method: "action", actionId: "install", granted: ["process.run"] });
  assert.equal(denied.result.error.code, "permission.denied");
  assert.deepEqual(scenario.terminal, []);
});

// ── run ─────────────────────────────────────────────────────────────────

test("run：只调用 `mo clean`，把输出写成报告；进度只在变了时给、只增不减", async () => {
  scenario.locate = found("/Users/me/.local/bin/mo");
  scenario.run = scripted(sampleOutput);
  const outcome = await callRun(["process.run"]);
  assert.deepEqual(scenario.runs.map((r) => [r.executable, r.arguments]), [["/Users/me/.local/bin/mo", ["clean"]]]);
  const report = outcome.result.value;
  assert.equal(report.failure, undefined);
  assert.deepEqual(report.sections.map((s) => s.title), ["系统（需管理员权限）", "用户缓存、日志与废纸篓", "浏览器缓存", "开发工具缓存"]);
  assert.deepEqual(report.sections[0].skipped, { reason: "notPresent" });
  assert.equal(totalFreed(report), 2_400_000_000 + 312_500_000 + 48_200_000 + 1_100_000_000);
  assert.ok(report.notes.some((n) => n.includes("管理员权限")));
  assert.ok(report.notes.some((n) => n.includes("+4.10GB")));

  const progress = outcome.progress;
  // 第一行、四个区段标题、五行有数的小结：其余（空行、⚙、✗、收尾几行）都不变。
  assert.equal(progress.length, 10);
  const keys = progress.map((p) => JSON.stringify(p));
  assert.equal(new Set(keys).size, keys.length, "不会连着给两份一样的");
  const fractions = progress.map((p) => p.fraction);
  assert.deepEqual(fractions, [...fractions].sort((a, b) => a - b), "进度只增不减");
  assert.equal(progress[progress.length - 1].freedBytes, totalFreed(report), "跑的过程中最后一个数与结果页同一个");
  assert.equal(host.invocations.filter((i) => i.namespace === "files").length, 0, "没授权 files.read 就不碰日志");
});

test("run：失败写进报告而不是抛出", async () => {
  scenario.run = scripted(["➤ System"], { exitCode: 2, stderr: "line1\nError: cannot read cwd" });
  const crashed = (await callRun()).result.value;
  assert.match(crashed.failure, /退出码 2/);
  assert.match(crashed.failure, /cannot read cwd/);

  scenario.run = () => {
    throw { code: "host.failure", message: "exec 失败", detail: "Permission denied" };
  };
  const notStarted = await callRun();
  assert.equal(notStarted.result.ok, true);
  assert.equal(notStarted.result.value.failure, "mo clean 没能启动：exec 失败（Permission denied）");
  assert.deepEqual(notStarted.result.value.sections, []);

  scenario.run = scripted(["➤ User essentials", "Cleanup cancelled"], { exitCode: 130, stderr: "" });
  const partial = (await callRun()).result.value;
  assert.equal(partial.failure, undefined, "有收尾标题就不算整次失败");
  assert.ok(partial.notes.some((n) => n.includes("Cleanup cancelled")));
});

test("run：找不到、没授权时报告整次失败，不跑进程", async () => {
  scenario.locate = async () => ({ path: null, problem: "notFound" });
  assert.equal((await callRun()).result.value.failure, "没有找到 mo 命令");
  scenario.locate = async () => ({ path: null, problem: "missing" });
  assert.equal((await callRun(ALL, { command: "~/bin/mo" })).result.value.failure, "填的路径 ~/bin/mo 不存在");
  const before = host.invocations.length;
  assert.match((await callRun(["files.read"])).result.value.failure, /还没有允许这个扩展运行命令/);
  assert.equal(host.invocations.length, before);
  assert.equal(scenario.runs.length, 0);
});

test("run：取消时中断进程，报「已取消」并保留已经清掉的", async () => {
  const proc = controlled();
  const callId = host.nextCallId;
  const pending = callRun(["process.run"]);
  await flush();
  assert.ok(proc.started);
  proc.out("➤ User essentials", "  ✓ User app cache · 2.40GB");
  await flush();
  host.cancelService(callId);
  const report = (await pending).result.value;
  assert.deepEqual(scenario.cancels, [proc.token], "取消落到这一个进程上");
  assert.equal(report.failure, "已取消");
  assert.equal(report.sections[0].freedBytes, 2_400_000_000);
});

test("run：Mole 在取消前打了收尾标题，就按它说的写", async () => {
  const proc = controlled();
  const callId = host.nextCallId;
  const pending = callRun(["process.run"]);
  await flush();
  proc.out("➤ User essentials", "Cleanup interrupted");
  await flush();
  host.cancelService(callId);
  const report = (await pending).result.value;
  assert.equal(report.failure, undefined);
  assert.ok(report.notes.includes("Mole 报告：Cleanup interrupted。"));
});

test("run：还在找 mo 时就被取消，不再启动进程", async () => {
  let release;
  scenario.locate = () => new Promise((resolve) => (release = () => resolve({ path: "/opt/homebrew/bin/mo", source: "discovered" })));
  const callId = host.nextCallId;
  const pending = callRun();
  await flush();
  host.cancelService(callId);
  release();
  assert.equal((await pending).result.value.failure, "已取消");
  assert.equal(scenario.runs.length, 0);
});

/**
 * 一个目标删上好一会儿、标准输出一行都没有的时候，大小照样从日志里涨上去；「正在删」跟着最近一条走；
 * 结果里每一类取两边大的那个，失败与跳过写进明细。定时器是假的：`tick()` 一次 = 读一次日志。
 */
test("run：读操作日志给出实时进度，结果每一类取两边大的那个", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const tick = async () => {
    t.mock.timers.tick(500);
    await flush();
  };
  writeFileSync(logPath, "# ========== clean run=older session ended at 2026-10-11 17:00:00, 1 items, 1KB ==========\n");
  const proc = controlled();
  const pending = callRun();
  await flush();
  assert.ok(proc.started);

  appendLog(`# ========== clean run=${RUN} session started at 2026-10-11 17:49:14 ==========`);
  proc.out("➤ User essentials");
  await flush();
  appendLog(
    op("SKIPPED", "/Users/me/Library/Caches/CloudKit", "whitelist"),
    op("REMOVED", "/Users/me/Library/Caches/Adobe", "500MB"),
    op("REMOVED", "/Users/me/Library/Caches/GameKit", "700MB"),
  );
  await tick();
  proc.out("  ✓ User app cache · 2 items, 1.20GB", "➤ App caches");
  await flush();
  appendLog(
    op("REMOVED", "/Users/me/Library/Containers/com.apple.geod/Data/tile-1", "300MB"),
    op("FAILED", "/Users/me/Library/Caches/Google", "removal timed out"),
  );
  await tick();
  appendLog(op("REMOVED", "/Users/me/Library/Containers/com.apple.geod/Data/tile-2", "300MB"));
  proc.out(
    "  ✓ Maps geo tile cache · 2 items, 600MB",
    "  ✓ Chrome Service Worker · 2.40GB, 3 protected",
    "➤ Developer tools",
    "  ✓ npm cache · 1.1GB",
  );
  await flush();
  appendLog(`# ========== clean run=${RUN} session ended at 2026-10-11 18:02:06, 5 items, 2.90GB ==========`);
  proc.out("Cleanup complete", "Tracked cleanup: 2.90GB | Items cleaned: 5 | Categories: 3");
  await flush();
  proc.exit(0, "");
  const outcome = await pending;

  const values = outcome.progress;
  // 「正在删 GameKit」只可能来自那次定时读日志：小结那一行到达时不读日志（只在换区段时读）。
  assert.ok(
    values.some(
      (p) => p.freedBytes === 1_200_000_000 && p.sectionTitle === "用户缓存、日志与废纸篓" && p.currentItem === "/Users/me/Library/Caches/GameKit",
    ),
    "小结那一行打出来之前，大小已经从日志里涨到 1.2GB",
  );
  assert.ok(values.some((p) => p.currentItem === "/Users/me/Library/Containers/com.apple.geod/Data/tile-1"), "正在删的那一项交绝对路径");
  const freed = values.map((p) => p.freedBytes);
  assert.deepEqual(freed, [...freed].sort((a, b) => a - b), "只增不减");

  const report = outcome.result.value;
  assert.equal(report.failure, undefined);
  assert.deepEqual(report.sections.map((s) => s.id), ["User essentials", "App caches", "Developer tools"]);
  assert.equal(report.sections[0].freedBytes, 1_200_000_000);
  assert.equal(report.sections[1].freedBytes, 600_000_000 + 2_400_000_000, "Service Worker 只在标准输出里，取大的那个");
  assert.deepEqual(report.sections[1].failures, ["/Users/me/Library/Caches/Google · removal timed out"], "删不掉的写进明细");
  assert.equal(report.sections[2].freedBytes, 1_100_000_000, "npm 这种用命令清的只在标准输出里");
  assert.ok(report.notes.some((n) => n.includes("跳过了 1 项")));
  assert.ok(report.notes.some((n) => n.includes("Mole 自己统计的总数为 2.90 GB") && n.includes("Service Worker")));
  assert.equal(values[values.length - 1].freedBytes, totalFreed(report), "跑的过程中最后一个数与结果页同一个");
  assert.ok(files.calls.length > 0 && files.calls.every((call) => call.path === LOG), "读的是 manifest 里声明的那一份");
});

test("run：日志不在时退回只看标准输出，结果与以前一样", async () => {
  scenario.run = scripted(["➤ User essentials", "  ✓ User app cache · 2 items, 1.20GB"]);
  const report = (await callRun()).result.value;
  assert.equal(totalFreed(report), 1_200_000_000);
  assert.equal(report.sections[0].itemCount, 2);
  assert.ok(files.calls.some((call) => call.method === "stat"), "授权了就去看一眼");
});
