import test from "node:test";
import assert from "node:assert/strict";
import { createTestHost, fakeDaemons } from "../dist/testing.js";

// SDK 2.10（jarvis-mac specs/20261028-111714-proxy-tun-orb-traffic-page-rules）：TUN、常驻进程重载、悬浮球那一层、
// 浏览器当前页、挑文件——线缆上的 namespace / method / 参数，以及 fakeDaemons() 演的宿主规则。
const daemons = fakeDaemons({ daemons: [{ id: "sing-box", config: true, reload: true }, { id: "plain", config: true }] });
const tab = { browser: { bundleId: "com.apple.Safari", name: "Safari", path: "/Applications/Safari.app" }, frontmost: false, status: "ok", url: "https://github.com/x" };
const host = createTestHost({
  async: {
    ...daemons.stubs,
    "browser.activeTab": () => tab,
    "files.pick": (params) => (params?.title === "取消" ? null : { name: "a.conf", text: "[Rule]\nFINAL,DIRECT\n" }),
  },
});
const { defineExtension, jarvis, capabilityTiers, sdkVersion } = await import("../dist/index.js");
defineExtension({});

const rejection = async (promise) => {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  assert.fail("应该被拒绝");
};
const lastCall = () => host.invocations.at(-1);
const config = (port = 19090, extra = {}) =>
  JSON.stringify({ inbounds: [{ type: "mixed", tag: "mixed-in", listen: "127.0.0.1", listen_port: 7890 }], experimental: { clash_api: { external_controller: `127.0.0.1:${port}`, secret: "s" } }, ...extra });

test("SDK 是 2.10.0；三项新能力的档位", () => {
  assert.equal(sdkVersion, "2.10.0");
  assert.equal(capabilityTiers["network.tunnel"], "high");
  assert.equal(capabilityTiers["browser.activeTab"], "medium");
  assert.equal(capabilityTiers["files.pick"], "low");
});

test("daemon.reload：只对声明了 reload 的；状态保持 running、配置换成新的", async () => {
  await jarvis.daemon.start({ id: "plain", config: "{}" });
  const undeclared = await rejection(jarvis.daemon.reload({ id: "plain", config: "{}" }));
  assert.equal(undeclared.code, "capability.undeclared");
  const notRunning = await rejection(jarvis.daemon.reload({ id: "sing-box", config: "{}" }));
  assert.equal(notRunning.code, "host.failure");
  await jarvis.daemon.start({ id: "sing-box", config: '{"a":1}', controlPort: 19090 });
  const status = await jarvis.daemon.reload({ id: "sing-box", config: '{"a":2}' });
  assert.deepEqual(lastCall().params, { id: "sing-box", config: '{"a":2}' });
  assert.equal(lastCall().namespace, "daemon");
  assert.equal(lastCall().method, "reload");
  assert.equal(status.state, "running");
  assert.equal(daemons.configs["sing-box"], '{"a":2}');
  assert.equal(daemons.reloads["sing-box"], 1);
  await jarvis.daemon.stop("sing-box");
  await jarvis.daemon.stop("plain");
});

test("tunnel.status：没装网络助手；只有给了路径才带 executable", async () => {
  const status = await jarvis.tunnel.status();
  assert.deepEqual(lastCall().params, {});
  assert.equal(lastCall().namespace, "tunnel");
  assert.equal(status.state, "stopped");
  assert.equal(status.helper.state, "notInstalled");
  assert.equal(status.kernel.executable, "/opt/homebrew/bin/sing-box");
  await jarvis.tunnel.status("/usr/local/bin/sing-box");
  assert.deepEqual(lastCall().params, { executable: "/usr/local/bin/sing-box" });
});

test("tunnel.start：守卫拒掉文件路径、TUN 入站与错的控制口；取消授权什么都不装", async () => {
  const logOutput = await rejection(jarvis.tunnel.start({ config: config(19090, { log: { output: "/etc/x" } }), controlPort: 19090 }));
  assert.equal(logOutput.code, "invalid.argument");
  assert.match(logOutput.message, /log\.output/);
  const tun = await rejection(
    jarvis.tunnel.start({ config: JSON.stringify({ inbounds: [{ type: "tun", listen: "127.0.0.1" }], experimental: { clash_api: { external_controller: "127.0.0.1:19090" } } }), controlPort: 19090 }),
  );
  assert.match(tun.message, /TUN 段由宿主填/);
  const wrongPort = await rejection(jarvis.tunnel.start({ config: config(19091), controlPort: 19090 }));
  assert.match(wrongPort.message, /external_controller/);
  const badRoute = await rejection(jarvis.tunnel.start({ config: config(), controlPort: 19090, excludeRoutes: ["192.168.0.0"] }));
  assert.equal(badRoute.code, "invalid.argument");
  const ws = JSON.parse(config());
  ws.outbounds = [{ type: "vless", tag: "n", transport: { type: "ws", path: "/ray" } }];
  daemons.cancelNextInstall();
  const cancelled = await rejection(jarvis.tunnel.start({ config: JSON.stringify(ws), controlPort: 19090 }));
  assert.equal(cancelled.code, "permission.denied", "transport 里的 URL 路径不是文件路径；取消授权 = 什么都没装");
  assert.equal(daemons.installs, 0);
});

test("tunnel.start → 当场装好 → running；系统代理认 TUN 内核；崩了宿主还原系统代理", async () => {
  const events = [];
  const unsubscribe = jarvis.tunnel.observe((event) => events.push(event));
  await host.settle();
  assert.deepEqual(Object.keys(lastCall().params), ["token"]);
  const request = { config: config(), controlPort: 19090, excludeRoutes: ["192.168.0.0/16", "fc00::/7"], stack: "mixed", ipv6: true };
  const status = await jarvis.tunnel.start(request);
  assert.deepEqual(lastCall().params, request);
  assert.equal(status.state, "running");
  assert.equal(status.helper.state, "ready");
  assert.equal(status.controlPort, 19090);
  assert.equal(daemons.installs, 1);
  assert.deepEqual(daemons.tunnelStart, request);

  const enabled = await jarvis.systemProxy.enable({ port: 7890 });
  assert.equal(enabled.owner, "self");

  const reloaded = await jarvis.tunnel.reload(config());
  assert.deepEqual(lastCall().params, { config: config() });
  assert.equal(reloaded.state, "running");
  assert.equal(daemons.tunnelReloads, 1);

  daemons.respond = (r) => ({ status: 200, headers: {}, text: r.path });
  const response = await jarvis.tunnel.request({ method: "GET", path: "/connections" });
  assert.equal(response.text, "/connections");
  assert.equal(daemons.requests.at(-1).id, undefined);

  daemons.tunnelOutput(["INFO a"]);
  daemons.crashTunnel({ exitCode: 1, lines: ["FATAL x"] });
  await host.settle();
  assert.deepEqual(events.map((event) => event.kind), ["output", "exit"]);
  assert.equal(events[1].expected, false);
  assert.equal(daemons.systemProxy.owner, "none", "内核没了，宿主兜底还原");
  assert.deepEqual(await jarvis.tunnel.logs(), ["INFO a", "FATAL x"]);
  unsubscribe();
});

test("别的 VPN 占着主网卡：start 不启动、不抛，返回 blocker", async () => {
  daemons.blockTunnel({ interface: "utun4", serviceName: "Surge", message: "先在 Surge 里关掉增强模式" });
  const status = await jarvis.tunnel.start({ config: config(), controlPort: 19090 });
  assert.equal(status.state, "exited");
  assert.equal(status.blocker.interface, "utun4");
  daemons.blockTunnel(null);
  assert.equal((await jarvis.tunnel.stop()).state, "exited");
});

test("orb.update：模型原样上线缆，撤掉时是 null 而不是 {}", async () => {
  const model = { kind: "traffic", upload: 34000, download: 1200000, succeeded: 42, failed: 3, caption: "节点选择" };
  await jarvis.orb.update(model);
  assert.deepEqual(lastCall().params, model);
  assert.equal(lastCall().namespace, "orb");
  await jarvis.orb.update(null);
  assert.equal(lastCall().params, null);
  assert.deepEqual(host.orbModels, [model, null]);
  assert.equal(host.latestOrb, null);
});

test("browser.activeTab 与 files.pick", async () => {
  assert.deepEqual(await jarvis.browser.activeTab(), tab);
  assert.deepEqual(lastCall().params, {});
  assert.equal(lastCall().namespace, "browser");
  assert.equal(lastCall().method, "activeTab");
  const picked = await jarvis.files.pick({ title: "选一份 Surge 配置", directory: "~/Library", extensions: ["conf"] });
  assert.equal(picked.name, "a.conf");
  assert.deepEqual(lastCall().params, { title: "选一份 Surge 配置", directory: "~/Library", extensions: ["conf"] });
  assert.equal(await jarvis.files.pick({ title: "取消" }), null);
  await jarvis.files.pick();
  assert.deepEqual(lastCall().params, {});
});

test("菜单栏模型：chart、tone、两行 title 原样上线缆", async () => {
  const model = {
    title: "↑ 34K\n↓ 1.2M",
    items: [
      { kind: "chart", series: [{ tone: "download", values: [1, 2] }], caption: "↓ 1.2 MB/s" },
      { kind: "submenu", title: "当前页面", items: [{ kind: "submenu", title: "github.com", items: [{ kind: "item", id: "r:1", title: "直连" }] }] },
      { kind: "item", id: "recent:1", title: "x.invalid", tone: "critical" },
    ],
  };
  await jarvis.menuBar.update(model);
  assert.deepEqual(lastCall().params, model);
  assert.equal(host.menuItem("r:1").title, "直连", "三层里的项也找得到");
});
