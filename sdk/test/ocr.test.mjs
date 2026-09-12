import test from "node:test";
import assert from "node:assert/strict";
import { chunk, joiner, mergeLines, paragraphs } from "../dist/ocr.js";

const line = (text, y, x = 0.1, height = 0.05, width = 0.8) => ({ text, box: { x, y, width, height } });

test("中文行尾不加空格，英文行尾加空格，连字符断词接回去", () => {
  assert.equal(joiner("这是第一行", "这是第二行"), "");
  assert.equal(joiner("first line", "second line"), " ");
  assert.equal(joiner("中文 mixed", "English"), " ");
  assert.equal(mergeLines([line("inter-", 0.1), line("national law", 0.16)]), "international law");
  assert.equal(mergeLines([line("well-", 0.1), line("Known", 0.16)]), "well- Known");
});

test("给了语言就整段按它来", () => {
  const lines = [line("第一行 end", 0.1), line("第二行", 0.16)];
  assert.equal(mergeLines(lines, { language: "zh-Hans" }), "第一行 end第二行");
  assert.equal(mergeLines(lines, { language: "en" }), "第一行 end 第二行");
});

test("纵向空隙超过行高的 0.8 倍就换段，缩进也换段", () => {
  const lines = [
    line("Paragraph one line one.", 0.1),
    line("Paragraph one line two.", 0.16),
    line("Paragraph two starts here.", 0.3), // gap 0.09 > 0.05 × 0.8
    line("Paragraph two line two.", 0.36),
    line("    Indented start.", 0.42, 0.25), // indent 0.15 > 0.05 × 1.2
  ];
  const groups = paragraphs(lines);
  assert.equal(groups.length, 3);
  assert.equal(
    mergeLines(lines),
    "Paragraph one line one. Paragraph one line two.\n\nParagraph two starts here. Paragraph two line two.\n\nIndented start.",
  );
});

test("空行与乱序的行被整理掉", () => {
  const lines = [line("B", 0.16), line("   ", 0.13), line("A", 0.1)];
  assert.equal(mergeLines(lines), "A B");
  assert.deepEqual(paragraphs([]), []);
});

test("按句边界分块，不超过上限", () => {
  const text = "第一句。第二句很长很长很长。\n\nSecond paragraph. Third sentence!";
  const pieces = chunk(text, 16);
  assert.ok(pieces.every((p) => p.length <= 16), pieces.join("|"));
  assert.equal(pieces.join("").replace(/\s+/g, ""), text.replace(/\s+/g, ""));
  assert.ok(pieces[0].startsWith("第一句。"));
  assert.throws(() => chunk("x", 0), RangeError);
});

test("超长的一句话硬切", () => {
  const pieces = chunk("a".repeat(25), 10);
  assert.deepEqual(pieces, ["aaaaaaaaaa", "aaaaaaaaaa", "aaaaa"]);
});
