/**
 * 测试共用的东西（不是测试文件）：`loadModel()` 把 `src/model.ts` 现编成 ESM 直接 import（产物是 IIFE，纯函数从外面看不到）；
 * `extra()` 造一颗菜单栏图标；`notchScreen` 是一块带刘海的 1728 宽内置屏（坐标照本机实测）。
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

/**
 * 一颗菜单栏图标。
 * @param id id。
 * @param x 左边。
 * @param options 宽、在不在屏幕上、是不是自己的。
 */
export function extra(id, x, { width = 32, onScreen = true, mine, screen = "1", name = id } = {}) {
  const item = { id, ownerBundleId: id, ownerName: name, title: "", frame: { x, y: 0, width, height: 33 }, screen, onScreen, movable: true };
  if (mine) item.mine = mine;
  return item;
}

export const notchScreen = {
  id: "1",
  frame: { x: 0, y: 0, width: 1728, height: 1117 },
  visibleFrame: { x: 0, y: 33, width: 1728, height: 1084 },
  menuBarHeight: 33,
  isMain: true,
  scale: 2,
  notch: { left: { x: 0, y: 0, width: 771, height: 33 }, right: { x: 957, y: 0, width: 771, height: 33 } },
};
