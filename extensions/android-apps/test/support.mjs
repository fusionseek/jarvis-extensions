/**
 * 测试共用的东西（不是测试文件，`node --test test/*.test.mjs` 不会把它当测试跑）：
 *
 * 1. `loadModel()`：把 `src/model.ts` 现编成 ESM 直接 import（产物是 IIFE，纯函数从外面看不到）。
 * 2. `app()` / `apps()`：造应用的小工具，大小按 MB 写。
 *
 * **从不碰真的 adb**：设备一侧是 SDK 的 `fakeAndroid()`。
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

const MB = 1_000_000;

/**
 * 一个应用。
 * @param name 包名。
 * @param sizes 安装包 / 数据 / 缓存，单位 MB；`null` = 设备不报。
 * @param system 是不是系统应用。
 * @returns `AndroidApp`。
 */
export function app(name, { apk = 10, data = 5, cache = 1, system = false } = {}) {
  const bytes = (value) => (value === null ? null : Math.round(value * MB));
  return { package: name, system, apkBytes: bytes(apk), dataBytes: bytes(data), cacheBytes: bytes(cache) };
}

/**
 * `count` 个用户应用 `<prefix>.app01…`，越往后越小（按大小排时顺序就是编号顺序）。
 * @param prefix 包名前缀。
 * @param count 个数。
 * @returns 应用数组。
 */
export function apps(prefix, count) {
  return Array.from({ length: count }, (_, index) => app(`${prefix}.app${String(index + 1).padStart(2, "0")}`, { apk: 1000 - index, data: 100, cache: 0 }));
}

/**
 * 一个图标句柄（宿主颁发的那种形状）。
 * @param name 包名。
 * @returns `FileHandle`。
 */
export function icon(name) {
  return { id: `icon-${name}`, name: `${name}.png`, byteCount: 4096, extension: "png" };
}
