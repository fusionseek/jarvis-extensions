/** 工具表：语言 → 工具、参数与 manifest 逐字一致、命令偏好、给用户的话。 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { extensionRoot, loadSource } from "./support.mjs";

const { tools, languages, languageEntry, argumentsFor, argumentShapes, commandFor, missingMessage, failureMessage, extensionOf } = await loadSource();
const manifest = JSON.parse(readFileSync(join(extensionRoot, "extension.json"), "utf8"));

test("manifest 声明的可执行文件与参数组，正好是代码里会用到的那些（一项不多）", () => {
  const declared = Object.fromEntries(manifest.process.executables.map((e) => [e.name, e.arguments]));
  assert.deepEqual(declared, argumentShapes());
  for (const executable of manifest.process.executables) assert.equal(executable.stdin, true, `${executable.name} 要从 stdin 读源码`);
});

test("每个工具的每种跑法都在声明里", () => {
  const declared = Object.fromEntries(manifest.process.executables.map((e) => [e.name, e.arguments.map((a) => JSON.stringify(a))]));
  const files = { c: "a.c", cpp: "a.cpp", objc: "a.m", java: "A.java", csharp: "A.cs", markdown: "README.md", javascript: "a.mjs", typescript: "a.tsx",
    json: "a.jsonc", yaml: "a.yml", css: "a.scss", html: "a.vue" };
  for (const entry of languages) {
    for (const tool of entry.tools) {
      for (const preferences of [{}, { javaStyle: "aosp" }]) {
        const args = argumentsFor(tool, entry.id, files[entry.id] ?? "x", preferences);
        assert.ok(declared[tool.executable]?.includes(JSON.stringify(args)), `${tool.id} ${args.join(" ")}`);
      }
    }
  }
});

test("语言按文件名挑参数：prettier 认扩展名的几种写法，clang-format 按语言", () => {
  assert.deepEqual(argumentsFor(tools.prettier, "yaml", "ci.yml"), ["--stdin-filepath", "jarvis-format.yaml"]);
  assert.deepEqual(argumentsFor(tools.prettier, "typescript", "App.tsx"), ["--stdin-filepath", "jarvis-format.tsx"]);
  assert.deepEqual(argumentsFor(tools.prettier, "markdown", "NOTES"), ["--stdin-filepath", "jarvis-format.md"], "认不出扩展名时按语言");
  assert.deepEqual(argumentsFor(tools.clangFormat, "objc", "View.mm"), ["--style=file", "--assume-filename=jarvis-format.m"]);
  assert.deepEqual(argumentsFor(tools.googleJavaFormat, "java", "A.java", { javaStyle: "aosp" }), ["--aosp", "-"]);
  assert.deepEqual(argumentsFor(tools.googleJavaFormat, "java", "A.java"), ["-"]);
  assert.equal(extensionOf("dir/App.TSX"), "tsx");
  assert.equal(extensionOf(".bashrc"), "");
});

test("先后：Java 先 google-java-format，Swift 先 Homebrew 那一份，Python 先 ruff；SQL 不认", () => {
  assert.deepEqual(languageEntry("java").tools.map((t) => t.id), ["google-java-format", "clang-format"]);
  assert.deepEqual(languageEntry("swift").tools.map((t) => t.id), ["swift-format", "xcrun swift-format"]);
  assert.deepEqual(languageEntry("python").tools.map((t) => t.id), ["ruff", "black"]);
  assert.equal(languageEntry("sql"), undefined);
});

test("命令偏好：填了用填的（去空白），没填用默认；没有偏好的工具只按默认找", () => {
  assert.equal(commandFor(tools.clangFormat, { clangFormat: "  /opt/llvm/bin/clang-format " }), "/opt/llvm/bin/clang-format");
  assert.equal(commandFor(tools.clangFormat, { clangFormat: "   " }), "clang-format");
  assert.equal(commandFor(tools.xcrunSwiftFormat, { swiftFormat: "/x/swift-format" }), "/usr/bin/xcrun");
  const keys = manifest.contributes.services[0].preferences.map((p) => p.key);
  for (const tool of Object.values(tools)) if (tool.preference) assert.ok(keys.includes(tool.preference), tool.id);
});

test("给用户的话：没找到写每个候选怎么装；失败带 stderr 头几行", () => {
  assert.equal(missingMessage(languageEntry("python")), "没找到 ruff 或 black：brew install ruff；brew install black，或在 设置 · Git · 代码格式化 里填路径");
  assert.equal(failureMessage(tools.ruff, 2, "\nerror: Failed to parse at 3:1\n  hint\nmore\nlast"), "ruff 没能格式化（退出码 2）：error: Failed to parse at 3:1 · hint · more");
  assert.equal(failureMessage(tools.gofmt, 1, ""), "gofmt 没能格式化（退出码 1）");
});
