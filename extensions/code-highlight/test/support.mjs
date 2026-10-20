/**
 * 测试共用（不是测试文件）：`loadSource()` 把 `src/` 的扫描器与语言规则现编成一份 ESM 直接 import——产物 `dist/extension.js` 是 IIFE，
 * 规则从服务那一面看不到；这里**只在测试时**编译，不落盘、不随扩展发布。
 *
 * 纯计算，没有替身要摆。
 */
import { build } from "esbuild";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
export const extensionRoot = join(here, "..");
const repositoryRoot = join(extensionRoot, "..", "..");

/**
 * 现编 `src/` 的纯模块。
 * @returns 模块命名空间。
 */
export async function loadSource() {
  const result = await build({
    stdin: { contents: 'export * from "./src/languages.ts"; export * from "./src/encode.ts"; export * from "./src/scanner.ts";', resolveDir: extensionRoot, loader: "ts", sourcefile: "test-entry.ts" },
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
