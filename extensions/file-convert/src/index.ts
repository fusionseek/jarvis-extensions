/**
 * 文件转换（`file-convert`）—— 一个没有界面的服务扩展，实现宿主开放的 `files.actions` 扩展点。
 *
 * 在 Jarvis「文件」里长按选中的图像、音频、视频、文本或办公文档，转盘上多一片「格式转换」；指着它向外展开一圈此刻转得了的格式，
 * 选一个就转：产物与原文件同名换扩展名，放回当前文件夹并选中，⌘Z 移到废纸篓；原文件不动。
 *
 * 转换的底层照 Filee（https://github.com/KnifeLemon/Filee）的做法：引擎表（`engines.ts`）+ 按类分开的转换（`media.ts` / `text.ts` / `office.ts`）
 * + 路线规划（`routes.ts`，一步到不了的自动拆两步）。引擎换成 macOS 自带与用户自己装的命令行工具，经 `process.run` 逐字声明地调用。
 */
import { defineExtension } from "@fusionseek/jarvis-extension-sdk";
import { convertEngine } from "./service.js";

defineExtension({
  services: {
    convert: convertEngine,
  },
});
