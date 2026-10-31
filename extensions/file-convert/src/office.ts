/**
 * 办公文档的转换（Word / Excel / PowerPoint 与 OpenDocument、PDF）——与媒体、文本各自独立成一个模块。
 *
 * Word ↔ ODT ↔ RTF 由 textutil（自带）做（见 `text.ts`）；这里只放 LibreOffice（`soffice`，装了才有）补的那几样：
 * 文档、表格、演示转 PDF，表格之间（XLSX / XLS / ODS / CSV）与演示之间（PPTX / PPT / ODP）互转。
 *
 * LibreOffice 不让指定产物名：`--convert-to` 写进工作目录（就是 Jarvis 给的暂存目录），名字 = 输入的名称 + 目标扩展名。
 * 跑之前 Jarvis 已经开着一个 LibreOffice 窗口时它会一声不响地什么都不做——那一项写「没转成」，提示先关掉 LibreOffice。
 */
import type { Conversion } from "./engines.js";
import { IN } from "./engines.js";

const documents = ["doc", "docx", "odt", "rtf", "txt", "html"];
const spreadsheets = ["xlsx", "xls", "ods", "csv"];
const presentations = ["pptx", "ppt", "odp"];

/** `--convert-to` 的写法：CSV 要点名分隔符与编码（逗号、UTF-8、第一行原样），否则 LibreOffice 按系统区域写分号与本地编码。 */
const filters: Record<string, string> = {
  pdf: "pdf",
  docx: "docx",
  odt: "odt",
  xlsx: "xlsx",
  ods: "ods",
  csv: "csv:Text-CSV:44,34,76,1",
  pptx: "pptx",
  odp: "odp",
};

function soffice(from: string[], to: string): Conversion {
  return { tool: "soffice", from: from.filter((source) => source !== to), to, cost: 2.5, template: ["--headless", "--convert-to", filters[to], IN] };
}

export const officeConversions: Conversion[] = [
  soffice([...documents, ...spreadsheets, ...presentations], "pdf"),
  soffice(documents, "docx"),
  soffice(documents, "odt"),
  soffice(spreadsheets, "xlsx"),
  soffice(spreadsheets, "ods"),
  soffice(spreadsheets.filter((source) => source !== "csv"), "csv"),
  soffice(presentations, "pptx"),
  soffice(presentations, "odp"),
];
