/**
 * 上限与小工具。
 *
 * 数字分两类：一类是**契约的上限**（jarvis-mac `bridge.v2.schema.json` 的 `$defs.project*`，宿主截到这里为止），
 * 一类是**向 GitHub 要多少**（每一页、每一条的连接取前多少个）。后者不超过前者：多要的宿主也会截掉，
 * 白花 GitHub 的点数（每小时 5,000 点）。
 */

/** 托管服务标识：与 manifest `contributes.git.hosting`、Jarvis Git 服务的服务标识一致。 */
export const hosting = "github";

/** 一页条目：GitHub 连接一页最多 100，契约一页也最多 100。 */
export const itemsPerPage = 100;
/** 一条的字段值：一个 Project 至多 50 个字段（GitHub 的上限），取 50 正好一个不落。 */
export const fieldValuesPerItem = 50;
/** 列 Project 一次取多少个（契约至多 200）。一个账号的 Project 很少过 50，按最近更新排，最新的在前。 */
export const projectsPerList = 50;
/** 一个 Project 的字段（契约至多 100）。 */
export const fieldsPerProject = 100;
/** 一条的指派人（契约至多 20）。 */
export const assigneesPerItem = 20;
/** 一条的标签（契约至多 50）。 */
export const labelsPerItem = 50;
/** 一条的 blocked by（契约至多 50；20 个之外的依赖在表格里也画不下）。 */
export const blockedByPerItem = 20;
/** 组织的 Issue Type（GitHub 默认三个，组织最多自定义 25 个）。 */
export const issueTypesPerOwner = 50;
/** 一个仓库的里程碑：按标题搜之后再逐字比对，100 个足够容下同名前缀。 */
export const milestonesPerSearch = 100;
/** 读当前指派人时取多少（GitHub 一条 Issue 至多 10 个指派人，留余量）。 */
export const currentAssignees = 50;

/** 契约里的字符串上限。 */
export const maxLength = {
  id: 200,
  title: 200,
  owner: 100,
  url: 500,
  name: 100,
  color: 20,
  text: 2000,
  itemTitle: 500,
  login: 100,
  label: 100,
  milestone: 200,
  issueType: 100,
  cursor: 500,
  summary: 200,
} as const;

/**
 * 截到 `limit` 个字符（按 Unicode 码点数，与 JSON Schema 的 `maxLength` 同一个口径）。
 * @param text 原文。
 * @param limit 上限。
 * @returns 不超过上限的字符串。
 */
export function clamp(text: string, limit: number): string {
  const points = Array.from(text);
  return points.length <= limit ? text : points.slice(0, limit).join("");
}

/**
 * 非空字符串截到上限；不是字符串或是空串时为 `undefined`。
 * @param value 任意值。
 * @param limit 上限。
 * @returns 截好的字符串或 `undefined`。
 */
export function nonEmpty(value: unknown, limit: number): string | undefined {
  return typeof value === "string" && value.length > 0 ? clamp(value, limit) : undefined;
}

/**
 * `YYYY-MM-DD`（取时间戳的前十位：GitHub 的 `Date` 本来就是这个形状，`DateTime` 取 UTC 那一天）。
 * @param value 任意值。
 * @returns 日历日或 `undefined`。
 */
export function day(value: unknown): string | undefined {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}/.test(value)) return undefined;
  return value.slice(0, 10);
}

/**
 * ISO 8601 时间戳原样保留；读不出来的为 `undefined`。
 * @param value 任意值。
 * @returns 时间戳或 `undefined`。
 */
export function timestamp(value: unknown): string | undefined {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T/.test(value) || Number.isNaN(Date.parse(value))) return undefined;
  return value;
}

/**
 * 在一个 UTC 日历日上加减天数。
 * @param date `YYYY-MM-DD`。
 * @param days 天数，可以是负数。
 * @returns `YYYY-MM-DD`。
 */
export function addDays(date: string, days: number): string {
  const time = Date.parse(`${date}T00:00:00Z`) + days * 86_400_000;
  return new Date(time).toISOString().slice(0, 10);
}
