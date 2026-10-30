/**
 * 走查修正（jarvis-mac specs/20261030-190534-input-source-walkthrough-fixes F-1）：快切时只认最新一次、以系统此刻的输入源为准；
 * 切完被改回去时补切一次、只补一次。单独一个文件：要一个干净的假宿主与真实的计时器。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { ABC, PINYIN, extensionRoot, sources } from "./support.mjs";

const { createTestHost } = await import(pathToFileURL(join(extensionRoot, "..", "..", "sdk", "dist", "testing.js")).href);

const WARP = { bundleId: "dev.warp.Warp-Stable", name: "Warp", pid: 1 };
const WECOM = { bundleId: "com.tencent.WeWorkMac", name: "企业微信", pid: 2 };
const granted = ["hud.show", "inputSources.read", "inputSources.select", "system.activity"];
const storage = new Map([
  [
    "rules",
    {
      [WARP.bundleId]: { mode: "fixed", source: ABC, name: "Warp" },
      [WECOM.bundleId]: { mode: "fixed", source: PINYIN, name: "企业微信" },
    },
  ],
]);
let current = PINYIN;
const selects = [];
/** 下一次切到拼音之后，过 50 ms 被「别人」改回 ABC（只发生一次）。 */
let flipBackOnce = false;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const host = createTestHost({
  async: {
    "storage.get": async (params) => storage.get(params.key) ?? null,
    "storage.set": async (params) => void storage.set(params.key, params.value),
    "preferences.observe": async () => null,
    "preferences.all": async () => ({}),
    "inputSources.list": async () => sources,
    "inputSources.current": async () => ({ id: current }),
    "inputSources.select": async (params) => {
      selects.push(params.id);
      // 切到 ABC 慢一拍落地：复现「切到上一个应用的那一次晚落地」。
      if (params.id === ABC) await sleep(80);
      current = params.id;
      if (params.id === PINYIN && flipBackOnce) {
        flipBackOnce = false;
        setTimeout(() => (current = ABC), 50);
      }
      return { id: params.id, effective: true };
    },
    "inputSources.observe": async () => null,
    "frontmostApp.observe": async () => null,
    "hud.show": async () => null,
  },
});
await import(pathToFileURL(join(extensionRoot, "dist", "extension.js")).href);

const front = (app) => host.emit(host.subscriptionToken("frontmostApp"), app);

test("快切：企业微信 → Warp → 企业微信，中间不停；最后落在企业微信的输入法上", async () => {
  await host.menuBarEvent("start", { granted, preferences: {} });
  front(WECOM);
  await host.settle();
  assert.deepEqual(selects, [], "订阅时补发的那一条只记下、不切");

  front(WARP);
  front(WECOM);
  await host.settle();
  await sleep(450);
  await host.settle();
  assert.equal(current, PINYIN, "旧的做法：Warp 那一次的 ABC 晚落地，企业微信停在 ABC 上");
  assert.ok(!selects.includes(ABC), "被顶掉的那一次不再执行");
});

test("切过去之后被改回去：300 ms 后核对，补切一次，只补一次", async () => {
  front(WARP);
  await host.settle();
  await sleep(450);
  assert.equal(current, ABC);
  selects.length = 0;

  flipBackOnce = true;
  front(WECOM);
  await host.settle();
  await sleep(450);
  await host.settle();
  assert.deepEqual(selects, [PINYIN, PINYIN], "第一次切过去，被改回去之后再切一次");
  assert.equal(current, PINYIN);
  assert.ok(host.logs.some((entry) => entry.message.includes("又被改回去了")), "记一条日志");

  await sleep(450);
  assert.equal(selects.length, 2, "不循环");
});

test("核对之前又换了前台：那一次的核对作废", async () => {
  selects.length = 0;
  front(WARP);
  await host.settle();
  front(WECOM);
  await host.settle();
  await sleep(450);
  await host.settle();
  assert.deepEqual(selects, [ABC, PINYIN], "每次切到的都是此刻前台那个应用的输入法，核对不额外再切");
  assert.equal(current, PINYIN);
});
