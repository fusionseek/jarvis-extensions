/**
 * 经宿主执行 GraphQL：读走 `git.hosting.query`（`git.hosting.read`），写走 `git.hosting.mutate`（`git.hosting.write`）。
 * token 从不经过扩展；宿主把 GitHub 的响应原样交回，部分成功（`data` 与 `errors` 同时在）不算失败。
 *
 * 这里把「失败」统一成一句**给用户看的话**：宿主把 `message` 原样显示在发起处（同步芯片、编辑失败的提示），
 * 因此要说清是哪一件事、被谁拒了、去哪修。
 */
import type { CancelSignal, GitGraphQLError, GitGraphQLResponse } from "@fusionseek/jarvis-extension-sdk";
import { jarvis, JarvisError } from "@fusionseek/jarvis-extension-sdk";
import { clamp, hosting, maxLength } from "./limits.js";

/** 读到的数据与随之而来的部分错误。 */
export interface QueryOutcome<T> {
  data: T;
  /** 部分成功时的错误（例如一条 Issue 在看不到的私有仓库里）。没有为空数组。 */
  errors: GitGraphQLError[];
}

/** GitHub 错误类型里「换个写法也没用」的那几种：不重试、不回落。 */
export const terminalErrorTypes = new Set(["NOT_FOUND", "FORBIDDEN", "INSUFFICIENT_SCOPES", "RATE_LIMITED"]);

/**
 * 把 GitHub 的错误说成人话。权限与限流有固定的出路，单独说；其余用 GitHub 的原话（第一条）。
 * @param errors GraphQL 错误。
 * @returns 一句话（≤ 200 字）。
 */
export function describeErrors(errors: readonly GitGraphQLError[] | undefined): string {
  const list = errors ?? [];
  if (list.some((error) => error.type === "INSUFFICIENT_SCOPES")) {
    return "token 缺少 Projects 权限（只读需 read:project，写回需 project）：到 设置 · Git · GitHub 更新 token";
  }
  if (list.some((error) => error.type === "RATE_LIMITED")) return "GitHub 限流了：等一会儿再试";
  const first = list[0];
  if (!first) return "GitHub 没有返回数据";
  return clamp(first.message || first.type || "GitHub 返回了错误", maxLength.summary);
}

/**
 * 被宿主取消时停下：后面的请求不再发。
 * @param signal 取消信号。
 * @returns 无返回值。
 * @throws `JarvisError`（`cancelled`）。
 */
export function throwIfCancelled(signal: CancelSignal | undefined): void {
  if (signal?.cancelled) throw new JarvisError({ code: "cancelled", message: "已取消" });
}

/**
 * 执行一份查询，原样交回响应（调用方自己决定部分成功怎么办，例如回落重试）。
 * @param document GraphQL 文档。
 * @param variables 变量。
 * @returns GitHub 的响应。
 * @throws 宿主的拒绝（`JarvisError`）。
 */
export function rawQuery<T>(document: string, variables: Record<string, unknown>): Promise<GitGraphQLResponse<T>> {
  return jarvis.git.hosting.query<T>({ hosting, query: document, variables });
}

/**
 * 执行一份查询。
 * @param document GraphQL 文档。
 * @param variables 变量。
 * @param what 这件事叫什么（报错用），例如「读字段结构」。
 * @returns `data` 与部分错误。
 * @throws 没有 `data` 时抛一句人话；宿主的拒绝（`JarvisError`）原样抛出。
 */
export async function query<T>(document: string, variables: Record<string, unknown>, what: string): Promise<QueryOutcome<T>> {
  return outcome(await rawQuery<T>(document, variables), what);
}

/**
 * 查询响应的统一口径：有 `data` 就收下（部分错误记一条日志），没有就抛一句人话。
 * @param response GitHub 的响应。
 * @param what 这件事叫什么。
 * @returns `data` 与部分错误。
 * @throws 没有 `data` 时的 `GitHubError`。
 */
export function outcome<T>(response: GitGraphQLResponse<T>, what: string): QueryOutcome<T> {
  const errors = response.errors ?? [];
  if (response.data === null || response.data === undefined) {
    // 「读你的 Project 失败」：以西文结尾的事名后面空一格再接中文。
    throw new GitHubError(`${what}${/[A-Za-z0-9]$/.test(what) ? " " : ""}失败：${describeErrors(errors)}`, errors);
  }
  if (errors.length) jarvis.log.warn(`${what}：GitHub 部分成功`, errors.slice(0, 3).map((error) => error.message));
  return { data: response.data, errors };
}

/**
 * 执行一份变更。变更不接受部分成功：有任何错误就算这一步没做成。
 * @param document GraphQL 文档。
 * @param variables 变量。
 * @param what 这一步叫什么，例如「关闭 Issue」。
 * @returns `data`。
 * @throws 有错误时抛一句人话；宿主的拒绝（`JarvisError`）原样抛出。
 */
export async function mutate<T>(document: string, variables: Record<string, unknown>, what: string): Promise<T> {
  const response = await jarvis.git.hosting.mutate<T>({ hosting, query: document, variables });
  const errors = response.errors ?? [];
  if (errors.length || response.data === null || response.data === undefined) {
    throw new GitHubError(`GitHub 拒绝了「${what}」：${describeErrors(errors)}`, errors);
  }
  return response.data;
}

/** GitHub 返回的失败（不是宿主的拒绝）。`message` 是给用户看的那一句。 */
export class GitHubError extends Error {
  readonly errors: readonly GitGraphQLError[];

  constructor(message: string, errors: readonly GitGraphQLError[]) {
    super(message);
    this.name = "GitHubError";
    this.errors = errors;
  }
}

/**
 * 一个错误给用户看的那一句。
 * @param error 任意抛出物。
 * @returns 一句话。
 */
export function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object" && "message" in error) return String((error as { message: unknown }).message);
  return String(error);
}
