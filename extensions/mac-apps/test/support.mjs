/**
 * 测试共用的东西（不是测试文件）：`loadModel()` 把 `src/model.ts` 现编成 ESM 直接 import（产物是 IIFE，纯函数从外面看不到）；
 * `app()` 造一个应用。从不读真的 /Applications。
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

const titles = { "public.app-category.developer-tools": "开发工具", "public.app-category.productivity": "效率", "public.app-category.utilities": "实用工具" };
const locationTitles = { applications: "应用程序", system: "系统", user: "我的应用", other: "其他位置" };

/**
 * 一个应用。
 * @param name 名字。
 * @param options 分类、位置、最近打开 / 添加时刻（毫秒）。
 */
export function app(name, { category = null, location = "applications", lastUsedAt = null, addedAt = null } = {}) {
  const path = location === "system" ? `/System/Applications/${name}.app` : `/Applications/${name}.app`;
  return {
    id: path, name, bundleId: null, path, category, categoryTitle: titles[category] ?? "其他", version: null,
    location, locationTitle: locationTitles[location], lastUsedAt, addedAt, system: location === "system", deletable: location !== "system",
  };
}
