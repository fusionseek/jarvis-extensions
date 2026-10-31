#!/usr/bin/env node
/**
 * 从引擎表生成 manifest 的 `process.executables`：每个工具一项，参数组 = 每条边的命令模板（输入写 `{file}` / `{output}` 各一组）。
 *
 * 命令只在 `src/` 里写一遍：宿主逐项比对 manifest 与实际发出的命令，两处手抄迟早会差一个字。
 * `npm run build` 先跑它；测试再钉一遍「生成出来的 = 提交的」（`test/manifest.test.mjs`）。
 *
 * 用法：node scripts/generate-manifest.mjs          写回 extension.json
 *      node scripts/generate-manifest.mjs --check  只比对，不一致时退出 1
 */
import { build } from "esbuild";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const repositoryRoot = join(root, "..", "..");

/** 现编 `src/commands.ts` 与 `src/engines.ts`，拿到声明用的那两样。 */
export async function loadDeclarations() {
  const result = await build({
    stdin: {
      contents: 'export { declaredShapes } from "./src/commands.ts"; export { tools } from "./src/engines.ts";',
      resolveDir: root,
      loader: "ts",
      sourcefile: "manifest-entry.ts",
    },
    bundle: true,
    format: "esm",
    platform: "neutral",
    target: ["es2020"],
    write: false,
    logLevel: "silent",
    alias: { "@fusionseek/jarvis-extension-sdk": join(repositoryRoot, "sdk", "src", "index.ts") },
  });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`);
}

/** 生成的 `process.executables`：按引擎表的顺序。 */
export async function generatedExecutables() {
  const { declaredShapes, tools } = await loadDeclarations();
  const shapes = declaredShapes();
  return tools
    .filter((tool) => shapes.has(tool.name))
    .map((tool) => ({ name: tool.name, arguments: shapes.get(tool.name) }));
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const manifestPath = join(root, "extension.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const executables = await generatedExecutables();
  const same = JSON.stringify(manifest.process.executables) === JSON.stringify(executables);
  if (process.argv.includes("--check")) {
    if (!same) {
      console.error("extension.json 的 process.executables 与引擎表不一致：跑一次 node scripts/generate-manifest.mjs");
      process.exit(1);
    }
  } else if (!same) {
    manifest.process.executables = executables;
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    console.log(`已写回 ${executables.length} 个工具、${executables.reduce((sum, item) => sum + item.arguments.length, 0)} 组参数`);
  }
}
