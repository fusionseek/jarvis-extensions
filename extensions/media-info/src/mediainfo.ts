/**
 * `mediainfo --Output=JSON <file>` 的输出 → `MediaReport`（纯函数）。
 *
 * 形状（MediaInfoLib 18.03 起的 JSON 导出，与 MediaInfo.app 同一个库）：
 *
 * ```json
 * { "creatingLibrary": { … }, "media": { "@ref": "…", "track": [
 *   { "@type": "General", "Format": "Matroska", "FileSize": "2411583", "Duration": "3.008", … },
 *   { "@type": "Video", "Format": "AVC", "Width": "1920", … },
 *   { "@type": "Audio", "@typeorder": "1", … }, { "@type": "Text", … },
 *   { "@type": "Menu", "extra": { "_00_00_00_000": "en:开场", … } } ] } }
 * ```
 *
 * 值全是字符串，时长是秒（带小数），码率是 bit/s；不认识的字段（`extra` 里的私有项）一律不碰。
 */
import { MediaReadFailure } from "./failures.js";
import type { AudioFacts, ChapterFact, GeneralFacts, ImageFacts, MediaReport, TextFacts, VideoFacts } from "./report.js";
import { numberOf, positive, textOf } from "./units.js";

type Track = Record<string, unknown>;

/** `"Yes"` → true。 */
function yes(value: unknown): boolean {
  return textOf(value) === "Yes";
}

/**
 * `"a / b / c"` → 三段（MediaInfo 把一条轨的多重身份写成斜线分隔，HDR 那几项就是这样）。
 * 空段保留位置：`"1.0 / "` 是「第一层 1.0、第二层没有」，按下标与 `HDR_Format` 对齐，不能先整体去空白再切。
 */
function parts(value: unknown): string[] {
  if (typeof value !== "string" || value.trim().length === 0) return [];
  return value.split("/").map((part) => part.trim());
}

/** 视频的配置 / 级别 / 层级 → `High@L4`、`Main 10@L5@Main`（MediaInfo「简洁」视图的 Format profile 一行）。 */
export function videoProfile(track: Track): string | undefined {
  const profile = textOf(track.Format_Profile);
  const level = textOf(track.Format_Level);
  const tier = textOf(track.Format_Tier);
  const pieces = [profile, level ? `L${level}` : undefined, tier].filter((piece): piece is string => piece !== undefined);
  return pieces.length > 0 ? pieces.join("@") : undefined;
}

/**
 * HDR 格式：`HDR_Format` 与它的版本 / 配置 / 级别 / 设置 / 兼容逐段对齐拼起来——
 * 一条 Dolby Vision 双层流在 MediaInfo 里是 `Dolby Vision / SMPTE ST 2086`，其余几项按同样的斜线位置给。
 */
export function hdrFormat(track: Track): string | undefined {
  const formats = parts(track.HDR_Format);
  if (formats.length === 0) return undefined;
  const versions = parts(track.HDR_Format_Version);
  const profiles = parts(track.HDR_Format_Profile);
  const levels = parts(track.HDR_Format_Level);
  const settings = parts(track.HDR_Format_Settings);
  const compatibility = parts(track.HDR_Format_Compatibility);
  return formats
    .map((format, index) => {
      const profile = profiles[index] ? (levels[index] ? `${profiles[index]}.${levels[index]}` : profiles[index]) : undefined;
      return [
        format,
        versions[index] ? `版本 ${versions[index]}` : undefined,
        profile,
        settings[index] || undefined,
        compatibility[index] ? `兼容 ${compatibility[index]}` : undefined,
      ]
        .filter((piece): piece is string => piece !== undefined && piece.length > 0)
        .join("，");
    })
    .filter((piece) => piece.length > 0)
    .join(" / ");
}

/** 章节键 `_HH_MM_SS_mmm`（JSON 键不能以数字开头，MediaInfo 补了一个下划线）。 */
const chapterKey = /^_(\d{2,})_(\d{2})_(\d{2})_(\d{3})$/;

/** 章节标题前的语言前缀（`en:`、`:`，mkvmerge 写的章节都带）。 */
const chapterLanguage = /^(?:[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*)?:(?=.)/;

/** Menu 轨 → 章节。键可能在轨上，也可能在 `extra` 里（新版都在 `extra`）。 */
export function menuChapters(track: Track): ChapterFact[] {
  const chapters: ChapterFact[] = [];
  const extra = track.extra && typeof track.extra === "object" ? (track.extra as Track) : {};
  for (const source of [track, extra]) {
    for (const key of Object.keys(source)) {
      const match = chapterKey.exec(key);
      if (!match) continue;
      const start = Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]) + Number(match[4]) / 1000;
      const raw = textOf(source[key]);
      chapters.push({ start, title: raw ? raw.replace(chapterLanguage, "").trim() : undefined });
    }
  }
  return chapters;
}

function general(track: Track): GeneralFacts {
  const version = textOf(track.Format_Version);
  return {
    format: textOf(track.Format),
    profile: textOf(track.Format_Profile) ?? (version ? `版本 ${version}` : undefined),
    fileSize: numberOf(track.FileSize),
    duration: positive(track.Duration),
    bitRate: positive(track.OverallBitRate),
    bitRateMode: textOf(track.OverallBitRate_Mode),
    frameRate: positive(track.FrameRate),
    encodedDate: textOf(track.Encoded_Date),
    application: textOf(track.Encoded_Application),
    library: textOf(track.Encoded_Library),
    title: textOf(track.Title) ?? textOf(track.Movie) ?? textOf(track.Track),
    artist: textOf(track.Performer) ?? textOf(track.Album_Performer),
    album: textOf(track.Album),
  };
}

function video(track: Track): VideoFacts {
  const numerator = textOf(track.FrameRate_Num);
  const denominator = textOf(track.FrameRate_Den);
  const aspect = numberOf(track.DisplayAspectRatio);
  return {
    format: textOf(track.Format),
    profile: videoProfile(track),
    codecId: textOf(track.CodecID),
    bitRate: positive(track.BitRate),
    nominalBitRate: positive(track.BitRate_Nominal),
    bitRateMode: textOf(track.BitRate_Mode),
    width: positive(track.Width),
    height: positive(track.Height),
    aspectRatio: aspect !== undefined && aspect > 0 ? aspect : textOf(track.DisplayAspectRatio),
    frameRate: positive(track.FrameRate),
    frameRateFraction: numerator && denominator && denominator !== "1" ? `${numerator}/${denominator}` : undefined,
    frameRateMode: textOf(track.FrameRate_Mode),
    colorSpace: textOf(track.ColorSpace),
    chromaSubsampling: textOf(track.ChromaSubsampling),
    bitDepth: positive(track.BitDepth),
    scanType: textOf(track.ScanType),
    scanOrder: textOf(track.ScanOrder),
    hdr: hdrFormat(track),
    primaries: textOf(track.colour_primaries),
    transfer: textOf(track.transfer_characteristics),
    language: textOf(track.Language),
    title: textOf(track.Title),
  };
}

function audio(track: Track): AudioFacts {
  const format = textOf(track.Format);
  const profile = [textOf(track.Format_Profile), textOf(track.Format_AdditionalFeatures)].filter((piece) => piece !== undefined).join(" ");
  const channels = textOf(track.Channels);
  return {
    format,
    profile: profile.length > 0 ? profile : undefined,
    commercial: textOf(track.Format_Commercial_IfAny),
    bitRate: positive(track.BitRate),
    nominalBitRate: positive(track.BitRate_Nominal),
    bitRateMode: textOf(track.BitRate_Mode),
    channels: channels === undefined ? undefined : numberOf(channels) ?? channels,
    layout: textOf(track.ChannelLayout),
    samplingRate: positive(track.SamplingRate),
    bitDepth: positive(track.BitDepth),
    compression: textOf(track.Compression_Mode),
    language: textOf(track.Language),
    title: textOf(track.Title),
    isDefault: yes(track.Default),
    isForced: yes(track.Forced),
  };
}

function text(track: Track): TextFacts {
  return {
    format: textOf(track.Format),
    language: textOf(track.Language),
    title: textOf(track.Title),
    isDefault: yes(track.Default),
    isForced: yes(track.Forced),
  };
}

function image(track: Track): ImageFacts {
  return {
    format: textOf(track.Format),
    width: positive(track.Width),
    height: positive(track.Height),
    bitDepth: positive(track.BitDepth),
  };
}

/**
 * 解析 mediainfo 的 JSON 输出。
 *
 * @param output 标准输出全文。
 * @returns 归一之后的事实。
 * @throws {MediaReadFailure} `malformed`：不是 JSON、或不是 MediaInfo 的形状（版本太旧没有 JSON 导出时会吐文本）；
 *   `unrecognized`：认不出格式（只有一条没有 Format 的 General——空文件、不是影音的文件都是这样）。
 */
export function parseMediaInfo(output: string): MediaReport {
  let document: unknown;
  try {
    document = JSON.parse(output);
  } catch {
    throw new MediaReadFailure("malformed");
  }
  const media = document && typeof document === "object" ? (document as Track).media : undefined;
  if (media === null) throw new MediaReadFailure("unrecognized");
  if (!media || typeof media !== "object") throw new MediaReadFailure("malformed");
  const raw = (media as Track).track;
  const tracks = (Array.isArray(raw) ? raw : raw && typeof raw === "object" ? [raw] : []).filter(
    (track): track is Track => track !== null && typeof track === "object",
  );

  const report: MediaReport = { general: {}, videos: [], audios: [], texts: [], images: [], chapters: [] };
  let sawGeneral = false;
  for (const track of tracks) {
    switch (track["@type"]) {
      case "General":
        if (!sawGeneral) report.general = general(track);
        sawGeneral = true;
        break;
      case "Video":
        report.videos.push(video(track));
        break;
      case "Audio":
        report.audios.push(audio(track));
        break;
      case "Text":
        report.texts.push(text(track));
        break;
      case "Image":
        report.images.push(image(track));
        break;
      case "Menu":
        report.chapters.push(...menuChapters(track));
        break;
    }
  }
  const streams = report.videos.length + report.audios.length + report.texts.length + report.images.length;
  if (report.general.format === undefined && streams === 0) throw new MediaReadFailure("unrecognized");
  return report;
}
