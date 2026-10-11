/**
 * Mole 深度清理（`mole-clean`）—— 一个没有界面的服务扩展。
 *
 * 它只入驻服务域：实现宿主开放的 `junkClean.engine` 扩展点。用户在设置「清理」里打开「深度清理（Mole）」之后，
 * 晃球、`/clean` 与工具箱清理都改走用户自己装好的 `mo clean`；悬浮球、进度与结果页仍是 Jarvis 自己的那一套，
 * 扩展只交数字。
 *
 * 这些代码原本写在宿主里（`MoleCleaner.swift` 等）。搬出来的理由：调用一个第三方命令行工具、解析它的输出格式，
 * 是会随 Mole 的版本变的东西——跟着扩展的版本走，Mole 改了输出格式时发一个扩展新版本，不用发 Jarvis 新版本。
 */
import { defineExtension } from "@fusionseek/jarvis-extension-sdk";
import { moleEngine } from "./engine.js";

defineExtension({
  services: {
    mole: moleEngine,
  },
});
