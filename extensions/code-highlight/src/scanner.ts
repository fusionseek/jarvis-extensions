/**
 * 一个按规则表扫描的词法器（纯函数，单测直接调）。
 *
 * 每到一个非空白位置，按顺序试规则（全部是粘性正则，从这个位置开始匹配），第一条匹配上的产出记号、跳过它；
 * 都不匹配时试「标识符」，交给语言自己的分类函数判断它是关键字、类型、函数还是普通名字；再不行就跳过一个字符。
 * 一遍从左到右，记号天然按起点递增、互不重叠——宿主要的正是这个。
 */
import type { CodeSyntaxKind } from "@fusionseek/jarvis-extension-sdk";

/** 一个记号：整份文本里的 UTF-16 起点（JavaScript 字符串下标）、长度、种类。 */
export interface Token {
  start: number;
  length: number;
  kind: CodeSyntaxKind;
}

/** 一条规则：`pattern`（粘性正则）与 `match`（自己数长度）二选一。 */
export interface Rule {
  /** 粘性正则（标志带 `y`）：只在当前位置匹配。 */
  pattern?: RegExp;
  /** 自己数：从 `at` 起匹配多长；0 = 不匹配。正则写不出来的（可以嵌套的块注释）用它。 */
  match?: (text: string, at: number) => number;
  /** 整个匹配是一个记号；省略 = 匹配上了只跳过，不出记号。 */
  kind?: CodeSyntaxKind;
  /** 一次匹配出几个记号（例如 `#include <a.h>` 的指令与路径）；给了它就不看 `kind`。只对 `pattern` 有效。 */
  emit?: (match: RegExpExecArray, at: number, out: Token[]) => void;
  /** 只在一行开头（前面只有缩进）才试。 */
  lineStart?: boolean;
}

/** 分类一个标识符时看得到的上下文。 */
export interface WordContext {
  /** 前一个标识符（中间只隔空白）；隔着标点为 `null`，紧跟在 `.` 后面为 `"."`。 */
  previousWord: string | null;
  /** 这个标识符之后第一个不是空格 / 制表符的字符（`(` 说明它多半是函数）；到行尾为 `""`。 */
  next: string;
  /** 这个标识符之前第一个不是空白的字符。 */
  previous: string;
}

/** 一种语言的扫描设置。 */
export interface ScanSpec {
  rules: Rule[];
  /** 标识符的粘性正则；省略 = 不认标识符。 */
  word?: RegExp;
  /** 给标识符分类；交回 `null` = 普通名字，不出记号。 */
  classify?: (word: string, context: WordContext) => CodeSyntaxKind | null;
}

/** 这个位置前面只有缩进（或就是开头）。 */
export function atLineStart(text: string, index: number): boolean {
  for (let i = index - 1; i >= 0; i -= 1) {
    const c = text.charCodeAt(i);
    if (c === 10) return true;
    if (c !== 32 && c !== 9) return false;
  }
  return true;
}

function nextNonSpace(text: string, index: number): string {
  for (let i = index; i < text.length; i += 1) {
    const c = text.charCodeAt(i);
    if (c === 10) return "";
    if (c !== 32 && c !== 9) return text[i]!;
  }
  return "";
}

function previousNonSpace(text: string, index: number): string {
  for (let i = index - 1; i >= 0; i -= 1) {
    const c = text.charCodeAt(i);
    if (c !== 32 && c !== 9 && c !== 10 && c !== 13) return text[i]!;
  }
  return "";
}

/**
 * 扫一份文本。
 * @param text 整份文本。
 * @param spec 语言设置。
 * @returns 记号，按起点递增、互不重叠。
 */
export function scan(text: string, spec: ScanSpec): Token[] {
  const out: Token[] = [];
  const n = text.length;
  let i = 0;
  let previousWord: string | null = null;
  outer: while (i < n) {
    const c = text.charCodeAt(i);
    if (c === 32 || c === 9 || c === 10 || c === 13) {
      i += 1;
      continue;
    }
    for (const rule of spec.rules) {
      if (rule.lineStart && !atLineStart(text, i)) continue;
      let length = 0;
      if (rule.pattern) {
        rule.pattern.lastIndex = i;
        const match = rule.pattern.exec(text);
        if (!match || match[0].length === 0) continue;
        length = match[0].length;
        if (rule.emit) rule.emit(match, i, out);
        else if (rule.kind) out.push({ start: i, length, kind: rule.kind });
      } else if (rule.match) {
        length = rule.match(text, i);
        if (length <= 0) continue;
        if (rule.kind) out.push({ start: i, length, kind: rule.kind });
      } else {
        continue;
      }
      i += length;
      previousWord = null;
      continue outer;
    }
    if (spec.word) {
      spec.word.lastIndex = i;
      const match = spec.word.exec(text);
      if (match && match[0].length > 0) {
        const word = match[0];
        const end = i + word.length;
        const kind = spec.classify?.(word, { previousWord, next: nextNonSpace(text, end), previous: previousNonSpace(text, i) }) ?? null;
        if (kind) out.push({ start: i, length: word.length, kind });
        previousWord = word;
        i = end;
        continue;
      }
    }
    previousWord = c === 46 ? "." : null;
    i += 1;
  }
  return out;
}

/** 规则的小工具：一段正则 → 粘性正则。 */
export function sticky(source: string, flags = ""): RegExp {
  return new RegExp(source, flags.includes("y") ? flags : flags + "y");
}

/**
 * 可以嵌套的块注释（Swift / Rust / Kotlin 里块注释可以套块注释）：数开闭，没闭合就到文本末尾。
 * @param open 开记号。
 * @param close 闭记号。
 * @returns 规则。
 */
export function nestedBlockComment(open = "/*", close = "*/"): Rule {
  return {
    kind: "comment",
    match(text, at) {
      if (!text.startsWith(open, at)) return 0;
      let depth = 0;
      let i = at;
      while (i < text.length) {
        if (text.startsWith(open, i)) {
          depth += 1;
          i += open.length;
        } else if (text.startsWith(close, i)) {
          depth -= 1;
          i += close.length;
          if (depth === 0) break;
        } else {
          i += 1;
        }
      }
      return i - at;
    },
  };
}
