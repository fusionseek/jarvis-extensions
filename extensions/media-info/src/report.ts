/**
 * 读出来的事实 → `files.details · inspect` 的段（纯函数）。
 *
 * 两个工具（mediainfo、ffprobe）各有一个解析器（`mediainfo.ts`、`ffprobe.ts`），都先归成同一份 `MediaReport`，
 * 再在这里排成段：分段与字段照 MediaInfo「简洁」视图（概要、视频、音频、字幕、图像、章节），0 与空的不写。
 * 字段的取舍与读法只在这一处，换哪个工具读，用户看到的是同一种排法。
 *
 * 最后一步 `clampResult` 按契约截好：宿主对越界的结果整份拒收（不替你截），一段写坏了整块就只剩「读不出来」。
 */
import { fileDetailsLimits } from "@fusionseek/jarvis-extension-sdk";
import type { FileDetailsResult, FileDetailsRow, FileDetailsSection } from "@fusionseek/jarvis-extension-sdk";
import {
  aspectRatioText,
  bitDepthText,
  bitRateText,
  dateText,
  durationText,
  fileSizeText,
  frameRateText,
  languageText,
  modeText,
  resolutionText,
  samplingRateText,
  scanText,
  timestampText,
  withDetails,
} from "./units.js";

/** 概要（MediaInfo 的 General）。数都是原始单位：秒、bit/s、字节。 */
export interface GeneralFacts {
  /** 容器（`Matroska`、`MPEG-4`）。 */
  format?: string;
  /** 容器的配置（`Base Media`、`QuickTime`、`版本 4`）。 */
  profile?: string;
  fileSize?: number;
  duration?: number;
  bitRate?: number;
  /** `CBR` / `VBR`。 */
  bitRateMode?: string;
  frameRate?: number;
  /** 已归一的日期串（`2026-10-31 08:00:00 UTC`），或任意原文。 */
  encodedDate?: string;
  /** 写入程序（封装器，`mkvmerge v74`、`Lavf62.3.100`）。 */
  application?: string;
  /** 编码库。 */
  library?: string;
  title?: string;
  artist?: string;
  album?: string;
}

/** 一条视频轨。 */
export interface VideoFacts {
  format?: string;
  /** 配置 / 级别，已拼好（`High@L4`、`Main 10@L5@Main`）。 */
  profile?: string;
  codecId?: string;
  bitRate?: number;
  /** 只有标称码率时（容器里写的、不是量出来的）。 */
  nominalBitRate?: number;
  bitRateMode?: string;
  width?: number;
  height?: number;
  /** 显示宽高比：小数（`1.778`）或已经是叫法（`16:9`）。 */
  aspectRatio?: number | string;
  frameRate?: number;
  /** 帧率的分数写法（`24000/1001`），整数帧率不写。 */
  frameRateFraction?: string;
  /** `CFR` / `VFR`。 */
  frameRateMode?: string;
  colorSpace?: string;
  chromaSubsampling?: string;
  bitDepth?: number;
  /** `Progressive` / `Interlaced` / `MBAFF`…… */
  scanType?: string;
  /** `TFF` / `BFF`。 */
  scanOrder?: string;
  /** HDR 格式，已拼好（`Dolby Vision，版本 1.0，dvhe.08.06，BL+RPU，兼容 HDR10 / SMPTE ST 2086，兼容 HDR10`）。 */
  hdr?: string;
  primaries?: string;
  transfer?: string;
  /** 语言码（`en` / `eng` / `zh-CN`），读法在这里换。 */
  language?: string;
  title?: string;
}

/** 一条音频轨。 */
export interface AudioFacts {
  format?: string;
  /** 配置（`LC`、`Layer 3`、`DTS-HD MA`）。 */
  profile?: string;
  /** 商业名（`Dolby Digital Plus`）。 */
  commercial?: string;
  bitRate?: number;
  nominalBitRate?: number;
  bitRateMode?: string;
  /** 声道数；读不成数的（`8 / 6`）原样。 */
  channels?: number | string;
  /** 声道布局（`L R C LFE Ls Rs`、`5.1(side)`）。 */
  layout?: string;
  samplingRate?: number;
  bitDepth?: number;
  /** `Lossy` / `Lossless`。 */
  compression?: string;
  language?: string;
  title?: string;
  isDefault?: boolean;
  isForced?: boolean;
}

/** 一条字幕轨。 */
export interface TextFacts {
  format?: string;
  language?: string;
  title?: string;
  isDefault?: boolean;
  isForced?: boolean;
}

/** 一张内嵌图像（封面）。 */
export interface ImageFacts {
  format?: string;
  width?: number;
  height?: number;
  bitDepth?: number;
}

/** 一个章节：起点（秒）与标题（可以为空）。 */
export interface ChapterFact {
  start: number;
  title?: string;
}

/** 一个文件读出来的全部事实。 */
export interface MediaReport {
  general: GeneralFacts;
  videos: VideoFacts[];
  audios: AudioFacts[];
  texts: TextFacts[];
  images: ImageFacts[];
  chapters: ChapterFact[];
}

/** 章节段至多几行（含最后那行「还有几章」）：详情面板是侧栏，四十行已经要滚很久。 */
export const maximumChapterRows = 40;

/** 一段里攒行：值为空就不写（0 与空不写，照 MediaInfo）。 */
class Rows {
  readonly rows: FileDetailsRow[] = [];

  add(label: string, value: string | undefined): void {
    if (value !== undefined && value.trim().length > 0) this.rows.push({ label, value });
  }
}

/** `视频` / `视频 #2`：只有一条时不编号，与 MediaInfo 一致。 */
function numbered(title: string, index: number, count: number): string {
  return count > 1 ? `${title} #${index + 1}` : title;
}

/** 码率（+ 模式）；只有标称码率时写「（标称）」。 */
function bitRateValue(bitRate: number | undefined, nominal: number | undefined, mode: string | undefined): string | undefined {
  const modeName = mode ? modeText(mode) : undefined;
  if (bitRate !== undefined) return withDetails(bitRateText(bitRate), modeName);
  if (nominal !== undefined) return withDetails(bitRateText(nominal), "标称", modeName);
  return undefined;
}

/** 声道数（+ 布局）→ `6 声道（L R C LFE Ls Rs）`。 */
function channelsValue(channels: number | string | undefined, layout: string | undefined): string | undefined {
  if (channels === undefined) return undefined;
  const count = typeof channels === "number" ? `${channels} 声道` : /声道$/.test(channels) ? channels : `${channels} 声道`;
  // `M`（MediaInfo）与 `mono`（ffprobe）都是单声道；`stereo` 是 ffprobe 的立体声。别的布局（`L R C LFE Ls Rs`、`5.1(side)`）原样写。
  const layoutName = layout === "M" || layout === "mono" ? "单声道" : layout === "stereo" ? "立体声" : layout;
  return withDetails(count, layoutName);
}

/** 只有一条以上同类轨时「默认」才有信息量（哪一条先放）；只有一条时它恒为是，写出来是噪声。「强制」是就写。 */
function flags(rows: Rows, facts: { isDefault?: boolean; isForced?: boolean }, siblings: number): void {
  if (facts.isDefault && siblings > 1) rows.add("默认", "是");
  if (facts.isForced) rows.add("强制", "是");
}

/** 语言行。 */
function languageValue(code: string | undefined): string | undefined {
  return code ? languageText(code) : undefined;
}

/** 概要段。 */
export function summarySection(general: GeneralFacts, firstVideo: VideoFacts | undefined): FileDetailsSection {
  const rows = new Rows();
  rows.add("格式", withDetails(general.format, general.profile));
  rows.add("文件大小", general.fileSize !== undefined ? fileSizeText(general.fileSize) : undefined);
  rows.add("时长", general.duration !== undefined ? durationText(general.duration) : undefined);
  rows.add("总码率", bitRateValue(general.bitRate, undefined, general.bitRateMode));
  const frameRate = general.frameRate ?? firstVideo?.frameRate;
  rows.add("帧率", frameRate !== undefined ? frameRateText(frameRate) : undefined);
  rows.add("编码日期", dateText(general.encodedDate));
  rows.add("写入程序", general.application);
  // 封装器既写程序又写库、两者是同一个字串时（ffmpeg 产出的文件都这样）只写一行。
  if (general.library !== general.application) rows.add("编码库", general.library);
  rows.add("标题", general.title);
  rows.add("艺术家", general.artist);
  rows.add("专辑", general.album);
  return { title: "概要", rows: rows.rows };
}

/** 一条视频轨的段。 */
export function videoSection(video: VideoFacts, index: number, count: number): FileDetailsSection {
  const rows = new Rows();
  rows.add("格式", withDetails(video.format, video.profile));
  rows.add("编码 ID", video.codecId);
  rows.add("码率", bitRateValue(video.bitRate, video.nominalBitRate, video.bitRateMode));
  rows.add("分辨率", video.width !== undefined && video.height !== undefined ? resolutionText(video.width, video.height) : undefined);
  rows.add("显示宽高比", typeof video.aspectRatio === "number" ? aspectRatioText(video.aspectRatio) : video.aspectRatio);
  rows.add(
    "帧率",
    video.frameRate !== undefined
      ? withDetails(frameRateText(video.frameRate), video.frameRateFraction, video.frameRateMode ? modeText(video.frameRateMode) : undefined)
      : undefined,
  );
  rows.add("色彩空间", video.colorSpace);
  rows.add("色度抽样", video.chromaSubsampling);
  rows.add("位深", video.bitDepth !== undefined ? bitDepthText(video.bitDepth) : undefined);
  rows.add("扫描方式", video.scanType ? scanText(video.scanType, video.scanOrder) : undefined);
  rows.add("HDR 格式", video.hdr);
  rows.add("色彩原色", video.primaries);
  rows.add("传输特性", video.transfer);
  rows.add("语言", languageValue(video.language));
  rows.add("标题", video.title);
  return { title: numbered("视频", index, count), rows: rows.rows };
}

/** 一条音频轨的段。 */
export function audioSection(audio: AudioFacts, index: number, count: number): FileDetailsSection {
  const rows = new Rows();
  rows.add("格式", withDetails(audio.format, audio.profile, audio.commercial));
  rows.add("码率", bitRateValue(audio.bitRate, audio.nominalBitRate, audio.bitRateMode));
  rows.add("声道", channelsValue(audio.channels, audio.layout));
  rows.add("采样率", audio.samplingRate !== undefined ? samplingRateText(audio.samplingRate) : undefined);
  rows.add("位深", audio.bitDepth !== undefined ? bitDepthText(audio.bitDepth) : undefined);
  rows.add("压缩模式", audio.compression ? modeText(audio.compression) : undefined);
  rows.add("语言", languageValue(audio.language));
  rows.add("标题", audio.title);
  flags(rows, audio, count);
  return { title: numbered("音频", index, count), rows: rows.rows };
}

/** 一条字幕轨的段。 */
export function textSection(text: TextFacts, index: number, count: number): FileDetailsSection {
  const rows = new Rows();
  rows.add("格式", text.format);
  rows.add("语言", languageValue(text.language));
  rows.add("标题", text.title);
  flags(rows, text, count);
  return { title: numbered("字幕", index, count), rows: rows.rows };
}

/** 一张内嵌图像的段。 */
export function imageSection(image: ImageFacts, index: number, count: number): FileDetailsSection {
  const rows = new Rows();
  rows.add("格式", image.format);
  rows.add("分辨率", image.width !== undefined && image.height !== undefined ? resolutionText(image.width, image.height) : undefined);
  rows.add("位深", image.bitDepth !== undefined ? bitDepthText(image.bitDepth) : undefined);
  return { title: numbered("图像", index, count), rows: rows.rows };
}

/**
 * 章节段：按起点排，`时刻 · 标题`，至多 {@link maximumChapterRows} 行；更多时最后一行写还有几章没列出（蓝光原盘的章节表能有上百条）。
 * 没有标题的章节写「第 n 章」——值不能为空。
 */
export function chapterSection(chapters: ChapterFact[]): FileDetailsSection | undefined {
  if (chapters.length === 0) return undefined;
  const sorted = [...chapters].sort((a, b) => a.start - b.start);
  const shown = sorted.length > maximumChapterRows ? sorted.slice(0, maximumChapterRows - 1) : sorted;
  const rows: FileDetailsRow[] = shown.map((chapter, index) => ({
    label: timestampText(chapter.start),
    value: chapter.title && chapter.title.trim().length > 0 ? chapter.title.trim() : `第 ${index + 1} 章`,
  }));
  if (shown.length < sorted.length) {
    rows.push({ label: "其余", value: `共 ${sorted.length} 章，这里只列出前 ${shown.length} 章` });
  }
  return { title: "章节", rows };
}

/**
 * 全部段，按 MediaInfo 的顺序：概要、视频、音频、字幕、图像、章节。空段不交。
 *
 * 段数上限 16：一份蓝光原盘的 remux 能有三十条字幕轨。超出时概要与章节留着，轨道段放到装得下为止，
 * 其余每条轨压成「其余轨道」那一段里的一行（`字幕 #12` · `PGS，英语，强制`）——一条不丢，只是读得简略些。
 */
export function buildSections(report: MediaReport): FileDetailsSection[] {
  const summary = summarySection(report.general, report.videos[0]);
  const tracks: FileDetailsSection[] = [
    ...report.videos.map((video, index) => videoSection(video, index, report.videos.length)),
    ...report.audios.map((audio, index) => audioSection(audio, index, report.audios.length)),
    ...report.texts.map((text, index) => textSection(text, index, report.texts.length)),
    ...report.images.map((image, index) => imageSection(image, index, report.images.length)),
  ].filter((section) => section.rows.length > 0);
  const chapters = chapterSection(report.chapters);
  const fixed = [summary, chapters].filter((section): section is FileDetailsSection => section !== undefined && section.rows.length > 0);

  const limit = fileDetailsLimits.sections;
  if (fixed.length + tracks.length <= limit) {
    return [...(summary.rows.length > 0 ? [summary] : []), ...tracks, ...(chapters ? [chapters] : [])];
  }
  const room = limit - fixed.length - 1;
  const kept = tracks.slice(0, room);
  const rest = tracks.slice(room);
  const maximumRows = fileDetailsLimits.rows;
  const restRows: FileDetailsRow[] = rest.slice(0, rest.length > maximumRows ? maximumRows - 1 : rest.length).map((section) => ({
    label: section.title,
    value: section.rows
      .slice(0, 4)
      .map((row) => row.value)
      .join("，"),
  }));
  if (rest.length > restRows.length) restRows.push({ label: "……", value: `还有 ${rest.length - restRows.length} 条轨道没列出` });
  return [
    ...(summary.rows.length > 0 ? [summary] : []),
    ...kept,
    { title: "其余轨道", rows: restRows },
    ...(chapters ? [chapters] : []),
  ];
}

/** 控制字符（含换行、制表）换成空格：元数据里的标题、注释什么都可能有，详情面板一格只画三行。 */
function flatten(text: string): string {
  return text.replace(/[\u0000-\u001f\u007f]+/g, " ").trim();
}

/**
 * 截到至多 `limit` 个 UTF-16 单元（超出时末尾换成「…」），不切开代理对。
 * 按 UTF-16 数是最严的一种数法：码点数、字形簇数都不会比它多，宿主无论按哪种数都不越界。
 */
export function truncate(text: string, limit: number): string {
  if (text.length <= limit) return text;
  let cut = limit - 1;
  const code = text.charCodeAt(cut - 1);
  if (code >= 0xd800 && code <= 0xdbff) cut -= 1;
  return `${text.slice(0, cut)}…`;
}

/**
 * 按契约截好一份结果：至多 16 段、每段 1–80 行、标题 ≤ 32、标签 ≤ 40、值 ≤ 500、notice ≤ 200；空的行与段去掉。
 * 宿主对越界的结果整份拒收——这是交出去之前的最后一道。
 */
export function clampResult(sections: FileDetailsSection[], notice?: string): FileDetailsResult {
  const limits = fileDetailsLimits;
  const clamped: FileDetailsSection[] = [];
  for (const section of sections) {
    const rows: FileDetailsRow[] = [];
    for (const row of section.rows) {
      const label = truncate(flatten(row.label), limits.label);
      const value = truncate(flatten(row.value), limits.value);
      if (label.length > 0 && value.length > 0) rows.push({ label, value });
      if (rows.length === limits.rows) break;
    }
    const title = truncate(flatten(section.title), limits.title);
    if (rows.length > 0 && title.length > 0) clamped.push({ title, rows });
    if (clamped.length === limits.sections) break;
  }
  const result: FileDetailsResult = { sections: clamped };
  const note = notice ? truncate(flatten(notice), limits.notice) : "";
  if (note.length > 0) result.notice = note;
  return result;
}
