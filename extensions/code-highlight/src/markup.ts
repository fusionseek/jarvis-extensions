/**
 * 标记类语言的扫描：Markdown、HTML / XML、CSS、YAML。它们按行或按「在不在尖括号 / 花括号里」认东西，规则表写不顺，各写一个小扫描器。
 */
import type { CodeSyntaxKind } from "@fusionseek/jarvis-extension-sdk";
import type { Token } from "./scanner.js";

function push(out: Token[], start: number, length: number, kind: CodeSyntaxKind): void {
  if (length > 0) out.push({ start, length, kind });
}

/** 从 `from` 起找下一个换行；没有为文本末尾。 */
function lineEnd(text: string, from: number): number {
  const end = text.indexOf("\n", from);
  return end < 0 ? text.length : end;
}

// ---------------------------------------------------------------------------
// Markdown
// ---------------------------------------------------------------------------

/**
 * Markdown：围栏代码块整块是代码；标题整行；引用整行；列表记号与分隔线是记号；行内的代码、链接、强调。
 * @param text 整份文本。
 * @returns 记号。
 */
export function scanMarkdown(text: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  while (i < text.length) {
    const end = lineEnd(text, i);
    const line = text.slice(i, end);
    const fence = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (fence) {
      // 找同一种围栏的闭合行；没有就到文本末尾。
      const marker = fence[1]!;
      let cursor = end + 1;
      let close = text.length;
      while (cursor < text.length) {
        const next = lineEnd(text, cursor);
        if (new RegExp("^ {0,3}" + marker[0] + "{" + marker.length + ",}\\s*$").test(text.slice(cursor, next))) {
          close = next;
          break;
        }
        cursor = next + 1;
      }
      push(out, i, close - i, "code");
      i = close + 1;
      continue;
    }
    if (/^ {0,3}#{1,6}(?:\s|$)/.test(line)) {
      push(out, i, line.length, "heading");
    } else if (/^ {0,3}>/.test(line)) {
      push(out, i, line.length, "quote");
    } else if (/^ {0,3}([-*_])(?:\s*\1){2,}\s*$/.test(line)) {
      push(out, i, line.length, "marker");
    } else {
      const list = /^(\s*)([-*+]|\d+[.)])(\s+\[[ xX]\])?\s/.exec(line);
      let from = 0;
      if (list) {
        push(out, i + list[1]!.length, list[2]!.length + (list[3]?.length ?? 0), "marker");
        from = list[0].length;
      }
      inlineMarkdown(text, i + from, end, out);
    }
    i = end + 1;
  }
  return out;
}

/** 一行之内：行内代码、图片 / 链接、自动链接、HTML 注释、粗体 / 斜体。 */
function inlineMarkdown(text: string, from: number, to: number, out: Token[]): void {
  const pattern = /`[^`\n]+`|!?\[[^\]\n]*\]\([^)\n]*\)|<https?:\/\/[^>\s]+>|<!--[\s\S]*?-->|\*\*[^*\n]+\*\*|__[^_\n]+__|\*[^*\s][^*\n]*\*|(?<![\w])_[^_\s][^_\n]*_(?![\w])/g;
  pattern.lastIndex = from;
  const segment = text.slice(0, to);
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(segment)) !== null) {
    const token = match[0];
    const kind: CodeSyntaxKind = token.startsWith("`") ? "code"
      : token.startsWith("<!--") ? "comment"
      : token.startsWith("[") || token.startsWith("![") || token.startsWith("<") ? "link"
      : "emphasis";
    push(out, match.index, token.length, kind);
  }
}

// ---------------------------------------------------------------------------
// HTML / XML
// ---------------------------------------------------------------------------

/**
 * HTML / XML（含 Vue 单文件组件的模板部分）：注释、`<!DOCTYPE>` / `<?xml?>`、CDATA、标签名、属性名、属性值、实体。标签之间的文字不着色。
 * @param text 整份文本。
 * @returns 记号。
 */
export function scanHTML(text: string): Token[] {
  const out: Token[] = [];
  const n = text.length;
  let i = 0;
  while (i < n) {
    const lt = text.indexOf("<", i);
    const amp = text.indexOf("&", i);
    const next = lt < 0 ? amp : amp < 0 ? lt : Math.min(lt, amp);
    if (next < 0) break;
    i = next;
    if (text[i] === "&") {
      const entity = /&(?:#\d+|#x[0-9a-fA-F]+|[A-Za-z][\w]*);/y;
      entity.lastIndex = i;
      const match = entity.exec(text);
      if (match) push(out, i, match[0].length, "constant");
      i += match ? match[0].length : 1;
      continue;
    }
    if (text.startsWith("<!--", i)) {
      const close = text.indexOf("-->", i + 4);
      const end = close < 0 ? n : close + 3;
      push(out, i, end - i, "comment");
      i = end;
      continue;
    }
    if (text.startsWith("<![CDATA[", i)) {
      const close = text.indexOf("]]>", i);
      const end = close < 0 ? n : close + 3;
      push(out, i, end - i, "string");
      i = end;
      continue;
    }
    if (text.startsWith("<?", i) || text.startsWith("<!", i)) {
      const close = text.indexOf(">", i);
      const end = close < 0 ? n : close + 1;
      push(out, i, end - i, "preprocessor");
      i = end;
      continue;
    }
    const tag = /<\/?[A-Za-z][\w:.-]*/y;
    tag.lastIndex = i;
    const name = tag.exec(text);
    if (!name) {
      i += 1;
      continue;
    }
    push(out, i, name[0].length, "tag");
    i += name[0].length;
    // 属性，直到 `>` 或 `/>`。
    const attribute = /\s*(?:([^\s=>/"']+)(?:\s*=\s*("[^"]*"?|'[^']*'?|[^\s>]+))?|(\/?>))/y;
    while (i < n) {
      attribute.lastIndex = i;
      const match = attribute.exec(text);
      if (!match || match[0].length === 0) break;
      const base = i + match[0].length - match[0].trimStart().length;
      if (match[3]) {
        push(out, i + match[0].length - match[3].length, match[3].length, "tag");
        i += match[0].length;
        break;
      }
      if (match[1]) push(out, base, match[1].length, "attribute");
      if (match[2]) push(out, i + match[0].length - match[2].length, match[2].length, "string");
      i += match[0].length;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// CSS / SCSS / Less
// ---------------------------------------------------------------------------

/**
 * CSS（SCSS / Less 也认）：花括号外是选择器（`.类` 类型色、`#id` 属性色、标签名标签色、`:伪类` 关键字色），花括号里是声明（属性名、值里的数字与单位、颜色、`!important`、函数、变量）。
 * 花括号里又出现一段跟着 `{` 的东西时它是嵌套的选择器（SCSS）。
 * @param text 整份文本。
 * @returns 记号。
 */
export function scanCSS(text: string): Token[] {
  const out: Token[] = [];
  const n = text.length;
  let depth = 0;
  let i = 0;
  let declarationStart = true;
  while (i < n) {
    const c = text[i]!;
    if (c === " " || c === "\t" || c === "\n" || c === "\r") {
      i += 1;
      continue;
    }
    if (text.startsWith("/*", i)) {
      const close = text.indexOf("*/", i + 2);
      const end = close < 0 ? n : close + 2;
      push(out, i, end - i, "comment");
      i = end;
      continue;
    }
    if (text.startsWith("//", i) && !/url\($/.test(text.slice(Math.max(0, i - 4), i))) {
      const end = lineEnd(text, i);
      push(out, i, end - i, "comment");
      i = end;
      continue;
    }
    if (c === '"' || c === "'") {
      const string = c === '"' ? /"(?:[^"\\\n]|\\.)*"?/y : /'(?:[^'\\\n]|\\.)*'?/y;
      string.lastIndex = i;
      const match = string.exec(text)!;
      push(out, i, match[0].length, "string");
      i += match[0].length;
      continue;
    }
    if (c === "{") { depth += 1; declarationStart = true; i += 1; continue; }
    if (c === "}") { depth = Math.max(0, depth - 1); declarationStart = true; i += 1; continue; }
    if (c === ";") { declarationStart = true; i += 1; continue; }
    if (c === "@" && /[\w-]/.test(text[i + 1] ?? "")) {
      const at = /@[\w-]+/y;
      at.lastIndex = i;
      const match = at.exec(text)!;
      // Less 的 `@变量:` 是变量，其余 `@media` 之类是关键字。
      const isVariable = /^\s*:/.test(text.slice(i + match[0].length, i + match[0].length + 8)) && depth > 0;
      push(out, i, match[0].length, isVariable ? "variable" : "keyword");
      i += match[0].length;
      declarationStart = false;
      continue;
    }
    // 这一段（到下一个 `{` / `;` / `}`）跟着 `{`：它是选择器（顶层，或 SCSS 嵌套）；跟着 `;` 的是声明（SCSS 顶层的 `$变量: …;` 也是）。
    const rest = /[^{};]*/y;
    rest.lastIndex = i;
    const segment = rest.exec(text)![0];
    const selector = text[i + segment.length] === "{";
    if (selector) {
      scanSelector(text, i, i + segment.length, out);
      i += segment.length;
      declarationStart = false;
      continue;
    }
    if (declarationStart) {
      const property = /(--[\w-]+|\$[\w-]+|[\w-]+)(\s*:)/y;
      property.lastIndex = i;
      const match = property.exec(text);
      if (match) {
        push(out, i, match[1]!.length, match[1]!.startsWith("--") || match[1]!.startsWith("$") ? "variable" : "property");
        i += match[0].length;
        declarationStart = false;
        continue;
      }
    }
    declarationStart = false;
    const value = /(#[0-9a-fA-F]{3,8}\b)|(-?(?:\d+\.?\d*|\.\d+)(?:[a-zA-Z%]+)?)|(!important)|(var\(--[\w-]+\)|--[\w-]+|\$[\w-]+)|([\w-]+(?=\())|([\w-]+)/y;
    value.lastIndex = i;
    const match = value.exec(text);
    if (!match) {
      i += 1;
      continue;
    }
    const kind: CodeSyntaxKind | null = match[1] ? "constant" : match[2] ? "number" : match[3] ? "keyword" : match[4] ? "variable" : match[5] ? "function" : null;
    if (kind) push(out, i, match[0].length, kind);
    i += match[0].length;
  }
  return out;
}

/** 一段选择器：`.类`、`#id`、`:伪类`、`[属性]`、标签名、`&`。 */
function scanSelector(text: string, from: number, to: number, out: Token[]): void {
  const pattern = /(\.[\w-]+)|(#[\w-]+)|(::?[\w-]+)|(\[[^\]]*\])|(&)|([A-Za-z][\w-]*)/g;
  pattern.lastIndex = from;
  const segment = text.slice(0, to);
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(segment)) !== null) {
    const kind: CodeSyntaxKind = match[1] ? "type" : match[2] ? "attribute" : match[3] ? "keyword" : match[4] ? "attribute" : match[5] ? "keyword" : "tag";
    push(out, match.index, match[0].length, kind);
  }
}

// ---------------------------------------------------------------------------
// YAML
// ---------------------------------------------------------------------------

/**
 * YAML：注释、文档记号、列表记号、键、整个值是数字 / 常量时的值、引号字符串、锚点与别名、标签、块标量记号。
 * @param text 整份文本。
 * @returns 记号。
 */
export function scanYAML(text: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  while (i < text.length) {
    const end = lineEnd(text, i);
    const line = text.slice(i, end);
    if (/^(?:---|\.\.\.)(?:\s|$)/.test(line)) {
      push(out, i, 3, "marker");
      scanYAMLValue(text, i + 3, end, out);
      i = end + 1;
      continue;
    }
    const prefix = /^(\s*)((?:-\s+)*)/.exec(line)!;
    let cursor = i + prefix[0].length;
    if (prefix[2]!.length > 0) {
      for (const dash of prefix[2]!.matchAll(/-/g)) push(out, i + prefix[1]!.length + dash.index!, 1, "marker");
    }
    const key = /("[^"\n]*"|'[^'\n]*'|[^\s#:'"{[][^:#\n]*?)\s*:(?=\s|$)/y;
    key.lastIndex = cursor;
    const keyMatch = key.exec(text);
    if (keyMatch && keyMatch.index === cursor && cursor < end) {
      push(out, cursor, keyMatch[1]!.length, "property");
      cursor += keyMatch[0].length;
    }
    scanYAMLValue(text, cursor, end, out);
    i = end + 1;
  }
  return out;
}

/** 一个值（到行尾）：前面有空白的 `#` 起是注释。 */
function scanYAMLValue(text: string, from: number, to: number, out: Token[]): void {
  let commentAt = -1;
  for (let i = from; i < to; i += 1) {
    const c = text[i];
    if (c === "#" && (i === from || text[i - 1] === " " || text[i - 1] === "\t")) { commentAt = i; break; }
    if (c === '"' || c === "'") {
      const close = text.indexOf(c, i + 1);
      if (close < 0 || close >= to) break;
      i = close;
    }
  }
  const valueEnd = commentAt < 0 ? to : commentAt;
  const value = text.slice(from, valueEnd);
  const trimmed = value.trim();
  const at = from + value.indexOf(trimmed);
  if (trimmed.length > 0) {
    if (/^(?:true|false|null|yes|no|on|off|~)$/i.test(trimmed)) {
      push(out, at, trimmed.length, "constant");
    } else if (/^[-+]?(?:\d[\d_]*(?:\.\d+)?(?:[eE][-+]?\d+)?|0x[0-9a-fA-F]+|\.inf|\.nan)$/i.test(trimmed)) {
      push(out, at, trimmed.length, "number");
    } else if (/^[|>][-+]?\d*$/.test(trimmed)) {
      push(out, at, trimmed.length, "marker");
    } else {
      const pattern = /"(?:[^"\\]|\\.)*"?|'(?:[^']|'')*'?|[&*][\w-]+|![\w!./-]*/g;
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(value)) !== null) {
        const token = match[0];
        const kind: CodeSyntaxKind = token.startsWith('"') || token.startsWith("'") ? "string" : token.startsWith("!") ? "attribute" : "variable";
        push(out, from + match.index, token.length, kind);
      }
    }
  }
  if (commentAt >= 0) push(out, commentAt, to - commentAt, "comment");
}
