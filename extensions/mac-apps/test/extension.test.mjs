/**
 * 整个扩展跑在假宿主上：服务 `launcher.apps · catalog` 读存储里的设置、读 `apps.list`、交回目录；没授权时原样拒绝；
 * 工具箱页改一项设置当场写进存储（下一次 catalog 就按新的来）。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { app, extensionRoot } from "./support.mjs";

const { createTestHost } = await import(pathToFileURL(join(extensionRoot, "..", "..", "sdk", "dist", "testing.js")).href);

const storage = new Map();
let denied = false;
const apps = [app("Xcode", { category: "public.app-category.developer-tools" }), app("计算器", { location: "system" })];
const host = createTestHost({
  async: {
    "storage.get": async ({ key }) => storage.get(key),
    "storage.set": async ({ key, value }) => void storage.set(key, value),
    "apps.list": async () => {
      if (denied) throw { code: "permission.denied", message: "没有「读取本机应用列表」的授权" };
      return apps;
    },
  },
});
await import(pathToFileURL(join(extensionRoot, "dist", "extension.js")).href);

test("catalog：默认按分类分组、搜索里 4 条、系统应用也列", async () => {
  const outcome = await host.callService({ point: "launcher.apps", service: "apps", method: "catalog", granted: ["apps.read"] });
  assert.equal(outcome.result.ok, true);
  assert.equal(outcome.result.value.searchLimit, 4);
  assert.deepEqual(outcome.result.value.groups.flatMap((g) => g.apps).sort(), ["/Applications/Xcode.app", "/System/Applications/计算器.app"]);
});

test("catalog 按存储里的设置：关掉系统应用、按首字母", async () => {
  storage.set("settings", { group: "letter", includeSystem: false });
  const outcome = await host.callService({ point: "launcher.apps", service: "apps", method: "catalog", granted: ["apps.read"] });
  assert.deepEqual(outcome.result.value.groups, [{ id: "letter:X", title: "X", apps: ["/Applications/Xcode.app"] }]);
  storage.delete("settings");
});

test("没授权：permission.denied 原样交回宿主", async () => {
  denied = true;
  const outcome = await host.callService({ point: "launcher.apps", service: "apps", method: "catalog" });
  denied = false;
  assert.equal(outcome.result.ok, false);
  assert.equal(outcome.result.error.code, "permission.denied");
});

test("工具箱页：改分组当场写进存储", async () => {
  await host.dispatch({ type: "activate", context: { surface: "toolbox", entry: "toolbox", granted: ["apps.read"], preferences: {}, commands: [] } });
  await host.settle();
  const segmented = host.find((node) => node.key === "group");
  assert.ok(segmented, "分组那一段");
  await host.fire(segmented, "change", "location");
  await host.settle();
  assert.equal(storage.get("settings").group, "location");
  assert.ok(host.find((node) => node.key === "preview"), "有授权时出预览");
});
