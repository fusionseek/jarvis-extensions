/**
 * `files.actions` 的实现：`describe` 报「格式转换」这一组里此刻转得了的目标格式，`run` 照路线一步步跑。
 *
 * - **一组**（SDK 2.14 `groups`）：所有目标格式都在「格式转换」这一组里——转盘上只占一片，指着它向外展开一圈格式；
 *   每个格式各自认哪些源（按此刻找得到的工具算出来的路线），所以一张 PNG 只看到图像能转成的那几种，一个 MP4 只看到影音的。
 * - **产物类型**（`produces`）：Jarvis 拿它在条目上画「目标格式」的图标，转着的时候在两种图标之间翻。
 * - **逐个文件的进度**（`progress.files`）：ffmpeg / avconvert 读到百分比就报，别的工具一项开始 0、做完 1。
 *
 * 产物落在暂存目录：原名换扩展名，同一批里重名的加「 2」；两步的路线中间产物也在暂存目录里，只交回最后一步的。
 */
import { JarvisError, jarvis } from "@fusionseek/jarvis-extension-sdk";
import type {
  CancelSignal,
  FileActionDescription,
  FileActionFile,
  FileActionsDescription,
  FileActionsEngine,
  FileActionsProgress,
  FileActionsRequest,
  FileActionsResult,
  ProcessResult,
  ServiceContext,
} from "@fusionseek/jarvis-extension-sdk";
import type { Input } from "./commands.js";
import { expand } from "./commands.js";
import type { ToolName } from "./engines.js";
import { durationTemplate, tool, tools } from "./engines.js";
import { formatById, formatOfExtension, formats, symbolOf } from "./formats.js";
import { avconvertFraction, ffmpegFraction, parseDuration } from "./progress.js";
import type { Step } from "./routes.js";
import { plan, reachableSources, toolsOf } from "./routes.js";

/** 转盘上那一片（组）。 */
export const group = { id: "convert", title: "格式转换", symbol: "arrow.triangle.2.circlepath" };

/** 一次至多转几个：再多就该分批，进度条也报不过来（宿主的 process.run 一分钟 120 次）。 */
export const maximumFiles = 50;

/** 此刻找得到的工具 → 它的路径。 */
export type Located = Map<ToolName, string>;

/**
 * 找一遍工具：设置里选过路径的用选的（坏了就当没有，不悄悄换成别处的一份）。
 * @param preferences 此刻的偏好。
 * @returns 找得到的。
 */
export async function locateTools(preferences: Record<string, unknown> = {}): Promise<Located> {
  const located: Located = new Map();
  for (const entry of tools) {
    const chosen = entry.preference && typeof preferences[entry.preference] === "string" ? (preferences[entry.preference] as string).trim() : "";
    const where = await jarvis.process.locate(chosen || entry.name);
    if (where.path) located.set(entry.name, where.path);
  }
  return located;
}

/** 动作 id：`to-<格式 id>`（`to-3gp` 这种以数字开头的格式 id 也合动作 id 的写法）。 */
export function actionId(target: string): string {
  return `to-${target}`;
}

/**
 * 此刻能报的动作：每个有源可转的目标格式一个，都在「格式转换」组里。
 * @param available 找得到的工具。
 * @returns describe 的返回。
 */
export function describeActions(available: Set<ToolName>): FileActionsDescription {
  const sourceIds = formats.map((format) => format.id);
  const actions: FileActionDescription[] = [];
  for (const target of formats) {
    const sources = reachableSources(target.id, available, sourceIds);
    if (sources.length === 0) continue;
    const extensions = [...new Set(sources.flatMap((id) => formatById(id)?.extensions ?? []))].slice(0, 64);
    actions.push({
      id: actionId(target.id),
      title: target.title,
      symbol: symbolOf(target.family),
      extensions,
      maximum: maximumFiles,
      group: group.id,
      produces: target.id,
    });
  }
  return { groups: [group], actions: actions.slice(0, 64) };
}

/** 产物名：原名换扩展名；同一批里换完重名时第二个加「 2」。不以点开头（宿主不收隐藏的产物）。 */
export function outputName(name: string, extension: string, taken: Set<string>): string {
  const dot = name.lastIndexOf(".");
  const stem = (dot > 0 ? name.slice(0, dot) : name).replace(/^\.+/, "") || "未命名";
  let candidate = `${stem}.${extension}`;
  for (let index = 2; taken.has(candidate.toLowerCase()); index += 1) candidate = `${stem} ${index}.${extension}`;
  taken.add(candidate.toLowerCase());
  return candidate;
}

/** 名称（不含扩展名）。 */
function stemOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return (dot > 0 ? name.slice(0, dot) : name).replace(/^\.+/, "") || "未命名";
}

/** stderr 最后一行有内容的话。 */
export function lastErrorLine(stderr: string): string | undefined {
  const lines = stderr.split(/\r?\n|\r/).map((line) => line.trim()).filter((line) => line.length > 0);
  const last = lines[lines.length - 1];
  if (!last) return undefined;
  return last.length > 120 ? `${last.slice(0, 119)}…` : last;
}

/** 动态库对不上（Homebrew 升级了依赖、它本身还是旧的）。 */
const brokenInstall = /Library not loaded|Symbol not found|dyld\[\d+\]/;

/** 一项没转成。 */
class FileFailure extends Error {}

/** 取消：宿主不再看这一次的结果。 */
function cancelledError(): JarvisError {
  return new JarvisError({ code: "cancelled", message: "已取消" });
}

/**
 * 跑一步。返回这一步的产物名（暂存目录里）。
 * @param step 这一步。
 * @param input 输入（原文件的句柄，或暂存目录里上一步的产物）。
 * @param inputName 输入的文件名（LibreOffice 的产物名由它定）。
 * @param output 想要的产物名（LibreOffice 不认，见 `Tool.namesOutputItself`）。
 */
async function runStep(
  step: Step,
  input: Input,
  inputName: string,
  output: string,
  located: Located,
  directory: string,
  signal: CancelSignal,
  onFraction: (fraction: number) => void,
): Promise<string> {
  const entry = tool(step.conversion.tool);
  const executable = located.get(entry.name);
  if (!executable) throw new FileFailure(`没找到 ${entry.name}`);
  let duration: number | undefined;
  // ffmpeg 的百分比要总时长当分母：有 ffprobe 就先读一下（读不出就只在做完时跳到 100%）。
  if (entry.progress === "ffmpeg" && located.has("ffprobe")) {
    const probe = jarvis.process.run({ executable: located.get("ffprobe")!, arguments: expand(durationTemplate, input), directory, output: "text" });
    signal.onCancel(() => probe.cancel());
    const result = await probe.result.catch(() => undefined);
    duration = result && result.exitCode === 0 ? parseDuration(result.stdout ?? "") : undefined;
  }
  if (signal.cancelled) throw cancelledError();
  const produced = entry.namesOutputItself ? `${stemOf(inputName)}.${step.to}` : output;
  const run = jarvis.process.run({
    executable,
    arguments: expand(step.conversion.template, input, entry.namesOutputItself ? undefined : output),
    directory,
    onLine: (line) => {
      const fraction = entry.progress === "ffmpeg" ? ffmpegFraction(line, duration) : entry.progress === "avconvert" ? avconvertFraction(line) : undefined;
      if (fraction !== undefined) onFraction(fraction);
    },
  });
  signal.onCancel(() => run.cancel());
  let result: ProcessResult;
  try {
    result = await run.result;
  } catch (error) {
    if (signal.cancelled) throw cancelledError();
    if (error instanceof JarvisError && error.code === "host.failure") throw new FileFailure(`${entry.name} 没跑完：${error.message}`);
    throw error;
  }
  if (signal.cancelled) throw cancelledError();
  if (result.exitCode !== 0) {
    if (brokenInstall.test(result.stderr)) throw new FileFailure(`${entry.name} 起不来：它依赖的库被 Homebrew 升级换掉了，在「设置 · 文件」里修复它`);
    const line = lastErrorLine(result.stderr);
    throw new FileFailure(line ? `${entry.name}：${line}` : `${entry.name} 退出码 ${result.exitCode}`);
  }
  return produced;
}

/**
 * 转一批。
 * @param request 宿主的入参。
 * @param progress 报进度。
 * @param signal 取消。
 * @param located 找得到的工具（测试注入）。
 * @returns 产物名与一句话。
 */
export async function convertFiles(
  request: FileActionsRequest,
  progress: (progress: FileActionsProgress) => void,
  signal: CancelSignal,
  located: Located,
): Promise<FileActionsResult> {
  const target = request.action.startsWith("to-") ? formatById(request.action.slice(3)) : undefined;
  if (!target) throw new JarvisError({ code: "invalid.argument", message: `不认识的动作 ${request.action}` });
  const available = new Set(located.keys());
  const outputs: string[] = [];
  const failures: string[] = [];
  const taken = new Set<string>();
  const total = request.files.length;
  const fractions: number[] = request.files.map(() => 0);
  let lastReport = 0;
  let lastReported = -1;
  const report = (index: number, fraction: number, force = false) => {
    fractions[index] = fraction;
    const now = Date.now();
    // 进度一秒几十行：至多 10 次 / 秒上线缆，但每走 5 个百分点一定报（转得快的也看得见在走）；每一项的开始与结束一定报。
    if (!force && now - lastReport < 100 && Math.abs(fraction - lastReported) < 0.05) return;
    lastReport = now;
    lastReported = fraction;
    const overall = fractions.reduce((sum, value) => sum + value, 0) / total;
    progress({ fraction: overall, message: `第 ${index + 1} / ${total} 个：${request.files[index].name}`, files: [{ index, fraction }] });
  };
  for (const [index, file] of request.files.entries()) {
    if (signal.cancelled) throw cancelledError();
    report(index, 0, true);
    try {
      outputs.push(await convertOne(file, target.id, available, located, request.directory, taken, signal, (fraction) => report(index, fraction)));
      report(index, 1, true);
    } catch (error) {
      if (error instanceof FileFailure) {
        failures.push(`${file.name}：${error.message}`);
        report(index, 1, true);
        continue;
      }
      throw error;
    }
  }
  if (outputs.length === 0 && failures.length > 0) {
    throw new JarvisError({ code: "host.failure", message: failures.slice(0, 3).join("\n") });
  }
  return { outputs, message: failures.length > 0 ? `${failures.length} 个没转成：${failures[0]}` : undefined };
}

/** 转一个：按路线一步步跑，中间产物留在暂存目录、只交回最后一步的。 */
async function convertOne(
  file: FileActionFile,
  target: string,
  available: Set<ToolName>,
  located: Located,
  directory: string,
  taken: Set<string>,
  signal: CancelSignal,
  onFraction: (fraction: number) => void,
): Promise<string> {
  const source = formatOfExtension(file.extension);
  if (!source) throw new FileFailure(`认不出 .${file.extension} 是什么格式`);
  const steps = plan(source.id, target, available);
  if (!steps) throw new FileFailure(`没有能把 ${source.title} 转成 ${formatById(target)?.title ?? target} 的工具（${toolsHint(target)}）`);
  let input: Input = { file: file.file };
  let inputName = file.name;
  let produced = "";
  for (const [index, step] of steps.entries()) {
    const isLast = index === steps.length - 1;
    const namesItself = tool(step.conversion.tool).namesOutputItself === true;
    let name: string;
    if (isLast && namesItself) {
      // LibreOffice 不让起名：产物就叫「输入的名称.目标扩展名」。同一批里已经有这个名字时这一项不转——覆盖掉前一个的产物更糟。
      name = `${stemOf(inputName)}.${step.to}`;
      if (taken.has(name.toLowerCase())) throw new FileFailure(`同一批里已经有「${name}」（LibreOffice 不让另起名字）`);
      taken.add(name.toLowerCase());
    } else {
      name = isLast ? outputName(file.name, step.to, taken) : `${stemOf(file.name)}.${step.to}`;
    }
    // 一步占这一项进度的一段：两步的路线前一半给第一步。
    const share = 1 / steps.length;
    produced = await runStep(step, input, inputName, name, located, directory, signal, (fraction) => onFraction(index * share + fraction * share));
    input = { output: produced };
    inputName = produced;
  }
  return produced;
}

/** 缺工具时的那半句：这个目标格式可能要装什么。 */
function toolsHint(target: string): string {
  const family = formatById(target)?.family;
  if (family === "video" || family === "audio") return "装 FFmpeg 能转更多影音格式";
  if (family === "office" || target === "pdf") return "装 LibreOffice 能转办公文档";
  if (target === "md" || target === "epub") return "装 pandoc 能转 Markdown 与 EPUB";
  return "在「设置 · 文件」里看看缺哪个工具";
}

/** 这一批要用到的工具都还在吗（describe 之后用户可能删了）：在 `toolsOf` 之外只是给测试看的。 */
export { toolsOf };

export const convertEngine: FileActionsEngine = {
  async describe(context: ServiceContext) {
    const located = await locateTools(context.preferences ?? {});
    return describeActions(new Set(located.keys()));
  },

  async run(request: FileActionsRequest, context: ServiceContext, progress: (progress: FileActionsProgress) => void, signal: CancelSignal): Promise<FileActionsResult> {
    const located = await locateTools(context.preferences ?? {});
    return convertFiles(request, progress, signal, located);
  },
};
