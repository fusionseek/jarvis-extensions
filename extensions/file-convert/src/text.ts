/**
 * 文本的转换（纯文本、HTML、RTF、Markdown、EPUB 与 JSON / plist）——与媒体、办公各自独立成一个模块。
 *
 * - textutil（自带，Cocoa 的文本系统）：TXT / HTML / RTF / DOC / DOCX / ODT / Web 归档 互转。它也是 Word 与 ODT 的主力（`office.ts` 只补 PDF 与表格、演示）。
 * - pandoc（装了才有）：Markdown 的读写都靠它，另加 EPUB；Markdown → Word 这类一步到不了 textutil 的，路线规划会自己接上。
 * - plutil（自带）：JSON ↔ plist（XML）。带日期、二进制数据的 plist 转 JSON 会被它拒绝，那一项写「没转成」。
 */
import type { Conversion } from "./engines.js";
import { IN, OUT } from "./engines.js";

/** textutil 读写的格式（id → `-convert` 名）。 */
const textutilWritable: Record<string, string> = { txt: "txt", html: "html", rtf: "rtf", doc: "doc", docx: "docx", odt: "odt" };
const textutilReadable = ["txt", "html", "rtf", "doc", "docx", "odt", "webarchive"];

/** pandoc 读得了的（按扩展名认格式）。 */
const pandocReadable = ["md", "html", "docx", "odt", "epub", "rtf"];

export const textConversions: Conversion[] = [
  ...Object.entries(textutilWritable).map(([to, name]) => ({
    tool: "textutil" as const,
    from: textutilReadable.filter((from) => from !== to),
    to,
    cost: 1,
    template: ["-convert", name, IN, "-output", OUT],
  })),
  // pandoc：Markdown 写成 GitHub 风格（读起来最常见）；纯文本要点名 plain（.txt 认不出格式）；其余按产物扩展名定，HTML 带完整的头尾。
  { tool: "pandoc", from: pandocReadable.filter((from) => from !== "md"), to: "md", cost: 2, template: [IN, "-t", "gfm", "-o", OUT] },
  { tool: "pandoc", from: pandocReadable, to: "txt", cost: 2, template: [IN, "-t", "plain", "-o", OUT] },
  ...["html", "docx", "odt", "epub", "rtf"].map((to) => ({
    tool: "pandoc" as const,
    from: pandocReadable.filter((from) => from !== to),
    to,
    cost: 2,
    template: [IN, "-s", "-o", OUT],
  })),
  { tool: "plutil", from: ["plist"], to: "json", cost: 1, template: ["-convert", "json", "-o", OUT, IN] },
  { tool: "plutil", from: ["json"], to: "plist", cost: 1, template: ["-convert", "xml1", "-o", OUT, IN] },
];
