/**
 * 命令模板 → 一次 `process.run` 的参数，与 manifest 里声明的参数组。两处读同一份模板：宿主逐项比对，生成的声明与发出的命令一字不差。
 */
import type { ProcessArgument } from "@fusionseek/jarvis-extension-sdk";
import type { Conversion, Template, ToolName } from "./engines.js";
import { IN, OUT, durationTemplate } from "./engines.js";
import { conversions } from "./routes.js";

/** 一步的输入：用户的文件（句柄），或暂存目录里上一步的产物（名字）。 */
export type Input = { file: string } | { output: string };

/**
 * 展开一条模板。
 * @param template 模板。
 * @param input 输入。
 * @param output 产物名（暂存目录里）；模板里没有产物位（LibreOffice）时不用。
 * @returns 参数。
 */
export function expand(template: Template, input: Input, output?: string): ProcessArgument[] {
  return template.map((part) => {
    if (part === IN) return input;
    if (part === OUT) {
      if (output === undefined) throw new Error("这条命令要一个产物名");
      return { output };
    }
    return part;
  });
}

/** 模板 → manifest 里的一组参数（输入写 `{file}` 或 `{output}`，产物写 `{output}`）。 */
function shape(template: Template, inputPlaceholder: "{file}" | "{output}"): string[] {
  return template.map((part) => (part === IN ? inputPlaceholder : part === OUT ? "{output}" : part));
}

/**
 * 每个工具要声明的参数组：每条边、输入是原文件与是中间产物各一组（第二步的输入在暂存目录里）；ffprobe 是读时长的那两组。去重、按出现顺序。
 * @param edges 边（测试注入）。
 * @returns 工具名 → 参数组。
 */
export function declaredShapes(edges: Conversion[] = conversions): Map<ToolName, string[][]> {
  const shapes = new Map<ToolName, string[][]>();
  const add = (tool: ToolName, value: string[]) => {
    const list = shapes.get(tool) ?? [];
    if (!list.some((existing) => existing.join("\u0001") === value.join("\u0001"))) list.push(value);
    shapes.set(tool, list);
  };
  for (const edge of edges) {
    add(edge.tool, shape(edge.template, "{file}"));
    add(edge.tool, shape(edge.template, "{output}"));
  }
  add("ffprobe", shape(durationTemplate, "{file}"));
  add("ffprobe", shape(durationTemplate, "{output}"));
  return shapes;
}
