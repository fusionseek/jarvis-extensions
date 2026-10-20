/**
 * `readItems`：一页条目（≤ 100）。
 *
 * 增量同步用 Project 的过滤串 `updated:>=YYYY-MM-DD`（`ProjectV2.items(query:)`）。它按天、且 GitHub 没说按哪个时区，
 * 因此**往前多退一天**：契约只要求「可以多给、不能少给」，宿主按 `updatedAt` 去重。
 *
 * GitHub 若拒绝这个过滤串（非 `NOT_FOUND` / 权限 / 限流这类换个写法也没用的错误），这一次**回落到全量**并从头读；
 * 回落之后的游标前缀 `all:`，宿主原样带回来，后面几页就接着全量读，不会拿全量的游标去配增量的查询。
 *
 * 带 `itemIds` 时（能力 `readItemsById`，Jarvis「项目」工具栏的「刷新本视图」）只读回这几条（`nodes(ids:)`），不翻页、不看 `cursor` / `since`。
 */
import type { CancelSignal, ProjectItem, ProjectItemsPage, ProjectItemsRequest } from "@fusionseek/jarvis-extension-sdk";
import { jarvis } from "@fusionseek/jarvis-extension-sdk";
import { readItems as readItemsDocument, readItemsByIds, readItemsSince } from "./documents.js";
import { describeErrors, GitHubError, outcome, rawQuery, terminalErrorTypes, throwIfCancelled } from "./graphql.js";
import type { Raw } from "./mapping.js";
import { mapItem } from "./mapping.js";
import { addDays, day, itemsPerPage, maxLength } from "./limits.js";

/** 回落到全量之后，游标带的前缀。 */
export const fullScanPrefix = "all:";

/**
 * 增量过滤串。
 * @param since ISO 8601 时间戳。
 * @returns `updated:>=YYYY-MM-DD`（往前多退一天）；读不出时间时为 `undefined`（读全量）。
 */
export function sinceFilter(since: string | undefined): string | undefined {
  if (!since || Number.isNaN(Date.parse(since))) return undefined;
  const date = day(new Date(Date.parse(since)).toISOString());
  return date ? `updated:>=${addDays(date, -1)}` : undefined;
}

/** 一次读页的计划：游标、过滤串、是不是已经回落到全量。 */
export interface PagePlan {
  after: string | undefined;
  filter: string | undefined;
  fullScan: boolean;
}

/**
 * 从宿主带回的游标与 `since` 定这一页怎么读。
 * @param request 入参。
 * @returns 计划。
 */
export function planPage(request: ProjectItemsRequest): PagePlan {
  const cursor = request.cursor || undefined;
  if (cursor?.startsWith(fullScanPrefix)) {
    return { after: cursor.slice(fullScanPrefix.length) || undefined, filter: undefined, fullScan: true };
  }
  return { after: cursor, filter: sinceFilter(request.since), fullScan: false };
}

interface ItemsConnection {
  totalCount?: number;
  pageInfo?: { hasNextPage?: boolean; endCursor?: string | null };
  nodes?: Raw[] | null;
}

interface ItemsData {
  node: { __typename?: string; items?: ItemsConnection | null } | null;
}

function fetchPage(projectId: string, plan: PagePlan) {
  const variables: Record<string, unknown> = { id: projectId, cursor: plan.after ?? null };
  if (plan.filter) variables["q"] = plan.filter;
  return rawQuery<ItemsData>(plan.filter ? readItemsSince : readItemsDocument, variables);
}

interface NodesData {
  nodes?: (Record<string, unknown> | null)[] | null;
}

/**
 * 要按 id 读的那几条：去掉空的、去重、保序。
 * @param ids 宿主带来的 `itemIds`。
 * @returns 去重之后的 id。
 * @throws 超过一页（100）时：宿主按 100 一批发，多了是宿主的错，宁可失败也不悄悄少读。
 */
export function requestedIds(ids: readonly unknown[]): string[] {
  const seen = new Set<string>();
  for (const id of ids) {
    if (typeof id === "string" && id.length > 0 && id.length <= maxLength.id) seen.add(id);
  }
  if (seen.size > itemsPerPage) throw new Error(`一次至多按 id 读 ${itemsPerPage} 条`);
  return [...seen];
}

/**
 * 按 id 读回几条。
 *
 * `NOT_FOUND`（条目已移出 Project、Issue 删了）的那几条不交回；**别的错误整次失败**——宿主据「请求了却没交回」把那一条从列表与镜像里去掉，
 * 不能把一次权限、限流、超时的失败读成「移出了」。不是这个 Project 的条目也不交回。
 * @param projectId Project id。
 * @param ids 条目 id。
 * @param signal 取消信号。
 * @returns 一页（不带游标）。
 */
async function readItemsById(projectId: string, ids: readonly unknown[], signal?: CancelSignal): Promise<ProjectItemsPage> {
  const wanted = requestedIds(ids);
  if (wanted.length === 0) return { items: [] };
  throwIfCancelled(signal);
  const response = await rawQuery<NodesData>(readItemsByIds, { ids: wanted });
  const errors = response.errors ?? [];
  const unexpected = errors.filter((error) => error.type !== "NOT_FOUND");
  if (response.data === null || response.data === undefined || unexpected.length > 0) {
    throw new GitHubError(`读条目失败：${describeErrors(unexpected.length > 0 ? unexpected : errors)}`, errors);
  }
  const wantedSet = new Set(wanted);
  const items = (response.data.nodes ?? [])
    .filter((node): node is Record<string, unknown> => node !== null && node !== undefined && node["__typename"] === "ProjectV2Item")
    .filter((node) => (node["project"] as { id?: unknown } | undefined)?.id === projectId)
    .map(mapItem)
    .filter((item): item is ProjectItem => item !== null && wantedSet.has(item.id));
  return { items };
}

/**
 * 读一页条目。
 * @param request 入参。
 * @param signal 取消信号。
 * @returns 一页。
 */
export async function readItems(request: ProjectItemsRequest, signal?: CancelSignal): Promise<ProjectItemsPage> {
  if (!request.projectId) throw new Error("缺少 projectId");
  throwIfCancelled(signal);
  if (Array.isArray(request.itemIds)) return readItemsById(request.projectId, request.itemIds, signal);
  let plan = planPage(request);
  let response = await fetchPage(request.projectId, plan);
  const rejectedFilter =
    plan.filter !== undefined &&
    !response.data?.node?.items &&
    (response.errors ?? []).length > 0 &&
    !(response.errors ?? []).some((error) => error.type !== undefined && terminalErrorTypes.has(error.type));
  if (rejectedFilter) {
    jarvis.log.warn("GitHub 不认增量过滤串，这一次回落到全量", (response.errors ?? []).slice(0, 2).map((error) => error.message));
    throwIfCancelled(signal);
    plan = { after: undefined, filter: undefined, fullScan: true };
    response = await fetchPage(request.projectId, plan);
  }

  // 与其它读取同一套的失败口径：没有 data 时抛一句人话。
  const { data } = outcome(response, "读条目");
  const node = data.node;
  if (!node) throw new GitHubError("找不到这个 Project（或 token 看不到它）", []);
  const connection = node.items;
  if (!connection) throw new GitHubError(`「${request.projectId}」不是一个 Project`, []);

  const items = (connection.nodes ?? []).map(mapItem).filter((item): item is ProjectItem => item !== null).slice(0, 100);
  const page: ProjectItemsPage = { items };
  const end = connection.pageInfo?.endCursor;
  if (connection.pageInfo?.hasNextPage && end) {
    const next = plan.fullScan ? `${fullScanPrefix}${end}` : end;
    // 截断的游标等于悄悄少读后面几页；宁可这一次失败。GitHub 的游标实际只有几十个字。
    if (next.length > maxLength.cursor) throw new GitHubError("GitHub 的翻页游标超过了 500 字，读不了下一页", []);
    page.nextCursor = next;
  }
  if (typeof connection.totalCount === "number") page.totalCount = Math.max(0, Math.floor(connection.totalCount));
  return page;
}
