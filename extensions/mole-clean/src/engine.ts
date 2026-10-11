/**
 * `junkClean.engine` 的实现：直接调用用户装好的 `mo clean`（移植自宿主 `MoleCleaner`、`MoleVersionProbe`
 * 与 `JunkCleanEngineFactory` 里 Mole 那一支）。
 *
 * 宿主替我们做了进程那一层（`process.locate` / `process.run`）：stdin 接空设备，`mo clean` 在非 TTY 下自动进入
 * 非交互模式——**不会提示、不会卡住、不会要密码**，没有现成的 sudo 会话时系统级那一段整段跳过；工作目录是主目录
 * （`mo` 在读不了当前目录时直接退出）；PATH 补上 Homebrew 与常见工具链目录（开发工具那一段用 `command -v` 判断工具在不在）；
 * `NO_COLOR=1`。扩展这一侧只管：找没找到、跑起来、读输出与日志、写报告。
 */
import {
  JarvisError,
  jarvis,
  sleep,
  type CancelSignal,
  type ExecutableLocation,
  type JunkCleanActionResult,
  type JunkCleanEngine,
  type JunkCleanProgress,
  type JunkCleanReport,
  type JunkCleanStatus,
  type ProcessHandle,
  type ServiceContext,
} from "@fusionseek/jarvis-extension-sdk";
import { commandPreference, describeProblem, parseVersion } from "./command.js";
import { clampText, limits } from "./limits.js";
import { LiveState } from "./live-state.js";
import { OperationLogReader, operationLogPath } from "./operation-log.js";
import { buildReport, cancelledText, failureReport, type RunOutcome } from "./report.js";

/** 多久读一次操作日志。500ms：一秒两次的数字跳动读得出「在动」，又不至于每一帧都去碰文件。 */
export const logPollInterval = 500;

/**
 * `mo --version` 最多等多久。宿主在打开设置、清理工具时都会问 `status`，一个卡住的版本探测
 * 会让那张引擎卡一直转圈；5 秒还没回来就当读不出版本——找得到 `mo` 已经说明它能用。
 */
export const versionTimeout = 5_000;

/** manifest `process.terminal` 里那段安装脚本的 id。 */
const installScriptId = "install";

/** 没授权 `process.run` 时的那句话。不调宿主：调了也只会拿回一个 `permission.denied`。 */
export const notAllowedToRun = "还没有允许这个扩展运行命令（process.run）。在设置 · 扩展里它那块面板上打开授权后再试。";

/** 「在终端中安装」那一颗。只在「没找到」时给：填错的路径装一个新的也救不了，该去设置里改。 */
const installAction = { id: installScriptId, title: "在终端中安装", prominent: true };

/** 宿主拒绝时那句给人读的话：`detail` 有就补在后面（`host.failure` 的 detail 才是真正的原因）。 */
function messageOf(error: unknown): string {
  if (error instanceof JarvisError) {
    return error.detail && error.detail !== error.message ? `${error.message}（${error.detail}）` : error.message;
  }
  return error instanceof Error ? error.message : String(error);
}

/** 这次拒绝是不是取消。比的是错误码而不是类：线缆另一端造出来的错误对象不一定是同一个类的实例。 */
function isCancellation(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: unknown }).code === "cancelled";
}

/** 能不能调某项能力：宿主在每次调用里带来此刻的授权。 */
function granted(context: ServiceContext, capability: string): boolean {
  return context.granted.includes(capability);
}

/**
 * 找 `mo`。
 * @param command 用户填的命令（已去掉空白）。
 * @returns 位置，或宿主拒绝时那句话。
 */
async function locate(command: string): Promise<{ location: ExecutableLocation } | { error: string }> {
  try {
    return { location: await jarvis.process.locate(command) };
  } catch (error) {
    return { error: messageOf(error) };
  }
}

/**
 * 问一次 `mo --version`。读不出版本不妨碍可用，所以这里不抛任何东西。
 * @param executable `process.locate` 给的路径。
 * @returns 版本号；读不出时为 `null`。
 */
async function probeVersion(executable: string): Promise<string | null> {
  const lines: string[] = [];
  let handle: ProcessHandle;
  try {
    handle = jarvis.process.run({ executable, arguments: ["--version"], onLine: (line) => lines.push(line) });
  } catch {
    return null;
  }
  let timer: number | undefined;
  const timeout = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => resolve("timeout"), versionTimeout);
  });
  try {
    if ((await Promise.race([handle.result, timeout])) === "timeout") handle.cancel();
  } catch {
    // 进程起不来、被拒：照样用已经读到的行。
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
  return parseVersion(lines);
}

/**
 * 此刻能不能用。设置「清理」与清理工具的引擎卡画的就是它。
 * @param context 宿主带来的偏好与授权。
 * @returns 状态。
 */
async function status(context: ServiceContext): Promise<JunkCleanStatus> {
  const unavailable = (text: string, actions: JunkCleanStatus["actions"] = []): JunkCleanStatus => {
    const clamped = clampText(text, limits.statusText);
    return { ready: false, summary: clamped, problem: clamped, actions };
  };
  if (!granted(context, "process.run")) return unavailable(notAllowedToRun);
  const command = commandPreference(context.preferences);
  const located = await locate(command);
  if ("error" in located) return unavailable(located.error);
  const { location } = located;
  if (location.path === null) {
    return unavailable(describeProblem(location.problem, command), location.problem === "notFound" ? [installAction] : []);
  }
  const version = await probeVersion(location.path);
  const summary = version === null ? location.path : `${location.path} · v${version}`;
  return { ready: true, summary: clampText(summary, limits.statusText), actions: [] };
}

/**
 * 跑一次 `mo clean`：逐行解析标准输出，同时每隔一会儿读操作日志，报告进度。
 *
 * 不抛错：找不到、没授权、起不来、退出码非零都写进报告的 `failure`——宿主据此回落或说明，
 * 而一个抛出去的异常只会变成一句没有上下文的「服务出错」。
 * @param context 宿主带来的偏好与授权。
 * @param progress 进度回调。
 * @param signal 取消信号。
 * @returns 报告。
 */
async function run(
  context: ServiceContext,
  progress: (progress: JunkCleanProgress) => void,
  signal: CancelSignal,
): Promise<JunkCleanReport> {
  if (!granted(context, "process.run")) return failureReport(notAllowedToRun);
  const command = commandPreference(context.preferences);
  const located = await locate(command);
  if ("error" in located) return failureReport(located.error);
  const { location } = located;
  if (location.path === null) return failureReport(describeProblem(location.problem, command));
  if (signal.cancelled) return failureReport(cancelledText);

  // 没授权读日志、或宿主不让读：退回只看标准输出——明细少一些，清理照样作数。
  const reader = granted(context, "files.read") ? await OperationLogReader.open(jarvis.files, operationLogPath) : null;
  const state = new LiveState(reader);
  const report = (snapshot: JunkCleanProgress | null) => {
    if (snapshot) progress(snapshot);
  };

  let handle: ProcessHandle;
  try {
    handle = jarvis.process.run({
      executable: location.path,
      arguments: ["clean"],
      // 解析与读日志本身不会拒绝（读取器把宿主的拒绝吞成「这一拍没有新行」）；兜一层只为不留下未处理的拒绝。
      onLine: (line) => void state.consume(line).then(report, () => undefined),
    });
  } catch (error) {
    return failureReport(`mo clean 没能启动：${messageOf(error)}`);
  }
  signal.onCancel(() => handle.cancel());

  // 一个目标删上几分钟、标准输出一行都没有的时候，进度只能靠定时读日志往上涨。
  let running = true;
  void (async () => {
    while (running) {
      await sleep(logPollInterval);
      if (!running) return;
      report(await state.poll());
    }
  })().catch(() => undefined);

  let outcome: RunOutcome;
  try {
    const result = await handle.result;
    outcome = { kind: "exited", exitCode: result.exitCode, stderr: result.stderr };
  } catch (error) {
    running = false;
    if (!signal.cancelled && !isCancellation(error)) {
      await state.idle();
      return failureReport(`mo clean 没能启动：${messageOf(error)}`);
    }
    outcome = { kind: "cancelled" };
  }
  running = false;
  // 进程退出之后再读一次：最后几条删除记录与会话结束标记。排在全部输出行之后（同一条队列）。
  report(await state.poll());
  return buildReport(state.parser, state.log, outcome);
}

/**
 * 用户按了 `status.actions` 里的某一颗。只有「在终端中安装」。
 * @param id 动作 id。
 * @param context 宿主带来的偏好与授权。
 * @returns 结果：`watchStatus` 让宿主每 2 秒重查一次 `status`，装好即自动换成 Mole。
 * @throws `invalid.argument`：不认识的动作；`permission.denied`：没授权 `terminal.run`。
 */
async function action(id: string, context: ServiceContext): Promise<JunkCleanActionResult> {
  if (id !== installScriptId) {
    throw new JarvisError({ code: "invalid.argument", message: `不认识的动作「${id}」` });
  }
  if (!granted(context, "terminal.run")) {
    throw new JarvisError({
      code: "permission.denied",
      message: "还没有允许这个扩展打开终端（terminal.run）。在设置 · 扩展里它那块面板上打开授权，或者自己在终端里运行 brew install mole。",
    });
  }
  await jarvis.terminal.run(installScriptId);
  return { message: "正在终端里安装 Mole…装好后会自动换成 Mole 清理。", watchStatus: true };
}

/** Mole 深度清理引擎。 */
export const moleEngine: JunkCleanEngine = { status, run, action };
