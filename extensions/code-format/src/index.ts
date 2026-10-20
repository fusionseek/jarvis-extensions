/**
 * 代码格式化（`code-format`）—— 一个没有界面的服务扩展。
 *
 * 只入驻服务域：实现宿主开放的 `code.format` 扩展点。Jarvis 的 Git 文件 diff 页里，工作区那一份认得出语言的文件出「格式化」：
 * Jarvis 把整份原文交过来，这里按语言挑一个用户装好的格式化工具（clang-format、swift-format、ktfmt、prettier……），
 * 经 `process.run` 跑它（原文走 stdin、工具在文件所在目录里跑、整份 stdout 交回）；对比、写回、撤销都是 Jarvis 的事。
 *
 * 规则不在宿主里的理由：哪种语言该用哪个工具、工具的参数怎么写，会随工具的版本变——跟着扩展的版本走，
 * 工具改了参数时发一个扩展新版本，不用发 Jarvis 新版本。
 */
import { defineExtension } from "@fusionseek/jarvis-extension-sdk";
import { formatEngine } from "./engine.js";

defineExtension({
  services: {
    formatters: formatEngine,
  },
});
