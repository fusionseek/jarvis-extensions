/**
 * `applyEdit`：把宿主校验过的编辑步骤写回 GitHub。
 *
 * 宿主已经按工作流、必填与漂移守卫校验过每一步，这里**只执行、不判断该不该改**。三段：
 *
 * 1. **一次解析查询**（`ResolveEdit`）：Issue / PR 的节点 id、当前状态 / 父 Issue / 指派人，以及这些步骤要用到的
 *    标签、里程碑、Issue Type、用户、其他 Issue 的 id——变更只认 id，名字要先换成 id；
 * 2. **逐步变更**：一步一份文档、按顺序发；某一步失败就停，报「第几步、被谁拒了、前几步已经写入」；
 * 3. **读回那一条**交给宿主，替换它的乐观更新。读回失败不算编辑失败（宿主下次同步会校正）。
 */
import type {
  CancelSignal,
  ProjectEditRequest,
  ProjectEditResult,
  ProjectEngineChange,
  ProjectFieldValue,
  ProjectItemRef,
} from "@fusionseek/jarvis-extension-sdk";
import { JarvisError, jarvis } from "@fusionseek/jarvis-extension-sdk";
import type { MutationName } from "./documents.js";
import { mutations, readItem } from "./documents.js";
import { messageOf, mutate, query, throwIfCancelled } from "./graphql.js";
import type { Raw } from "./mapping.js";
import { mapItem } from "./mapping.js";
import { currentAssignees, issueTypesPerOwner, milestonesPerSearch } from "./limits.js";
import { splitRepository } from "./projects.js";

/** 一步编辑给用户看的名字（报错用）。 */
export function changeTitle(change: ProjectEngineChange): string {
  switch (change.op) {
    case "setFieldValue":
      return "改字段值";
    case "clearFieldValue":
      return "清空字段值";
    case "setIssueState":
      return change.open ? "重新打开 Issue" : "关闭 Issue";
    case "setIssueType":
      return "改 Issue Type";
    case "setLabels":
      return "改标签";
    case "setMilestone":
      return "改里程碑";
    case "setAssignees":
      return "改指派人";
    case "setParent":
      return "改父 Issue";
    case "addBlockedBy":
      return "加依赖";
    case "removeBlockedBy":
      return "去掉依赖";
  }
}

/**
 * 字段值 → GitHub `ProjectV2FieldValue`。空的多选不是一个值：调用方改发「清空」。
 * @param value 契约的字段值。
 * @returns GitHub 的输入；空多选为 `null`。
 */
export function fieldValueInput(value: ProjectFieldValue): Record<string, unknown> | null {
  if ("text" in value) return { text: value.text };
  if ("number" in value) return { number: value.number };
  if ("date" in value) return { date: value.date };
  if ("optionId" in value) return { singleSelectOptionId: value.optionId };
  if ("optionIds" in value) return value.optionIds.length ? { multiSelectOptionIds: value.optionIds } : null;
  return { iterationId: value.iterationId };
}

/** 一条 Issue 身份的比较键（仓库名不分大小写）。 */
export function refKey(ref: ProjectItemRef): string {
  return `${ref.repository.toLowerCase()}#${ref.number}`;
}

/** 这一步要不要先认出条目装的 Issue / PR（字段值两步不用：它们改的是 Project 条目）。 */
function touchesContent(change: ProjectEngineChange): boolean {
  return change.op !== "setFieldValue" && change.op !== "clearFieldValue";
}

/** 解析查询的计划：文档、变量，以及每个名字落在哪个别名上。 */
export interface ResolvePlan {
  document: string;
  variables: Record<string, unknown>;
  labels: Map<string, string>;
  users: Map<string, string>;
  refs: Map<string, string>;
  milestones: boolean;
  issueTypes: boolean;
}

/**
 * 拼一次解析查询。别名与变量名都是这里生成的（`l0`、`u0`、`r0`）；用户给的名字只进变量，不进文档。
 * @param ref 条目装的 Issue / PR。
 * @param changes 编辑步骤。
 * @returns 计划。
 */
export function planResolve(ref: ProjectItemRef, changes: readonly ProjectEngineChange[]): ResolvePlan {
  const { owner, name } = splitRepository(ref.repository);
  const variables: Record<string, unknown> = { owner, name, number: ref.number };
  const declarations = ["$owner: String!", "$name: String!", "$number: Int!"];
  const inRepository: string[] = [];
  const atRoot: string[] = [];
  const labels = new Map<string, string>();
  const users = new Map<string, string>();
  const refs = new Map<string, string>();
  let milestones = false;
  let issueTypes = false;

  const addRef = (other: ProjectItemRef) => {
    const key = refKey(other);
    if (refs.has(key)) return;
    const alias = `r${refs.size}`;
    refs.set(key, alias);
    const parts = splitRepository(other.repository);
    declarations.push(`$${alias}Owner: String!`, `$${alias}Name: String!`, `$${alias}Number: Int!`);
    Object.assign(variables, { [`${alias}Owner`]: parts.owner, [`${alias}Name`]: parts.name, [`${alias}Number`]: other.number });
    atRoot.push(
      `${alias}: repository(owner: $${alias}Owner, name: $${alias}Name) { issueOrPullRequest(number: $${alias}Number) { __typename ... on Issue { id } } }`,
    );
  };

  for (const change of changes) {
    switch (change.op) {
      case "setLabels":
        for (const label of [...change.add, ...change.remove]) {
          if (labels.has(label)) continue;
          const alias = `l${labels.size}`;
          labels.set(label, alias);
          declarations.push(`$${alias}: String!`);
          variables[alias] = label;
          inRepository.push(`${alias}: label(name: $${alias}) { id name }`);
        }
        break;
      case "setMilestone":
        if (change.title !== null && !milestones) {
          milestones = true;
          declarations.push("$milestone: String");
          variables["milestone"] = change.title;
          inRepository.push(`milestones(first: ${milestonesPerSearch}, query: $milestone, states: [OPEN, CLOSED]) { nodes { id title } }`);
        }
        break;
      case "setIssueType":
        if (!issueTypes) {
          issueTypes = true;
          inRepository.push(`issueTypes(first: ${issueTypesPerOwner}) { nodes { id name isEnabled } }`);
        }
        break;
      case "setAssignees":
        for (const login of change.logins) {
          const key = login.toLowerCase();
          if (users.has(key)) continue;
          const alias = `u${users.size}`;
          users.set(key, alias);
          declarations.push(`$${alias}: String!`);
          variables[alias] = login;
          atRoot.push(`${alias}: user(login: $${alias}) { id login }`);
        }
        break;
      case "setParent":
        if (change.parent) addRef(change.parent);
        break;
      case "addBlockedBy":
      case "removeBlockedBy":
        addRef(change.ref);
        break;
      default:
        break;
    }
  }

  const assignees = `assignees(first: ${currentAssignees}) { nodes { id login } }`;
  const document = `query ResolveEdit(${declarations.join(", ")}) {
  repository(owner: $owner, name: $name) {
    target: issueOrPullRequest(number: $number) {
      __typename
      ... on Issue { id closed parent { id number repository { nameWithOwner } } ${assignees} }
      ... on PullRequest { id closed ${assignees} }
    }
${inRepository.map((line) => `    ${line}`).join("\n")}
  }
${atRoot.map((line) => `  ${line}`).join("\n")}
}`;
  return { document, variables, labels, users, refs, milestones, issueTypes };
}

interface Person {
  id: string;
  login: string;
}

/** 解析出来的东西：执行时就地更新（关掉之后的下一步看到的是「已关」）。 */
interface Resolved {
  ref: ProjectItemRef;
  kind: "Issue" | "PullRequest";
  id: string;
  closed: boolean;
  parent: { id: string; key: string | null } | null;
  assignees: Person[];
  labelIds: Map<string, string>;
  milestones: { id: string; title: string }[];
  issueTypes: { id: string; name: string }[];
  userIds: Map<string, string>;
  refIds: Map<string, string>;
}

function list(value: unknown): Raw[] {
  const nodes = (value as { nodes?: unknown } | null | undefined)?.nodes;
  return Array.isArray(nodes) ? (nodes as Raw[]) : [];
}

function str(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

async function resolve(ref: ProjectItemRef, changes: readonly ProjectEngineChange[]): Promise<Resolved> {
  const plan = planResolve(ref, changes);
  const { data } = await query<Record<string, Raw>>(plan.document, plan.variables, "读要改的 Issue");
  const repository = data["repository"];
  if (!repository) throw new Error(`找不到仓库 ${ref.repository}（或 token 看不到它）`);
  const target = repository["target"] as Raw;
  const kind = target?.["__typename"];
  const id = str(target?.["id"]);
  if (!target || !id || (kind !== "Issue" && kind !== "PullRequest")) throw new Error(`找不到 ${ref.repository}#${ref.number}`);

  const rawParent = target["parent"] as Raw;
  const parentRepository = str((rawParent?.["repository"] as Raw)?.["nameWithOwner"]);
  const parentNumber = rawParent?.["number"];
  const parentID = str(rawParent?.["id"]);
  const resolved: Resolved = {
    ref,
    kind,
    id,
    closed: target["closed"] === true,
    parent: parentID
      ? {
          id: parentID,
          key: parentRepository && typeof parentNumber === "number" ? refKey({ repository: parentRepository, number: parentNumber }) : null,
        }
      : null,
    assignees: list(target["assignees"]).flatMap((node) => {
      const personID = str(node?.["id"]);
      const login = str(node?.["login"]);
      return personID && login ? [{ id: personID, login }] : [];
    }),
    labelIds: new Map(),
    milestones: list(repository["milestones"]).flatMap((node) => {
      const milestoneID = str(node?.["id"]);
      const title = str(node?.["title"]);
      return milestoneID && title ? [{ id: milestoneID, title }] : [];
    }),
    issueTypes: list(repository["issueTypes"]).flatMap((node) => {
      const typeID = str(node?.["id"]);
      const name = str(node?.["name"]);
      return typeID && name && node?.["isEnabled"] !== false ? [{ id: typeID, name }] : [];
    }),
    userIds: new Map(),
    refIds: new Map(),
  };
  for (const [label, alias] of plan.labels) {
    const labelID = str((repository[alias] as Raw)?.["id"]);
    if (labelID) resolved.labelIds.set(label, labelID);
  }
  for (const [login, alias] of plan.users) {
    const userID = str(data[alias]?.["id"]);
    if (userID) resolved.userIds.set(login, userID);
  }
  for (const [key, alias] of plan.refs) {
    const issue = data[alias]?.["issueOrPullRequest"] as Raw;
    const issueID = issue?.["__typename"] === "Issue" ? str(issue["id"]) : undefined;
    if (issueID) resolved.refIds.set(key, issueID);
  }
  return resolved;
}

/** 发一份变更。 */
function send(name: MutationName, input: Record<string, unknown>): Promise<unknown> {
  const mutation = mutations[name];
  return mutate(mutation.document, { input }, mutation.title);
}

function requireIssue(target: Resolved | null, change: ProjectEngineChange): Resolved {
  const resolved = requireContent(target, change);
  if (resolved.kind !== "Issue") {
    throw new Error(`${resolved.ref.repository}#${resolved.ref.number} 是 Pull Request，「${changeTitle(change)}」只对 Issue 有效`);
  }
  return resolved;
}

function requireContent(target: Resolved | null, change: ProjectEngineChange): Resolved {
  if (!target) throw new Error(`草稿还不是 Issue，不能${changeTitle(change)}`);
  return target;
}

function refID(target: Resolved, ref: ProjectItemRef): string {
  const id = target.refIds.get(refKey(ref));
  if (!id) throw new Error(`找不到 Issue ${ref.repository}#${ref.number}（或它是 PR、token 看不到它）`);
  return id;
}

async function applyOne(request: ProjectEditRequest, target: Resolved | null, change: ProjectEngineChange): Promise<void> {
  const item = { projectId: request.projectId, itemId: request.itemId };
  switch (change.op) {
    case "setFieldValue": {
      const value = fieldValueInput(change.value);
      if (value) await send("updateProjectV2ItemFieldValue", { ...item, fieldId: change.fieldId, value });
      else await send("clearProjectV2ItemFieldValue", { ...item, fieldId: change.fieldId });
      return;
    }
    case "clearFieldValue":
      await send("clearProjectV2ItemFieldValue", { ...item, fieldId: change.fieldId });
      return;
    case "setIssueState": {
      const issue = requireIssue(target, change);
      // 已经是那个状态就不发：GitHub 对「关一个已关的 Issue」的回应不稳定，而结果本来就对。
      if (change.open === !issue.closed) return;
      if (change.open) await send("reopenIssue", { issueId: issue.id });
      else await send("closeIssue", { issueId: issue.id, stateReason: change.reason === "notPlanned" ? "NOT_PLANNED" : "COMPLETED" });
      issue.closed = !change.open;
      return;
    }
    case "setIssueType": {
      const issue = requireIssue(target, change);
      const wanted = change.name.trim().toLowerCase();
      const type = issue.issueTypes.find((entry) => entry.name.toLowerCase() === wanted);
      if (!type) {
        throw new Error(
          issue.issueTypes.length
            ? `仓库 ${issue.ref.repository} 没有名为「${change.name}」的 Issue Type`
            : `仓库 ${issue.ref.repository} 用不了 Issue Type（只有组织仓库里有）`,
        );
      }
      await send("updateIssueIssueType", { issueId: issue.id, issueTypeId: type.id });
      return;
    }
    case "setLabels": {
      const content = requireContent(target, change);
      const missing = change.add.filter((label) => !content.labelIds.has(label));
      if (missing.length) throw new Error(`仓库 ${content.ref.repository} 里没有标签「${missing.join("」「")}」`);
      const add = change.add.map((label) => content.labelIds.get(label)!);
      // 要去掉的标签仓库里已经没有了，结果本来就对：跳过，不报错。
      const remove = change.remove.flatMap((label) => {
        const id = content.labelIds.get(label);
        return id ? [id] : [];
      });
      if (add.length) await send("addLabelsToLabelable", { labelableId: content.id, labelIds: add });
      if (remove.length) await send("removeLabelsFromLabelable", { labelableId: content.id, labelIds: remove });
      return;
    }
    case "setMilestone": {
      // PR 的里程碑要走 updatePullRequest——没有声明，也就不做。
      const issue = requireIssue(target, change);
      if (change.title === null) {
        await send("updateIssue", { id: issue.id, milestoneId: null });
        return;
      }
      const title = change.title;
      const milestone =
        issue.milestones.find((entry) => entry.title === title) ??
        issue.milestones.find((entry) => entry.title.toLowerCase() === title.toLowerCase());
      if (!milestone) throw new Error(`仓库 ${issue.ref.repository} 里没有里程碑「${title}」`);
      // updateIssue 能改很多东西，这里只传 id 与 milestoneId。
      await send("updateIssue", { id: issue.id, milestoneId: milestone.id });
      return;
    }
    case "setAssignees": {
      const content = requireContent(target, change);
      const wanted = new Set(change.logins.map((login) => login.toLowerCase()));
      const current = new Set(content.assignees.map((person) => person.login.toLowerCase()));
      const toAdd = change.logins.filter((login) => !current.has(login.toLowerCase()));
      const missing = toAdd.filter((login) => !content.userIds.has(login.toLowerCase()));
      if (missing.length) throw new Error(`找不到 GitHub 用户「${missing.join("」「")}」`);
      const addIDs = [...new Set(toAdd.map((login) => content.userIds.get(login.toLowerCase())!))];
      const remove = content.assignees.filter((person) => !wanted.has(person.login.toLowerCase()));
      if (addIDs.length) await send("addAssigneesToAssignable", { assignableId: content.id, assigneeIds: addIDs });
      if (remove.length) await send("removeAssigneesFromAssignable", { assignableId: content.id, assigneeIds: remove.map((person) => person.id) });
      return;
    }
    case "setParent": {
      const issue = requireIssue(target, change);
      if (change.parent === null) {
        if (!issue.parent) return;
        await send("removeSubIssue", { issueId: issue.parent.id, subIssueId: issue.id });
        issue.parent = null;
        return;
      }
      const key = refKey(change.parent);
      if (issue.parent?.key === key) return;
      const parentID = refID(issue, change.parent);
      await send("addSubIssue", { issueId: parentID, subIssueId: issue.id, replaceParent: true });
      issue.parent = { id: parentID, key };
      return;
    }
    case "addBlockedBy": {
      const issue = requireIssue(target, change);
      await send("addBlockedBy", { issueId: issue.id, blockingIssueId: refID(issue, change.ref) });
      return;
    }
    case "removeBlockedBy": {
      const issue = requireIssue(target, change);
      await send("removeBlockedBy", { issueId: issue.id, blockingIssueId: refID(issue, change.ref) });
      return;
    }
  }
}

/**
 * 执行一次编辑。
 * @param request 入参：Project、条目、条目装的 Issue / PR、步骤。
 * @param signal 取消信号：步骤之间检查，已经发出去的那一步不撤回。
 * @returns 读回的条目（读不回时省略）。
 * @throws 某一步失败时，一句写明第几步、被谁拒了、前几步已经写入的话。
 */
export async function applyEdit(request: ProjectEditRequest, signal?: CancelSignal): Promise<ProjectEditResult> {
  if (!request.projectId || !request.itemId) throw new Error("缺少 projectId 或 itemId");
  const changes = request.changes ?? [];
  if (!changes.length) throw new Error("没有要执行的编辑");
  throwIfCancelled(signal);

  let target: Resolved | null = null;
  if (changes.some(touchesContent) && request.contentRef) target = await resolve(request.contentRef, changes);

  for (const [index, change] of changes.entries()) {
    try {
      throwIfCancelled(signal);
      await applyOne(request, target, change);
    } catch (error) {
      if (error instanceof JarvisError && error.code === "cancelled") throw error;
      const done = index > 0 ? `；前 ${index} 步已经写入` : "";
      const message = `第 ${index + 1} 步（${changeTitle(change)}）没做成：${messageOf(error)}${done}`;
      if (error instanceof JarvisError) throw new JarvisError({ code: error.code, message, ...(error.detail ? { detail: error.detail } : {}) });
      throw new Error(message);
    }
  }

  try {
    const { data } = await query<{ node: Raw }>(readItem, { id: request.itemId }, "读回条目");
    const item = mapItem(data.node);
    return item ? { item } : {};
  } catch (error) {
    jarvis.log.warn("编辑已写入，读回那一条失败；宿主下次同步会校正", messageOf(error));
    return {};
  }
}
