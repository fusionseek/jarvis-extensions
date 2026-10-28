import test from "node:test";
import assert from "node:assert/strict";
import { createTestHost, fakeDaemons } from "../dist/testing.js";

// 常驻进程与系统代理（SDK 2.9）：线缆上的 namespace / method / 参数、订阅的 { id, token }，
// 以及 fakeDaemons() 守的宿主规则——「内核死了、扩展收到退出、系统代理被宿主还原」靠它断言。
const daemons = fakeDaemons({ daemons: [{ id: "sing-box", config: true }, { id: "helper", located: "" }] });
const host = createTestHost({ async: { ...daemons.stubs } });
const { defineExtension, jarvis, JarvisError } = await import("../dist/index.js");
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

test("status：没装的答空串；只有给了路径才把 executable 带上线缆", async () => {
  const missing = await jarvis.daemon.status("helper");
  assert.deepEqual(missing, { id: "helper", state: "stopped", executable: "" });
  assert.deepEqual(lastCall().params, { id: "helper" });
  const custom = await jarvis.daemon.status("sing-box", "/usr/local/bin/sing-box");
  assert.equal(custom.executable, "/usr/local/bin/sing-box");
  assert.deepEqual(lastCall().params, { id: "sing-box", executable: "/usr/local/bin/sing-box" });
  assert.equal(lastCall().namespace, "daemon");
  const undeclared = await rejection(jarvis.daemon.status("nope"));
  assert.ok(undeclared instanceof JarvisError && undeclared.code === "capability.undeclared");
});

test("系统代理：没有在跑的常驻进程时 enable 被拒（指着空端口等于断网）", async () => {
  assert.deepEqual(await jarvis.systemProxy.status(), { owner: "none", effective: false });
  const error = await rejection(jarvis.systemProxy.enable({ port: 7890 }));
  assert.equal(error.code, "host.failure");
  assert.equal(lastCall().namespace, "systemProxy");
  assert.equal(lastCall().method, "enable");
});

test("start：声明了 config 就必须带；起来之后是 running，配置正文留给断言", async () => {
  const noConfig = await rejection(jarvis.daemon.start({ id: "sing-box" }));
  assert.equal(noConfig.code, "invalid.argument");
  const badPort = await rejection(jarvis.daemon.start({ id: "sing-box", config: "{}", controlPort: 80 }));
  assert.equal(badPort.code, "invalid.argument");
  const notInstalled = await rejection(jarvis.daemon.start({ id: "helper" }));
  assert.equal(notInstalled.code, "host.failure");

  const status = await jarvis.daemon.start({ id: "sing-box", config: '{"log":{}}', controlPort: 19090 });
  assert.deepEqual(lastCall().params, { id: "sing-box", config: '{"log":{}}', controlPort: 19090 });
  assert.equal(status.state, "running");
  assert.equal(status.executable, "/opt/homebrew/bin/sing-box");
  assert.equal(status.controlPort, 19090);
  assert.ok(status.pid >= 1 && status.startedAt > 0);
  assert.equal(daemons.configs["sing-box"], '{"log":{}}');
  const again = await rejection(jarvis.daemon.start({ id: "sing-box", config: "{}" }));
  assert.equal(again.code, "host.failure", "已在运行：先 stop");
});

test("observe 带着 { id, token } 上线缆；输出推到监听者，logs 读得到；退订只发一次", async () => {
  const events = [];
  const off = jarvis.daemon.observe("sing-box", (event) => events.push(event));
  await host.settle();
  const subscribe = lastCall();
  assert.equal(subscribe.method, "observe");
  assert.equal(subscribe.params.id, "sing-box");
  assert.match(subscribe.params.token, /^daemon\.observe#\d+$/);
  assert.equal(daemons.observers("sing-box"), 1);

  daemons.output("sing-box", ["INFO started", "INFO inbound/mixed[mixed-in]: tcp server started at 127.0.0.1:7890"]);
  assert.deepEqual(events, [{ kind: "output", lines: ["INFO started", "INFO inbound/mixed[mixed-in]: tcp server started at 127.0.0.1:7890"] }]);
  assert.deepEqual(await jarvis.daemon.logs("sing-box"), ["INFO started", "INFO inbound/mixed[mixed-in]: tcp server started at 127.0.0.1:7890"]);

  off();
  off();
  await host.settle();
  const unsubscribes = host.invocations.filter((call) => call.namespace === "daemon" && call.method === "unsubscribe");
  assert.equal(unsubscribes.length, 1);
  assert.deepEqual(unsubscribes[0].params, subscribe.params);
  daemons.output("sing-box", ["INFO later"]);
  assert.equal(events.length, 1, "退订之后不再收到");
});

test("被拒的订阅（没声明的 id）只记一条 warn", async () => {
  jarvis.daemon.observe("nope", () => assert.fail("不该收到"));
  await host.settle();
  assert.ok(host.logs.some((log) => log.level === "warn" && log.message.includes("daemon.observe")));
});

test("控制口：只认 / 开头、不含 // 的路径与三个请求头；放行的交给 respond", async () => {
  daemons.respond = (request) => ({ status: 200, headers: { "Content-Type": "application/json" }, text: JSON.stringify({ path: request.path }) });
  const response = await jarvis.daemon.request({ id: "sing-box", method: "GET", path: "/proxies?x=1", headers: { Authorization: "Bearer s" }, timeout: 15 });
  assert.deepEqual(response, { status: 200, headers: { "Content-Type": "application/json" }, text: '{"path":"/proxies?x=1"}' });
  assert.deepEqual(lastCall().params, { id: "sing-box", method: "GET", path: "/proxies?x=1", headers: { Authorization: "Bearer s" }, timeout: 15 });
  assert.equal((await rejection(jarvis.daemon.request({ id: "sing-box", method: "GET", path: "//evil.example/" }))).code, "invalid.argument");
  assert.equal((await rejection(jarvis.daemon.request({ id: "sing-box", method: "GET", path: "/x", headers: { Cookie: "a" } }))).code, "invalid.argument");
  assert.equal((await rejection(jarvis.daemon.request({ id: "sing-box", method: "GET", path: "/x", timeout: 60 }))).code, "invalid.argument");
  assert.equal(daemons.requests.length, 1, "被拒的不算");
});

test("系统代理：进程在跑时接管；被别的工具拦着时不写、带回 blocker；另一个扩展占着时被拒", async () => {
  daemons.blockSystemProxy({ serviceName: "Surge", address: "127.0.0.1:6152", message: "当前系统代理由「Surge」提供" });
  const blocked = await jarvis.systemProxy.enable({ port: 7890 });
  assert.equal(blocked.owner, "none");
  assert.equal(blocked.blocker.serviceName, "Surge");
  daemons.blockSystemProxy(null);

  daemons.claimSystemProxy("别的代理");
  const taken = await rejection(jarvis.systemProxy.enable({ port: 7890 }));
  assert.equal(taken.code, "host.failure");
  assert.match(taken.message, /别的代理/);
  daemons.claimSystemProxy(null);

  const enabled = await jarvis.systemProxy.enable({ port: 7890, socks: true, bypass: ["*.corp"] });
  assert.deepEqual(lastCall().params, { port: 7890, socks: true, bypass: ["*.corp"] });
  assert.deepEqual(enabled, { owner: "self", port: 7890, effective: true, current: "127.0.0.1:7890" });
  assert.equal((await rejection(jarvis.systemProxy.enable({ port: 7890, bypass: ["a b"] }))).code, "invalid.argument");
});

test("内核自己死了：订阅者收到 expected: false 的 exit，宿主兜底把系统代理还原", async () => {
  const events = [];
  jarvis.daemon.observe("sing-box", (event) => events.push(event));
  await host.settle();
  daemons.crash("sing-box", { signal: 9, lines: ["FATAL killed"] });
  assert.equal(events.length, 1);
  assert.equal(events[0].kind, "exit");
  assert.equal(events[0].expected, false);
  assert.equal(events[0].signal, 9);
  assert.equal(events[0].lines.at(-1), "FATAL killed");
  assert.equal(daemons.status("sing-box").state, "exited");
  assert.deepEqual(await jarvis.systemProxy.status(), { owner: "none", effective: false });
  assert.equal((await rejection(jarvis.daemon.request({ id: "sing-box", method: "GET", path: "/" }))).code, "host.failure");
});

test("stop：在跑的停下并推 expected: true 的 exit，接管着的系统代理一起还原；再 stop 一次照常兑现", async () => {
  const events = [];
  await jarvis.daemon.start({ id: "sing-box", config: "{}", controlPort: 19090 });
  await jarvis.systemProxy.enable({ port: 7890 });
  jarvis.daemon.observe("sing-box", (event) => events.push(event));
  await host.settle();
  const stopped = await jarvis.daemon.stop("sing-box");
  assert.deepEqual(lastCall().params, { id: "sing-box" });
  assert.equal(stopped.state, "stopped");
  assert.equal(events.at(-1).kind, "exit");
  assert.equal(events.at(-1).expected, true);
  assert.equal(daemons.systemProxy.owner, "none");
  assert.equal((await jarvis.daemon.stop("sing-box")).state, "stopped");
});

test("failNext 演一次启动失败（1 秒内就退出了），下一次照常", async () => {
  daemons.failNext("daemon.start", { code: "host.failure", message: "sing-box 启动后 1 秒内退出", detail: "FATAL listen tcp 127.0.0.1:7890: bind: address already in use" });
  const error = await rejection(jarvis.daemon.start({ id: "sing-box", config: "{}" }));
  assert.equal(error.code, "host.failure");
  assert.match(error.detail, /address already in use/);
  assert.equal((await jarvis.daemon.start({ id: "sing-box", config: "{}" })).state, "running");
  assert.equal((await jarvis.systemProxy.disable()).owner, "none", "不是主人时 disable 是空操作");
  assert.ok(daemons.calls.some((call) => call.method === "daemon.start" && call.params.config === "{}"));
});
