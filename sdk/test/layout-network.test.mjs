import test from "node:test";
import assert from "node:assert/strict";
import { createTestHost } from "../dist/testing.js";

// jarvis-mac specs/20261028-191224-git-push-error-proxy-dashboard-issue-links P-1 / P-2 / P-3：
// layout.* 五种节点的线缆形状、networkStatus() 的线缆、菜单栏模型的 hidden。
const host = createTestHost({
  async: {
    "network.status": () => ({ kind: "wifi", interface: "en0", name: "Wi-Fi" }),
  },
});
const { defineExtension, jarvis, layout, networkStatus, ui } = await import("../dist/index.js");

let page = "activity";
const picked = [];
defineExtension({
  window: {
    render: () =>
      layout.sidebar({
        key: "nav",
        label: "代理",
        value: page,
        items: [
          { value: "activity", title: "活动", symbol: "waveform.path.ecg" },
          { value: "rules", title: "规则", symbol: "list.bullet.rectangle" },
        ],
        onChange: (value) => {
          picked.push(value);
          page = value;
        },
        children: [
          ui.scroll({
            children: [
              layout.grid({ key: "cards", minimum: 160, children: [ui.card({ children: [ui.text({ text: "延迟" })] })] }),
              layout.bars({ key: "hours", labels: ["0", "1"], series: [{ tone: "download", values: [1, 2] }], caption: "今天" }),
              layout.table({
                key: "rules",
                columns: [{ title: "ID", width: "narrow", alignment: "trailing", mono: true }, { title: "目标", width: "fill" }],
                rows: [{ cells: ["1", "google.com"], tint: "neutral" }],
                emptyText: "没有规则",
              }),
              layout.preference({ key: "subs", preference: "subscriptions" }),
            ],
          }),
        ],
      }),
  },
});

test("layout.sidebar：items / value / label 进 props，onChange 换成 on.change，唯一的子节点留在 children", async () => {
  host.dispatch({ type: "activate", context: { entry: "search", surface: "window", granted: [], preferences: {}, commands: [] } });
  await host.settle();
  const root = host.latest;
  assert.equal(root.kind, "sidebar");
  assert.equal(root.key, "nav");
  assert.deepEqual(root.props, {
    label: "代理",
    value: "activity",
    items: [
      { value: "activity", title: "活动", symbol: "waveform.path.ecg" },
      { value: "rules", title: "规则", symbol: "list.bullet.rectangle" },
    ],
  });
  assert.deepEqual(Object.keys(root.on), ["change"]);
  assert.equal(root.children.length, 1);
  assert.equal(root.children[0].kind, "scroll");
  await host.fire(root, "change", "rules");
  assert.deepEqual(picked, ["rules"]);
});

test("layout.grid / bars / table / preference：取值原样进 props，没有句柄", () => {
  const grid = host.find((node) => node.kind === "grid");
  assert.deepEqual(grid.props, { minimum: 160 });
  assert.equal(grid.children.length, 1);
  const bars = host.find((node) => node.kind === "bars");
  assert.deepEqual(bars.props, { labels: ["0", "1"], series: [{ tone: "download", values: [1, 2] }], caption: "今天" });
  const table = host.find((node) => node.kind === "table");
  assert.deepEqual(table.props.columns[0], { title: "ID", width: "narrow", alignment: "trailing", mono: true });
  assert.deepEqual(table.props.rows, [{ cells: ["1", "google.com"], tint: "neutral" }]);
  assert.equal(table.props.emptyText, "没有规则");
  const preference = host.find((node) => node.kind === "preference");
  assert.deepEqual(preference.props, { preference: "subscriptions" }, "上线缆就是 props.preference（不叫 key：key 是节点自己的身份，序列化时被拿走）");
  assert.equal(preference.key, "subs", "节点自己的身份照旧是 key");
  for (const node of [grid, bars, table, preference]) assert.equal(node.on, undefined);
});

test("networkStatus()：namespace = network、method = status、不带参数", async () => {
  assert.deepEqual(await networkStatus(), { kind: "wifi", interface: "en0", name: "Wi-Fi" });
  const call = host.invocations.at(-1);
  assert.equal(call.namespace, "network");
  assert.equal(call.method, "status");
  assert.deepEqual(call.params, {});
});

test("menuBar.update：hidden 原样上线缆", async () => {
  await jarvis.menuBar.update({ hidden: true, items: [] });
  assert.deepEqual(host.latestMenuBar, { hidden: true, items: [] });
});
