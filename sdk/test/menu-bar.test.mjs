import test from "node:test";
import assert from "node:assert/strict";
import { createTestHost } from "../dist/testing.js";

// 菜单栏域（SDK 2.9）：menuBar 事件落到 defineExtension({ menuBar }) 的三个回调，模型经 menuBar.update 原样上线缆，
// 替身不用给桩就收下模型；select 只能点到最新一份模型里点得到的那一项。
const host = createTestHost();
const { defineExtension, jarvis, capabilityTiers, sdkVersion } = await import("../dist/index.js");

const seen = [];
let mode = "rule";
let failNextSelect = false;

const model = () => ({
  symbol: "network",
  title: "↓1.2M",
  items: [
    { kind: "header", title: `运行中 · ${mode}` },
    {
      kind: "submenu",
      title: "出站模式",
      items: ["rule", "global", "direct"].map((value) => ({ kind: "item", id: `mode:${value}`, title: value, checked: value === mode })),
    },
    { kind: "submenu", title: "节点", enabled: false, items: [{ kind: "item", id: "node:a", title: "A" }] },
    { kind: "separator" },
    { kind: "item", id: "test", title: "测速", enabled: false },
  ],
});

defineExtension({
  menuBar: {
    async start(context) {
      seen.push({ event: "start", context });
      await jarvis.menuBar.update(model());
    },
    open(context) {
      seen.push({ event: "open", context });
      return jarvis.menuBar.update(model());
    },
    async select(context, itemId) {
      seen.push({ event: "select", context, itemId });
      if (failNextSelect) {
        failNextSelect = false;
        throw new Error("切换失败");
      }
      if (itemId.startsWith("mode:")) mode = itemId.slice("mode:".length);
      await jarvis.menuBar.update(model());
    },
  },
});

test("SDK 2.9：版本号与两项新能力的档位（都是高）", () => {
  assert.equal(sdkVersion, "2.11.0");
  assert.equal(jarvis.sdk.version, "2.11.0");
  assert.equal(capabilityTiers["process.daemon"], "high");
  assert.equal(capabilityTiers["system.proxy"], "high");
});

test("start 带着授权与偏好落到回调，推的模型原样上线缆（namespace = menuBar、method = update）", async () => {
  await host.menuBarEvent("start", { granted: ["process.daemon"], preferences: { mixedPort: 7890 } });
  assert.deepEqual(seen.at(-1), { event: "start", context: { granted: ["process.daemon"], preferences: { mixedPort: 7890 } } });
  const call = host.invocations.at(-1);
  assert.equal(call.namespace, "menuBar");
  assert.equal(call.method, "update");
  assert.deepEqual(call.params, model());
  assert.deepEqual(host.latestMenuBar, model());
  assert.equal(host.menuBarModels.length, 1);
  assert.equal(host.commits.length, 0, "后台会话没有哪一面开着：回调之后不提交任何树");
});

test("open 是刷新的时机：再推一份", async () => {
  await host.menuBarEvent("open");
  assert.equal(seen.at(-1).event, "open");
  assert.deepEqual(seen.at(-1).context, { granted: [], preferences: {} });
  assert.equal(host.menuBarModels.length, 2);
});

test("select 带回扩展自己给的 id；改了状态再推，勾跟着走", async () => {
  assert.equal(host.menuItem("mode:rule").checked, true);
  await host.menuBarEvent("select", { itemId: "mode:global", granted: ["system.proxy"] });
  assert.equal(seen.at(-1).itemId, "mode:global");
  assert.deepEqual(seen.at(-1).context.granted, ["system.proxy"]);
  assert.equal(host.menuItem("mode:global").checked, true);
  assert.equal(host.menuItem("mode:rule").checked, false);
  assert.equal(host.latestMenuBar.items[0].title, "运行中 · global");
});

test("点不到的项替身不让点：不在模型里、自己禁用、所在子菜单禁用", async () => {
  const before = seen.length;
  await assert.rejects(host.menuBarEvent("select", { itemId: "missing" }), /没有「missing」/);
  await assert.rejects(host.menuBarEvent("select", { itemId: "test" }), /被禁用/);
  await assert.rejects(host.menuBarEvent("select", { itemId: "node:a" }), /被禁用/);
  await assert.rejects(host.menuBarEvent("select"), /要带 itemId/);
  assert.equal(seen.length, before, "一次都没落到回调");
  assert.equal(host.menuItem("node:a").title, "A", "menuItem 只是查找，禁用的也找得到");
});

test("回调抛错只记一条 error 日志，下一次照常", async () => {
  failNextSelect = true;
  await host.menuBarEvent("select", { itemId: "mode:direct" });
  assert.ok(host.logs.some((log) => log.level === "error" && log.message.includes("select") && log.data === "切换失败"));
  await host.menuBarEvent("select", { itemId: "mode:direct" });
  assert.equal(host.menuItem("mode:direct").checked, true);
});

test("宿主比 SDK 新、发来不认识的菜单栏事件：忽略，不抛", async () => {
  const before = seen.length;
  host.dispatch({ type: "menuBar", menuBar: { event: "hover", granted: [], preferences: {} } });
  await host.settle();
  assert.equal(seen.length, before);
});
