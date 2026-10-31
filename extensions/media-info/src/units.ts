/**
 * 单位与读法（纯函数）：把工具读出的原始数（秒、bit/s、Hz、字节）写成给人看的中文。
 *
 * 读法照 MediaInfo「简洁」视图（千分位用空格、码率 10 Mb/s 以下写 kb/s、采样率写 kHz），
 * 汉字只换单位与词——`1 小时 2 分 3 秒`、`8 573 kb/s`、`48.0 kHz`、`1 920 × 1 080 像素`。
 * 用户多半拿它对照 MediaInfo.app 看，数的写法一致，对照起来才不用心算。
 */

/** 取出一个有限的数：数字原样，`"6413785"` / `"23.976"` 这种纯数字串转数；别的（`"Unknown"`、`"8 / 6"`、空串）为 `undefined`。 */
export function numberOf(value: unknown): number | undefined {
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value !== "string") return undefined;
  const text = value.trim();
  if (!/^-?\d+(\.\d+)?$/.test(text)) return undefined;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/** 正数才算（码率、尺寸、采样率为 0 等于没读出来，MediaInfo 也不写）。 */
export function positive(value: unknown): number | undefined {
  const parsed = numberOf(value);
  return parsed !== undefined && parsed > 0 ? parsed : undefined;
}

/** 去掉首尾空白的非空字符串；别的为 `undefined`。 */
export function textOf(value: unknown): string | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value !== "string") return undefined;
  const text = value.trim();
  return text.length > 0 ? text : undefined;
}

/** 整数按三位一组、空格分隔：`1920` → `1 920`。 */
export function grouped(value: number): string {
  const rounded = Math.round(Math.abs(value));
  const digits = String(rounded);
  let out = "";
  for (let index = 0; index < digits.length; index += 1) {
    if (index > 0 && (digits.length - index) % 3 === 0) out += " ";
    out += digits[index];
  }
  return value < 0 && rounded !== 0 ? `-${out}` : out;
}

/** 去掉小数尾巴上的 0：`48.000` → `48`，`44.100` → `44.1`。 */
function trimZeros(text: string): string {
  return text.indexOf(".") === -1 ? text : text.replace(/0+$/, "").replace(/\.$/, "");
}

/**
 * 码率（bit/s）。照 MediaInfo：1 kb/s 以下写 b/s；10 Mb/s 以下写整数 kb/s（`6 414 kb/s`）；再往上写 Mb/s，100 以下带一位小数（`35.9 Mb/s`）。
 * 1000 进位（码率是十进制单位，与文件大小的 KiB 不是一回事）。
 */
export function bitRateText(bitsPerSecond: number): string {
  if (bitsPerSecond < 1000) return `${Math.round(bitsPerSecond)} b/s`;
  const kilobits = bitsPerSecond / 1000;
  if (Math.round(kilobits) < 10000) return `${grouped(kilobits)} kb/s`;
  const megabits = bitsPerSecond / 1e6;
  return megabits < 99.95 ? `${megabits.toFixed(1)} Mb/s` : `${grouped(megabits)} Mb/s`;
}

/**
 * 时长（秒）。一小时以上 `1 小时 2 分 3 秒`、一分钟以上 `2 分 3 秒`、一分钟以内带毫秒 `3 秒 8 毫秒`（MediaInfo 写 `3 s 8 ms`）、
 * 一秒以内 `500 毫秒`。末尾为 0 的那几位不写（`1 小时`），中间的 0 保留（`1 小时 0 分 3 秒`）——否则读的人分不清 3 是分还是秒。
 */
export function durationText(seconds: number): string {
  const milliseconds = Math.round(seconds * 1000);
  if (milliseconds < 1000) return `${milliseconds} 毫秒`;
  if (milliseconds < 60000) {
    const whole = Math.floor(milliseconds / 1000);
    const rest = milliseconds % 1000;
    return rest > 0 ? `${whole} 秒 ${rest} 毫秒` : `${whole} 秒`;
  }
  const total = Math.round(milliseconds / 1000);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  const parts: string[] = [];
  if (hours > 0) parts.push(`${hours} 小时`);
  if (minutes > 0 || (hours > 0 && secs > 0)) parts.push(`${minutes} 分`);
  if (secs > 0) parts.push(`${secs} 秒`);
  return parts.join(" ");
}

/** 章节时刻（秒）→ `00:05:12.345`（与 MediaInfo 章节表同一种写法，按位对齐好扫读）。 */
export function timestampText(seconds: number): string {
  const milliseconds = Math.max(0, Math.round(seconds * 1000));
  const hours = Math.floor(milliseconds / 3600000);
  const minutes = Math.floor((milliseconds % 3600000) / 60000);
  const secs = Math.floor((milliseconds % 60000) / 1000);
  const rest = milliseconds % 1000;
  const pad = (value: number, width: number) => String(value).padStart(width, "0");
  return `${pad(hours, 2)}:${pad(minutes, 2)}:${pad(secs, 2)}.${pad(rest, 3)}`;
}

/** 采样率（Hz）→ `48.0 kHz` / `44.1 kHz` / `22.05 kHz`（整千时补一位 0，与 MediaInfo 一致）。 */
export function samplingRateText(hertz: number): string {
  if (hertz < 1000) return `${Math.round(hertz)} Hz`;
  const kilohertz = hertz / 1000;
  const text = Number.isInteger(kilohertz) ? kilohertz.toFixed(1) : trimZeros(kilohertz.toFixed(3));
  return `${text} kHz`;
}

/** 帧率 → `23.976 fps`（三位小数，与 MediaInfo 一致：25 写成 `25.000`，一眼看出是不是 NTSC 的 1000/1001）。 */
export function frameRateText(framesPerSecond: number): string {
  return `${framesPerSecond.toFixed(3)} fps`;
}

/**
 * 文件大小（字节），十进制单位，与 Jarvis 详情面板「一般信息」那一行同一种写法（系统 `ByteCountFormatter` 的文件档）：
 * KB 取整、MB 一位小数、GB 起两位小数，尾巴上的 0 不写。不用 MediaInfo 的 MiB：同一块面板里两个大小对不上，读的人会以为有一个是错的。
 */
export function fileSizeText(bytes: number): string {
  if (bytes < 1000) return `${Math.round(bytes)} 字节`;
  const units = ["KB", "MB", "GB", "TB", "PB"];
  let value = bytes / 1000;
  let index = 0;
  while (value >= 1000 && index < units.length - 1) {
    value /= 1000;
    index += 1;
  }
  const digits = index === 0 ? 0 : index === 1 ? 1 : 2;
  return `${trimZeros(value.toFixed(digits))} ${units[index]}`;
}

/** 分辨率 → `1 920 × 1 080 像素`。 */
export function resolutionText(width: number, height: number): string {
  return `${grouped(width)} × ${grouped(height)} 像素`;
}

/** 位深 → `10 位`。 */
export function bitDepthText(bits: number): string {
  return `${Math.round(bits)} 位`;
}

/** 常见的显示宽高比（小数 → 叫法），容差 0.01。 */
const namedAspectRatios: [number, string][] = [
  [0.5625, "9:16"],
  [0.75, "3:4"],
  [1, "1:1"],
  [1.25, "5:4"],
  [1.333, "4:3"],
  [1.5, "3:2"],
  [1.6, "16:10"],
  [1.667, "5:3"],
  [1.778, "16:9"],
  [1.85, "1.85:1"],
  [1.896, "1.90:1"],
  [2, "2.00:1"],
  [2.2, "2.20:1"],
  [2.333, "21:9"],
  [2.35, "2.35:1"],
  [2.37, "2.37:1"],
  [2.39, "2.39:1"],
  [2.4, "2.40:1"],
];

/** 显示宽高比（小数）→ `16:9` / `2.39:1`；叫不出名字的写两位小数 `x.xx:1`。MediaInfo 的 JSON 给的是小数，「简洁」视图写的是叫法。 */
export function aspectRatioText(ratio: number): string {
  let best: [number, string] | undefined;
  for (const entry of namedAspectRatios) {
    const distance = Math.abs(entry[0] - ratio);
    if (distance <= 0.01 && (!best || distance < Math.abs(best[0] - ratio))) best = entry;
  }
  return best ? best[1] : `${ratio.toFixed(2)}:1`;
}

/** 模式与压缩方式的读法。 */
const modeNames: Record<string, string> = {
  CBR: "恒定",
  VBR: "可变",
  ABR: "平均",
  CFR: "恒定",
  VFR: "可变",
  Lossy: "有损",
  Lossless: "无损",
};

/** 码率 / 帧率模式与压缩方式 → `恒定` / `可变` / `有损` / `无损`；`"Lossless / Lossy"`（DTS-HD MA 带核心）逐段换。认不出的原样写。 */
export function modeText(value: string): string {
  return value
    .split(" / ")
    .map((part) => modeNames[part.trim()] ?? part.trim())
    .filter((part) => part.length > 0)
    .join(" / ");
}

/** 扫描方式。 */
const scanNames: Record<string, string> = {
  Progressive: "逐行",
  Interlaced: "隔行",
  MBAFF: "隔行（MBAFF）",
  PAFF: "隔行（PAFF）",
  Mixed: "逐行与隔行混合",
};

/** 扫描场序。 */
const scanOrderNames: Record<string, string> = {
  TFF: "上场优先",
  BFF: "下场优先",
};

/** 扫描方式（+ 场序）→ `逐行` / `隔行（上场优先）`。 */
export function scanText(type: string, order?: string): string {
  const name = scanNames[type] ?? type;
  const orderName = order ? scanOrderNames[order] ?? order : undefined;
  return orderName && name !== "逐行" ? `${name}（${orderName}）` : name;
}

/** 语言（ISO 639-1 / 639-2 两种写法都认：MediaInfo 给 `en`，ffprobe 给 `eng`）。 */
const languageNames: Record<string, string> = {
  en: "英语", eng: "英语",
  zh: "中文", chi: "中文", zho: "中文", cmn: "普通话", yue: "粤语",
  ja: "日语", jpn: "日语",
  ko: "韩语", kor: "韩语",
  fr: "法语", fre: "法语", fra: "法语",
  de: "德语", ger: "德语", deu: "德语",
  es: "西班牙语", spa: "西班牙语",
  it: "意大利语", ita: "意大利语",
  ru: "俄语", rus: "俄语",
  pt: "葡萄牙语", por: "葡萄牙语",
  ar: "阿拉伯语", ara: "阿拉伯语",
  hi: "印地语", hin: "印地语",
  th: "泰语", tha: "泰语",
  vi: "越南语", vie: "越南语",
  id: "印尼语", ind: "印尼语",
  ms: "马来语", may: "马来语", msa: "马来语",
  nl: "荷兰语", dut: "荷兰语", nld: "荷兰语",
  sv: "瑞典语", swe: "瑞典语",
  no: "挪威语", nor: "挪威语", nb: "挪威语", nob: "挪威语",
  da: "丹麦语", dan: "丹麦语",
  fi: "芬兰语", fin: "芬兰语",
  pl: "波兰语", pol: "波兰语",
  cs: "捷克语", cze: "捷克语", ces: "捷克语",
  hu: "匈牙利语", hun: "匈牙利语",
  tr: "土耳其语", tur: "土耳其语",
  el: "希腊语", gre: "希腊语", ell: "希腊语",
  he: "希伯来语", heb: "希伯来语",
  uk: "乌克兰语", ukr: "乌克兰语",
  mul: "多语种",
};

/** 地区与文字的子标签。 */
const regionNames: Record<string, string> = {
  CN: "中国大陆", TW: "台湾", HK: "香港", SG: "新加坡",
  Hans: "简体", Hant: "繁体",
  US: "美国", GB: "英国", AU: "澳大利亚", CA: "加拿大",
  BR: "巴西", PT: "葡萄牙", MX: "墨西哥", ES: "西班牙", "419": "拉丁美洲",
};

/**
 * 语言码 → 中文名：`en` / `eng` → `英语`，`zh-CN` → `中文（中国大陆）`。`und`（未定）、`zxx`（无语言内容）不写——那等于没标。
 * 认不出的原样写：一个生僻的语言码比一个猜错的名字诚实。
 */
export function languageText(code: string): string | undefined {
  const text = code.trim();
  if (text.length === 0) return undefined;
  const parts = text.split(/[-_]/);
  const base = parts[0].toLowerCase();
  if (base === "und" || base === "zxx" || base === "mis") return undefined;
  const name = languageNames[base];
  if (!name) return text;
  const extras = parts.slice(1).map((part) => regionNames[part] ?? regionNames[part.toUpperCase()] ?? part);
  return extras.length > 0 ? `${name}（${extras.join("，")}）` : name;
}

/** `主体（补充，补充）`：补充都空时只写主体；主体空时为 `undefined`。 */
export function withDetails(main: string | undefined, ...details: (string | undefined)[]): string | undefined {
  if (!main) return undefined;
  const extras = details.filter((detail): detail is string => detail !== undefined && detail.length > 0 && detail !== main);
  return extras.length > 0 ? `${main}（${extras.join("，")}）` : main;
}

/**
 * 时间写法归一：MediaInfo 新版 `2023-01-01 12:00:00 UTC` 原样；旧版 `UTC 2023-01-01 12:00:00` 挪成新版；ffprobe 的 ISO 8601 写成同一种。
 * MP4 / MOV 里没填的日期是 1904-01-01（Mac 纪元）或 1970-01-01，那是「没有」，不写。
 */
export function dateText(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  let text = raw.trim();
  const legacy = /^UTC (\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})/.exec(text);
  if (legacy) text = `${legacy[1]} UTC`;
  const iso = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2})(?:\.\d+)?Z$/.exec(text);
  if (iso) text = `${iso[1]} ${iso[2]} UTC`;
  if (/^(1904|1970)-01-01 00:00:00/.test(text) || /^0000-/.test(text)) return undefined;
  return text.length > 0 ? text : undefined;
}
