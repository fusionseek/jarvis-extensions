/**
 * 认领范围（`files.details · describe`）。
 *
 * 类别 `video` / `audio` 是宿主按系统 UTType 分的；但系统认不出是影音的容器还有一大把（mkv、webm、flac、ape……），
 * 它们在宿主那里落在 `other`，只报类别就永远轮不到这里。下面这张表补上这些，也把常见的那几种再写一遍——
 * 系统对 `.ts`（TypeScript 还是 MPEG-TS？）、`.rm` 这类有歧义的扩展名不一定判成影音。
 */
import { fileDetailsLimits } from "@fusionseek/jarvis-extension-sdk";
import type { FileCategory, FileDetailsDescription } from "@fusionseek/jarvis-extension-sdk";

/** 认的类别。 */
export const claimedCategories: FileCategory[] = ["video", "audio"];

/** 认的扩展名（小写、不带点）。 */
export const claimedExtensions: string[] = [
  // Matroska 家族与 WebM
  "mkv", "mka", "mks", "webm",
  // Flash、AVI、Windows Media
  "flv", "f4v", "avi", "wmv", "wma", "asf",
  // MPEG 传输流 / 节目流（蓝光、DVD）
  "ts", "mts", "m2ts", "vob",
  // Ogg 家族
  "ogg", "ogv", "oga", "opus",
  // 无损与各家的音频
  "flac", "ape", "wv", "dts", "ac3", "eac3", "mpc",
  // RealMedia、专业封装、手机
  "rm", "rmvb", "mxf", "3gp", "3g2", "amr",
  // Apple 与常见的那几种
  "caf", "aiff", "aif", "m4v", "m4a", "mp4", "mov", "mp3", "aac", "wav",
];

/**
 * `describe` 的返回：去重、按契约截到 128 个以内。
 * @returns 认领范围。
 */
export function describeClaims(): FileDetailsDescription {
  const extensions = [...new Set(claimedExtensions.map((extension) => extension.toLowerCase()))].slice(0, fileDetailsLimits.extensions);
  return { categories: [...claimedCategories], extensions };
}
