import test from "node:test";
import assert from "node:assert/strict";
import { createTestHost } from "../dist/testing.js";

// SDK 2.10 折叠（jarvis-mac specs/20261028-130540-proxy-walkthrough-fixes）：jarvis.preferences.set 的线缆、ui.chart 的线缆形状。
const writes = [];
const host = createTestHost({
  async: {
    "preferences.set": (params) => {
      writes.push(params);
      if (params.key === "subscriptions") throw Object.assign(new Error("只有用户能在设置页里改"), { code: "invalid.argument" });
      return null;
    },
  },
});
const { defineExtension, jarvis, ui } = await import("../dist/index.js");
defineExtension({
  toolbox: {
    render: () =>
      ui.scroll({
        children: [ui.chart({ key: "traffic", series: [{ tone: "download", values: [0, 1024] }, { tone: "upload", values: [0, 64] }], caption: "↓ 1.0K", label: "代理流量曲线" })],
      }),
  },
});

test("preferences.set：namespace / method / 参数一字不改；宿主拒绝原样抛给扩展", async () => {
  await jarvis.preferences.set("tun", true);
  const call = host.invocations.at(-1);
  assert.equal(call.namespace, "preferences");
  assert.equal(call.method, "set");
  assert.deepEqual(call.params, { key: "tun", value: true });
  await assert.rejects(jarvis.preferences.set("subscriptions", "https://x"), (error) => error.code === "invalid.argument");
  assert.deepEqual(writes.map((write) => write.key), ["tun", "subscriptions"]);
});

test("ui.chart：series / caption / label 进 props，没有句柄、没有子节点", async () => {
  host.dispatch({ type: "activate", context: { entry: "toolbox", surface: "toolbox", granted: [], preferences: {}, commands: [] } });
  await host.settle();
  const chart = host.find((node) => node.kind === "chart");
  assert.ok(chart, "提交里要有 chart 节点");
  assert.equal(chart.key, "traffic");
  assert.deepEqual(chart.props, {
    series: [{ tone: "download", values: [0, 1024] }, { tone: "upload", values: [0, 64] }],
    caption: "↓ 1.0K",
    label: "代理流量曲线",
  });
  assert.equal(chart.on, undefined);
  assert.equal(chart.children, undefined);
});
