/**
 * `createField` 与 `createOption`：在 Project 里建字段、给单选 / 多选字段加选项。
 *
 * 宿主只在用户在映射页明确要「写回 Project」时调它们（不静默修复：宿主从不自己建字段）。
 * **已有选项的 id 必须保持不变**——宿主的映射按选项 id 认。GitHub 的 `updateProjectV2Field` 是**整组替换**选项，
 * 但 `ProjectV2SingleSelectFieldOptionInput` 带 `id`：把已有选项连 id、名字、颜色、说明原样写回去，再接上新的那一个。
 */
import type {
  CancelSignal,
  ProjectCreateFieldRequest,
  ProjectCreateOptionRequest,
  ProjectField,
  ProjectFieldResult,
} from "@fusionseek/jarvis-extension-sdk";
import { jarvis } from "@fusionseek/jarvis-extension-sdk";
import { mutations, readField } from "./documents.js";
import { GitHubError, mutate, query, throwIfCancelled } from "./graphql.js";
import type { Raw } from "./mapping.js";
import { creatableTypes, mapField } from "./mapping.js";
import { addDays, clamp, maxLength } from "./limits.js";

/** 新选项的颜色：GitHub 要求必填；灰色是它自己界面上新建选项的默认色。 */
export const newOptionColor = "GRAY";
/** 迭代字段没给周期时的默认（GitHub 界面的默认也是两周）。 */
export const defaultIterationDays = 14;
/** 新迭代字段预先排好的迭代个数（与 GitHub 界面新建迭代字段一致：三个）。 */
export const initialIterations = 3;

/**
 * 迭代字段的初始配置：从今天（UTC）起排三个迭代，名字与 GitHub 界面一致（`Iteration 1` …）。
 * 不排的话字段是空的，而宿主没有「加迭代」这条路。
 * @param durationDays 周期（天）。
 * @param today `YYYY-MM-DD`；省略时取此刻的 UTC 日期。
 * @returns `ProjectV2IterationFieldConfigurationInput`。
 */
export function iterationConfiguration(durationDays: number, today = new Date().toISOString().slice(0, 10)) {
  return {
    startDate: today,
    duration: durationDays,
    iterations: Array.from({ length: initialIterations }, (_, index) => ({
      title: `Iteration ${index + 1}`,
      startDate: addDays(today, index * durationDays),
      duration: durationDays,
    })),
  };
}

/**
 * `createProjectV2Field` 的输入。
 * @param request 入参。
 * @param today 测试用的「今天」。
 * @returns 输入对象。
 */
export function createFieldInput(request: ProjectCreateFieldRequest, today?: string): Record<string, unknown> {
  const name = request.name?.trim();
  if (!name) throw new Error("字段名不能是空的");
  const dataType = creatableTypes[request.dataType];
  if (!dataType) throw new Error(`GitHub Project 建不了「${String(request.dataType)}」类型的字段`);
  const input: Record<string, unknown> = { projectId: request.projectId, dataType, name: clamp(name, maxLength.name) };
  const options = (request.options ?? [])
    .map((option) => option.trim())
    .filter((option) => option.length > 0)
    .map((option) => ({ name: clamp(option, maxLength.name), color: newOptionColor, description: "" }));
  if (request.dataType === "singleSelect" && options.length) input["singleSelectOptions"] = options;
  if (request.dataType === "multiSelect" && options.length) input["multiSelectOptions"] = options;
  if (request.dataType === "iteration") {
    const days = request.iterationDurationDays ?? defaultIterationDays;
    if (!Number.isInteger(days) || days < 1 || days > 365) throw new Error("迭代周期要在 1–365 天之间");
    input["iterationConfiguration"] = iterationConfiguration(days, today);
  }
  return input;
}

function fieldFrom(raw: Raw, what: string): ProjectField {
  const field = mapField(raw);
  if (!field) throw new GitHubError(`${what}之后，GitHub 交回的字段读不出来`, []);
  return field;
}

/**
 * 建一个字段。
 * @param request 入参。
 * @param signal 取消信号。
 * @returns 建好的字段。
 */
export async function createField(request: ProjectCreateFieldRequest, signal?: CancelSignal): Promise<ProjectFieldResult> {
  if (!request.projectId) throw new Error("缺少 projectId");
  const input = createFieldInput(request);
  throwIfCancelled(signal);
  const mutation = mutations.createProjectV2Field;
  const data = await mutate<{ createProjectV2Field: { projectV2Field: Raw } | null }>(mutation.document, { input }, mutation.title);
  return { field: fieldFrom(data.createProjectV2Field?.projectV2Field, "建字段") };
}

interface OptionInput {
  id: string;
  name: string;
  color: string;
  description: string;
}

/**
 * 把已有选项原样写回去的输入（id、名字、颜色、说明一样不改）。
 * @param raw GitHub 的选项数组。
 * @returns 输入数组。
 */
export function existingOptions(raw: unknown): OptionInput[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((entry) => {
    const option = entry as Raw;
    const id = option?.["id"];
    const name = option?.["name"];
    if (typeof id !== "string" || typeof name !== "string") return [];
    const color = typeof option?.["color"] === "string" ? (option["color"] as string) : newOptionColor;
    const description = typeof option?.["description"] === "string" ? (option["description"] as string) : "";
    return [{ id, name, color, description }];
  });
}

/**
 * 给单选 / 多选字段加一个选项。已经有同名选项（不分大小写）时不改，原样交回字段。
 * @param request 入参。
 * @param signal 取消信号。
 * @returns 改好的字段。
 */
export async function createOption(request: ProjectCreateOptionRequest, signal?: CancelSignal): Promise<ProjectFieldResult> {
  if (!request.fieldId) throw new Error("缺少 fieldId");
  const name = request.name?.trim();
  if (!name) throw new Error("选项名不能是空的");
  throwIfCancelled(signal);
  const { data } = await query<{ node: Raw }>(readField, { id: request.fieldId }, "读字段");
  const node = data.node;
  if (!node) throw new GitHubError("找不到这个字段（或 token 看不到它）", []);
  const dataType = node["dataType"];
  if (dataType !== "SINGLE_SELECT" && dataType !== "MULTI_SELECT") {
    throw new GitHubError(`「${String(node["name"] ?? request.fieldId)}」不是单选或多选字段，加不了选项`, []);
  }
  const key = dataType === "SINGLE_SELECT" ? "options" : "multiSelectOptions";
  const existing = existingOptions(node[key]);
  if (existing.some((option) => option.name.trim().toLowerCase() === name.toLowerCase())) {
    return { field: fieldFrom(node, "读字段") };
  }

  const options = [...existing, { name: clamp(name, maxLength.name), color: newOptionColor, description: "" }];
  const input = { fieldId: request.fieldId, [dataType === "SINGLE_SELECT" ? "singleSelectOptions" : "multiSelectOptions"]: options };
  throwIfCancelled(signal);
  const mutation = mutations.updateProjectV2Field;
  const result = await mutate<{ updateProjectV2Field: { projectV2Field: Raw } | null }>(mutation.document, { input }, mutation.title);
  const field = fieldFrom(result.updateProjectV2Field?.projectV2Field, "加选项");

  // GitHub 若没有保住已有选项的 id，宿主的漂移守卫会把它认成「选项被删」并中断写入、请用户更新映射——
  // 那是对的结果；这里记一条日志，方便看出是谁改的。
  const kept = new Set((field.options ?? []).map((option) => option.id));
  const lost = existing.filter((option) => !kept.has(option.id));
  if (lost.length) jarvis.log.warn("加选项之后，已有选项的 id 变了", lost.map((option) => option.name));
  return { field };
}
