/**
 * 图片转换（示例，`file-actions-sample`）—— `files.actions` 扩展点的脚手架。
 *
 * 只入驻服务域。Jarvis「文件」里长按选中的图片，转盘上出现这里声明的动作（紫色扇面）；点了之后：
 * 1. Jarvis 把每个文件的**句柄**（不是路径）和一个空暂存目录的句柄交过来；
 * 2. 这里经 `jarvis.process.run` 跑 sips：`{ file: 句柄 }` 填 manifest 里的 `"{file}"`，`{ output: 名字 }` 填 `"{output}"`，
 *    `directory` 用暂存目录的句柄——产物就落在暂存目录里；
 * 3. 交回产物名，Jarvis 把它们移进当前文件夹、选中、记一次可撤销。
 *
 * 换成你自己的转换工具：在 manifest 的 `process.executables` 里声明它与参数组（占位符各占一整项），
 * 在 `describe` 里报动作，在 `run` 里照下面的样子跑。
 */
import { defineExtension, jarvis } from "@fusionseek/jarvis-extension-sdk";
import type { CancelSignal, FileActionsEngine, FileActionsProgress, FileActionsRequest, FileActionsResult, ServiceContext } from "@fusionseek/jarvis-extension-sdk";

/** 动作 id → sips 的 `format` 与产物扩展名。 */
const targets: Record<string, { format: "png" | "jpeg" | "heic"; extension: string; title: string }> = {
  "to-png": { format: "png", extension: "png", title: "转为 PNG" },
  "to-jpeg": { format: "jpeg", extension: "jpg", title: "转为 JPEG" },
  "to-heic": { format: "heic", extension: "heic", title: "转为 HEIC" },
};

/** sips 读得懂的图片扩展名（不含 PDF：sips 只转 PDF 的第一页，容易让人以为转完了整份）。 */
const readable = ["png", "jpg", "jpeg", "heic", "heif", "tif", "tiff", "gif", "bmp", "webp"];

/** 产物名：原名换扩展名；同一批里两个文件换完重名（a.png 与 a.jpg 都转 PNG）时第二个加「 2」。 */
export function outputName(name: string, extension: string, taken: Set<string>): string {
  const dot = name.lastIndexOf(".");
  const stem = dot > 0 ? name.slice(0, dot) : name;
  let candidate = `${stem}.${extension}`;
  for (let index = 2; taken.has(candidate); index += 1) candidate = `${stem} ${index}.${extension}`;
  taken.add(candidate);
  return candidate;
}

export const convertEngine: FileActionsEngine = {
  describe() {
    return {
      actions: Object.entries(targets).map(([id, target]) => ({
        id,
        title: target.title,
        symbol: "arrow.triangle.2.circlepath",
        // 已经是这个格式的图不出这一项：转 PNG 不出现在 .png 上。
        extensions: readable.filter((extension) => !(target.format === "jpeg" ? ["jpg", "jpeg"] : [target.extension]).includes(extension)),
        maximum: 50,
      })),
    };
  },

  async run(request: FileActionsRequest, _context: ServiceContext, progress: (progress: FileActionsProgress) => void, signal: CancelSignal): Promise<FileActionsResult> {
    const target = targets[request.action];
    if (!target) throw new Error(`不认识的动作 ${request.action}`);
    const where = await jarvis.process.locate("sips");
    if (!where.path) throw new Error("没找到 sips（它是 macOS 自带的，通常在 /usr/bin/sips）");
    const outputs: string[] = [];
    const taken = new Set<string>();
    const failures: string[] = [];
    for (const [index, file] of request.files.entries()) {
      if (signal.cancelled) break;
      progress({ fraction: index / request.files.length, message: `第 ${index + 1} / ${request.files.length} 张：${file.name}` });
      const name = outputName(file.name, target.extension, taken);
      const run = jarvis.process.run({
        executable: where.path,
        arguments: ["-s", "format", target.format, { file: file.file }, "--out", { output: name }],
        directory: request.directory,
      });
      signal.onCancel(() => run.cancel());
      const result = await run.result.catch((error: Error) => ({ exitCode: -1, stderr: error.message }));
      if (result.exitCode === 0) {
        outputs.push(name);
      } else {
        failures.push(`${file.name}：${result.stderr.trim().split("\n").pop() || `sips 退出码 ${result.exitCode}`}`);
      }
    }
    progress({ fraction: 1 });
    if (outputs.length === 0 && failures.length > 0) throw new Error(failures.slice(0, 3).join("\n"));
    return { outputs, message: failures.length > 0 ? `${failures.length} 张没转成：${failures[0]}` : undefined };
  },
};

defineExtension({
  services: {
    convert: convertEngine,
  },
});
