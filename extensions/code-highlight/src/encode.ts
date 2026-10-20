/**
 * 记号 → `highlight` 的返回形状（纯函数，单测直接调）：`kinds` 是用到的种类，每份文本一串扁平的 `[起点, 长度, 种类下标, …]`。
 */
import type { CodeHighlightResult, CodeSyntaxKind } from "@fusionseek/jarvis-extension-sdk";
import type { Token } from "./scanner.js";

/** 全部文本合起来至多交回几个记号（与宿主的上限同一个数）：多的丢掉，宿主照原样白字画剩下那截。 */
export const maximumTokens = 300_000;

/**
 * 编码。
 * @param documents 每份文本的记号（按起点递增、互不重叠）。
 * @returns 返回值。
 */
export function encode(documents: Token[][]): CodeHighlightResult {
  const kinds: CodeSyntaxKind[] = [];
  const index = new Map<CodeSyntaxKind, number>();
  let budget = maximumTokens;
  const flat = documents.map((tokens) => {
    const numbers: number[] = [];
    for (const token of tokens) {
      if (budget <= 0) break;
      if (token.length <= 0) continue;
      let kindIndex = index.get(token.kind);
      if (kindIndex === undefined) {
        kindIndex = kinds.length;
        kinds.push(token.kind);
        index.set(token.kind, kindIndex);
      }
      numbers.push(token.start, token.length, kindIndex);
      budget -= 1;
    }
    return numbers;
  });
  return { kinds, documents: flat };
}
