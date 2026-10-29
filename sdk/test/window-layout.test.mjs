import test from "node:test";
import assert from "node:assert/strict";
import { createTestHost } from "../dist/testing.js";

// jarvis-mac specs/20261029-082059-proxy-window-desktop-layout D-2…D-6：
// layout.header、section 的面板头分段、table 的选中与自滚、grid 的比例与撑满、text 的 metric 档——线缆上的形状。
const host = createTestHost({ async: {} });
const { defineExtension, layout, ui } = await import("../dist/index.js");

const events = [];
defineExtension({
  window: {
    render: () =>
      layout.sidebar({
        key: "nav",
        value: "processes",
        items: [
          { value: "activity", title: "活动", symbol: "waveform.path.ecg" },
          { value: "processes", title: "进程", symbol: "cpu" },
        ],
        onChange: () => {},
        children: [
          ui.stack({
            key: "page",
            children: [
              layout.header({
                key: "head",
                title: "进程",
                subtitle: "7 个程序 · 14 条连接",
                tint: "live",
                children: [ui.search({ key: "filter", value: "", label: "筛选", onChange: () => {} })],
              }),
              ui.text({ key: "big", text: "86 ms", style: "metric" }),
              layout.grid({
                key: "split",
                minimum: 360,
                weights: [2, 3],
                fill: true,
                children: [
                  ui.section({
                    key: "left",
                    title: "程序",
                    segments: [
                      { value: "now", title: "此刻" },
                      { value: "today", title: "今天", help: "今天的合计" },
                    ],
                    segment: "now",
                    segmentLabel: "看哪一份",
                    onSegment: (value) => events.push(["segment", value]),
                    children: [
                      layout.table({
                        key: "processes",
                        columns: [{ title: "程序", width: "fill" }],
                        rows: [{ id: "Safari", cells: ["Safari"] }, { cells: ["（没有 id 的行点不了）"] }],
                        selection: "Safari",
                        scroll: true,
                        onSelect: (id) => events.push(["select", id]),
                      }),
                    ],
                  }),
                  ui.section({ key: "right", title: "连接", children: [] }),
                ],
              }),
            ],
          }),
        ],
      }),
  },
});

host.dispatch({ type: "activate", context: { entry: "search", surface: "window", granted: [], preferences: {}, commands: [] } });
await host.settle();
const find = (key) => host.find((node) => node.key === key);

test("layout.header：title / subtitle / tint 进 props，右侧控件留在 children，本身不挂事件", () => {
  const head = find("head");
  assert.equal(head.kind, "header");
  assert.deepEqual(head.props, { title: "进程", subtitle: "7 个程序 · 14 条连接", tint: "live" });
  assert.equal(head.on, undefined);
  assert.deepEqual(head.children.map((child) => child.kind), ["search"]);
});

test("text 的 metric 档原样上线缆", () => {
  assert.equal(find("big").props.style, "metric");
});

test("grid.weights / fill 进 props", () => {
  assert.deepEqual(find("split").props, { minimum: 360, weights: [2, 3], fill: true });
});

test("section 的分段：segments / segment / segmentLabel 进 props，onSegment 换成 on.segment，回传被点那一段的 value", async () => {
  const left = find("left");
  assert.deepEqual(left.props.segments, [
    { value: "now", title: "此刻" },
    { value: "today", title: "今天", help: "今天的合计" },
  ]);
  assert.equal(left.props.segment, "now");
  assert.equal(left.props.segmentLabel, "看哪一份");
  assert.deepEqual(Object.keys(left.on), ["segment"]);
  await host.fire(left, "segment", "today");
  assert.deepEqual(events.at(-1), ["segment", "today"]);
});

test("table：行的 id、selection、scroll 进 props，onSelect 换成 on.select，回传被点那一行的 id", async () => {
  const table = find("processes");
  assert.deepEqual(table.props.rows, [{ id: "Safari", cells: ["Safari"] }, { cells: ["（没有 id 的行点不了）"] }]);
  assert.equal(table.props.selection, "Safari");
  assert.equal(table.props.scroll, true);
  assert.deepEqual(Object.keys(table.on), ["select"]);
  await host.fire(table, "select", "Safari");
  assert.deepEqual(events.at(-1), ["select", "Safari"]);
});
