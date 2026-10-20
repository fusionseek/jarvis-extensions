/**
 * `code.format` 的实现：`describe` 报每种语言此刻找不找得到工具，`format` 跑那个工具。
 *
 * **只跑用户自己装好的工具**：扩展不带任何一种语言的格式化逻辑；找不到就告诉用户怎么装。
 */
import { JarvisError, jarvis } from "@fusionseek/jarvis-extension-sdk";
import type { CancelSignal, CodeFormatDescription, CodeFormatEngine, CodeFormatRequest, CodeFormatResult, ServiceContext } from "@fusionseek/jarvis-extension-sdk";
import { argumentsFor, commandFor, failureMessage, languageEntry, languages, missingMessage, tools, xcrunProbe, type FormatTool } from "./tools.js";

/** 一个工具此刻在哪；找不到为 `null`。xcrun 还要确认 swift-format 在。 */
async function locate(tool: FormatTool, preferences: Record<string, unknown>): Promise<string | null> {
  const where = await jarvis.process.locate(commandFor(tool, preferences));
  if (where.path === null) return null;
  if (tool.id === tools.xcrunSwiftFormat.id) {
    const probe = await jarvis.process.run({ executable: where.path, arguments: xcrunProbe }).result;
    if (probe.exitCode !== 0) return null;
  }
  return where.path;
}

/** 一种语言第一个找得到的工具。 */
async function firstAvailable(id: string, preferences: Record<string, unknown>): Promise<{ tool: FormatTool; path: string } | null> {
  const entry = languageEntry(id);
  if (!entry) return null;
  for (const tool of entry.tools) {
    const path = await locate(tool, preferences);
    if (path) return { tool, path };
  }
  return null;
}

export const formatEngine: CodeFormatEngine = {
  async describe(context: ServiceContext): Promise<CodeFormatDescription> {
    // 同一个工具管好几种语言（prettier、clang-format）：每个工具只找一次。
    const cache = new Map<string, Promise<string | null>>();
    const find = (tool: FormatTool) => {
      if (!cache.has(tool.id)) cache.set(tool.id, locate(tool, context.preferences).catch(() => null));
      return cache.get(tool.id)!;
    };
    const statuses = [];
    for (const entry of languages) {
      let found: FormatTool | null = null;
      for (const tool of entry.tools) {
        if (await find(tool)) {
          found = tool;
          break;
        }
      }
      statuses.push(found ? { id: entry.id, available: true, tool: found.id } : { id: entry.id, available: false, message: missingMessage(entry) });
    }
    return { languages: statuses };
  },

  async format(request: CodeFormatRequest, context: ServiceContext, signal: CancelSignal): Promise<CodeFormatResult> {
    const entry = languageEntry(request.language);
    if (!entry) throw new JarvisError({ code: "capability.unknown", message: `不格式化 ${request.language}` });
    const found = await firstAvailable(request.language, context.preferences);
    if (!found) throw new JarvisError({ code: "host.failure", message: missingMessage(entry) });
    const run = jarvis.process.run({
      executable: found.path,
      arguments: argumentsFor(found.tool, entry.id, request.fileName, context.preferences),
      stdin: request.text,
      directory: request.directory,
      output: "text",
    });
    signal.onCancel(() => run.cancel());
    const result = await run.result;
    if (result.exitCode !== 0) throw new JarvisError({ code: "host.failure", message: failureMessage(found.tool, result.exitCode, result.stderr) });
    const text = result.stdout ?? "";
    // 原文不空、工具却什么都没吐：多半是它把结果写到了别处（版本不认 stdin 的写法），不当成「格式化成了空文件」。
    if (text.length === 0 && request.text.trim().length > 0) {
      throw new JarvisError({ code: "host.failure", message: `${found.tool.id} 没有交回内容：它可能不认从标准输入读的写法，升级到新版本再试` });
    }
    return { text, tool: found.tool.id };
  },
};
