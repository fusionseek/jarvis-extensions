/**
 * 测试共用（不是测试文件）：把 `src/` 现编成一份 ESM 直接 import（产物 `dist/extension.js` 是 IIFE，纯函数从服务那一面看不到）。
 * 只在测试时编译，不落盘、不随扩展发布。**从不执行真的转换工具**：进程一律由测试替身回放。
 */
import { build } from "esbuild";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
export const extensionRoot = join(here, "..");
const repositoryRoot = join(extensionRoot, "..", "..");

/** 现编 `src/` 里的模块（格式、引擎、三类转换、路线、命令、进度、服务）。 */
export async function loadSource() {
  const result = await build({
    stdin: {
      contents: [
        'export * from "./src/formats.ts";',
        'export * from "./src/engines.ts";',
        'export * from "./src/media.ts";',
        'export * from "./src/text.ts";',
        'export * from "./src/office.ts";',
        'export * from "./src/routes.ts";',
        'export * from "./src/commands.ts";',
        'export * from "./src/progress.ts";',
        'export { describeActions, outputName, actionId, group } from "./src/service.ts";',
      ].join("\n"),
      resolveDir: extensionRoot,
      loader: "ts",
      sourcefile: "test-entry.ts",
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
