/**
 * 标准输出解析、大小记号、进度估计、区段中文名、版本号与命令偏好（移植自宿主 `MoleCleanerTests`）。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { loadSource, sampleOutput } from "./support.mjs";

const {
  CleanOutputParser,
  bytesFromToken,
  localizedTitle,
  sectionOrder,
  sectionHeading,
  parseVersion,
  commandPreference,
  describeProblem,
  panelSize,
} = await loadSource();

const feed = (lines) => {
  const parser = new CleanOutputParser();
  for (const line of lines) parser.consume(line);
  return parser;
};

test("读出区段、每一行与末尾的总数", () => {
  const parser = feed(sampleOutput);
  assert.deepEqual(parser.sections.map((s) => s.title), ["System", "User essentials", "Browsers", "Developer tools"]);
  assert.equal(parser.sections[1].freedBytes, 2_400_000_000 + 312_500_000);
  assert.equal(parser.sections[1].itemCount, 1 + 12 + 9, "没写条目数的行算 1 项；只写条目数的行不加大小");
  assert.equal(parser.sections[2].freedBytes, 48_200_000, "✗ 行不计");
  assert.equal(parser.sections[2].itemCount, 3);
  assert.equal(parser.sections[3].freedBytes, 1_100_000_000);
  assert.equal(parser.sections[0].itemCount, 0);
  assert.equal(parser.systemSkipped, true);
  assert.equal(parser.heading, "Cleanup complete");
  assert.equal(parser.trackedBytes, 3_870_000_000);
  assert.equal(parser.trackedItems, 26);
  assert.equal(parser.freeSpaceDelta, "+4.10GB");
  assert.ok(Math.abs(parser.estimatedFraction - 5 / 15) < 1e-12, "读到第 6 段 Developer tools 的开头");
});

test("进度估计跟着 Mole 固定的区段顺序走", () => {
  const parser = new CleanOutputParser();
  assert.equal(parser.estimatedFraction, 0);
  parser.consume("➤ Browsers");
  assert.ok(Math.abs(parser.estimatedFraction - 3 / 15) < 1e-12);
  parser.consume("➤ Something Mole adds later");
  assert.ok(Math.abs(parser.estimatedFraction - 3 / 15) < 1e-12, "不认识的区段不推进、也不倒退");
  parser.consume("➤ Project artifacts");
  assert.ok(Math.abs(parser.estimatedFraction - 14 / 15) < 1e-12);
  assert.equal(sectionOrder.length, 15);
});

test("大小记号用十进制单位；区段名翻成中文，不认识的原样显示", () => {
  assert.equal(bytesFromToken("2.40GB"), 2_400_000_000);
  assert.equal(bytesFromToken("512.3MB"), 512_300_000);
  assert.equal(bytesFromToken("12KB"), 12_000);
  assert.equal(bytesFromToken("100B"), 100);
  assert.equal(bytesFromToken("1TB"), 1_000_000_000_000);
  assert.equal(bytesFromToken("items"), null);
  assert.equal(bytesFromToken("GB"), null);
  assert.equal(bytesFromToken("-1GB"), null);
  assert.equal(bytesFromToken("DB"), null, "以 B 结尾的词不是大小");
  assert.equal(bytesFromToken("infGB"), null);
  assert.equal(localizedTitle("Developer tools"), "开发工具缓存");
  assert.equal(localizedTitle("External volume"), "外接卷");
  assert.equal(localizedTitle("Something new"), "Something new", "不认识的原样显示");
});

/** Mole 1.59 源码里真实存在的几种不带 ` · ` 的写法（`lib/clean/*.sh`）。 */
test("标准输出里那些不规整的行", () => {
  const parser = feed([
    "➤ App leftovers",
    "  ✓ Cleaned 2 items, about 7.8MB",
    "  ✓ Orphaned app container stubs, 3 removed",
    "➤ Developer tools",
    "  ✓ Xcode Simulator system cache · removed 4 (1.2GB)",
    "  ✓ Python bytecode cache · ~/Dev · 3 dirs, 25KB",
    "  ✓ bun cache · skipped (whitelist)",
    "  ✓ Nothing to clean",
    "➤ Browsers",
    "  ✓ Chrome Service Worker · 2.40GB, 3 protected",
    "  ✓ Trash · emptied, 40 items",
  ]);
  assert.equal(parser.sections[0].freedBytes, 7_800_000);
  assert.equal(parser.sections[0].itemCount, 2 + 3, "「Cleaned 2 items」算 2，「3 removed」算 3");
  assert.equal(parser.sections[1].freedBytes, 1_200_000_000 + 25_000, "括号里的大小照读");
  assert.equal(parser.sections[1].itemCount, 4 + 3, "「removed 4」算 4；skipped 与 Nothing to clean 不算清掉了东西");
  assert.deepEqual(parser.sections[1].notes, ["bun cache：skipped (whitelist)"]);
  assert.equal(parser.sections[2].freedBytes, 2_400_000_000);
  assert.equal(parser.sections[2].itemCount, 1 + 40);
});

test("区段之前的 ✓ 行不计；Tracked 行带 At least 也读得出；区段标题去掉颜色码", () => {
  const parser = feed([
    "  ✓ Orphan before any section · 9.9GB",
    "\u001B[1m➤ User essentials\u001B[0m",
    "Tracked cleanup: At least 1.5GB | Items cleaned: 7",
    "Free space: 100GB",
  ]);
  assert.deepEqual(parser.sections.map((s) => s.title), ["User essentials"]);
  assert.equal(parser.sections[0].freedBytes, 0);
  assert.equal(parser.trackedBytes, 1_500_000_000);
  assert.equal(parser.trackedItems, 7);
  assert.equal(parser.freeSpaceDelta, null, "没有括号就没有变化量");
  assert.equal(sectionHeading("  ➤ Browsers  "), "Browsers");
  assert.equal(sectionHeading("  ✓ Browsers"), null);
});

test("版本号从 `Mole version x` 那一行取", () => {
  assert.equal(parseVersion(["", "Mole version 1.59.1", "macOS 26.0"]), "1.59.1");
  assert.equal(parseVersion(["mo: command not found"]), null);
});

test("命令偏好：去掉空白，空的、不是字符串的回到 mo", () => {
  assert.equal(commandPreference({}), "mo");
  assert.equal(commandPreference({ command: "  /opt/tools/mo  " }), "/opt/tools/mo");
  assert.equal(commandPreference({ command: "   " }), "mo");
  assert.equal(commandPreference({ command: 42 }), "mo");
});

test("找不到 mo 的三种说法", () => {
  assert.equal(describeProblem("notFound", "mo"), "没有找到 mo 命令");
  assert.equal(describeProblem("missing", "~/tools/mo"), "填的路径 ~/tools/mo 不存在");
  assert.equal(describeProblem("notExecutable", "/x/mo"), "/x/mo 不是可执行文件");
});

test("面板读数：两位有效小数、十进制单位、进位先升单位", () => {
  assert.equal(panelSize(0), "0 B");
  assert.equal(panelSize(-5), "0 B");
  assert.equal(panelSize(999), "999 B");
  assert.equal(panelSize(1000), "1.00 KB");
  assert.equal(panelSize(1_240_000_000), "1.24 GB");
  assert.equal(panelSize(2_900_000_000), "2.90 GB");
  assert.equal(panelSize(45_600_000), "45.6 MB");
  assert.equal(panelSize(312_000_000), "312 MB");
  assert.equal(panelSize(9_996_000), "10.0 MB");
  assert.equal(panelSize(999_700_000), "1.00 GB", "不写 1000 MB");
  assert.equal(panelSize(5_000_000_000_000_000), "5000 TB", "最大一档不再升");
});
