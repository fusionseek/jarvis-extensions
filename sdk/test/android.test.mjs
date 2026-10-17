import test from "node:test";
import assert from "node:assert/strict";
import { createTestHost, fakeAndroid } from "../dist/testing.js";

// Android 操作域（SDK 2.4）：档位、线缆上的 namespace / method / 参数、假手机守的宿主规则，以及 row 的 image。
const icon = { id: "icon-1", name: "com.example.chat.png", byteCount: 2048, extension: "png" };
const phone = fakeAndroid({
  devices: [
    {
      serial: "R5CX",
      name: "Pixel 8",
      apps: [
        { package: "com.example.chat", system: false, apkBytes: 120_000_000, dataBytes: 300_000_000, cacheBytes: 20_000_000 },
        { package: "com.android.settings", system: true, apkBytes: 30_000_000, dataBytes: null, cacheBytes: null },
      ],
      details: { "com.example.chat": { label: "聊天", versionName: "8.0.50", icon } },
    },
    { serial: "EMU1", state: "unauthorized" },
  ],
});
const host = createTestHost({ async: { ...phone.stubs } });
const { defineExtension, jarvis, capabilityTiers, maximumAndroidAppDetailsPerCall, ui } = await import("../dist/index.js");

defineExtension({
  toolbox: {
    render: () =>
      ui.scroll({
        children: [ui.row({ key: "app", image: icon, title: "聊天", subtitle: "com.example.chat · 440 MB" }), ui.row({ key: "plain", symbol: "app", title: "无图" })],
      }),
  },
});

const rejection = async (promise) => {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  assert.fail("应该被拒绝");
};

test("Android 操作域的档位：读是中，交给工具是低；一次至多 8 个包", () => {
  assert.equal(capabilityTiers["android.apps.read"], "medium");
  assert.equal(capabilityTiers["android.tools.open"], "low");
  assert.equal(maximumAndroidAppDetailsPerCall, 8);
});

test("jarvis.android.* 按 namespace = android、方法名原样上线缆，参数不改写", async () => {
  const devices = await jarvis.android.devices();
  assert.deepEqual(devices, [
    { serial: "R5CX", name: "Pixel 8", state: "device", ready: true },
    { serial: "EMU1", name: "EMU1", state: "unauthorized", ready: false },
  ]);
  const user = await jarvis.android.apps({ serial: "R5CX" });
  assert.deepEqual(user.apps.map((app) => app.package), ["com.example.chat"], "scope 省略 = 只列用户应用");
  const all = await jarvis.android.apps({ serial: "R5CX", scope: "all" });
  assert.equal(all.apps.length, 2);
  const details = await jarvis.android.appDetails({ serial: "R5CX", packages: ["com.example.chat", "com.missing"] });
  assert.deepEqual(details[0], { package: "com.example.chat", label: "聊天", versionName: "8.0.50", icon, problem: null });
  assert.equal(details[1].problem, "设备上没有这个应用");
  await jarvis.android.openTool({ tool: "apkScan", package: "com.example.chat" });
  assert.deepEqual(phone.opened, [{ tool: "apkScan", package: "com.example.chat" }]);

  const wire = host.invocations.filter((request) => request.namespace === "android").map((request) => [request.method, request.params]);
  assert.deepEqual(wire, [
    ["devices", {}],
    ["apps", { serial: "R5CX" }],
    ["apps", { serial: "R5CX", scope: "all" }],
    ["appDetails", { serial: "R5CX", packages: ["com.example.chat", "com.missing"] }],
    ["openTool", { tool: "apkScan", package: "com.example.chat" }],
  ]);
});

test("假手机守宿主的规则：1…8 个包、设备要 ready、工具只认两种", async () => {
  const nine = Array.from({ length: 9 }, (_, index) => `com.p${index}`);
  assert.equal((await rejection(jarvis.android.appDetails({ serial: "R5CX", packages: nine }))).code, "invalid.argument");
  assert.equal((await rejection(jarvis.android.appDetails({ serial: "R5CX", packages: [] }))).code, "invalid.argument");
  assert.equal((await rejection(jarvis.android.apps({ serial: "" }))).code, "invalid.argument");
  assert.equal((await rejection(jarvis.android.apps({ serial: "R5CX", scope: "system" }))).code, "invalid.argument");
  const unauthorized = await rejection(jarvis.android.apps({ serial: "EMU1" }));
  assert.equal(unauthorized.code, "host.failure");
  assert.equal(unauthorized.message, "手机上还没有允许 USB 调试");
  assert.equal((await rejection(jarvis.android.apps({ serial: "GONE" }))).code, "host.failure");
  assert.equal((await rejection(jarvis.android.openTool({ tool: "shell", package: "com.example.chat" }))).code, "invalid.argument");
  assert.equal((await rejection(jarvis.android.openTool({ tool: "dataExport", package: "" }))).code, "invalid.argument");
});

test("failNext 让下一次失败；holdDetails 挂住时数得出在途个数", async () => {
  phone.failNext("devices", { code: "host.failure", message: "未找到 adb" });
  const failed = await rejection(jarvis.android.devices());
  assert.equal(failed.code, "host.failure");
  assert.equal(failed.message, "未找到 adb");
  assert.equal((await jarvis.android.devices()).length, 2, "只失败一次");

  const release = phone.holdDetails();
  const first = jarvis.android.appDetails({ serial: "R5CX", packages: ["com.example.chat"] });
  const second = jarvis.android.appDetails({ serial: "R5CX", packages: ["com.android.settings"] });
  for (let i = 0; i < 8; i += 1) await new Promise((resolve) => setImmediate(resolve));
  assert.equal(phone.detailsInFlight, 2);
  release();
  await Promise.all([first, second]);
  assert.equal(phone.detailsInFlight, 0);
  assert.equal(phone.maxDetailsInFlight, 2);
});

test("row 的 image 原样进 props（宿主颁发的句柄），没有它的行照常带 symbol", async () => {
  host.dispatch({ type: "activate", context: { entry: "toolbox", surface: "toolbox", granted: [], preferences: {}, commands: [] } });
  await host.settle();
  const withImage = host.find((node) => node.key === "app");
  assert.deepEqual(withImage.props.image, icon);
  assert.equal(withImage.props.symbol, undefined);
  assert.equal(host.find((node) => node.key === "plain").props.symbol, "app");
});
