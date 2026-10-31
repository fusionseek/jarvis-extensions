/**
 * 格式表：一种格式 = 一个 id（就是产物的扩展名）、给人看的名字、认哪些扩展名、属于哪一类。
 *
 * 转盘外圈上那一片的名字就是这里的 `title`；动作 id 是 `to-<id>`。分三类模块写转换（媒体 `media.ts`、文本 `text.ts`、办公 `office.ts`），
 * 格式表是它们共用的那一份：PDF 既是图片能转成的，也是 Word 能转成的，同一个目标在外圈上只有一片。
 */

/** 一类：决定外圈那一片的符号。 */
export type Family = "image" | "audio" | "video" | "text" | "office" | "data" | "pdf";

/** 一种格式。 */
export interface Format {
  /** 产物的扩展名（小写不带点），也是动作 id 的后半（`to-png`）。 */
  id: string;
  /** 外圈上那一片的名字（≤ 24 字，拉丁字母为主：9.5pt 一片放得下 8 个字母）。 */
  title: string;
  family: Family;
  /** 认作这种格式的扩展名（第一个是 `id` 本身）。 */
  extensions: string[];
}

export const formats: Format[] = [
  // 图像
  { id: "png", title: "PNG", family: "image", extensions: ["png"] },
  { id: "jpg", title: "JPEG", family: "image", extensions: ["jpg", "jpeg"] },
  { id: "heic", title: "HEIC", family: "image", extensions: ["heic", "heif"] },
  { id: "tiff", title: "TIFF", family: "image", extensions: ["tiff", "tif"] },
  { id: "gif", title: "GIF", family: "image", extensions: ["gif"] },
  { id: "bmp", title: "BMP", family: "image", extensions: ["bmp"] },
  { id: "webp", title: "WebP", family: "image", extensions: ["webp"] },
  { id: "avif", title: "AVIF", family: "image", extensions: ["avif"] },
  { id: "jp2", title: "JPEG 2000", family: "image", extensions: ["jp2"] },
  { id: "ico", title: "ICO", family: "image", extensions: ["ico"] },
  { id: "psd", title: "PSD", family: "image", extensions: ["psd"] },
  { id: "svg", title: "SVG", family: "image", extensions: ["svg"] },
  { id: "tga", title: "TGA", family: "image", extensions: ["tga"] },
  // PDF：图片与办公文档都能转成它
  { id: "pdf", title: "PDF", family: "pdf", extensions: ["pdf"] },
  // 音频
  { id: "m4a", title: "M4A", family: "audio", extensions: ["m4a"] },
  { id: "mp3", title: "MP3", family: "audio", extensions: ["mp3"] },
  { id: "wav", title: "WAV", family: "audio", extensions: ["wav"] },
  { id: "aiff", title: "AIFF", family: "audio", extensions: ["aiff", "aif"] },
  { id: "flac", title: "FLAC", family: "audio", extensions: ["flac"] },
  { id: "caf", title: "CAF", family: "audio", extensions: ["caf"] },
  { id: "ogg", title: "OGG", family: "audio", extensions: ["ogg", "oga"] },
  { id: "opus", title: "Opus", family: "audio", extensions: ["opus"] },
  { id: "aac", title: "AAC", family: "audio", extensions: ["aac"] },
  // 视频
  { id: "mp4", title: "MP4", family: "video", extensions: ["mp4"] },
  { id: "mov", title: "MOV", family: "video", extensions: ["mov", "qt"] },
  { id: "m4v", title: "M4V", family: "video", extensions: ["m4v"] },
  { id: "mkv", title: "MKV", family: "video", extensions: ["mkv"] },
  { id: "webm", title: "WebM", family: "video", extensions: ["webm"] },
  { id: "avi", title: "AVI", family: "video", extensions: ["avi"] },
  { id: "flv", title: "FLV", family: "video", extensions: ["flv"] },
  { id: "wmv", title: "WMV", family: "video", extensions: ["wmv"] },
  { id: "mpg", title: "MPEG", family: "video", extensions: ["mpg", "mpeg"] },
  { id: "ts", title: "TS", family: "video", extensions: ["ts", "m2ts", "mts"] },
  { id: "3gp", title: "3GP", family: "video", extensions: ["3gp"] },
  // 文本
  { id: "md", title: "Markdown", family: "text", extensions: ["md", "markdown"] },
  { id: "html", title: "HTML", family: "text", extensions: ["html", "htm"] },
  { id: "txt", title: "纯文本", family: "text", extensions: ["txt"] },
  { id: "rtf", title: "RTF", family: "text", extensions: ["rtf"] },
  { id: "epub", title: "EPUB", family: "text", extensions: ["epub"] },
  { id: "webarchive", title: "Web 归档", family: "text", extensions: ["webarchive"] },
  // 数据
  { id: "json", title: "JSON", family: "data", extensions: ["json"] },
  { id: "plist", title: "plist", family: "data", extensions: ["plist"] },
  // 办公
  { id: "docx", title: "Word", family: "office", extensions: ["docx"] },
  { id: "doc", title: "Word 97", family: "office", extensions: ["doc"] },
  { id: "odt", title: "ODT", family: "office", extensions: ["odt"] },
  { id: "xlsx", title: "Excel", family: "office", extensions: ["xlsx"] },
  { id: "xls", title: "Excel 97", family: "office", extensions: ["xls"] },
  { id: "ods", title: "ODS", family: "office", extensions: ["ods"] },
  { id: "csv", title: "CSV", family: "office", extensions: ["csv"] },
  { id: "pptx", title: "PowerPoint", family: "office", extensions: ["pptx"] },
  { id: "ppt", title: "PPT 97", family: "office", extensions: ["ppt"] },
  { id: "odp", title: "ODP", family: "office", extensions: ["odp"] },
];

const byId = new Map(formats.map((format) => [format.id, format]));
const byExtension = new Map(formats.flatMap((format) => format.extensions.map((extension) => [extension, format] as const)));

/** 按 id 找。 */
export function formatById(id: string): Format | undefined {
  return byId.get(id);
}

/** 一个文件扩展名是哪种格式（`jpeg` → `jpg`）；认不出为 `undefined`。 */
export function formatOfExtension(extension: string): Format | undefined {
  return byExtension.get(extension.toLowerCase());
}

/** 外圈那一片的符号（SF Symbol）。 */
export function symbolOf(family: Family): string {
  switch (family) {
    case "image": return "photo";
    case "audio": return "music.note";
    case "video": return "film";
    case "text": return "doc.text";
    case "office": return "doc.richtext";
    case "data": return "curlybraces";
    case "pdf": return "doc.richtext.fill";
  }
}
