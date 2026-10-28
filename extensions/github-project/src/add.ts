/**
 * `addItem`：把仓库里已有的一条 Issue 加进 Project（jarvis-mac `specs/20261028-191224-git-push-error-proxy-dashboard-issue-links` I-1）。
 *
 * 宿主那边：Issue 正文里点开的一条链接指向一条不在这个 Project 里的 Issue，抽屉里「加入这个 Project」；Git 的 Issue 页「加入 Project」。
 *
 * 三步：认出 Issue 的节点 id（`IssueId`）→ `addProjectV2ItemById` → 读回那一条。已经在 Project 里时 GitHub 交回原条目（幂等），照常交回。
 * 不写任何字段：放进来之后宿主照常经 `applyEdit` 编辑。读回失败不算失败：交回一条最小的条目，宿主下次同步会校正。
 */
import type { CancelSignal, ProjectAddItemRequest, ProjectCreatedItem, ProjectItem } from "@fusionseek/jarvis-extension-sdk";
import { jarvis } from "@fusionseek/jarvis-extension-sdk";
import { issueId, mutations, readItem } from "./documents.js";
import { GitHubError, messageOf, mutate, query, throwIfCancelled } from "./graphql.js";
import { clamp, maxLength, nonEmpty } from "./limits.js";
import type { Raw } from "./mapping.js";
import { mapItem } from "./mapping.js";
import { splitRepository } from "./projects.js";

/** 校验过的入参。 */
export interface AddItemPlan {
  projectId: string;
  repository: string;
  owner: string;
  name: string;
  number: number;
}

/**
 * 在发任何请求之前把入参校验一遍。
 * @param request 入参。
 * @returns 校验过的入参。
 * @throws 缺 Project / 仓库、仓库不是 `owner/name`、编号不是正整数时，一句人话。
 */
export function planAddItem(request: ProjectAddItemRequest): AddItemPlan {
  if (!request.projectId) throw new Error("缺少 projectId");
  if (!request.repository) throw new Error("缺少 Issue 所在的仓库");
  const { owner, name } = splitRepository(request.repository);
  const number = request.number;
  if (typeof number !== "number" || !Number.isInteger(number) || number < 1) throw new Error("Issue 编号要是一个正整数");
  return { projectId: request.projectId, repository: request.repository, owner, name, number };
}

/**
 * 读回失败时交回的最小条目。
 * @param itemId Project 条目 id。
 * @param plan 入参。
 * @param issue Issue 的标题与链接（认 id 那一步读到的）。
 */
export function minimalAddedItem(itemId: string, plan: AddItemPlan, issue: { title: string; url?: string; isOpen: boolean }): ProjectItem {
  const content: ProjectItem["content"] = {
    repository: plan.repository,
    number: plan.number,
    title: clamp(issue.title || `#${plan.number}`, maxLength.itemTitle),
    isOpen: issue.isOpen,
  };
  const url = nonEmpty(issue.url, maxLength.url);
  if (url) content.url = url;
  return { id: itemId, contentType: "issue", updatedAt: new Date().toISOString(), content, values: {} };
}

/**
 * 把一条已有的 Issue 加进 Project。
 * @param request 入参：Project、仓库（`owner/name`）、编号。
 * @param signal 取消信号：加进去之前检查。
 * @returns 已在 Project 里的那一条（读回的；读不回时是最小条目）。
 * @throws 入参不对、找不到 Issue（或它是 PR）、GitHub 拒绝时一句人话（宿主的拒绝保留错误码）。
 */
export async function addItem(request: ProjectAddItemRequest, signal?: CancelSignal): Promise<ProjectCreatedItem> {
  const plan = planAddItem(request);
  throwIfCancelled(signal);

  const { data } = await query<{ repository: Raw }>(issueId, { owner: plan.owner, name: plan.name, number: plan.number }, "读 Issue");
  const issue = (data.repository?.["issue"] ?? null) as Raw;
  const contentId = issue?.["id"];
  if (typeof contentId !== "string" || !contentId) {
    throw new GitHubError(`找不到 ${plan.repository}#${plan.number}（不存在、是 Pull Request，或 token 看不到它）`, []);
  }
  const title = typeof issue?.["title"] === "string" ? (issue["title"] as string) : "";
  const url = typeof issue?.["url"] === "string" ? (issue["url"] as string) : undefined;
  const isOpen = issue?.["state"] !== "CLOSED";
  throwIfCancelled(signal);

  const add = mutations.addProjectV2ItemById;
  const added = await mutate<{ addProjectV2ItemById: { item: Raw } | null }>(add.document, { input: { projectId: plan.projectId, contentId } }, add.title);
  const itemId = added.addProjectV2ItemById?.item?.["id"];
  if (typeof itemId !== "string" || !itemId) throw new GitHubError(`GitHub 拒绝了「${add.title}」：没有交回 Project 条目`, []);

  try {
    const { data: read } = await query<{ node: Raw }>(readItem, { id: itemId }, "读回条目");
    const item = mapItem(read.node);
    if (item) return { item };
    jarvis.log.warn("Issue 已加进 Project，读回的那一条读不出；先交回最小条目，宿主下次同步会校正", itemId);
  } catch (error) {
    jarvis.log.warn("Issue 已加进 Project，读回那一条失败；先交回最小条目，宿主下次同步会校正", messageOf(error));
  }
  return { item: minimalAddedItem(itemId, plan, { title, ...(url ? { url } : {}), isOpen }) };
}
