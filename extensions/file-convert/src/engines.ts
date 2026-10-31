/**
 * 引擎表（照 Filee 的 `EngineRegistry`）：每个外部工具是一个引擎，带它能做的「格式 → 格式」的边与每条边的命令模板。
 *
 * 与 Filee 的差别：Filee 的引擎多是 .NET 库，这里一律是命令行——macOS 自带的（sips、afconvert、avconvert、textutil、plutil）
 * 与用户自己装的（ffmpeg、ImageMagick、pandoc、LibreOffice）。找得到才用（`process.locate`），找不到的那几条边不进路线规划，
 * 外圈上也就不出那几个格式（Filee 的「只显示适合这些文件的格式」）。
 *
 * **命令模板是 manifest 的唯一来源**：`scripts/generate-manifest.mjs` 从这里生成 `process.executables`，测试钉住
 * 「这里能发出的每一条命令都在声明里」——宿主逐项比对，多一个字都拦。
 */

/** 模板里的「输入」位：第一步是用户的文件（`{file}`），之后的步是暂存目录里上一步的产物（`{output}`）。 */
export const IN = "\u0000in";
/** 模板里的「产物」位：暂存目录里这一步的产物（`{output}`）。 */
export const OUT = "\u0000out";

/** 一条命令模板（不含可执行文件本身）。 */
export type Template = string[];

/** 一个外部工具。 */
export interface Tool {
  /** manifest 里声明的名字（也是 `process.locate` 找的名字）。 */
  name: ToolName;
  /** macOS 自带：永远在，不出现在设置里。 */
  builtin: boolean;
  /** 设置里那一项 `executable` 偏好的 key（用户装的才有）。 */
  preference?: string;
  /** 进度怎么读：ffmpeg 的 `-progress pipe:1`、avconvert 的 `--progress`；没有 = 一项开始 0、做完 1。 */
  progress?: "ffmpeg" | "avconvert";
  /** 产物名由工具自己定（LibreOffice：写进工作目录、名字 = 输入的名称 + 目标扩展名），模板里没有 `OUT`。 */
  namesOutputItself?: boolean;
}

export type ToolName = "sips" | "afconvert" | "avconvert" | "textutil" | "plutil" | "ffmpeg" | "ffprobe" | "magick" | "pandoc" | "soffice";

/** 一条边：一组源格式 → 一个目标格式。 */
export interface Conversion {
  tool: ToolName;
  from: string[];
  to: string;
  /**
   * 代价（越小越先用）：自带的 1、装的 2；同一条边两个工具都能做时先用自带的。
   * 多一步再加 0.5（`routes.ts`），所以一步能到的永远不绕两步。
   */
  cost: number;
  template: Template;
}

export const tools: Tool[] = [
  { name: "sips", builtin: true },
  { name: "afconvert", builtin: true },
  { name: "avconvert", builtin: true, progress: "avconvert" },
  { name: "textutil", builtin: true },
  { name: "plutil", builtin: true },
  { name: "ffmpeg", builtin: false, preference: "ffmpegPath", progress: "ffmpeg" },
  { name: "ffprobe", builtin: false, preference: "ffprobePath" },
  { name: "magick", builtin: false, preference: "magickPath" },
  { name: "pandoc", builtin: false, preference: "pandocPath" },
  { name: "soffice", builtin: false, preference: "sofficePath", namesOutputItself: true },
];

/** 按名字找。 */
export function tool(name: ToolName): Tool {
  const found = tools.find((entry) => entry.name === name);
  if (!found) throw new Error(`没有 ${name} 这个引擎`);
  return found;
}

/** ffprobe 读时长（给 ffmpeg 的百分比当分母）。不转换，只读。 */
export const durationTemplate: Template = ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", IN];
