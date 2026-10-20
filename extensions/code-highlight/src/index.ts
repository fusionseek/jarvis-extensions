/**
 * 代码高亮（`code-highlight`）—— 一个没有界面、不要任何能力的服务扩展。
 *
 * 只入驻服务域：实现宿主开放的 `code.highlight` 扩展点。Jarvis 的 Git 文件 diff 页与 Blame 认出一个文件的语言之后，把整份文本交过来，
 * 这里把它切成记号（关键字、字符串、注释……）交回去；颜色由 Jarvis 按记号种类定。
 *
 * 规则不在宿主里的理由：哪种语言有哪些关键字、字符串怎么写，是会随语言版本变、会不断加语言的东西——跟着扩展的版本走，
 * 加一种语言、修一处认错的地方，发一个扩展新版本，不用发 Jarvis 新版本。纯计算、零依赖：bundle 里只有这里的代码与 SDK 的运行时桥。
 */
import { defineExtension } from "@fusionseek/jarvis-extension-sdk";
import type { CodeHighlightEngine } from "@fusionseek/jarvis-extension-sdk";
import { encode } from "./encode.js";
import { supportedLanguages, tokenize } from "./languages.js";

const engine: CodeHighlightEngine = {
  describe() {
    return { languages: supportedLanguages };
  },
  highlight(request) {
    return encode(request.documents.map((text) => tokenize(request.language, text)));
  },
};

defineExtension({
  services: {
    syntax: engine,
  },
});
