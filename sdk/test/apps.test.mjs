import test from "node:test";
import assert from "node:assert/strict";
import { createTestHost } from "../dist/testing.js";

// 本机应用（SDK 2.5）：档位、线缆上的 namespace / method、launcher.apps 的服务分派。
const apps = [
  { id: "/Applications/Xcode.app", name: "Xcode", bundleId: "com.apple.dt.Xcode", path: "/Applications/Xcode.app",
    category: "public.app-category.developer-tools", categoryTitle: "开发工具", version: "26.0", location: "applications",
    locationTitle: "应用程序", lastUsedAt: 1_800_000_000_000, addedAt: null, system: false, deletable: true },
];
let calls = [];
const host = createTestHost({
  async: {
    "apps.list": async (params) => {
      calls.push(params);
      return apps;
    },
  },
});
const { defineExtension, jarvis, capabilityTiers, sdkVersion } = await import("../dist/index.js");

defineExtension({
  services: {
    apps: {
      async catalog(context) {
        const list = await jarvis.apps.list();
        return { showInSearch: context.preferences.show !== false, searchLimit: 4, groups: [{ id: "all", title: "全部", apps: list.map((app) => app.id) }] };
      },
    },
  },
});

test("apps.read 是中档；SDK 是 2.13.0", () => {
  assert.equal(capabilityTiers["apps.read"], "medium");
  assert.equal(sdkVersion, "2.13.0");
});

test("jarvis.apps.list 按 namespace = apps、method = list 上线缆，不带参数", async () => {
  calls = [];
  const list = await jarvis.apps.list();
  assert.deepEqual(list, apps);
  assert.deepEqual(calls, [{}]);
});

test("launcher.apps · catalog：实现拿到宿主给的偏好，目录经 service.resolve 交回", async () => {
  const outcome = await host.callService({ point: "launcher.apps", service: "apps", method: "catalog", preferences: { show: false }, granted: ["apps.read"] });
  assert.deepEqual(outcome.result, {
    ok: true,
    value: { showInSearch: false, searchLimit: 4, groups: [{ id: "all", title: "全部", apps: ["/Applications/Xcode.app"] }] },
  });
});

test("launcher.apps 不认识的方法：交回 capability.unknown，不抛", async () => {
  const outcome = await host.callService({ point: "launcher.apps", service: "apps", method: "describe" });
  assert.equal(outcome.result.ok, false);
});
