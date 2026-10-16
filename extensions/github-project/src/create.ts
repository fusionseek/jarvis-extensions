/**
 * `createItem`：在你选的仓库里建一条 Issue，再把它加进 Project（宿主「项目」里的「新建」）。
 *
 * 四步：认出仓库的节点 id（`RepositoryId`）→ `createIssue` → `addProjectV2ItemById` → 读回那一条。
 * 字段值不在这里写：宿主拿交回的条目并进镜像，随后经 `applyEdit` 写预填的字段（状态、迭代……）。
 *
 * - **交回的条目必须已经在 Project 里**，因此 Issue 建好之后就不再理会取消：停在两步之间会留下一条不在 Project 里的 Issue——
 *   用户在「项目」里看不到它，以为没建成，再点一次就重复了。
 * - 加进 Project 那一步失败时，报错写明 Issue 已经建在哪、编号是多少：Issue 不会被撤回（没有删 Issue 的变更），
 *   用户要知道去哪找它。
 * - 读回失败不算失败：交回一条最小的条目（Issue 的身份、标题、链接），宿主下次同步会校正。
 */
import type { CancelSignal, ProjectCreateItemRequest, ProjectCreatedItem, ProjectItem } from "@fusionseek/jarvis-extension-sdk";
import { JarvisError, jarvis } from "@fusionseek/jarvis-extension-sdk";
import { mutations, readItem, repositoryId } from "./documents.js";
import { GitHubError, messageOf, mutate, query, throwIfCancelled } from "./graphql.js";
import type { Raw } from "./mapping.js";
import { mapItem } from "./mapping.js";
import { clamp, maxLength, nonEmpty } from "./limits.js";
import { splitRepository } from "./projects.js";

/** Issue 标题的上限（GitHub 的上限，也是契约 `projectEngineRequest.title` 的上限）。 */
export const maxIssueTitle = 256;
/** Issue 正文的上限（GitHub 的上限，也是契约 `projectEngineRequest.body` 的上限）。 */
export const maxIssueBody = 65_536;

/** 校验过的入参。 */
export interface CreateItemPlan {
  projectId: string;
  repository: string;
  owner: string;
  name: string;
  title: string;
  /** 省略 = 空正文。 */
  body?: string;
}

/**
 * 在发任何请求之前把入参校验一遍（宿主按 schema 发，这里是最后一道：错的入参不该建出半条 Issue）。
 * @param request 入参。
 * @returns 校验过的入参：标题去掉首尾空白；空正文省略。
 * @throws 缺 Project / 仓库、仓库不是 `owner/name`、标题为空或超过 256 字、正文超过 65,536 字时，一句人话。
 */
export function planCreateItem(request: ProjectCreateItemRequest): CreateItemPlan {
  if (!request.projectId) throw new Error("缺少 projectId");
  if (!request.repository) throw new Error("缺少要建 Issue 的仓库");
  const { owner, name } = splitRepository(request.repository);
  const title = typeof request.title === "string" ? request.title.trim() : "";
  if (!title) throw new Error("Issue 标题不能是空的");
  if (Array.from(title).length > maxIssueTitle) throw new Error(`Issue 标题超过 ${maxIssueTitle} 字`);
  const plan: CreateItemPlan = { projectId: request.projectId, repository: request.repository, owner, name, title };
  if (typeof request.body === "string" && request.body.length > 0) {
    if (Array.from(request.body).length > maxIssueBody) throw new Error("Issue 正文超过 65,536 字");
    plan.body = request.body;
  }
  return plan;
}

/** 建好的 Issue。 */
export interface CreatedIssue {
  id: string;
  number: number;
  url?: string;
}

/**
 * 读回失败时交回的最小条目：Issue 的身份、标题、链接，开着，没有字段值。宿主拿它并进镜像，下次同步校正。
 * @param itemId Project 条目 id。
 * @param plan 校验过的入参。
 * @param issue 建好的 Issue。
 * @returns 条目。
 */
export function minimalItem(itemId: string, plan: CreateItemPlan, issue: CreatedIssue): ProjectItem {
  const content: ProjectItem["content"] = {
    repository: plan.repository,
    number: issue.number,
    title: clamp(plan.title, maxLength.itemTitle),
    isOpen: true,
  };
  const url = nonEmpty(issue.url, maxLength.url);
  if (url) content.url = url;
  return { id: itemId, contentType: "issue", updatedAt: new Date().toISOString(), content, values: {} };
}

function createdIssue(raw: Raw): CreatedIssue | null {
  const id = raw?.["id"];
  const number = raw?.["number"];
  if (typeof id !== "string" || !id || typeof number !== "number" || !Number.isInteger(number) || number < 1) return null;
  const url = raw?.["url"];
  return typeof url === "string" ? { id, number, url } : { id, number };
}

/**
 * 在仓库里建一条 Issue 并加进 Project。
 * @param request 入参：Project、仓库（`owner/name`）、标题、可选的正文。
 * @param signal 取消信号：Issue 建好之前检查；建好之后不再理会（见文件头）。
 * @returns 建好、已在 Project 里的那一条（读回的；读不回时是最小条目）。
 * @throws 入参不对、找不到仓库、GitHub 拒绝建 Issue 时一句人话；加进 Project 失败时写明 Issue 已建在哪（宿主的拒绝保留错误码）。
 */
export async function createItem(request: ProjectCreateItemRequest, signal?: CancelSignal): Promise<ProjectCreatedItem> {
  const plan = planCreateItem(request);
  throwIfCancelled(signal);

  const { data } = await query<{ repository: Raw }>(repositoryId, { owner: plan.owner, name: plan.name }, "读仓库");
  const repositoryNode = data.repository?.["id"];
  if (typeof repositoryNode !== "string" || !repositoryNode) {
    throw new GitHubError(`找不到仓库 ${plan.repository}（或 token 看不到它）`, []);
  }
  throwIfCancelled(signal);

  const create = mutations.createIssue;
  const input: Record<string, unknown> = { repositoryId: repositoryNode, title: plan.title };
  if (plan.body !== undefined) input["body"] = plan.body;
  const created = await mutate<{ createIssue: { issue: Raw } | null }>(create.document, { input }, create.title);
  const issue = createdIssue(created.createIssue?.issue);
  if (!issue) throw new GitHubError(`GitHub 拒绝了「${create.title}」：没有交回建好的 Issue`, []);

  // 从这里起 Issue 已经在仓库里了：不再理会取消（见文件头）。
  let itemId: string;
  try {
    const add = mutations.addProjectV2ItemById;
    const added = await mutate<{ addProjectV2ItemById: { item: Raw } | null }>(
      add.document,
      { input: { projectId: plan.projectId, contentId: issue.id } },
      add.title,
    );
    const id = added.addProjectV2ItemById?.item?.["id"];
    if (typeof id !== "string" || !id) throw new GitHubError(`GitHub 拒绝了「${add.title}」：没有交回 Project 条目`, []);
    itemId = id;
  } catch (error) {
    const message = `Issue #${issue.number} 已建在 ${plan.repository}，但没能加进 Project：${messageOf(error)}`;
    if (error instanceof JarvisError) throw new JarvisError({ code: error.code, message, ...(error.detail ? { detail: error.detail } : {}) });
    throw new Error(message);
  }

  try {
    const { data: read } = await query<{ node: Raw }>(readItem, { id: itemId }, "读回条目");
    const item = mapItem(read.node);
    if (item) return { item };
    jarvis.log.warn("Issue 已建好并加进 Project，读回的那一条读不出；先交回最小条目，宿主下次同步会校正", itemId);
  } catch (error) {
    jarvis.log.warn("Issue 已建好并加进 Project，读回那一条失败；先交回最小条目，宿主下次同步会校正", messageOf(error));
  }
  return { item: minimalItem(itemId, plan, issue) };
}
