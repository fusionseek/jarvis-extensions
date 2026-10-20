/**
 * 全部 GraphQL 文档（GitHub GraphQL API，Projects v2）。
 *
 * 每份文档恰好一个**具名**操作、放在最前面，后面跟它用到的具名片段——宿主的闸门（jarvis-mac
 * `GitHostingGraphQLPolicy`）只认「一个操作 + 片段」，并按变更的**顶层字段名**比对 manifest `git.mutations`。
 * 用户给的值一律走变量，不拼进文档。
 *
 * 字段名与类型以 2026-10-15 对 GitHub 公开 schema 的只读内省为准（README「已知边界」列出了与直觉不同的几处）：
 * - Issue 与 PR 的 `state` 是两种不同的枚举，放进同一个联合选择会触发「字段冲突」，因此两边都只取 `closed`；
 * - 多选字段的选项叫 `multiSelectOptions`，多选取值是 `options { id }`；
 * - `ProjectV2Owner` 上没有 `login`，要按 `Organization` / `User` 分别取。
 */
import { assigneesPerItem, blockedByPerItem, fieldValuesPerItem, fieldsPerProject, issueTypesPerOwner, itemsPerPage, labelsPerItem, projectsPerList } from "./limits.js";

/** Project 概要。`items { totalCount }` 不带分页参数：只要个数时 GitHub 不要求 `first`。 */
const projectSummaryFragment = `fragment ProjectSummaryFields on ProjectV2 {
  id
  number
  title
  url
  closed
  updatedAt
  owner { __typename ... on Organization { login } ... on User { login } }
  items { totalCount }
}`;

/** 字段结构：通用三项 + 单选 / 多选的选项 + 迭代配置。选项的 `description` 只为 `createOption` 原样写回。 */
const fieldConfigFragment = `fragment FieldConfig on ProjectV2FieldConfiguration {
  ... on ProjectV2FieldCommon { id name dataType }
  ... on ProjectV2SingleSelectField { options { id name color description } }
  ... on ProjectV2MultiSelectField { multiSelectOptions { id name color description } }
  ... on ProjectV2IterationField {
    configuration {
      duration
      iterations { id title startDate duration }
      completedIterations { id title startDate duration }
    }
  }
}`;

const fieldIdFragment = `fragment FieldId on ProjectV2FieldConfiguration {
  ... on ProjectV2FieldCommon { id }
}`;

/** 一个条目：字段值（只取六种原始值）、内容（Issue / PR / 草稿）、Issue 的父子与依赖。 */
const itemFragment = `fragment ItemFields on ProjectV2Item {
  id
  updatedAt
  isArchived
  type
  fieldValues(first: ${fieldValuesPerItem}) {
    nodes {
      __typename
      ... on ProjectV2ItemFieldTextValue { text field { ...FieldId } }
      ... on ProjectV2ItemFieldNumberValue { number field { ...FieldId } }
      ... on ProjectV2ItemFieldDateValue { date field { ...FieldId } }
      ... on ProjectV2ItemFieldSingleSelectValue { optionId field { ...FieldId } }
      ... on ProjectV2ItemFieldMultiSelectValue { options { id } field { ...FieldId } }
      ... on ProjectV2ItemFieldIterationValue { iterationId field { ...FieldId } }
    }
  }
  content {
    __typename
    ... on Issue {
      number
      title
      url
      closed
      createdAt
      closedAt
      author { login }
      assignees(first: ${assigneesPerItem}) { nodes { login } }
      labels(first: ${labelsPerItem}) { nodes { name } }
      milestone { title dueOn }
      issueType { name }
      repository { nameWithOwner }
      parent { number repository { nameWithOwner } }
      blockedBy(first: ${blockedByPerItem}) { nodes { number repository { nameWithOwner } } }
      subIssuesSummary { total completed }
    }
    ... on PullRequest {
      number
      title
      url
      closed
      createdAt
      closedAt
      author { login }
      assignees(first: ${assigneesPerItem}) { nodes { login } }
      labels(first: ${labelsPerItem}) { nodes { name } }
      milestone { title dueOn }
      repository { nameWithOwner }
    }
    ... on DraftIssue {
      title
      createdAt
      assignees(first: ${assigneesPerItem}) { nodes { login } }
    }
  }
}
${fieldIdFragment}`;

const projectOrder = `orderBy: { field: UPDATED_AT, direction: DESC }`;

/** token 自己的 Project。 */
export const listViewerProjects = `query ListViewerProjects {
  viewer {
    projectsV2(first: ${projectsPerList}, ${projectOrder}) { nodes { ...ProjectSummaryFields } }
  }
}
${projectSummaryFragment}`;

/** 一个账号或组织的 Project：`repositoryOwner` 一次认出是组织还是用户，不用试两次。 */
export const listOwnerProjects = `query ListOwnerProjects($owner: String!) {
  repositoryOwner(login: $owner) {
    __typename
    ... on Organization { projectsV2(first: ${projectsPerList}, ${projectOrder}) { nodes { ...ProjectSummaryFields } } }
    ... on User { projectsV2(first: ${projectsPerList}, ${projectOrder}) { nodes { ...ProjectSummaryFields } } }
  }
}
${projectSummaryFragment}`;

/** 与一个仓库关联的 Project。 */
export const listRepositoryProjects = `query ListRepositoryProjects($owner: String!, $name: String!) {
  repository(owner: $owner, name: $name) {
    projectsV2(first: ${projectsPerList}, ${projectOrder}) { nodes { ...ProjectSummaryFields } }
  }
}
${projectSummaryFragment}`;

/** 一个 Project 的概要与字段结构。 */
export const readSchema = `query ReadSchema($id: ID!) {
  node(id: $id) {
    __typename
    ... on ProjectV2 {
      ...ProjectSummaryFields
      fields(first: ${fieldsPerProject}) { nodes { ...FieldConfig } }
    }
  }
}
${projectSummaryFragment}
${fieldConfigFragment}`;

/** 组织的 Issue Type（Issue Type 字段的选项）。用户名下的 Project 没有这一层。 */
export const organizationIssueTypes = `query OrganizationIssueTypes($login: String!) {
  organization(login: $login) { issueTypes(first: ${issueTypesPerOwner}) { nodes { id name isEnabled } } }
}`;

/** 一页条目（全量）。 */
export const readItems = `query ReadItems($id: ID!, $cursor: String) {
  node(id: $id) {
    __typename
    ... on ProjectV2 {
      items(first: ${itemsPerPage}, after: $cursor) {
        totalCount
        pageInfo { hasNextPage endCursor }
        nodes { ...ItemFields }
      }
    }
  }
}
${itemFragment}`;

/** 一页条目（增量：`$q` 是 Project 过滤串 `updated:>=YYYY-MM-DD`）。 */
export const readItemsSince = `query ReadItemsSince($id: ID!, $cursor: String, $q: String!) {
  node(id: $id) {
    __typename
    ... on ProjectV2 {
      items(first: ${itemsPerPage}, after: $cursor, query: $q) {
        totalCount
        pageInfo { hasNextPage endCursor }
        nodes { ...ItemFields }
      }
    }
  }
}
${itemFragment}`;

/**
 * 按 id 读回几条（`readItems` 带 `itemIds`，能力 `readItemsById`；≤ 100 条，与一页同上限）。
 * 每条带上它所在的 Project：宿主据「没交回」判这一条已移出 Project，因此不是这个 Project 的条目一律不交回。
 */
export const readItemsByIds = `query ReadItemsByIds($ids: [ID!]!) {
  nodes(ids: $ids) {
    __typename
    ... on ProjectV2Item { project { id } ...ItemFields }
  }
}
${itemFragment}`;

/** 读回一个条目（`applyEdit` 之后）。 */
export const readItem = `query ReadItem($id: ID!) {
  node(id: $id) {
    __typename
    ... on ProjectV2Item { ...ItemFields }
  }
}
${itemFragment}`;

/** 一个仓库的节点 id（`createItem` 建 Issue 要用：`createIssue` 只认仓库 id）。 */
export const repositoryId = `query RepositoryId($owner: String!, $name: String!) {
  repository(owner: $owner, name: $name) { id }
}`;

/** 读一个字段的当前结构（`createOption` / `createIteration` 要原样带回已有选项 / 迭代）。 */
export const readField = `query ReadField($id: ID!) {
  node(id: $id) {
    __typename
    ...FieldConfig
  }
}
${fieldConfigFragment}`;

// ---------------------------------------------------------------------------
// 变更：每份一个顶层字段，名字与 manifest `git.mutations` 逐字对应。默认只取 clientMutationId、结果另读；
// 后面要用到结果的那几份（建字段、建 Issue、加进 Project）带自己的选择集。
// ---------------------------------------------------------------------------

/** 一种变更：GraphQL 顶层字段名 + 输入类型。 */
interface MutationSpec {
  field: string;
  input: string;
  /** 给用户看的那一步叫什么。 */
  title: string;
  /** 选择集；省略时只取 clientMutationId。 */
  selection?: string;
  fragments?: string;
}

function mutationDocument(spec: MutationSpec): string {
  const name = spec.field[0]!.toUpperCase() + spec.field.slice(1);
  const selection = spec.selection ?? "clientMutationId";
  return `mutation ${name}($input: ${spec.input}!) {
  ${spec.field}(input: $input) { ${selection} }
}${spec.fragments ? `\n${spec.fragments}` : ""}`;
}

const specs = {
  updateProjectV2ItemFieldValue: { field: "updateProjectV2ItemFieldValue", input: "UpdateProjectV2ItemFieldValueInput", title: "改字段值" },
  clearProjectV2ItemFieldValue: { field: "clearProjectV2ItemFieldValue", input: "ClearProjectV2ItemFieldValueInput", title: "清空字段值" },
  closeIssue: { field: "closeIssue", input: "CloseIssueInput", title: "关闭 Issue" },
  reopenIssue: { field: "reopenIssue", input: "ReopenIssueInput", title: "重新打开 Issue" },
  updateIssueIssueType: { field: "updateIssueIssueType", input: "UpdateIssueIssueTypeInput", title: "改 Issue Type" },
  addLabelsToLabelable: { field: "addLabelsToLabelable", input: "AddLabelsToLabelableInput", title: "加标签" },
  removeLabelsFromLabelable: { field: "removeLabelsFromLabelable", input: "RemoveLabelsFromLabelableInput", title: "去掉标签" },
  updateIssue: { field: "updateIssue", input: "UpdateIssueInput", title: "改里程碑" },
  addAssigneesToAssignable: { field: "addAssigneesToAssignable", input: "AddAssigneesToAssignableInput", title: "加指派人" },
  removeAssigneesFromAssignable: { field: "removeAssigneesFromAssignable", input: "RemoveAssigneesFromAssignableInput", title: "去掉指派人" },
  addSubIssue: { field: "addSubIssue", input: "AddSubIssueInput", title: "设父 Issue" },
  removeSubIssue: { field: "removeSubIssue", input: "RemoveSubIssueInput", title: "脱离父 Issue" },
  addBlockedBy: { field: "addBlockedBy", input: "AddBlockedByInput", title: "加依赖" },
  removeBlockedBy: { field: "removeBlockedBy", input: "RemoveBlockedByInput", title: "去掉依赖" },
  createProjectV2Field: {
    field: "createProjectV2Field",
    input: "CreateProjectV2FieldInput",
    title: "建字段",
    selection: "projectV2Field { ...FieldConfig }",
    fragments: fieldConfigFragment,
  },
  updateProjectV2Field: {
    field: "updateProjectV2Field",
    input: "UpdateProjectV2FieldInput",
    title: "加选项",
    selection: "projectV2Field { ...FieldConfig }",
    fragments: fieldConfigFragment,
  },
  createIssue: { field: "createIssue", input: "CreateIssueInput", title: "建 Issue", selection: "issue { id number url }" },
  addProjectV2ItemById: { field: "addProjectV2ItemById", input: "AddProjectV2ItemByIdInput", title: "加进 Project", selection: "item { id }" },
} satisfies Record<string, MutationSpec>;

/** 代码里会发的变更名。manifest `git.mutations` 必须与它逐字相同（测试钉住）。 */
export type MutationName = keyof typeof specs;

/** 一份变更：文档与它在报错里的名字。 */
export interface Mutation {
  name: MutationName;
  title: string;
  document: string;
}

/** 全部变更，按名字取。 */
export const mutations: Readonly<Record<MutationName, Mutation>> = Object.fromEntries(
  Object.entries(specs).map(([name, spec]) => [name, { name, title: spec.title, document: mutationDocument(spec) }]),
) as Record<MutationName, Mutation>;
