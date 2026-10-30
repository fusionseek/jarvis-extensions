/**
 * 1.1 在假宿主上：副栏模式下点「‹」开副栏（锚在它下面、菜单栏不动）；副栏里点一颗 → 后台露出它的段、等它进屏幕、点开，
 * 菜单关上 0.3 秒收回；弹的不是菜单就按「点过某颗图标」至少等 20 秒；截图只在启动收起之前与为点开而露出时。
 * （jarvis-mac `specs/20261030-081832-menubar-manager-p2` N-7）
 */
import test, { mock } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { extra, extensionRoot, notchScreen } from "./support.mjs";

const { createTestHost } = await import(pathToFileURL(join(extensionRoot, "..", "..", "sdk", "dist", "testing.js")).href);

mock.timers.enable({ apis: ["setTimeout", "Date"] });

const preferences = { showIn: "bar" };
const granted = ["menuBar.pointer", "menuBarExtras.read", "menuBarExtras.capture", "menuBarExtras.control"];
const captured = [];
const pressed = [];
const runs = [];
let pressResult = { via: "accessibility" };

// 菜单栏随我们自己那枚边界的宽度变：撑开时隐藏段里的图标在屏幕外，缩回竖线时挪进屏幕。
let started = false;
function items() {
  const collapsed = started && host.statusItem("hidden")?.length === 10000;
  const hiddenX = collapsed ? -3700 : 1100;
  return [
    extra("net.mullvad.vpn", hiddenX - 50, { width: 46, onScreen: !collapsed, name: "Mullvad VPN" }),
    extra("com.tencent.xinWeChat", hiddenX, { width: 66, onScreen: !collapsed, name: "微信" }),
    extra("hidden-divider", collapsed ? -3626 : 1250, { width: collapsed ? 5016 : 22, onScreen: !collapsed, mine: "hidden" }),
    extra("com.nssurge.surge-mac", 1424, { width: 22, name: "Surge" }),
    extra("toggle", 1450, { width: 26, mine: "toggle" }),
  ];
}

const host = createTestHost({
  async: {
    "menuBar.update": async () => null,
    "menuBarPointer.observe": async () => null,
    "menuBarPointer.unsubscribe": async () => null,
    "preferences.observe": async () => null,
    "preferences.all": async () => preferences,
    "permissions.granted": async () => granted,
    "screens.list": async () => [notchScreen],
    "menuBarExtras.list": async () => items(),
    "menuBarExtras.capture": async (params) => {
      captured.push(params.ids);
      return params.ids.map((id) => ({ id, live: true, image: { id: `img-${id}`, name: `${id}.png`, byteCount: 10, extension: "png" }, capturedAt: 1 }));
    },
    "menuBarExtras.press": async (params) => {
      pressed.push(params);
      return pressResult;
    },
    "commands.run": async (params) => void runs.push(params),
    "ui.dismissPopover": async () => null,
  },
});
await import(pathToFileURL(join(extensionRoot, "dist", "extension.js")).href);

const collapsed = () => host.statusItem("hidden")?.length === 10000;

test("副栏模式启动：收起之前把露着的隐藏段截一次，之后照样收着", async () => {
  await host.menuBarEvent("start", { granted, preferences });
  started = true;
  assert.deepEqual(captured, [["net.mullvad.vpn", "com.tencent.xinWeChat"]], "只截隐藏段里露着的（显示段一直看得见）");
  assert.ok(collapsed());
});

test("点「‹」：开副栏、锚在它下面，菜单栏不动；⌥ 点连永远隐藏的一起", async () => {
  await host.menuBarEvent("press", { statusItem: "toggle", modifiers: [], granted });
  assert.deepEqual(runs.at(-1), { id: "bar", argument: "hidden", anchor: { statusItem: "toggle" } });
  assert.ok(collapsed(), "副栏模式下菜单栏本身不展开");
  await host.menuBarEvent("press", { statusItem: "toggle", modifiers: ["option"], granted });
  assert.equal(runs.at(-1).argument, "all");
});

test("副栏这一面：一排 iconButton，图是截到的那一张，点一颗交给 reveal-item 再关掉副栏", async () => {
  host.dispatch({ type: "activate", context: { entry: "command", surface: "popover", granted, preferences, commands: [] } });
  await host.dispatch({ type: "command", context: { id: "bar", trigger: "page", argument: "hidden", granted, preferences, commands: [] } });
  await host.settle();
  const wechat = host.find((node) => node.kind === "iconButton" && node.key === "com.tencent.xinWeChat");
  assert.equal(wechat.props.image.id, "img-com.tencent.xinWeChat");
  assert.equal(wechat.props.label, "微信");
  assert.equal(host.find((node) => node.kind === "iconButton" && node.key === "com.nssurge.surge-mac"), undefined, "显示段的不进副栏");
  assert.equal(host.find((node) => node.key === "bar").props.axis, "horizontal");
  await host.fire(wechat, "press");
  await host.settle();
  assert.deepEqual(runs.at(-1), { id: "reveal-item", argument: "com.tencent.xinWeChat" });
  assert.ok(host.invocations.some((entry) => entry.namespace === "ui" && entry.method === "dismissPopover"));
});

test("reveal-item：露出隐藏段、等它进屏幕、点开；菜单关上 0.3 秒收回", async () => {
  captured.length = 0;
  const done = host.dispatch({ type: "command", context: { id: "reveal-item", trigger: "page", argument: "com.tencent.xinWeChat", granted, preferences, commands: [] } });
  await host.settle();
  mock.timers.tick(100);
  await done;
  await host.settle();
  assert.equal(host.statusItem("hidden").length, "auto", "为了点它，隐藏段临时露出来");
  const request = pressed.at(-1);
  assert.equal(request.id, "com.tencent.xinWeChat");
  assert.ok(request.token, "要菜单开关");
  assert.deepEqual(captured.at(-1), ["net.mullvad.vpn", "com.tencent.xinWeChat"], "它们此刻露着：顺手刷新截图");

  host.emit(request.token, { id: request.id, state: "opened" });
  await host.settle();
  mock.timers.tick(60_000);
  await host.settle();
  assert.equal(host.statusItem("hidden").length, "auto", "菜单开着不收");

  host.emit(request.token, { id: request.id, state: "closed" });
  await host.settle();
  mock.timers.tick(350);
  await host.settle();
  assert.ok(collapsed(), "菜单一关就收回");
});

test("reveal-item 弹的不是菜单（none）：按「点过某颗图标」至少等 20 秒", async () => {
  const done = host.dispatch({ type: "command", context: { id: "reveal-item", trigger: "page", argument: "net.mullvad.vpn", granted, preferences, commands: [] } });
  await host.settle();
  mock.timers.tick(100);
  await done;
  await host.settle();
  const request = pressed.at(-1);
  assert.equal(request.id, "net.mullvad.vpn");
  host.emit(request.token, { id: request.id, state: "none" });
  await host.settle();
  mock.timers.tick(15_000);
  await host.settle();
  assert.equal(host.statusItem("hidden").length, "auto", "它弹了一扇窗或面板：10 秒太快");
  mock.timers.tick(6_000);
  await host.settle();
  assert.ok(collapsed());
});
