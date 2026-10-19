/**
 * 纯函数：设置的读法、排序、分组（分类 / 首字母 / 位置 / 不分组）、交给全局搜索的目录、页面预览。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { app, loadModel } from "./support.mjs";

const model = await loadModel();
const dev = "public.app-category.developer-tools";
const prod = "public.app-category.productivity";

test("设置：认不出的字段回落到默认", () => {
  assert.deepEqual(model.normalizeSettings(undefined), model.defaultSettings);
  assert.deepEqual(model.normalizeSettings({ group: "letter", sort: "bogus", showInSearch: false, searchLimit: 5, includeSystem: "yes" }), {
    group: "letter", sort: "name", showInSearch: false, searchLimit: 4, includeSystem: true,
  });
});

test("排序：名称按拼音；最近使用 / 最近添加新的在先，没有时刻的在后", () => {
  const apps = [app("Xcode", { lastUsedAt: 10 }), app("微信", { lastUsedAt: 30, addedAt: 5 }), app("Arc"), app("备忘录", { addedAt: 9 })];
  assert.deepEqual(model.sortApps(apps, "name").map((a) => a.name), ["Arc", "备忘录", "微信", "Xcode"]);
  assert.deepEqual(model.sortApps(apps, "recent").map((a) => a.name), ["微信", "Xcode", "Arc", "备忘录"]);
  assert.deepEqual(model.sortApps(apps, "added").map((a) => a.name), ["备忘录", "微信", "Arc", "Xcode"]);
});

test("首字母：拉丁取本身，汉字按拼音，数字与符号归 #", () => {
  assert.equal(model.letterOf("safari"), "S");
  assert.equal(model.letterOf("微信"), "W");
  assert.equal(model.letterOf("落格输入法"), "L");
  assert.equal(model.letterOf("日历"), "R");
  assert.equal(model.letterOf("1Password"), "#");
});

test("按分类分组：分类名拼音序、「其他」最后，组里按名称", () => {
  const apps = [app("Xcode", { category: dev }), app("Terminal", { category: dev }), app("Notes", { category: prod }), app("Foo")];
  const groups = model.groupApps(apps, { ...model.defaultSettings });
  assert.deepEqual(groups.map((g) => g.title), ["开发工具", "效率", "其他"]);
  assert.deepEqual(groups[0].apps, ["/Applications/Terminal.app", "/Applications/Xcode.app"]);
});

test("按首字母 / 位置 / 不分组", () => {
  const apps = [app("Xcode"), app("微信"), app("1Password"), app("计算器", { location: "system" })];
  const letters = model.groupApps(apps, { ...model.defaultSettings, group: "letter" });
  assert.deepEqual(letters.map((g) => g.title), ["J", "W", "X", "#"]);
  const locations = model.groupApps(apps, { ...model.defaultSettings, group: "location" });
  assert.deepEqual(locations.map((g) => g.title), ["应用程序", "系统"]);
  const all = model.groupApps(apps, { ...model.defaultSettings, group: "none" });
  assert.equal(all.length, 1);
  assert.equal(all[0].title, "全部应用");
  assert.deepEqual(model.groupApps([], { ...model.defaultSettings, group: "none" }), [], "空清单不出空组");
});

test("目录：带上搜索设置；关掉系统应用时网格与搜索里都没有它", () => {
  const apps = [app("Xcode", { category: dev }), app("计算器", { location: "system", category: "public.app-category.utilities" })];
  const full = model.catalog(apps, model.defaultSettings);
  assert.equal(full.showInSearch, true);
  assert.equal(full.searchLimit, 4);
  assert.equal(full.groups.flatMap((g) => g.apps).length, 2);
  const userOnly = model.catalog(apps, { ...model.defaultSettings, includeSystem: false, showInSearch: false, searchLimit: 6 });
  assert.deepEqual(userOnly.groups.flatMap((g) => g.apps), ["/Applications/Xcode.app"]);
  assert.equal(userOnly.showInSearch, false);
  assert.equal(userOnly.searchLimit, 6);
});

test("预览：每组个数与前三个名字", () => {
  const apps = ["Arc", "Bear", "Cursor", "Dash"].map((name) => app(name, { category: dev }));
  assert.deepEqual(model.preview(apps, model.defaultSettings), [{ id: `category:${dev}`, title: "开发工具", count: 4, sample: "Arc、Bear、Cursor 等" }]);
});
