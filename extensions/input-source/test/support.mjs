/**
 * 测试共用的东西（不是测试文件）：`loadModel()` 把 `src/model.ts` 现编成 ESM 直接 import（产物是 IIFE，纯函数从外面看不到）；
 * 两枚输入法照本机实测（ABC 与微信输入法）。
 */
import { build } from "esbuild";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
export const extensionRoot = join(here, "..");
const repositoryRoot = join(extensionRoot, "..", "..");

/**
 * 现编 `src/model.ts`。
 * @returns 模块命名空间。
 */
export async function loadModel() {
  const result = await build({
    entryPoints: [join(extensionRoot, "src", "model.ts")],
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

export const ABC = "com.apple.keylayout.ABC";
export const PINYIN = "com.tencent.inputmethod.wetype.pinyin";
export const icon = { id: "icon-pinyin", name: "pinyin.png", byteCount: 10, extension: "png" };
export const sources = [
  { id: ABC, name: "ABC", kind: "keyboardLayout", languages: ["en"] },
  { id: PINYIN, name: "微信输入法", kind: "inputMode", languages: ["zh-Hans"], icon },
];
