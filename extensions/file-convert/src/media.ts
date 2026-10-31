/**
 * 媒体的转换（图像、音频、视频）——与文本、办公各自独立成一个模块。
 *
 * - 图像：sips（自带，读写常见位图、AVIF、HEIC、JPEG 2000，能写 PDF）先；ImageMagick 补 WebP、ICO 与 sips 读不了的源；
 *   都没有 ImageMagick 时 ffmpeg 也能写 WebP。
 * - 音频：afconvert（自带，M4A / WAV / AIFF / CAF / FLAC）先；ffmpeg 补 MP3、OGG、Opus 与 afconvert 读不了的源。
 * - 视频：avconvert（自带，AVFoundation 读得了的 MOV / MP4 / M4V 互转、取音轨成 M4A）先；ffmpeg 补 MKV、WebM、GIF 动图、
 *   取音轨成 MP3 / WAV / FLAC…，以及 avconvert 读不了的源（MKV、AVI、WebM…）。
 *
 * 每个目标格式一组固定参数（Filee 的「预设」以后再加）：取「多数人要的那一档」——H.264 CRF 23、AAC 192k、MP3 V2。
 */
import type { Conversion } from "./engines.js";
import { IN, OUT } from "./engines.js";

/** sips 读得了的图像。 */
const sipsReadable = ["png", "jpg", "heic", "tiff", "gif", "bmp", "webp", "avif", "jp2", "psd", "tga", "svg"];
/** sips 的 `-s format` 名。 */
const sipsFormats: Record<string, string> = { png: "png", jpg: "jpeg", heic: "heic", tiff: "tiff", gif: "gif", bmp: "bmp", avif: "avif", jp2: "jp2", pdf: "pdf" };
/** ImageMagick 读得了的图像（比 sips 多：ICO 等）。 */
const magickReadable = ["png", "jpg", "heic", "tiff", "gif", "bmp", "webp", "avif", "jp2", "psd", "tga", "svg", "ico"];
/** ImageMagick 补的目标。 */
const magickTargets = ["png", "jpg", "webp", "avif", "tiff", "gif", "bmp"];

/** afconvert 读得了的音频。 */
const afconvertReadable = ["m4a", "mp3", "wav", "aiff", "caf", "flac", "aac"];
/** afconvert 的文件类型与编码。 */
const afconvertFormats: Record<string, [string, string]> = {
  m4a: ["m4af", "aac"],
  wav: ["WAVE", "LEI16"],
  aiff: ["AIFF", "BEI16"],
  caf: ["caff", "aac"],
  flac: ["flac", "flac"],
};

/** avconvert（AVFoundation）读得了的视频。 */
const avconvertReadable = ["mov", "mp4", "m4v"];

/** ffmpeg 读得了的视频 / 音频（它几乎什么都读）。 */
const ffmpegVideo = ["mp4", "mov", "m4v", "mkv", "webm", "avi", "flv", "wmv", "mpg", "ts", "3gp"];
const ffmpegAudio = ["m4a", "mp3", "wav", "aiff", "flac", "caf", "ogg", "opus", "aac"];

/** ffmpeg 每个目标格式的编码参数（夹在 `-i 输入` 与进度、产物之间）。 */
export const ffmpegCodecs: Record<string, string[]> = {
  mp4: ["-c:v", "libx264", "-preset", "medium", "-crf", "23", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart"],
  m4v: ["-c:v", "libx264", "-preset", "medium", "-crf", "23", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart"],
  mov: ["-c:v", "libx264", "-preset", "medium", "-crf", "20", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k"],
  mkv: ["-c:v", "libx264", "-preset", "medium", "-crf", "22", "-c:a", "aac", "-b:a", "192k"],
  webm: ["-c:v", "libvpx-vp9", "-crf", "32", "-b:v", "0", "-c:a", "libopus", "-b:a", "128k"],
  // GIF 动图：12 帧、宽 480。不用 palettegen 两段滤镜（那要 `;`，manifest 不收 shell 记号）。
  gif: ["-vf", "fps=12,scale=480:-1:flags=lanczos", "-loop", "0"],
  mp3: ["-vn", "-c:a", "libmp3lame", "-q:a", "2"],
  m4a: ["-vn", "-c:a", "aac", "-b:a", "192k"],
  wav: ["-vn", "-c:a", "pcm_s16le"],
  aiff: ["-vn", "-c:a", "pcm_s16be"],
  flac: ["-vn", "-c:a", "flac"],
  ogg: ["-vn", "-c:a", "libvorbis", "-q:a", "5"],
  opus: ["-vn", "-c:a", "libopus", "-b:a", "128k"],
  webp: ["-c:v", "libwebp", "-quality", "85"],
};

/** 一条 ffmpeg 命令：不交互、覆盖、进度写到标准输出（每秒几行 `out_time_us=…`）。 */
export function ffmpegTemplate(target: string): string[] {
  return ["-hide_banner", "-nostdin", "-y", "-i", IN, ...ffmpegCodecs[target], "-progress", "pipe:1", "-nostats", OUT];
}

export const mediaConversions: Conversion[] = [
  // 图像 · sips
  ...Object.keys(sipsFormats).map((to) => ({
    tool: "sips" as const,
    from: sipsReadable.filter((from) => from !== to),
    to,
    cost: 1,
    template: ["-s", "format", sipsFormats[to], IN, "--out", OUT],
  })),
  // 图像 · ImageMagick（按产物扩展名定格式）；ICO 要先缩到图标的几档尺寸
  ...magickTargets.map((to) => ({ tool: "magick" as const, from: magickReadable.filter((from) => from !== to), to, cost: 2, template: [IN, OUT] })),
  { tool: "magick", from: magickReadable.filter((from) => from !== "ico"), to: "ico", cost: 2, template: [IN, "-define", "icon:auto-resize=256,128,64,48,32,16", OUT] },
  // 图像 · ffmpeg 写 WebP（没装 ImageMagick 时）
  { tool: "ffmpeg", from: ["png", "jpg", "bmp", "tiff", "gif"], to: "webp", cost: 3, template: ffmpegTemplate("webp") },
  // 音频 · afconvert
  ...Object.entries(afconvertFormats).map(([to, [fileType, dataFormat]]) => ({
    tool: "afconvert" as const,
    from: afconvertReadable.filter((from) => from !== to),
    to,
    cost: 1,
    template: ["-f", fileType, "-d", dataFormat, IN, OUT],
  })),
  // 音频 · ffmpeg
  ...["mp3", "m4a", "wav", "aiff", "flac", "ogg", "opus"].map((to) => ({
    tool: "ffmpeg" as const,
    from: [...ffmpegAudio, ...ffmpegVideo].filter((from) => from !== to),
    to,
    cost: 2,
    template: ffmpegTemplate(to),
  })),
  // 视频 · avconvert
  ...["mp4", "mov", "m4v"].map((to) => ({
    tool: "avconvert" as const,
    from: avconvertReadable.filter((from) => from !== to),
    to,
    cost: 1,
    template: ["--source", IN, "--preset", "PresetHighestQuality", "--output", OUT, "--progress", "--replace"],
  })),
  { tool: "avconvert", from: avconvertReadable, to: "m4a", cost: 1.5, template: ["--source", IN, "--preset", "PresetAppleM4A", "--output", OUT, "--progress", "--replace"] },
  // 视频 · ffmpeg
  ...["mp4", "mov", "m4v", "mkv", "webm", "gif"].map((to) => ({
    tool: "ffmpeg" as const,
    from: ffmpegVideo.filter((from) => from !== to),
    to,
    cost: 2,
    template: ffmpegTemplate(to),
  })),
];
