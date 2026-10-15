/**
 * GitHub 的响应 → 项目引擎契约（jarvis-mac `bridge.v2.schema.json` 的 `$defs.project*`）。全部是纯函数。
 *
 * 原则与宿主一致：**宽进严出**。读不出必填项的那一个（条目、字段、选项）丢掉，不让整页失败；
 * 字符串截到契约上限；只交原始值——字段值怎么翻译成通用字段，是宿主的事。
 */
import type {
  ProjectField,
  ProjectFieldDataType,
  ProjectFieldOption,
  ProjectFieldValue,
  ProjectItem,
  ProjectItemContent,
  ProjectItemRef,
  ProjectItemRelations,
  ProjectIteration,
  ProjectSummary,
} from "@fusionseek/jarvis-extension-sdk";
import { clamp, day, maxLength, nonEmpty, timestamp } from "./limits.js";

/** GitHub 响应里随便一个对象：字段都按「可能缺、可能为 null」读。 */
export type Raw = Record<string, unknown> | null | undefined;

function object(value: unknown): Raw {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function nodes(connection: unknown): Raw[] {
  const list = object(connection)?.["nodes"];
  return Array.isArray(list) ? list.map(object) : [];
}

function count(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.floor(value) : undefined;
}

/**
 * GitHub `ProjectV2FieldType` → 契约的字段类型名。认不出的（`TRACKS`、`CREATED` …）一律 `other`：
 * 宿主按 `other` 显示、不丢字段，只是不能映射。
 */
const dataTypes: Readonly<Record<string, ProjectFieldDataType>> = {
  TEXT: "text",
  NUMBER: "number",
  DATE: "date",
  SINGLE_SELECT: "singleSelect",
  MULTI_SELECT: "multiSelect",
  ITERATION: "iteration",
  TITLE: "title",
  ASSIGNEES: "assignees",
  LABELS: "labels",
  MILESTONE: "milestone",
  REPOSITORY: "repository",
  ISSUE_TYPE: "issueType",
  PARENT_ISSUE: "parentIssue",
  SUB_ISSUES_PROGRESS: "subIssuesProgress",
  LINKED_PULL_REQUESTS: "linkedPullRequests",
  REVIEWERS: "reviewers",
};

/**
 * 字段类型名。
 * @param value GitHub 的 `dataType`。
 * @returns 契约的类型名；认不出为 `other`。
 */
export function mapDataType(value: unknown): ProjectFieldDataType {
  return (typeof value === "string" && dataTypes[value]) || "other";
}

/** 契约的可建类型 → GitHub `ProjectV2CustomFieldType`。 */
export const creatableTypes = {
  text: "TEXT",
  number: "NUMBER",
  date: "DATE",
  singleSelect: "SINGLE_SELECT",
  multiSelect: "MULTI_SELECT",
  iteration: "ITERATION",
} as const;

/**
 * Project 所有者的登录名。`ProjectV2Owner` 上没有 `login`，按 `Organization` / `User` 分别取。
 * @param owner `owner { __typename … login }`。
 * @returns 登录名；读不出为空串。
 */
export function ownerLogin(owner: unknown): string {
  return nonEmpty(object(owner)?.["login"], maxLength.owner) ?? "";
}

/**
 * 一个 Project 的概要。
 * @param raw `ProjectSummaryFields`。
 * @returns 概要；没有 id 的为 `null`。
 */
export function mapProjectSummary(raw: Raw): ProjectSummary | null {
  const id = nonEmpty(raw?.["id"], maxLength.id);
  if (!raw || !id) return null;
  const number = count(raw["number"]) ?? 0;
  // 标题是必填且非空：GitHub 的新 Project 默认叫「@xx's untitled project」，真遇到空串就用编号顶上。
  const title = nonEmpty(raw["title"], maxLength.title) ?? `Project #${number}`;
  const summary: ProjectSummary = {
    id,
    number,
    title,
    owner: ownerLogin(raw["owner"]),
    url: nonEmpty(raw["url"], maxLength.url) ?? "",
  };
  const itemCount = count(object(raw["items"])?.["totalCount"]);
  if (itemCount !== undefined) summary.itemCount = itemCount;
  const updatedAt = timestamp(raw["updatedAt"]);
  if (updatedAt) summary.updatedAt = updatedAt;
  if (typeof raw["closed"] === "boolean") summary.closed = raw["closed"];
  return summary;
}

/**
 * 选项列表（单选、多选、Issue Type）。
 * @param list GitHub 的选项数组。
 * @returns 选项；没有 id 或名字的丢掉，至多 200 个。
 */
export function mapOptions(list: unknown): ProjectFieldOption[] {
  if (!Array.isArray(list)) return [];
  const options: ProjectFieldOption[] = [];
  for (const entry of list) {
    const raw = object(entry);
    const id = nonEmpty(raw?.["id"], maxLength.id);
    const name = nonEmpty(raw?.["name"], maxLength.name);
    if (!id || !name) continue;
    const option: ProjectFieldOption = { id, name };
    const color = nonEmpty(raw?.["color"], maxLength.color);
    if (color) option.color = color;
    options.push(option);
    if (options.length === 200) break;
  }
  return options;
}

function mapIteration(raw: Raw, completed: boolean): ProjectIteration | null {
  const id = nonEmpty(raw?.["id"], maxLength.id);
  const title = nonEmpty(raw?.["title"], maxLength.name);
  const startDate = day(raw?.["startDate"]);
  const durationDays = count(raw?.["duration"]);
  if (!id || !title || !startDate || durationDays === undefined || durationDays < 1 || durationDays > 365) return null;
  return { id, title, startDate, durationDays, completed };
}

/**
 * 一个字段。
 * @param raw `FieldConfig`。
 * @param issueTypes Issue Type 字段的选项（组织的 Issue Type）；没有时省略。
 * @returns 字段；没有 id 或名字的为 `null`。
 */
export function mapField(raw: Raw, issueTypes?: ProjectFieldOption[]): ProjectField | null {
  const id = nonEmpty(raw?.["id"], maxLength.id);
  const name = nonEmpty(raw?.["name"], maxLength.name);
  if (!raw || !id || !name) return null;
  const dataType = mapDataType(raw["dataType"]);
  const field: ProjectField = { id, name, dataType };
  if (dataType === "singleSelect") field.options = mapOptions(raw["options"]);
  if (dataType === "multiSelect") field.options = mapOptions(raw["multiSelectOptions"]);
  if (dataType === "issueType" && issueTypes && issueTypes.length > 0) field.options = issueTypes.slice(0, 200);
  if (dataType === "iteration") {
    const configuration = object(raw["configuration"]);
    const iterations = [
      ...nodesOf(configuration?.["completedIterations"]).map((entry) => mapIteration(entry, true)),
      ...nodesOf(configuration?.["iterations"]).map((entry) => mapIteration(entry, false)),
    ].filter((entry): entry is ProjectIteration => entry !== null);
    iterations.sort((a, b) => a.startDate.localeCompare(b.startDate));
    field.iterations = iterations.slice(-200);
    const duration = count(configuration?.["duration"]);
    if (duration !== undefined && duration >= 1 && duration <= 365) field.iterationDurationDays = duration;
  }
  return field;
}

function nodesOf(list: unknown): Raw[] {
  return Array.isArray(list) ? list.map(object) : [];
}

/**
 * 一个字段值。只认六种原始值；标签、里程碑、指派人这些内置字段的值随条目内容走，不在这里。
 * @param raw `fieldValues.nodes` 的一项。
 * @returns 字段 id 与值；认不出的为 `null`。
 */
export function mapFieldValue(raw: Raw): { fieldId: string; value: ProjectFieldValue } | null {
  const fieldId = nonEmpty(object(raw?.["field"])?.["id"], maxLength.id);
  if (!raw || !fieldId) return null;
  switch (raw["__typename"]) {
    case "ProjectV2ItemFieldTextValue":
      return typeof raw["text"] === "string" ? { fieldId, value: { text: clamp(raw["text"], maxLength.text) } } : null;
    case "ProjectV2ItemFieldNumberValue":
      return typeof raw["number"] === "number" && Number.isFinite(raw["number"]) ? { fieldId, value: { number: raw["number"] } } : null;
    case "ProjectV2ItemFieldDateValue": {
      const date = day(raw["date"]);
      return date ? { fieldId, value: { date } } : null;
    }
    case "ProjectV2ItemFieldSingleSelectValue": {
      const optionId = nonEmpty(raw["optionId"], maxLength.id);
      return optionId ? { fieldId, value: { optionId } } : null;
    }
    case "ProjectV2ItemFieldMultiSelectValue": {
      const options = Array.isArray(raw["options"]) ? raw["options"] : [];
      const optionIds = options
        .map((entry) => nonEmpty(object(entry)?.["id"], maxLength.id))
        .filter((entry): entry is string => entry !== undefined)
        .slice(0, 50);
      return { fieldId, value: { optionIds } };
    }
    case "ProjectV2ItemFieldIterationValue": {
      const iterationId = nonEmpty(raw["iterationId"], maxLength.id);
      return iterationId ? { fieldId, value: { iterationId } } : null;
    }
    default:
      return null;
  }
}

/**
 * Issue 的身份。
 * @param raw `{ number, repository { nameWithOwner } }`。
 * @returns 身份；读不出为 `null`。
 */
export function mapRef(raw: Raw): ProjectItemRef | null {
  const repository = nonEmpty(object(raw?.["repository"])?.["nameWithOwner"], 200);
  const number = count(raw?.["number"]);
  if (!repository || !/^[^/\s]+\/[^/\s]+$/.test(repository) || !number) return null;
  return { repository, number };
}

function logins(connection: unknown, limit: number): string[] {
  return nodes(connection)
    .map((node) => nonEmpty(node?.["login"], maxLength.login))
    .filter((entry): entry is string => entry !== undefined)
    .slice(0, limit);
}

const contentTypes: Readonly<Record<string, ProjectItem["contentType"]>> = {
  Issue: "issue",
  PullRequest: "pullRequest",
  DraftIssue: "draftIssue",
};

/**
 * 一个条目。
 * @param raw `ItemFields`。
 * @returns 条目；内容读不出（`REDACTED`、没权限看的 Issue）或缺身份的为 `null`。
 */
export function mapItem(raw: Raw): ProjectItem | null {
  const id = nonEmpty(raw?.["id"], maxLength.id);
  const updatedAt = timestamp(raw?.["updatedAt"]);
  const rawContent = object(raw?.["content"]);
  const contentType = contentTypes[String(rawContent?.["__typename"])];
  if (!raw || !id || !updatedAt || !rawContent || !contentType) return null;

  const content: ProjectItemContent = {
    title: typeof rawContent["title"] === "string" ? clamp(rawContent["title"], maxLength.itemTitle) : "",
  };
  if (contentType !== "draftIssue") {
    const ref = mapRef(rawContent);
    if (!ref) return null;
    content.repository = ref.repository;
    content.number = ref.number;
    const url = nonEmpty(rawContent["url"], maxLength.url);
    if (url) content.url = url;
    if (typeof rawContent["closed"] === "boolean") content.isOpen = !rawContent["closed"];
    const author = nonEmpty(object(rawContent["author"])?.["login"], maxLength.login);
    if (author) content.author = author;
    const labels = nodes(rawContent["labels"])
      .map((node) => nonEmpty(node?.["name"], maxLength.label))
      .filter((entry): entry is string => entry !== undefined)
      .slice(0, 50);
    if (labels.length) content.labels = labels;
    const milestone = object(rawContent["milestone"]);
    const milestoneTitle = nonEmpty(milestone?.["title"], maxLength.milestone);
    if (milestoneTitle) content.milestone = milestoneTitle;
    const due = day(milestone?.["dueOn"]);
    if (milestoneTitle && due) content.milestoneDueOn = due;
    const issueType = nonEmpty(object(rawContent["issueType"])?.["name"], maxLength.issueType);
    if (issueType) content.issueType = issueType;
    const closedAt = timestamp(rawContent["closedAt"]);
    if (closedAt) content.closedAt = closedAt;
  }
  const assignees = logins(rawContent["assignees"], 20);
  if (assignees.length) content.assignees = assignees;
  const createdAt = timestamp(rawContent["createdAt"]);
  if (createdAt) content.createdAt = createdAt;

  const item: ProjectItem = { id, contentType, updatedAt, content };
  if (raw["isArchived"] === true) item.archived = true;

  const values: Record<string, ProjectFieldValue> = {};
  let valueCount = 0;
  for (const node of nodes(raw["fieldValues"])) {
    const mapped = mapFieldValue(node);
    if (!mapped || mapped.fieldId in values) continue;
    values[mapped.fieldId] = mapped.value;
    valueCount += 1;
    if (valueCount === 100) break;
  }
  if (valueCount) item.values = values;

  if (contentType === "issue") {
    const relations: ProjectItemRelations = {};
    const parent = mapRef(object(rawContent["parent"]));
    if (parent) relations.parent = parent;
    const blockedBy = nodes(rawContent["blockedBy"])
      .map(mapRef)
      .filter((entry): entry is ProjectItemRef => entry !== null)
      .slice(0, 50);
    if (blockedBy.length) relations.blockedBy = blockedBy;
    const summary = object(rawContent["subIssuesSummary"]);
    const total = count(summary?.["total"]);
    const completed = count(summary?.["completed"]);
    if (total !== undefined) {
      relations.subIssueTotal = total;
      relations.subIssueDone = Math.min(completed ?? 0, total);
    }
    if (Object.keys(relations).length) item.relations = relations;
  }
  return item;
}
