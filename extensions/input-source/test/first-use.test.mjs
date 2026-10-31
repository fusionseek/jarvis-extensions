/**
 * 刚装上（jarvis-mac specs/20261031-080909-input-source-walkthrough-fixes W-2）：「记住上次」不必等你在每个应用里手动换一次才学会。
 * 你在一个应用里用着哪个输入法离开它，下次切回来就换回那一个——包括从来没手动换过的应用。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { ABC, PINYIN, extensionRoot, sources } from "./support.mjs";

const { createTestHost } = await import(pathToFileURL(join(extensionRoot, "..", "..", "sdk", "dist", "testing.js")).href);

const WARP = { bundleId: "dev.warp.Warp-Stable", name: "Warp", pid: 1 };
const RIDER = { bundleId: "com.jetbrains.rider", name: "Rider", pid: 2 };
const NOTES = { bundleId: "com.apple.Notes", name: "备忘录", pid: 3 };
const granted = ["hud.show", "inputSources.read", "inputSources.select", "system.activity"];
// 刚装上：只有一条固定规则（Rider 用 ABC），Warp 是「记住上次」，其余应用跟着「无规则的应用：记住上次」；从没手动换过。
const storage = new Map([
  [
    "rules",
    {
      [RIDER.bundleId]: { mode: "fixed", source: ABC, name: "Rider" },
      [WARP.bundleId]: { mode: "remember", name: "Warp" },
    },
  ],
]);
const preferences = { others: "remember" };
let current = PINYIN;
const selects = [];
const host = createTestHost({
  async: {
    "storage.get": async (params) => storage.get(params.key) ?? null,
    "storage.set": async (params) => void storage.set(params.key, params.value),
    "preferences.observe": async () => null,
    "preferences.all": async () => preferences,
    "inputSources.list": async () => sources,
    "inputSources.current": async () => ({ id: current }),
    "inputSources.select": async (params) => {
      selects.push(params.id);
      current = params.id;
      return { id: params.id, effective: true };
    },
    "inputSources.observe": async () => null,
    "frontmostApp.observe": async () => null,
    "hud.show": async () => null,
  },
});
await import(pathToFileURL(join(extensionRoot, "dist", "extension.js")).href);

const front = async (app) => {
  host.emit(host.subscriptionToken("frontmostApp"), app);
  await host.settle();
};
/** 宿主推来的「输入法换了」：切过去的那一下由 bySelf 标出是不是自己切的。 */
const selected = async (id, bySelf) => {
  current = id;
  host.emit(host.subscriptionToken("inputSources"), { type: "selected", id, bySelf });
  await host.settle();
};

test("刚装上还没授权：页面里点了「允许」之后，订上前台与输入法，补发的那一条只记下", async () => {
  await host.menuBarEvent("start", { granted: [], preferences });
  assert.equal(host.subscriptionToken("frontmostApp"), undefined, "没授权不订");
  await host.dispatch({ type: "permissionsChanged", granted });
  await host.settle();
  assert.ok(host.subscriptionToken("frontmostApp"));
  assert.ok(host.subscriptionToken("inputSources"));
  // 宿主订阅时补发此刻的前台（`FrontmostAppMonitor.subscribe`）。
  await front(WARP);
  assert.deepEqual(selects, [], "补发的那一条不替你换掉正在用的输入法");
});

test("在 Warp 里一直用拼音、没手动换过：切到 Rider 换成 ABC，切回 Warp 换回拼音", async () => {
  await front(RIDER);
  assert.deepEqual(selects, [ABC]);
  await selected(ABC, true);
  await front(WARP);
  assert.deepEqual(selects, [ABC, PINYIN], "离开 Warp 时用的是拼音：切回来就换回拼音");
  assert.equal(storage.get("lastUsed")?.[WARP.bundleId], PINYIN);
  await selected(PINYIN, true);
});

test("没有规则的应用跟着「记住上次」：第一次离开时用的那个就记下", async () => {
  await front(NOTES);
  assert.deepEqual(selects, [ABC, PINYIN], "第一次来备忘录：还不知道你在这里用什么，不动");
  await front(RIDER);
  await selected(ABC, true);
  await front(NOTES);
  assert.equal(selects.at(-1), PINYIN, "上次在备忘录里用的是拼音");
  await selected(PINYIN, true);
});

test("固定规则的应用不记：在 Rider 里离开时用的 ABC 不写进「上次用的」", async () => {
  await front(RIDER);
  await selected(ABC, true);
  await front(WARP);
  assert.equal(storage.get("lastUsed")?.[RIDER.bundleId], undefined);
});
