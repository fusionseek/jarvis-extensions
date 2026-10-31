/**
 * `ffprobe -v error -print_format json -show_format -show_streams -show_chapters <file>` 的输出 → `MediaReport`（纯函数）。
 *
 * ffprobe 是 mediainfo 不在时的后备：它报的是解码器的视角（`codec_name: "h264"`、`pix_fmt: "yuv420p"`），
 * 这里把它换成 MediaInfo 的叫法（`AVC`、`YUV` + `4:2:0` + `8 位`），用户在两种工具之间看到的是同一套词。
 * 换不出来的（没见过的编码、容器）原样写，不猜。
 */
import { MediaReadFailure } from "./failures.js";
import type { AudioFacts, ChapterFact, GeneralFacts, ImageFacts, MediaReport, TextFacts, VideoFacts } from "./report.js";
import { aspectRatioText, numberOf, positive, textOf } from "./units.js";

type Dict = Record<string, unknown>;

function dict(value: unknown): Dict {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Dict) : {};
}

/** 标签按名字找，不分大小写（MKV 里 ffprobe 给 `ENCODER`、`BPS`，MP4 里给 `encoder`）。 */
export function tag(tags: unknown, name: string): string | undefined {
  const source = dict(tags);
  const wanted = name.toLowerCase();
  for (const key of Object.keys(source)) {
    if (key.toLowerCase() === wanted) return textOf(source[key]);
  }
  return undefined;
}

/** 解码器名 → MediaInfo 的格式名（视频、音频）。音频的几项另带配置 / 商业名。 */
const videoFormats: Record<string, string> = {
  h264: "AVC", hevc: "HEVC", vvc: "VVC", av1: "AV1", vp9: "VP9", vp8: "VP8",
  mpeg4: "MPEG-4 Visual", mpeg2video: "MPEG Video", mpeg1video: "MPEG Video", h263: "H.263",
  mjpeg: "JPEG", prores: "ProRes", dnxhd: "VC-3", vc1: "VC-1", wmv3: "VC-1", wmv2: "WMV2", wmv1: "WMV1",
  theora: "Theora", ffv1: "FFV1", cfhd: "CineForm", flv1: "Sorenson Spark", rv40: "RealVideo 4", rv30: "RealVideo 3",
  png: "PNG", gif: "GIF", bmp: "BMP", tiff: "TIFF", webp: "WebP", rawvideo: "YUV",
};

const audioFormats: Record<string, { format: string; profile?: string; commercial?: string }> = {
  aac: { format: "AAC" },
  mp3: { format: "MPEG Audio", profile: "Layer 3" },
  mp2: { format: "MPEG Audio", profile: "Layer 2" },
  mp1: { format: "MPEG Audio", profile: "Layer 1" },
  ac3: { format: "AC-3", commercial: "Dolby Digital" },
  eac3: { format: "E-AC-3", commercial: "Dolby Digital Plus" },
  truehd: { format: "MLP FBA", commercial: "Dolby TrueHD" },
  mlp: { format: "MLP" },
  dts: { format: "DTS" },
  flac: { format: "FLAC" },
  alac: { format: "ALAC" },
  opus: { format: "Opus" },
  vorbis: { format: "Vorbis" },
  wmav1: { format: "WMA" },
  wmav2: { format: "WMA" },
  wmapro: { format: "WMA", profile: "Pro" },
  wmalossless: { format: "WMA", profile: "Lossless" },
  amr_nb: { format: "AMR" },
  amr_wb: { format: "AMR", profile: "Wide band" },
  ape: { format: "Monkey's Audio" },
  wavpack: { format: "WavPack" },
  tta: { format: "TTA" },
  speex: { format: "Speex" },
  musepack7: { format: "Musepack SV7" },
  musepack8: { format: "Musepack SV8" },
  cook: { format: "Cooker" },
};

/** 无损的音频编码（ffprobe 不报压缩模式，按编码推）。 */
const losslessAudio = new Set(["flac", "alac", "ape", "wavpack", "tta", "truehd", "mlp", "wmalossless"]);
/** 有损的音频编码。 */
const lossyAudio = new Set(["aac", "mp3", "mp2", "mp1", "ac3", "eac3", "opus", "vorbis", "wmav1", "wmav2", "wmapro", "amr_nb", "amr_wb", "speex", "musepack7", "musepack8", "cook"]);

const subtitleFormats: Record<string, string> = {
  subrip: "SubRip（SRT）", srt: "SubRip（SRT）", ass: "ASS", ssa: "SSA", webvtt: "WebVTT", mov_text: "Timed Text",
  hdmv_pgs_subtitle: "PGS", dvd_subtitle: "VobSub", dvb_subtitle: "DVB Subtitle", dvb_teletext: "Teletext",
  eia_608: "EIA-608", text: "Text", ttml: "TTML", microdvd: "MicroDVD",
};

const primaryNames: Record<string, string> = {
  bt709: "BT.709", bt2020: "BT.2020", smpte170m: "BT.601 NTSC", bt470bg: "BT.601 PAL", bt470m: "BT.470 System M",
  smpte240m: "SMPTE 240M", smpte431: "DCI P3", smpte432: "Display P3", film: "Film", smpte428: "SMPTE 428M",
};

const transferNames: Record<string, string> = {
  bt709: "BT.709", smpte2084: "PQ", "arib-std-b67": "HLG", "iec61966-2-1": "sRGB/sYCC", "bt2020-10": "BT.2020 (10-bit)",
  "bt2020-12": "BT.2020 (12-bit)", smpte170m: "BT.601", gamma22: "BT.470 System M", gamma28: "BT.470 System B/G",
  linear: "Linear", smpte240m: "SMPTE 240M", smpte428: "SMPTE 428M", log100: "Logarithmic (100:1)",
};

/** ffprobe 的颜色名 → MediaInfo 的；`unknown` / `reserved` 等于没写。 */
function colorName(table: Record<string, string>, value: unknown): string | undefined {
  const raw = textOf(value);
  if (!raw || raw === "unknown" || raw === "reserved" || raw === "unspecified") return undefined;
  return table[raw] ?? raw;
}

/** MP4 主品牌 → MediaInfo 的容器配置（`isom` = Base Media、`qt  ` = QuickTime）。 */
const brandProfiles: Record<string, string> = {
  isom: "Base Media", iso2: "Base Media", iso4: "Base Media", iso5: "Base Media", iso6: "Base Media",
  mp41: "Base Media / Version 1", mp42: "Base Media / Version 2", qt: "QuickTime", M4A: "Apple audio with iTunes info",
  "3gp4": "3GPP Media Release 4", "3gp5": "3GPP Media Release 5", "3gp6": "3GPP Media Release 6", "3g2a": "3GPP2 Media", dash: "DASH",
};

/** 单一格式名（`format_name` 的第一段）→ MediaInfo 的容器名。 */
const containerNames: Record<string, string> = {
  mpegts: "MPEG-TS", mpeg: "MPEG-PS", avi: "AVI", asf: "Windows Media", flv: "Flash Video", ogg: "Ogg", wav: "Wave",
  w64: "Wave64", aiff: "AIFF", flac: "FLAC", mp3: "MPEG Audio", aac: "ADTS", ac3: "AC-3", eac3: "E-AC-3", dts: "DTS",
  ape: "Monkey's Audio", wv: "WavPack", caf: "CAF", mxf: "MXF", rm: "RealMedia", amr: "AMR", mpc: "Musepack",
  mpc8: "Musepack", truehd: "MLP", tta: "TTA", "3gp": "MPEG-4",
};

/** 容器名与配置。 */
export function container(format: Dict, extension: string): { format?: string; profile?: string } {
  const names = textOf(format.format_name) ?? "";
  if (names.startsWith("mov,mp4")) {
    const brand = (tag(format.tags, "major_brand") ?? "").trim();
    return { format: "MPEG-4", profile: brand ? brandProfiles[brand] ?? brand : undefined };
  }
  if (names.startsWith("matroska")) return { format: extension === "webm" ? "WebM" : "Matroska" };
  const first = names.split(",")[0];
  return { format: containerNames[first] ?? textOf(format.format_long_name) ?? (first || undefined) };
}

/** `30/1` → 30、`24000/1001` → 23.976…；`0/0` 为 `undefined`。 */
export function rate(value: unknown): number | undefined {
  const text = textOf(value);
  if (!text) return undefined;
  const match = /^(\d+)\/(\d+)$/.exec(text);
  if (!match) return positive(text);
  const denominator = Number(match[2]);
  if (denominator === 0) return undefined;
  const result = Number(match[1]) / denominator;
  return result > 0 ? result : undefined;
}

/** 配置 + 级别 → `High@L4.1`（与 MediaInfo 同一种写法）。ffprobe 的级别：H.264 是 ×10、HEVC 是 ×30、AV1 是 seq_level_idx。 */
export function ffprobeProfile(codec: string, profile: string | undefined, level: number | undefined): string | undefined {
  let levelText: string | undefined;
  if (level !== undefined && level > 0) {
    if (codec === "h264") levelText = String(level / 10);
    else if (codec === "hevc") levelText = String(Math.round((level / 30) * 10) / 10);
    else if (codec === "av1") levelText = `${2 + (level >> 2)}.${level & 3}`;
  }
  const pieces = [profile, levelText ? `L${levelText}` : undefined].filter((piece): piece is string => piece !== undefined && piece.length > 0);
  return pieces.length > 0 ? pieces.join("@") : undefined;
}

/** 像素格式 → 色彩空间、色度抽样、位深（`yuv420p10le` → YUV、4:2:0、10）。 */
export function pixelFormat(value: unknown): { colorSpace?: string; chromaSubsampling?: string; bitDepth?: number } {
  const format = textOf(value);
  if (!format) return {};
  const depthMatch = /p(\d{2})(?:le|be)?$/.exec(format) ?? /^p0(\d{2})/.exec(format);
  const depth = depthMatch ? Number(depthMatch[1]) : undefined;
  if (/^(yuv|yuvj|yuva|nv12|nv21|p0)/.test(format)) {
    const chroma = /420|nv12|nv21|^p0/.test(format) ? "4:2:0" : /422/.test(format) ? "4:2:2" : /444/.test(format) ? "4:4:4" : /411/.test(format) ? "4:1:1" : /440/.test(format) ? "4:4:0" : undefined;
    return { colorSpace: format.startsWith("yuva") ? "YUVA" : "YUV", chromaSubsampling: chroma, bitDepth: depth ?? 8 };
  }
  if (/^(rgb|bgr|gbr|argb|abgr|rgba|bgra)/.test(format)) return { colorSpace: /a/.test(format.replace(/^gbr/, "")) ? "RGBA" : "RGB", bitDepth: depth ?? 8 };
  if (/^gray/.test(format)) return { colorSpace: "Y", bitDepth: depth ?? 8 };
  return {};
}

/** 场序 → 扫描方式与场序（按显示顺序：`tb` 是顶场先编码、底场先显示）。 */
function scan(fieldOrder: unknown): { scanType?: string; scanOrder?: string } {
  switch (textOf(fieldOrder)) {
    case "progressive":
      return { scanType: "Progressive" };
    case "tt":
    case "bt":
      return { scanType: "Interlaced", scanOrder: "TFF" };
    case "bb":
    case "tb":
      return { scanType: "Interlaced", scanOrder: "BFF" };
    default:
      return {};
  }
}

/**
 * HDR 格式：ffprobe 不像 MediaInfo 那样直接报，只能从流的旁路数据与传输特性推——
 * Dolby Vision 配置记录 → `Dolby Vision，版本 1.0，配置 8.1，级别 6，BL+RPU`；母版显示元数据 → `SMPTE ST 2086，兼容 HDR10`；
 * 只有 PQ → `HDR10（PQ）`；HLG → `HLG`。
 */
export function ffprobeHdr(stream: Dict): string | undefined {
  const sideData = Array.isArray(stream.side_data_list) ? stream.side_data_list.map(dict) : [];
  const transfer = textOf(stream.color_transfer);
  const formats: string[] = [];
  const dovi = sideData.find((entry) => textOf(entry.side_data_type) === "DOVI configuration record");
  if (dovi) {
    const major = numberOf(dovi.dv_version_major);
    const minor = numberOf(dovi.dv_version_minor);
    const profile = numberOf(dovi.dv_profile);
    const compatibility = numberOf(dovi.dv_bl_signal_compatibility_id);
    const level = numberOf(dovi.dv_level);
    const layers = [numberOf(dovi.bl_present_flag) ? "BL" : undefined, numberOf(dovi.el_present_flag) ? "EL" : undefined, numberOf(dovi.rpu_present_flag) ? "RPU" : undefined]
      .filter((layer): layer is string => layer !== undefined)
      .join("+");
    const compatibleWith = compatibility === 1 || compatibility === 6 ? "HDR10" : compatibility === 2 ? "SDR" : compatibility === 4 ? "HLG" : undefined;
    formats.push(
      [
        "Dolby Vision",
        major !== undefined ? `版本 ${major}.${minor ?? 0}` : undefined,
        profile !== undefined ? `配置 ${profile}${compatibility ? `.${compatibility}` : ""}` : undefined,
        level ? `级别 ${level}` : undefined,
        layers || undefined,
        compatibleWith ? `兼容 ${compatibleWith}` : undefined,
      ]
        .filter((piece): piece is string => piece !== undefined)
        .join("，"),
    );
  }
  if (sideData.some((entry) => textOf(entry.side_data_type) === "Mastering display metadata")) {
    formats.push("SMPTE ST 2086，兼容 HDR10");
  } else if (transfer === "smpte2084" && !dovi) {
    formats.push("HDR10（PQ）");
  }
  if (transfer === "arib-std-b67" && formats.length === 0) formats.push("HLG");
  return formats.length > 0 ? formats.join(" / ") : undefined;
}

function disposition(stream: Dict): { isDefault: boolean; isForced: boolean } {
  const flags = dict(stream.disposition);
  return { isDefault: numberOf(flags.default) === 1, isForced: numberOf(flags.forced) === 1 };
}

/** 流的码率：流上写的，或 MKV 里 mkvmerge 记的统计标签 `BPS`。 */
function streamBitRate(stream: Dict): number | undefined {
  return positive(stream.bit_rate) ?? positive(tag(stream.tags, "BPS")) ?? positive(tag(stream.tags, "BPS-eng"));
}

function video(stream: Dict): VideoFacts {
  const codec = textOf(stream.codec_name) ?? "";
  const pixels = pixelFormat(stream.pix_fmt);
  const width = positive(stream.width);
  const height = positive(stream.height);
  const display = textOf(stream.display_aspect_ratio);
  const sar = rate(textOf(stream.sample_aspect_ratio)?.replace(":", "/"));
  const average = textOf(stream.avg_frame_rate);
  const frames = textOf(stream.avg_frame_rate) && rate(average) ? average : textOf(stream.r_frame_rate);
  const fraction = frames && /^(\d+)\/(\d+)$/.exec(frames);
  const tagString = textOf(stream.codec_tag_string);
  return {
    format: videoFormats[codec] ?? textOf(stream.codec_long_name) ?? (codec || undefined),
    profile: ffprobeProfile(codec, textOf(stream.profile), numberOf(stream.level)),
    codecId: tagString && !tagString.startsWith("[") ? tagString : undefined,
    bitRate: streamBitRate(stream),
    width,
    height,
    aspectRatio:
      display && /^\d+:\d+$/.test(display) && !display.startsWith("0:")
        ? display
        : width && height
          ? aspectRatioText((width / height) * (sar ?? 1))
          : undefined,
    frameRate: rate(frames),
    frameRateFraction: fraction && fraction[2] !== "1" ? `${fraction[1]}/${fraction[2]}` : undefined,
    colorSpace: pixels.colorSpace,
    chromaSubsampling: pixels.chromaSubsampling,
    bitDepth: positive(stream.bits_per_raw_sample) ?? pixels.bitDepth,
    ...scan(stream.field_order),
    hdr: ffprobeHdr(stream),
    primaries: colorName(primaryNames, stream.color_primaries),
    transfer: colorName(transferNames, stream.color_transfer),
    language: tag(stream.tags, "language"),
    title: tag(stream.tags, "title"),
  };
}

function audio(stream: Dict): AudioFacts {
  const codec = textOf(stream.codec_name) ?? "";
  const known = audioFormats[codec] ?? (codec.startsWith("pcm_") ? { format: "PCM" } : codec.startsWith("dsd_") ? { format: "DSD" } : codec.startsWith("adpcm_") ? { format: "ADPCM" } : undefined);
  const profile = textOf(stream.profile);
  const lossless = losslessAudio.has(codec) || codec.startsWith("pcm_") || codec.startsWith("dsd_") || (codec === "dts" && profile === "DTS-HD MA");
  return {
    format: known?.format ?? textOf(stream.codec_long_name) ?? (codec || undefined),
    profile: profile ?? known?.profile,
    commercial: known?.commercial,
    bitRate: streamBitRate(stream),
    channels: positive(stream.channels),
    layout: textOf(stream.channel_layout),
    samplingRate: positive(stream.sample_rate),
    bitDepth: positive(stream.bits_per_raw_sample) ?? positive(stream.bits_per_sample),
    compression: lossless ? "Lossless" : lossyAudio.has(codec) ? "Lossy" : undefined,
    language: tag(stream.tags, "language"),
    title: tag(stream.tags, "title"),
    ...disposition(stream),
  };
}

function subtitle(stream: Dict): TextFacts {
  const codec = textOf(stream.codec_name) ?? "";
  return {
    format: subtitleFormats[codec] ?? textOf(stream.codec_long_name) ?? (codec || undefined),
    language: tag(stream.tags, "language"),
    title: tag(stream.tags, "title"),
    ...disposition(stream),
  };
}

function picture(stream: Dict): ImageFacts {
  const codec = textOf(stream.codec_name) ?? "";
  return {
    format: videoFormats[codec] ?? (codec.toUpperCase() || undefined),
    width: positive(stream.width),
    height: positive(stream.height),
  };
}

/**
 * 解析 ffprobe 的 JSON 输出。
 *
 * @param output 标准输出全文。
 * @param extension 文件的扩展名（小写），用来分 Matroska 与 WebM——ffprobe 对两者报同一个 `matroska,webm`。
 * @returns 归一之后的事实。
 * @throws {MediaReadFailure} `malformed`：不是 JSON；`unrecognized`：没有 `format` 也没有流（ffprobe 读不了时吐的是 `{}`）。
 */
export function parseFFprobe(output: string, extension: string): MediaReport {
  let document: unknown;
  try {
    document = JSON.parse(output);
  } catch {
    throw new MediaReadFailure("malformed");
  }
  if (document === null || typeof document !== "object" || Array.isArray(document)) throw new MediaReadFailure("malformed");
  const root = document as Dict;
  const format = dict(root.format);
  const streams = (Array.isArray(root.streams) ? root.streams : []).map(dict);
  if (Object.keys(format).length === 0 && streams.length === 0) throw new MediaReadFailure("unrecognized");

  const report: MediaReport = { general: {}, videos: [], audios: [], texts: [], images: [], chapters: [] };
  for (const stream of streams) {
    switch (textOf(stream.codec_type)) {
      case "video":
        // 音乐文件的封面在 ffprobe 里是一条「视频流」，带 attached_pic；MediaInfo 把它归进图像。
        if (numberOf(dict(stream.disposition).attached_pic) === 1) report.images.push(picture(stream));
        else report.videos.push(video(stream));
        break;
      case "audio":
        report.audios.push(audio(stream));
        break;
      case "subtitle":
        report.texts.push(subtitle(stream));
        break;
    }
  }
  const named = container(format, extension);
  const general: GeneralFacts = {
    format: named.format,
    profile: named.profile,
    fileSize: numberOf(format.size),
    duration: positive(format.duration),
    bitRate: positive(format.bit_rate),
    encodedDate: tag(format.tags, "creation_time"),
    application: tag(format.tags, "encoder"),
    title: tag(format.tags, "title"),
    artist: tag(format.tags, "artist") ?? tag(format.tags, "album_artist"),
    album: tag(format.tags, "album"),
  };
  report.general = general;
  const chapters: ChapterFact[] = [];
  for (const chapter of (Array.isArray(root.chapters) ? root.chapters : []).map(dict)) {
    const start = numberOf(chapter.start_time);
    if (start !== undefined) chapters.push({ start, title: tag(chapter.tags, "title") });
  }
  report.chapters = chapters;
  return report;
}
