/**
 * `files.details` 的实现：`describe` 报认领范围，`inspect` 跑工具读一个文件。
 *
 * 读法（受限执行，manifest 里逐字声明、各一组参数）：
 * 1. `mediainfo --Output=JSON {file}`——MediaInfo 官方命令行，与 MediaInfo.app 是同一个库，读出的字段与 App 一致；
 * 2. 没有 mediainfo、或它没读出来时，`ffprobe -v error -print_format json -show_format -show_streams -show_chapters {file}`；
 * 3. 都没有时告诉用户怎么装。
 *
 * **只跑用户自己装好的工具**：扩展不带任何解码器。文件经句柄交给工具（`{ file }`），扩展看不到路径。
 */
import { JarvisError, jarvis } from "@fusionseek/jarvis-extension-sdk";
import type { CancelSignal, FileDetailsEngine, FileDetailsRequest, FileDetailsResult, ProcessArgument, ProcessResult } from "@fusionseek/jarvis-extension-sdk";
import { describeClaims } from "./claims.js";
import { parseFFprobe } from "./ffprobe.js";
import { MediaReadFailure } from "./failures.js";
import type { MediaReadFailureKind } from "./failures.js";
import { parseMediaInfo } from "./mediainfo.js";
import type { MediaReport } from "./report.js";
import { buildSections, clampResult } from "./report.js";

/** 一个读得了影音信息的外部工具。参数组与 manifest `process.executables` 逐字相同——宿主逐项比对，多一个字都拦。 */
export interface MediaTool {
  /** manifest 里声明的名字。 */
  name: "mediainfo" | "ffprobe";
  /** Homebrew 的包名（装 / 升级的那一句话里用）。 */
  formula: string;
  /** 这一次的参数（`{ file }` 填 manifest 里的 `"{file}"`）。 */
  arguments(handle: string): ProcessArgument[];
  /** 解析它的标准输出。 */
  parse(output: string, extension: string): MediaReport;
}

export const mediainfoTool: MediaTool = {
  name: "mediainfo",
  formula: "media-info",
  arguments: (handle) => ["--Output=JSON", { file: handle }],
  parse: (output) => parseMediaInfo(output),
};

export const ffprobeTool: MediaTool = {
  name: "ffprobe",
  formula: "ffmpeg",
  arguments: (handle) => ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", "-show_chapters", { file: handle }],
  parse: (output, extension) => parseFFprobe(output, extension),
};

/** 先 mediainfo 后 ffprobe：MediaInfo 读得更全（HDR、编码设置、商业名），ffprobe 是后备。 */
export const mediaTools: MediaTool[] = [mediainfoTool, ffprobeTool];

/** 两样都没装。 */
export const missingToolsMessage = "需要 mediainfo（brew install media-info）或 ffprobe（brew install ffmpeg）";

/** 没装 mediainfo、用 ffprobe 读出来的那一次，画在段下面的一句。 */
export const ffprobeNotice = "用的是 ffprobe；装上 MediaInfo 命令行（brew install media-info）能读出更多。";

/** 一个工具这一次没读出来。`reason` 是短的一截（放进 notice 的括号里），`message` 是给用户的整句。 */
class ToolFailure extends Error {
  constructor(
    readonly tool: MediaTool,
    readonly kind: "broken" | "failed" | MediaReadFailureKind,
    message: string,
    readonly reason: string,
  ) {
    super(message);
    this.name = "ToolFailure";
  }
}

/** 动态库对不上：Homebrew 升级了它依赖的库（x265、libvpx……）而它本身还是旧的，dyld 在启动时就停了。 */
const brokenInstall = /Library not loaded|Symbol not found|dyld\[\d+\]/;

/** stderr 最后一行有内容的话，去掉前面的「路径: 」（ffprobe 写 `/Users/…/a.mov: Invalid data found…`）。 */
export function lastErrorLine(stderr: string): string | undefined {
  const lines = stderr.split("\n").map((line) => line.trim()).filter((line) => line.length > 0);
  const last = lines[lines.length - 1];
  if (!last) return undefined;
  const cut = last.lastIndexOf(": ");
  const tail = cut >= 0 ? last.slice(cut + 2).trim() : last;
  const text = tail.length > 0 ? tail : last;
  return text.length > 160 ? `${text.slice(0, 159)}…` : text;
}

/** 进程结果 → 失败（退出码不是 0 时）。 */
function failureOf(tool: MediaTool, result: ProcessResult): ToolFailure {
  if (brokenInstall.test(result.stderr)) {
    return new ToolFailure(
      tool,
      "broken",
      `${tool.name} 起不来：它依赖的库被 Homebrew 升级换掉了。在终端里跑 brew upgrade ${tool.formula}（不行就 brew reinstall ${tool.formula}）再试。`,
      "它起不来",
    );
  }
  const line = lastErrorLine(result.stderr);
  return new ToolFailure(
    tool,
    "failed",
    line ? `${tool.name} 读不了这个文件：${line}` : `${tool.name} 读不了这个文件（退出码 ${result.exitCode}）`,
    `退出码 ${result.exitCode}`,
  );
}

/** 解析失败 → 失败。 */
function parseFailureOf(tool: MediaTool, kind: MediaReadFailureKind): ToolFailure {
  return kind === "malformed"
    ? new ToolFailure(tool, kind, `${tool.name} 交回的不是 JSON：它的版本可能太旧，跑一次 brew upgrade ${tool.formula} 再试。`, "输出不是 JSON")
    : new ToolFailure(tool, kind, `${tool.name} 认不出这个文件的格式：它可能不是影音文件，或者已经损坏。`, "认不出格式");
}

/** 取消：宿主不再看这一次的结果，交回的是什么都行——给一个明确的 `cancelled`。 */
function cancelledError(): JarvisError {
  return new JarvisError({ code: "cancelled", message: "已取消" });
}

/** 跑一个工具、解析它的输出。失败抛 `ToolFailure`；取消与授权类的错原样抛。 */
async function read(tool: MediaTool, executable: string, handle: string, extension: string, signal: CancelSignal): Promise<MediaReport> {
  const run = jarvis.process.run({ executable, arguments: tool.arguments(handle), output: "text" });
  signal.onCancel(() => run.cancel());
  let result: ProcessResult;
  try {
    result = await run.result;
  } catch (error) {
    if (signal.cancelled) throw cancelledError();
    // 输出超过 4 MiB、进程起不来：宿主以 host.failure 拒绝，算这个工具没读出来，换下一个。别的（授权被撤销）原样抛。
    if (error instanceof JarvisError && error.code === "host.failure") {
      throw new ToolFailure(tool, "failed", `${tool.name} 没跑完：${error.message}`, "没跑完");
    }
    throw error;
  }
  if (signal.cancelled) throw cancelledError();
  if (result.exitCode !== 0) throw failureOf(tool, result);
  try {
    return tool.parse(result.stdout ?? "", extension);
  } catch (error) {
    if (error instanceof MediaReadFailure) throw parseFailureOf(tool, error.kind);
    throw error;
  }
}

/** 全都没读出来时给用户的那一句：都认不出格式时合成一句，否则用先试的那个工具的原因（它是首选，原因最有用）。 */
function finalMessage(failures: ToolFailure[]): string {
  if (failures.length > 1 && failures.every((failure) => failure.kind === "unrecognized")) {
    return `${failures.map((failure) => failure.tool.name).join(" 与 ")} 都认不出这个文件的格式：它可能不是影音文件，或者已经损坏。`;
  }
  return failures[0].message;
}

/**
 * 读一个文件。
 *
 * @param request 详情面板此刻显示的那一个文件。
 * @param signal 用户换了选中时触发。
 * @param tools 依次试的工具（测试换顺序用；默认先 mediainfo 后 ffprobe）。
 * @returns 按契约截好的段。
 * @throws {JarvisError} 都没装 / 都没读出来（`host.failure`，`message` 写给用户）；取消（`cancelled`）。
 */
export async function inspectFile(request: FileDetailsRequest, signal: CancelSignal, tools: MediaTool[] = mediaTools): Promise<FileDetailsResult> {
  const file = request.files[0];
  if (!file) throw new JarvisError({ code: "invalid.argument", message: "没有要读的文件" });
  if (file.folder) throw new JarvisError({ code: "invalid.argument", message: "媒体信息不读文件夹" });
  const failures: ToolFailure[] = [];
  for (const tool of tools) {
    if (signal.cancelled) throw cancelledError();
    const where = await jarvis.process.locate(tool.name);
    if (signal.cancelled) throw cancelledError();
    if (where.path === null) continue;
    try {
      const report = await read(tool, where.path, file.file, file.extension, signal);
      const sections = buildSections(report);
      if (sections.length === 0) throw parseFailureOf(tool, "unrecognized");
      const notice =
        tool.name === "ffprobe"
          ? failures.length > 0
            ? `${failures[0].tool.name} 没读出来（${failures[0].reason}），这次用的是 ffprobe。`
            : ffprobeNotice
          : undefined;
      return clampResult(sections, notice);
    } catch (error) {
      if (error instanceof ToolFailure) {
        failures.push(error);
        continue;
      }
      throw error;
    }
  }
  if (failures.length === 0) throw new JarvisError({ code: "host.failure", message: missingToolsMessage });
  throw new JarvisError({ code: "host.failure", message: finalMessage(failures) });
}

export const mediaEngine: FileDetailsEngine = {
  describe() {
    return describeClaims();
  },
  inspect(request, _context, signal) {
    return inspectFile(request, signal);
  },
};
