/**
 * 对着构建产物跑：宿主替身在线缆另一端扮演 Jarvis，经 `project.engine` 调九个方法；
 * `git.hosting.*` 由假 GitHub 接住（按宿主闸门的规则判每一份文档）。**从不访问真的 GitHub。**
 *
 * 最后一条测试钉住：测试里真的发出去过的变更 = manifest `git.mutations`，一个不多一个不少。
 */
import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createTestHost } from "../../../sdk/dist/testing.js";
import { contract, declaredMutations, fakeGitHub, issueNode, loadSource, ok } from "./support.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const github = fakeGitHub();
const host = createTestHost({ async: github.stubs });
await import(join(here, "..", "dist", "extension.js")); // IIFE：加载即 defineExtension

const ALL = ["git.hosting.read", "git.hosting.write"];

async function call(method, request, granted = ALL) {
  const outcome = await host.callService({ point: "project.engine", service: "github", method, granted, ...(request ? { request } : {}) });
  return outcome.result;
}

async function value(method, request, def) {
  const result = await call(method, request);
  assert.equal(result.ok, true, result.ok ? "" : `${method} 失败：${result.error?.message}`);
  const problems = contract(def, result.value);
  if (problems) assert.deepEqual(problems, [], `${method} 的返回不符合宿主的 bridge schema`);
  return result.value;
}

const project = (id = "PVT_kwHOAA", extra = {}) => ({
  id,
  number: 3,
  title: "Jarvis Roadmap",
  url: "https://github.com/users/fusionseek/projects/3",
  closed: false,
  updatedAt: "2026-10-15T04:00:00Z",
  owner: { __typename: "User", login: "fusionseek" },
  items: { totalCount: 2 },
  ...extra,
});

beforeEach(() => {
  github.reset();
  github.viewer = { login: "fusionseek", scopes: ["repo", "project"], projectAccess: "readWrite" };
});

// ---------------------------------------------------------------------------
// describe
// ---------------------------------------------------------------------------

test("describe：token 有 project 时可用，八项可选能力，契约版本 1", async () => {
  assert.deepEqual(await value("describe", undefined, "projectEngineDescribe"), {
    contractVersion: 1,
    ready: true,
    summary: "已接上 GitHub · fusionseek",
    hosting: "github",
    features: ["nativeHierarchy", "nativeDependencies", "issueTypes", "createFields", "draftIssues", "createIterations", "createItems", "readItemsById", "addItems"],
  });
});

test("describe：缺 project 权限、只读、fine-grained、没授权、连不上，各说各的", async () => {
  github.viewer = { login: "fusionseek", scopes: ["repo"], projectAccess: "none" };
  const none = await value("describe", undefined, "projectEngineDescribe");
  assert.equal(none.ready, false);
  assert.equal(none.problem, "token 缺少 project 权限（只读需 read:project）");

  github.viewer = { login: "fusionseek", scopes: ["read:project"], projectAccess: "readOnly" };
  const readOnly = await value("describe", undefined, "projectEngineDescribe");
  assert.equal(readOnly.ready, true);
  assert.match(readOnly.summary, /只能读/);

  github.viewer = { projectAccess: "unknown" };
  assert.match((await value("describe", undefined, "projectEngineDescribe")).summary, /^已接上 GitHub（fine-grained/);

  github.viewer = { login: "fusionseek", projectAccess: "readWrite" };
  const result = await call("describe", undefined, ["git.hosting.read"]);
  assert.match(result.value.summary, /只读浏览/);

  const ungranted = await call("describe", undefined, []);
  assert.equal(ungranted.value.ready, false);
  assert.match(ungranted.value.problem, /读取 Git 服务数据/);

  github.viewer = () => {
    throw { code: "host.failure", message: "还没有添加 github 服务" };
  };
  const down = await call("describe");
  assert.equal(down.ok, true, "describe 从不失败");
  assert.deepEqual([down.value.ready, down.value.problem], [false, "还没有添加 github 服务"]);
});

// ---------------------------------------------------------------------------
// listProjects / readSchema
// ---------------------------------------------------------------------------

test("listProjects：仓库、账号（组织或用户一次认出）、token 自己", async () => {
  github.handlers.ListRepositoryProjects = () => ({ data: { repository: { projectsV2: { nodes: [project(), null] } } } });
  github.handlers.ListOwnerProjects = (variables) => ({
    data: { repositoryOwner: variables.owner === "nobody" ? null : { __typename: "Organization", projectsV2: { nodes: [project("PVT_org", { owner: { __typename: "Organization", login: "fusionseek-org" } })] } } },
  });
  github.handlers.ListViewerProjects = () => ({ data: { viewer: { projectsV2: { nodes: [project("PVT_me")] } } } });

  const byRepository = await value("listProjects", { repository: "fusionseek/jarvis-mac" }, "projectEngineProjects");
  assert.deepEqual(byRepository.projects.map((p) => p.id), ["PVT_kwHOAA"]);
  assert.deepEqual(github.callsOf("ListRepositoryProjects")[0].variables, { owner: "fusionseek", name: "jarvis-mac" });

  const byOwner = await value("listProjects", { owner: "fusionseek-org" }, "projectEngineProjects");
  assert.deepEqual(byOwner.projects.map((p) => [p.id, p.owner]), [["PVT_org", "fusionseek-org"]]);

  assert.deepEqual((await value("listProjects", {}, "projectEngineProjects")).projects.map((p) => p.id), ["PVT_me"]);

  const missing = await call("listProjects", { owner: "nobody" });
  assert.deepEqual([missing.ok, missing.error.code, missing.error.message], [false, "host.failure", "找不到 GitHub 账号或组织「nobody」"]);
});

test("listProjects：token 缺 read:project 时 GitHub 不给 data，报一句能照着修的话", async () => {
  github.handlers.ListViewerProjects = () => ({ errors: [{ type: "INSUFFICIENT_SCOPES", message: "Your token has not been granted the required scopes" }] });
  const result = await call("listProjects", {});
  assert.equal(result.ok, false);
  assert.match(result.error.message, /^读你的 Project 失败：token 缺少 Projects 权限/);
});

const schemaNode = (ownerType) => ({
  __typename: "ProjectV2",
  ...project("PVT_kwHOAA", { owner: { __typename: ownerType, login: ownerType === "Organization" ? "fusionseek-org" : "fusionseek" } }),
  fields: {
    nodes: [
      { id: "PVTF_title", name: "Title", dataType: "TITLE" },
      { id: "PVTSSF_status", name: "Status", dataType: "SINGLE_SELECT", options: [{ id: "f75ad846", name: "待处理", color: "GRAY", description: "" }] },
      { id: "PVTIF_sprint", name: "Sprint", dataType: "ITERATION", configuration: { duration: 14, iterations: [{ id: "i42", title: "Sprint 42", startDate: "2026-10-06", duration: 14 }], completedIterations: [] } },
      { id: "PVTF_type", name: "Type", dataType: "ISSUE_TYPE" },
      { id: "PVTF_target", name: "Target date", dataType: "DATE" },
    ],
  },
});

test("readSchema：组织名下的 Issue Type 字段带上组织的 Issue Type（只取启用着的）", async () => {
  github.handlers.ReadSchema = (variables) => {
    assert.deepEqual(variables, { id: "PVT_kwHOAA" });
    return { data: { node: schemaNode("Organization") } };
  };
  github.handlers.OrganizationIssueTypes = (variables) => {
    assert.deepEqual(variables, { login: "fusionseek-org" });
    return { data: { organization: { issueTypes: { nodes: [{ id: "IT_feature", name: "Feature", isEnabled: true }, { id: "IT_old", name: "Old", isEnabled: false }, { id: "IT_bug", name: "Bug", isEnabled: true }] } } } };
  };
  const schema = await value("readSchema", { projectId: "PVT_kwHOAA" }, "projectEngineSchema");
  assert.equal(schema.project.owner, "fusionseek-org");
  assert.deepEqual(schema.fields.map((f) => [f.id, f.dataType]), [
    ["PVTF_title", "title"],
    ["PVTSSF_status", "singleSelect"],
    ["PVTIF_sprint", "iteration"],
    ["PVTF_type", "issueType"],
    ["PVTF_target", "date"],
  ]);
  assert.deepEqual(schema.fields[3].options, [{ id: "IT_feature", name: "Feature" }, { id: "IT_bug", name: "Bug" }]);
  assert.equal(schema.fields[2].iterationDurationDays, 14);
});

test("readSchema：用户名下不去读 Issue Type；读 Issue Type 失败也不影响字段结构；找不到的 Project 说清楚", async () => {
  github.handlers.ReadSchema = () => ({ data: { node: schemaNode("User") } });
  const schema = await value("readSchema", { projectId: "PVT_kwHOAA" }, "projectEngineSchema");
  assert.equal(github.callsOf("OrganizationIssueTypes").length, 0);
  assert.equal(schema.fields[3].options, undefined);

  github.handlers.ReadSchema = () => ({ data: { node: schemaNode("Organization") } });
  github.handlers.OrganizationIssueTypes = () => ({ data: { organization: { issueTypes: null } }, errors: [{ type: "FORBIDDEN", message: "no permission to retrieve issueType" }] });
  assert.equal((await value("readSchema", { projectId: "PVT_kwHOAA" }, "projectEngineSchema")).fields.length, 5);

  github.handlers.ReadSchema = () => ({ data: { node: null }, errors: [{ type: "NOT_FOUND", message: "Could not resolve to a node" }] });
  const missing = await call("readSchema", { projectId: "PVT_gone" });
  assert.deepEqual([missing.ok, missing.error.message], [false, "找不到这个 Project（或 token 看不到它）"]);
});

// ---------------------------------------------------------------------------
// readItems
// ---------------------------------------------------------------------------

const page = (nodes, { hasNextPage = false, endCursor = null, totalCount = nodes.length } = {}) => ({
  data: { node: { __typename: "ProjectV2", items: { totalCount, pageInfo: { hasNextPage, endCursor }, nodes } } },
});

const draftNode = {
  id: "PVTI_draft",
  updatedAt: "2026-10-14T09:00:00Z",
  isArchived: false,
  type: "DRAFT_ISSUE",
  fieldValues: { nodes: [] },
  content: { __typename: "DraftIssue", title: "速记待办同步到 Project", createdAt: "2026-10-14T08:00:00Z", assignees: { nodes: [] } },
};

test("readItems：全量一页，游标原样往下传；读不出的条目丢掉不丢整页", async () => {
  github.handlers.ReadItems = (variables) => page([issueNode, draftNode, { id: "PVTI_r", updatedAt: "2026-10-14T09:00:00Z", type: "REDACTED", content: null }], { hasNextPage: true, endCursor: "Y3Vyc29yOjEwMA==", totalCount: 1240 });
  const first = await value("readItems", { projectId: "PVT_kwHOAA" }, "projectEngineItems");
  assert.deepEqual(github.callsOf("ReadItems")[0].variables, { id: "PVT_kwHOAA", cursor: null });
  assert.deepEqual(first.items.map((item) => item.id), ["PVTI_128", "PVTI_draft"]);
  assert.deepEqual([first.nextCursor, first.totalCount], ["Y3Vyc29yOjEwMA==", 1240]);

  github.handlers.ReadItems = () => page([issueNode]);
  const last = await value("readItems", { projectId: "PVT_kwHOAA", cursor: "Y3Vyc29yOjEwMA==" }, "projectEngineItems");
  assert.equal(github.callsOf("ReadItems")[1].variables.cursor, "Y3Vyc29yOjEwMA==");
  assert.equal(last.nextCursor, undefined, "最后一页没有游标");
});

test("readItems：增量带 updated:>= 过滤串（往前多退一天）", async () => {
  github.handlers.ReadItemsSince = () => page([issueNode], { hasNextPage: true, endCursor: "c2" });
  const result = await value("readItems", { projectId: "PVT_kwHOAA", since: "2026-10-15T09:00:00Z" }, "projectEngineItems");
  assert.deepEqual(github.callsOf("ReadItemsSince")[0].variables, { id: "PVT_kwHOAA", cursor: null, q: "updated:>=2026-10-14" });
  assert.equal(result.nextCursor, "c2");
});

test("readItems：GitHub 不认过滤串时回落到全量从头读，之后的游标带 all: 前缀、不再带过滤串", async () => {
  github.handlers.ReadItemsSince = () => ({ data: { node: null }, errors: [{ message: "Invalid filter: updated" }] });
  github.handlers.ReadItems = (variables) => page([issueNode], { hasNextPage: true, endCursor: variables.cursor ? "c3" : "c1" });
  const first = await value("readItems", { projectId: "PVT_kwHOAA", cursor: "qcursor", since: "2026-10-15T09:00:00Z" }, "projectEngineItems");
  assert.equal(github.callsOf("ReadItems")[0].variables.cursor, null, "回落之后从头读");
  assert.equal(first.nextCursor, "all:c1");
  const second = await value("readItems", { projectId: "PVT_kwHOAA", cursor: "all:c1", since: "2026-10-15T09:00:00Z" }, "projectEngineItems");
  assert.equal(github.callsOf("ReadItemsSince").length, 1, "带 all: 的那一页不再试过滤串");
  assert.equal(github.callsOf("ReadItems")[1].variables.cursor, "c1");
  assert.equal(second.nextCursor, "all:c3");
  assert.ok(host.logs.some((log) => log.level === "warn" && log.message.includes("回落到全量")));
});

test("readItems：带 itemIds 只按 id 读回这几条（nodes(ids:)），不翻页、不看 cursor / since", async () => {
  const inProject = { ...issueNode, __typename: "ProjectV2Item", project: { id: "PVT_kwHOAA" } };
  const elsewhere = { ...issueNode, __typename: "ProjectV2Item", id: "PVTI_other", project: { id: "PVT_other" } };
  github.handlers.ReadItemsByIds = () => ({
    data: { nodes: [inProject, null, elsewhere, { __typename: "Issue", id: "I_1" }] },
    errors: [{ type: "NOT_FOUND", path: ["nodes", 1], message: "Could not resolve to a node with the global id of 'PVTI_gone'" }],
  });
  const result = await value("readItems", { projectId: "PVT_kwHOAA", itemIds: ["PVTI_128", "PVTI_gone", "PVTI_128", "PVTI_other", "I_1"], cursor: "ignored", since: "2026-10-15T09:00:00Z" }, "projectEngineItems");
  assert.deepEqual(github.callsOf("ReadItemsByIds")[0].variables, { ids: ["PVTI_128", "PVTI_gone", "PVTI_other", "I_1"] }, "去重、保序");
  assert.deepEqual(result.items.map((item) => item.id), ["PVTI_128"], "移出的（NOT_FOUND）、别的 Project 的、不是条目的都不交回");
  assert.equal(result.nextCursor, undefined, "按 id 读不翻页");
  assert.equal(github.callsOf("ReadItems").length + github.callsOf("ReadItemsSince").length, 0, "不走全量 / 增量");
});

test("readItems：按 id 读遇到 NOT_FOUND 之外的错误整次失败（不能把读失败当成移出）", async () => {
  github.handlers.ReadItemsByIds = () => ({ data: { nodes: [null] }, errors: [{ type: "FORBIDDEN", message: "Resource not accessible" }] });
  const result = await call("readItems", { projectId: "PVT_kwHOAA", itemIds: ["PVTI_128"] });
  assert.equal(result.ok, false);
  assert.match(result.error.message, /^读条目失败/);
});

test("readItems：itemIds 超过 100 个直接报，空的不发请求", async () => {
  const many = Array.from({ length: 101 }, (_, index) => `PVTI_${index}`);
  const tooMany = await call("readItems", { projectId: "PVT_kwHOAA", itemIds: many });
  assert.equal(tooMany.ok, false);
  const empty = await value("readItems", { projectId: "PVT_kwHOAA", itemIds: [] }, "projectEngineItems");
  assert.deepEqual(empty.items, []);
  assert.equal(github.callsOf("ReadItemsByIds").length, 0);
});

test("readItems：找不到 Project 不回落，直接报", async () => {
  github.handlers.ReadItemsSince = () => ({ data: { node: null }, errors: [{ type: "NOT_FOUND", message: "Could not resolve to a node" }] });
  const result = await call("readItems", { projectId: "PVT_gone", since: "2026-10-15T09:00:00Z" });
  assert.equal(result.ok, false);
  assert.equal(github.callsOf("ReadItems").length, 0);
  assert.equal(result.error.message, "找不到这个 Project（或 token 看不到它）");
});

// ---------------------------------------------------------------------------
// applyEdit
// ---------------------------------------------------------------------------

const REF = { repository: "fusionseek/jarvis-mac", number: 128 };

function resolveResponse(variables, overrides = {}) {
  const repository = {
    target: {
      __typename: "Issue",
      id: "I_128",
      closed: false,
      parent: { id: "I_101", number: 101, repository: { nameWithOwner: "fusionseek/jarvis-mac" } },
      assignees: { nodes: [{ id: "U_me", login: "fusionseek" }, { id: "U_old", login: "old-friend" }] },
      ...overrides.target,
    },
    milestones: { nodes: [{ id: "M_330", title: "v3.3.0" }, { id: "M_3300", title: "v3.3.00" }] },
    issueTypes: { nodes: [{ id: "IT_bug", name: "Bug", isEnabled: true }, { id: "IT_feature", name: "Feature", isEnabled: true }] },
  };
  const data = { repository };
  for (const [name, val] of Object.entries(variables)) {
    if (/^l\d+$/.test(name)) repository[name] = val === "ghost" ? null : { id: `LA_${val}`, name: val };
    if (/^u\d+$/.test(name)) data[name] = val === "nobody" ? null : { id: `U_${val.toLowerCase()}`, login: val };
    const ref = /^(r\d+)Number$/.exec(name);
    if (ref) data[ref[1]] = { issueOrPullRequest: val === 404 ? null : { __typename: "Issue", id: `I_${val}` } };
  }
  return { data };
}

function editHandlers(overrides = {}) {
  github.handlers.ResolveEdit = (variables) => resolveResponse(variables, overrides);
  for (const name of declaredMutations) {
    const op = name[0].toUpperCase() + name.slice(1);
    if (!github.handlers[op]) github.handlers[op] = () => ok(name);
  }
  github.handlers.ReadItem = (variables) => ({ data: { node: { ...issueNode, id: variables.id, updatedAt: "2026-10-15T05:00:00Z" } } });
}

const inputsOf = (name) => github.callsOf(name[0].toUpperCase() + name.slice(1)).map((c) => c.variables.input);

test("applyEdit：十种步骤按顺序执行，名字先换成 id，最后读回那一条", async () => {
  editHandlers();
  const result = await value(
    "applyEdit",
    {
      projectId: "PVT_kwHOAA",
      itemId: "PVTI_128",
      contentRef: REF,
      changes: [
        { op: "setFieldValue", fieldId: "PVTSSF_status", value: { optionId: "98236657" } },
        { op: "setFieldValue", fieldId: "PVTF_target", value: { date: "2026-10-20" } },
        { op: "setFieldValue", fieldId: "PVTMSF_area", value: { optionIds: [] } },
        { op: "clearFieldValue", fieldId: "PVTF_estimate" },
        { op: "setIssueState", open: false, reason: "notPlanned" },
        { op: "setIssueType", name: "bug" },
        { op: "setLabels", add: ["feature"], remove: ["wontfix", "ghost"] },
        { op: "setMilestone", title: "v3.3.0" },
        { op: "setAssignees", logins: ["fusionseek", "Alice"] },
        { op: "setParent", parent: { repository: "fusionseek/jarvis-mac", number: 90 } },
        { op: "addBlockedBy", ref: { repository: "fusionseek/jarvis-mac", number: 126 } },
        { op: "removeBlockedBy", ref: { repository: "fusionseek/jarvis-mac", number: 125 } },
      ],
    },
    "projectEngineEditResult",
  );
  assert.equal(result.item.id, "PVTI_128");
  assert.equal(result.item.updatedAt, "2026-10-15T05:00:00Z");

  const item = { projectId: "PVT_kwHOAA", itemId: "PVTI_128" };
  assert.deepEqual(inputsOf("updateProjectV2ItemFieldValue"), [
    { ...item, fieldId: "PVTSSF_status", value: { singleSelectOptionId: "98236657" } },
    { ...item, fieldId: "PVTF_target", value: { date: "2026-10-20" } },
  ]);
  assert.deepEqual(inputsOf("clearProjectV2ItemFieldValue"), [
    { ...item, fieldId: "PVTMSF_area" },
    { ...item, fieldId: "PVTF_estimate" },
  ]);
  assert.deepEqual(inputsOf("closeIssue"), [{ issueId: "I_128", stateReason: "NOT_PLANNED" }]);
  assert.deepEqual(inputsOf("updateIssueIssueType"), [{ issueId: "I_128", issueTypeId: "IT_bug" }]);
  assert.deepEqual(inputsOf("addLabelsToLabelable"), [{ labelableId: "I_128", labelIds: ["LA_feature"] }]);
  assert.deepEqual(inputsOf("removeLabelsFromLabelable"), [{ labelableId: "I_128", labelIds: ["LA_wontfix"] }], "仓库里已经没有的标签跳过");
  assert.deepEqual(inputsOf("updateIssue"), [{ id: "I_128", milestoneId: "M_330" }], "只传 id 与 milestoneId，标题逐字匹配");
  assert.deepEqual(inputsOf("addAssigneesToAssignable"), [{ assignableId: "I_128", assigneeIds: ["U_alice"] }]);
  assert.deepEqual(inputsOf("removeAssigneesFromAssignable"), [{ assignableId: "I_128", assigneeIds: ["U_old"] }]);
  assert.deepEqual(inputsOf("addSubIssue"), [{ issueId: "I_90", subIssueId: "I_128", replaceParent: true }]);
  assert.deepEqual(inputsOf("addBlockedBy"), [{ issueId: "I_128", blockingIssueId: "I_126" }]);
  assert.deepEqual(inputsOf("removeBlockedBy"), [{ issueId: "I_128", blockingIssueId: "I_125" }]);

  const resolve = github.callsOf("ResolveEdit");
  assert.equal(resolve.length, 1, "一次解析查询认出全部名字");
  assert.deepEqual(resolve[0].variables.u0, "fusionseek");
  const order = github.calls.map((c) => c.name);
  assert.equal(order[0], "ResolveEdit");
  assert.equal(order.at(-1), "ReadItem");
  assert.ok(order.indexOf("CloseIssue") < order.indexOf("UpdateIssueIssueType"), "按步骤顺序发");
});

test("applyEdit：重新打开、清掉里程碑、脱离父 Issue；已经是那个状态的不发", async () => {
  editHandlers({ target: { closed: true } });
  await value(
    "applyEdit",
    {
      projectId: "P",
      itemId: "PVTI_128",
      contentRef: REF,
      changes: [
        { op: "setIssueState", open: true },
        { op: "setIssueState", open: true },
        { op: "setMilestone", title: null },
        { op: "setParent", parent: null },
        { op: "setParent", parent: null },
      ],
    },
    "projectEngineEditResult",
  );
  assert.deepEqual(inputsOf("reopenIssue"), [{ issueId: "I_128" }], "第二次「打开」时已经开着，不发");
  assert.deepEqual(inputsOf("updateIssue"), [{ id: "I_128", milestoneId: null }]);
  assert.deepEqual(inputsOf("removeSubIssue"), [{ issueId: "I_101", subIssueId: "I_128" }], "第二次「脱离」时已经没有父 Issue，不发");

  github.reset();
  editHandlers();
  await value("applyEdit", { projectId: "P", itemId: "I", contentRef: REF, changes: [{ op: "setIssueState", open: true }, { op: "setParent", parent: { repository: "FusionSeek/Jarvis-Mac", number: 101 } }] }, "projectEngineEditResult");
  assert.equal(inputsOf("reopenIssue").length, 0, "本来就开着");
  assert.equal(inputsOf("addSubIssue").length, 0, "本来就是这个父 Issue（仓库名不分大小写）");
});

test("applyEdit：某一步被拒就停，说清第几步、被谁拒了、前几步已经写入", async () => {
  editHandlers();
  github.handlers.CloseIssue = () => ({ data: { closeIssue: null }, errors: [{ type: "FORBIDDEN", message: "Resource not accessible by integration" }] });
  const result = await call("applyEdit", {
    projectId: "P",
    itemId: "PVTI_128",
    contentRef: REF,
    changes: [
      { op: "setFieldValue", fieldId: "PVTSSF_status", value: { optionId: "x" } },
      { op: "setIssueState", open: false, reason: "completed" },
      { op: "setLabels", add: ["feature"], remove: [] },
    ],
  });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "host.failure");
  assert.equal(result.error.message, "第 2 步（关闭 Issue）没做成：GitHub 拒绝了「关闭 Issue」：Resource not accessible by integration；前 1 步已经写入");
  assert.equal(inputsOf("addLabelsToLabelable").length, 0, "失败之后的步骤不发");
  assert.equal(github.callsOf("ReadItem").length, 0);
});

test("applyEdit：宿主拒绝写（没授权）时保留错误码", async () => {
  editHandlers();
  // 假 GitHub 的处理函数抛出宿主那种结构化错误，等于宿主在闸门上拒绝了这次写入。
  github.handlers.UpdateProjectV2ItemFieldValue = () => {
    throw { code: "permission.denied", message: "没有授权修改 Git 服务数据" };
  };
  const result = await call("applyEdit", { projectId: "P", itemId: "I", changes: [{ op: "setFieldValue", fieldId: "F", value: { text: "x" } }] });
  assert.deepEqual([result.ok, result.error.code], [false, "permission.denied"]);
  assert.equal(result.error.message, "第 1 步（改字段值）没做成：没有授权修改 Git 服务数据");
});

test("applyEdit：名字换不成 id、草稿碰 Issue 的事、PR 碰只属于 Issue 的事，都在发变更之前说清", async () => {
  editHandlers();
  const run = (changes, extra = {}) => call("applyEdit", { projectId: "P", itemId: "I", contentRef: REF, changes, ...extra });
  assert.match((await run([{ op: "setLabels", add: ["ghost"], remove: [] }])).error.message, /仓库 fusionseek\/jarvis-mac 里没有标签「ghost」/);
  assert.match((await run([{ op: "setAssignees", logins: ["nobody"] }])).error.message, /找不到 GitHub 用户「nobody」/);
  assert.match((await run([{ op: "setMilestone", title: "v9" }])).error.message, /没有里程碑「v9」/);
  assert.match((await run([{ op: "setIssueType", name: "Epic" }])).error.message, /没有名为「Epic」的 Issue Type/);
  assert.match((await run([{ op: "addBlockedBy", ref: { repository: "fusionseek/jarvis-mac", number: 404 } }])).error.message, /找不到 Issue fusionseek\/jarvis-mac#404/);
  const draft = await call("applyEdit", { projectId: "P", itemId: "I", changes: [{ op: "setParent", parent: REF }] });
  assert.match(draft.error.message, /草稿还不是 Issue，不能改父 Issue/);
  assert.equal(github.callsOf("ResolveEdit").length, 5, "草稿不去解析");

  github.handlers.ResolveEdit = (variables) => resolveResponse(variables, { target: { __typename: "PullRequest", id: "PR_7", parent: undefined } });
  const pr = await run([{ op: "setIssueState", open: false }]);
  assert.match(pr.error.message, /是 Pull Request，「关闭 Issue」只对 Issue 有效/);
  await value("applyEdit", { projectId: "P", itemId: "I", contentRef: REF, changes: [{ op: "setLabels", add: ["feature"], remove: [] }] }, "projectEngineEditResult");
  assert.deepEqual(inputsOf("addLabelsToLabelable").at(-1), { labelableId: "PR_7", labelIds: ["LA_feature"] }, "PR 也能改标签");

  github.handlers.ResolveEdit = (variables) => {
    const response = resolveResponse(variables);
    response.data.repository.issueTypes = null;
    return response;
  };
  assert.match((await run([{ op: "setIssueType", name: "Bug" }])).error.message, /用不了 Issue Type（只有组织仓库里有）/);
  assert.equal(github.calls.filter((c) => c.via === "mutate" && c.name === "UpdateIssueIssueType").length, 0);
});

test("applyEdit：读回失败不算编辑失败（宿主下次同步校正）", async () => {
  editHandlers();
  github.handlers.ReadItem = () => ({ data: { node: null }, errors: [{ type: "NOT_FOUND", message: "gone" }] });
  const result = await value("applyEdit", { projectId: "P", itemId: "I", changes: [{ op: "clearFieldValue", fieldId: "F" }] }, "projectEngineEditResult");
  assert.deepEqual(result, {});
  assert.equal(github.callsOf("ResolveEdit").length, 0, "只改字段值时不需要认 Issue");
});

// ---------------------------------------------------------------------------
// createField / createOption
// ---------------------------------------------------------------------------

test("createField：交回建好的字段", async () => {
  github.handlers.CreateProjectV2Field = (variables) => ({
    data: {
      createProjectV2Field: {
        projectV2Field: {
          id: "PVTSSF_new",
          name: variables.input.name,
          dataType: "SINGLE_SELECT",
          options: variables.input.singleSelectOptions.map((o, i) => ({ id: `o${i}`, name: o.name, color: o.color, description: "" })),
        },
      },
    },
  });
  const result = await value("createField", { projectId: "PVT_kwHOAA", name: "优先级", dataType: "singleSelect", options: ["P0", "P1"] }, "projectEngineFieldResult");
  assert.deepEqual(result.field, {
    id: "PVTSSF_new",
    name: "优先级",
    dataType: "singleSelect",
    options: [
      { id: "o0", name: "P0", color: "GRAY" },
      { id: "o1", name: "P1", color: "GRAY" },
    ],
  });
  assert.equal(github.callsOf("CreateProjectV2Field")[0].variables.input.dataType, "SINGLE_SELECT");

  github.handlers.CreateProjectV2Field = (variables) => ({ data: { createProjectV2Field: { projectV2Field: { id: "PVTIF_new", name: variables.input.name, dataType: "ITERATION", configuration: { duration: 7, iterations: [], completedIterations: [] } } } } });
  const iteration = await value("createField", { projectId: "PVT_kwHOAA", name: "Sprint", dataType: "iteration", iterationDurationDays: 7 }, "projectEngineFieldResult");
  assert.equal(iteration.field.iterationDurationDays, 7);
  assert.equal(github.callsOf("CreateProjectV2Field")[1].variables.input.iterationConfiguration.iterations.length, 3);
});

const statusField = {
  __typename: "ProjectV2SingleSelectField",
  id: "PVTSSF_status",
  name: "Status",
  dataType: "SINGLE_SELECT",
  options: [
    { id: "f75ad846", name: "待处理", color: "GRAY", description: "还没开始" },
    { id: "98236657", name: "已完成", color: "GREEN", description: "" },
  ],
};

test("createOption：已有选项连 id、名字、颜色、说明原样写回，再接上新的", async () => {
  github.handlers.ReadField = () => ({ data: { node: statusField } });
  github.handlers.UpdateProjectV2Field = (variables) => ({
    data: { updateProjectV2Field: { projectV2Field: { ...statusField, options: variables.input.singleSelectOptions.map((o) => ({ ...o, id: o.id ?? "new1" })) } } },
  });
  const result = await value("createOption", { projectId: "P", fieldId: "PVTSSF_status", name: "待验收" }, "projectEngineFieldResult");
  assert.deepEqual(github.callsOf("UpdateProjectV2Field")[0].variables.input, {
    fieldId: "PVTSSF_status",
    singleSelectOptions: [
      { id: "f75ad846", name: "待处理", color: "GRAY", description: "还没开始" },
      { id: "98236657", name: "已完成", color: "GREEN", description: "" },
      { name: "待验收", color: "GRAY", description: "" },
    ],
  });
  assert.deepEqual(result.field.options.map((o) => o.id), ["f75ad846", "98236657", "new1"]);
});

test("createOption：同名选项已在就不改；多选用 multiSelectOptions；别的类型加不了；id 被换掉时记日志", async () => {
  github.handlers.ReadField = () => ({ data: { node: statusField } });
  const same = await value("createOption", { projectId: "P", fieldId: "PVTSSF_status", name: " 已完成 " }, "projectEngineFieldResult");
  assert.equal(github.callsOf("UpdateProjectV2Field").length, 0);
  assert.equal(same.field.options.length, 2);

  const area = { id: "PVTMSF_area", name: "Area", dataType: "MULTI_SELECT", multiSelectOptions: [{ id: "a1", name: "UI", color: "BLUE", description: "" }] };
  github.handlers.ReadField = () => ({ data: { node: area } });
  github.handlers.UpdateProjectV2Field = (variables) => ({ data: { updateProjectV2Field: { projectV2Field: { ...area, multiSelectOptions: variables.input.multiSelectOptions.map((o, i) => ({ ...o, id: `z${i}` })) } } } });
  const multi = await value("createOption", { projectId: "P", fieldId: "PVTMSF_area", name: "Infra" }, "projectEngineFieldResult");
  assert.deepEqual(Object.keys(github.callsOf("UpdateProjectV2Field")[0].variables.input), ["fieldId", "multiSelectOptions"]);
  assert.equal(multi.field.options.length, 2);
  assert.ok(host.logs.some((log) => log.message.includes("已有选项的 id 变了")), "GitHub 换了 id 时记一条日志（宿主的漂移守卫会接住）");

  github.handlers.ReadField = () => ({ data: { node: { id: "PVTF_target", name: "Target date", dataType: "DATE" } } });
  const date = await call("createOption", { projectId: "P", fieldId: "PVTF_target", name: "x" });
  assert.match(date.error.message, /「Target date」不是单选或多选字段/);
});

// ---------------------------------------------------------------------------
// createIteration（jarvis-mac U-5「在迭代部分，可以选择新增迭代」）
// ---------------------------------------------------------------------------

const sprintField = {
  __typename: "ProjectV2IterationField",
  id: "PVTIF_sprint",
  name: "Sprint",
  dataType: "ITERATION",
  configuration: {
    duration: 14,
    iterations: [{ id: "i42", title: "Sprint 42", startDate: "2026-10-06", duration: 14 }],
    completedIterations: [{ id: "i41", title: "Sprint 41", startDate: "2026-09-22", duration: 14 }],
  },
};

test("createIteration：已结束的迭代也连 id 原样写回，新的按开始日接进去", async () => {
  github.handlers.ReadField = () => ({ data: { node: sprintField } });
  github.handlers.UpdateProjectV2Field = (variables) => {
    const all = variables.input.iterationConfiguration.iterations.map((it) => ({ ...it, id: it.id ?? "i43" }));
    return {
      data: {
        updateProjectV2Field: {
          projectV2Field: { ...sprintField, configuration: { duration: 14, completedIterations: [all[0]], iterations: all.slice(1) } },
        },
      },
    };
  };
  const result = await value(
    "createIteration",
    { projectId: "P", fieldId: "PVTIF_sprint", name: "Sprint 43", startDate: "2026-10-20", iterationDurationDays: 14 },
    "projectEngineFieldResult",
  );
  assert.deepEqual(github.callsOf("UpdateProjectV2Field")[0].variables.input, {
    fieldId: "PVTIF_sprint",
    iterationConfiguration: {
      startDate: "2026-09-22",
      duration: 14,
      iterations: [
        { id: "i41", title: "Sprint 41", startDate: "2026-09-22", duration: 14 },
        { id: "i42", title: "Sprint 42", startDate: "2026-10-06", duration: 14 },
        { title: "Sprint 43", startDate: "2026-10-20", duration: 14 },
      ],
    },
  });
  assert.deepEqual(result.field.iterations.map((it) => it.id), ["i41", "i42", "i43"]);
  assert.equal(result.field.iterations[0].completed, true);
});

test("createIteration：重名、不是迭代字段、日期写错都在发变更之前拦下", async () => {
  github.handlers.ReadField = () => ({ data: { node: sprintField } });
  const duplicate = await call("createIteration", { projectId: "P", fieldId: "PVTIF_sprint", name: " sprint 41 ", startDate: "2026-11-01", iterationDurationDays: 7 });
  assert.match(duplicate.error.message, /已经有叫「sprint 41」的迭代/);
  const badDate = await call("createIteration", { projectId: "P", fieldId: "PVTIF_sprint", name: "Sprint 44", startDate: "11/01", iterationDurationDays: 7 });
  assert.match(badDate.error.message, /YYYY-MM-DD/);
  github.handlers.ReadField = () => ({ data: { node: statusField } });
  const wrongType = await call("createIteration", { projectId: "P", fieldId: "PVTSSF_status", name: "x", startDate: "2026-11-01", iterationDurationDays: 7 });
  assert.match(wrongType.error.message, /「Status」不是迭代字段/);
  assert.equal(github.callsOf("UpdateProjectV2Field").length, 0);
});

test("createIterationInput：空字段从新迭代起算；读不懂的旧迭代不碰", async () => {
  const source = await loadSource();
  const input = source.createIterationInput("F", { duration: 7, iterations: [], completedIterations: [] }, { projectId: "P", fieldId: "F", name: "Iteration 1", startDate: "2026-10-20", iterationDurationDays: 7 });
  assert.deepEqual(input.iterationConfiguration, { startDate: "2026-10-20", duration: 7, iterations: [{ title: "Iteration 1", startDate: "2026-10-20", duration: 7 }] });
  assert.deepEqual(source.existingIterations({ iterations: [{ id: "x", title: "坏的" }] }), [], "缺开始日 / 天数的迭代不写回（读不懂就不碰）");
});

// ---------------------------------------------------------------------------
// createItem（jarvis-mac 第十八轮 AG-1「新建条目」）
// ---------------------------------------------------------------------------

const NEW_ISSUE_URL = "https://github.com/fusionseek/jarvis-mac/issues/130";

/** 新建的 Issue 读回来的样子：没有父子、依赖、标签，也还没有字段值（宿主随后经 applyEdit 写）。 */
const newIssueNode = (id) => ({
  ...issueNode,
  id,
  updatedAt: "2026-10-17T08:00:00Z",
  fieldValues: { nodes: [] },
  content: {
    ...issueNode.content,
    number: 130,
    title: "登录页支持 Passkey",
    url: NEW_ISSUE_URL,
    createdAt: "2026-10-17T08:00:00Z",
    assignees: { nodes: [] },
    labels: { nodes: [] },
    milestone: null,
    issueType: null,
    parent: null,
    blockedBy: { nodes: [] },
    subIssuesSummary: { total: 0, completed: 0 },
  },
});

function createHandlers() {
  github.handlers.RepositoryId = (variables) => ({ data: { repository: { id: `R_${variables.owner}_${variables.name}` } } });
  github.handlers.CreateIssue = () => ({ data: { createIssue: { issue: { id: "I_130", number: 130, url: NEW_ISSUE_URL } } } });
  github.handlers.AddProjectV2ItemById = () => ({ data: { addProjectV2ItemById: { item: { id: "PVTI_new" } } } });
  github.handlers.ReadItem = (variables) => ({ data: { node: newIssueNode(variables.id) } });
}

const createRequest = { projectId: "PVT_kwHOAA", repository: "fusionseek/jarvis-mac", title: "  登录页支持 Passkey ", body: "## 背景\n\n- [ ] 设计稿" };

test("createItem：认出仓库 → 建 Issue → 加进 Project → 读回，交回已在 Project 里的那一条", async () => {
  createHandlers();
  const result = await value("createItem", createRequest, "projectEngineCreatedItem");
  assert.deepEqual(
    github.calls.map((c) => c.name),
    ["RepositoryId", "CreateIssue", "AddProjectV2ItemById", "ReadItem"],
  );
  assert.deepEqual(github.callsOf("RepositoryId")[0].variables, { owner: "fusionseek", name: "jarvis-mac" });
  assert.deepEqual(
    inputsOf("createIssue")[0],
    { repositoryId: "R_fusionseek_jarvis-mac", title: "登录页支持 Passkey", body: "## 背景\n\n- [ ] 设计稿" },
    "标题去掉首尾空白；正文原样",
  );
  assert.deepEqual(inputsOf("addProjectV2ItemById")[0], { projectId: "PVT_kwHOAA", contentId: "I_130" });
  assert.deepEqual(github.callsOf("ReadItem")[0].variables, { id: "PVTI_new" });
  assert.equal(result.item.id, "PVTI_new");
  assert.equal(result.item.contentType, "issue");
  assert.deepEqual(result.item.content, {
    title: "登录页支持 Passkey",
    repository: "fusionseek/jarvis-mac",
    number: 130,
    url: NEW_ISSUE_URL,
    isOpen: true,
    author: "fusionseek",
    createdAt: "2026-10-17T08:00:00Z",
  });

  github.reset();
  createHandlers();
  await value("createItem", { projectId: "P", repository: "fusionseek/jarvis-mac", title: "没有正文" }, "projectEngineCreatedItem");
  assert.deepEqual(inputsOf("createIssue")[0], { repositoryId: "R_fusionseek_jarvis-mac", title: "没有正文" }, "没有正文就不传 body");
});

test("createItem：加进 Project 失败时写明 Issue 已建在哪、编号是多少；宿主的拒绝保留错误码", async () => {
  createHandlers();
  github.handlers.AddProjectV2ItemById = () => ({
    data: { addProjectV2ItemById: null },
    errors: [{ type: "FORBIDDEN", message: "Resource not accessible by integration" }],
  });
  const rejected = await call("createItem", createRequest);
  assert.equal(rejected.ok, false);
  assert.equal(rejected.error.code, "host.failure");
  assert.equal(
    rejected.error.message,
    "Issue #130 已建在 fusionseek/jarvis-mac，但没能加进 Project：GitHub 拒绝了「加进 Project」：Resource not accessible by integration",
  );
  assert.equal(github.callsOf("ReadItem").length, 0, "没加进去就不读回");

  github.handlers.AddProjectV2ItemById = () => {
    throw { code: "permission.denied", message: "没有授权修改 Git 服务数据" };
  };
  const denied = await call("createItem", createRequest);
  assert.deepEqual([denied.ok, denied.error.code], [false, "permission.denied"]);
  assert.equal(denied.error.message, "Issue #130 已建在 fusionseek/jarvis-mac，但没能加进 Project：没有授权修改 Git 服务数据");
});

test("createItem：读回失败不算失败，交回最小的条目（Issue 的身份、标题、链接）", async () => {
  createHandlers();
  github.handlers.ReadItem = () => ({ data: { node: null }, errors: [{ type: "NOT_FOUND", message: "gone" }] });
  const unreadable = await value("createItem", createRequest, "projectEngineCreatedItem");
  const { updatedAt, ...rest } = unreadable.item;
  assert.ok(!Number.isNaN(Date.parse(updatedAt)), "updatedAt 是一个时刻");
  assert.deepEqual(rest, {
    id: "PVTI_new",
    contentType: "issue",
    content: { repository: "fusionseek/jarvis-mac", number: 130, title: "登录页支持 Passkey", isOpen: true, url: NEW_ISSUE_URL },
    values: {},
  });

  github.handlers.ReadItem = () => ({ data: null, errors: [{ type: "RATE_LIMITED", message: "slow down" }] });
  const limited = await value("createItem", createRequest, "projectEngineCreatedItem");
  assert.equal(limited.item.id, "PVTI_new", "读回整个失败也交回最小条目");
  assert.equal(limited.item.content.number, 130);
});

test("createItem：标题为空、仓库不是 owner/name 时什么都不发；找不到仓库时不建 Issue", async () => {
  createHandlers();
  const blank = await call("createItem", { projectId: "P", repository: "fusionseek/jarvis-mac", title: "   " });
  assert.match(blank.error.message, /Issue 标题不能是空的/);
  const badRepository = await call("createItem", { projectId: "P", repository: "jarvis-mac", title: "x" });
  assert.match(badRepository.error.message, /仓库要写成 owner\/name/);
  const tooLong = await call("createItem", { projectId: "P", repository: "fusionseek/jarvis-mac", title: "长".repeat(257) });
  assert.match(tooLong.error.message, /Issue 标题超过 256 字/);
  assert.equal(github.calls.length, 0, "入参不对时一个请求都不发");

  github.handlers.RepositoryId = () => ({ data: { repository: null }, errors: [{ type: "NOT_FOUND", message: "Could not resolve to a Repository" }] });
  const missing = await call("createItem", { projectId: "P", repository: "fusionseek/nope", title: "x" });
  assert.equal(missing.error.message, "找不到仓库 fusionseek/nope（或 token 看不到它）");
  assert.equal(inputsOf("createIssue").length, 0);
});

test("planCreateItem / minimalItem：标题去空白、空正文省略、正文按码点数限 65,536", async () => {
  const source = await loadSource();
  assert.deepEqual(source.planCreateItem({ projectId: "P", repository: "a/b", title: " t ", body: "" }), {
    projectId: "P",
    repository: "a/b",
    owner: "a",
    name: "b",
    title: "t",
  });
  assert.equal(source.planCreateItem({ projectId: "P", repository: "a/b", title: "t", body: "😀".repeat(65_536) }).body.length, 131_072, "按码点数算，不按 UTF-16");
  assert.throws(() => source.planCreateItem({ projectId: "P", repository: "a/b", title: "t", body: "x".repeat(65_537) }), /正文超过 65,536 字/);
  assert.throws(() => source.planCreateItem({ projectId: "", repository: "a/b", title: "t" }), /缺少 projectId/);
  const item = source.minimalItem("PVTI_x", source.planCreateItem({ projectId: "P", repository: "a/b", title: "t" }), { id: "I", number: 7 });
  assert.deepEqual({ ...item, updatedAt: "" }, { id: "PVTI_x", contentType: "issue", updatedAt: "", content: { repository: "a/b", number: 7, title: "t", isOpen: true }, values: {} });
});

// ---------------------------------------------------------------------------
// 收尾：变更的覆盖
// ---------------------------------------------------------------------------

test("测试里真的发出去过的变更 = manifest git.mutations（一个不多、一个不少）", () => {
  assert.deepEqual([...github.usedMutations].sort(), [...declaredMutations].sort());
});

// ---------------------------------------------------------------------------
// addItem（jarvis-mac specs/20261028-191224-git-push-error-proxy-dashboard-issue-links I-1：把已有的 Issue 加进 Project）
// ---------------------------------------------------------------------------

const EXISTING_URL = "https://github.com/fusionseek/jarvis-mac/issues/117";

function addHandlers() {
  github.handlers.IssueId = (variables) =>
    variables.number === 404
      ? { data: { repository: { issue: null } } }
      : { data: { repository: { issue: { id: `I_${variables.number}`, title: "外部的 Issue", url: EXISTING_URL, state: "OPEN" } } } };
  github.handlers.AddProjectV2ItemById = () => ({ data: { addProjectV2ItemById: { item: { id: "PVTI_added" } } } });
  github.handlers.ReadItem = (variables) => ({ data: { node: { ...newIssueNode(variables.id), content: { ...newIssueNode(variables.id).content, number: 117, title: "外部的 Issue", url: EXISTING_URL } } } });
}

const addRequest = { projectId: "PVT_kwHOAA", repository: "fusionseek/jarvis-mac", number: 117 };

test("addItem：认出 Issue → 加进 Project → 读回，交回已在 Project 里的那一条；不写字段", async () => {
  github.reset();
  addHandlers();
  const result = await value("addItem", addRequest, "projectEngineCreatedItem");
  assert.deepEqual(github.calls.map((c) => c.name), ["IssueId", "AddProjectV2ItemById", "ReadItem"]);
  assert.deepEqual(github.callsOf("IssueId")[0].variables, { owner: "fusionseek", name: "jarvis-mac", number: 117 });
  assert.deepEqual(inputsOf("addProjectV2ItemById")[0], { projectId: "PVT_kwHOAA", contentId: "I_117" });
  assert.equal(result.item.id, "PVTI_added");
  assert.equal(result.item.content.number, 117);
  assert.equal(result.item.content.title, "外部的 Issue");
});

test("addItem：找不到（或是 PR）时不加；编号不对什么都不发；读回失败交回最小条目", async () => {
  github.reset();
  addHandlers();
  const missing = await call("addItem", { ...addRequest, number: 404 });
  assert.equal(missing.ok, false);
  assert.match(missing.error.message, /找不到 fusionseek\/jarvis-mac#404/);
  assert.equal(github.callsOf("AddProjectV2ItemById").length, 0);

  github.reset();
  addHandlers();
  const bad = await call("addItem", { ...addRequest, number: 0 });
  assert.equal(bad.ok, false);
  assert.equal(github.calls.length, 0, "入参不对什么都不发");

  github.reset();
  addHandlers();
  github.handlers.ReadItem = () => ({ data: { node: null }, errors: [{ type: "NOT_FOUND", message: "gone" }] });
  const minimal = await value("addItem", addRequest, "projectEngineCreatedItem");
  const { updatedAt, ...rest } = minimal.item;
  assert.ok(!Number.isNaN(Date.parse(updatedAt)));
  assert.deepEqual(rest, {
    id: "PVTI_added",
    contentType: "issue",
    content: { repository: "fusionseek/jarvis-mac", number: 117, title: "外部的 Issue", isOpen: true, url: EXISTING_URL },
    values: {},
  });
});
