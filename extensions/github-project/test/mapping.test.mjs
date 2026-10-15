/**
 * GitHub 的响应 → 项目引擎契约：字段类型、选项、迭代、字段值、条目（Issue / PR / 草稿 / 读不出的）、上限。
 * 形状照 2026-10-15 对 GitHub GraphQL 的只读内省（README「已知边界」）。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { contract, issueNode as issueItem, loadSource } from "./support.mjs";

const source = await loadSource();

test("字段类型：GitHub 的枚举翻成契约的名字，认不出的是 other", () => {
  const pairs = {
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
    TRACKS: "other",
    TRACKED_BY: "other",
    CREATED: "other",
    UPDATED: "other",
    CLOSED: "other",
  };
  for (const [github, name] of Object.entries(pairs)) assert.equal(source.mapDataType(github), name, github);
  assert.equal(source.mapDataType(undefined), "other");
});

test("Project 概要：所有者按组织 / 用户取 login，个数来自 items.totalCount", () => {
  const summary = source.mapProjectSummary({
    id: "PVT_kwHOAA",
    number: 3,
    title: "Jarvis Roadmap",
    url: "https://github.com/users/fusionseek/projects/3",
    closed: false,
    updatedAt: "2026-10-15T04:00:00Z",
    owner: { __typename: "User", login: "fusionseek" },
    items: { totalCount: 1240 },
  });
  assert.deepEqual(summary, {
    id: "PVT_kwHOAA",
    number: 3,
    title: "Jarvis Roadmap",
    owner: "fusionseek",
    url: "https://github.com/users/fusionseek/projects/3",
    itemCount: 1240,
    updatedAt: "2026-10-15T04:00:00Z",
    closed: false,
  });
  assert.deepEqual(contract("projectSummary", summary) ?? [], []);
  assert.equal(source.mapProjectSummary({ number: 1 }), null, "没有 id 的丢掉");
  assert.equal(source.mapProjectSummary({ id: "P", number: 7, title: "" }).title, "Project #7", "空标题用编号顶上");
});

test("字段：单选、多选（multiSelectOptions）、迭代（已结束的标 completed）、Issue Type 用组织的选项", () => {
  const single = source.mapField({
    id: "PVTSSF_status",
    name: "Status",
    dataType: "SINGLE_SELECT",
    options: [
      { id: "f75ad846", name: "待处理", color: "GRAY", description: "" },
      { id: "", name: "坏的" },
      { id: "98236657", name: "已完成", color: "GREEN", description: "x" },
    ],
  });
  assert.deepEqual(single, {
    id: "PVTSSF_status",
    name: "Status",
    dataType: "singleSelect",
    options: [
      { id: "f75ad846", name: "待处理", color: "GRAY" },
      { id: "98236657", name: "已完成", color: "GREEN" },
    ],
  });
  const multi = source.mapField({ id: "PVTMSF_area", name: "Area", dataType: "MULTI_SELECT", multiSelectOptions: [{ id: "a1", name: "UI", color: "BLUE" }] });
  assert.deepEqual(multi.options, [{ id: "a1", name: "UI", color: "BLUE" }]);

  const iteration = source.mapField({
    id: "PVTIF_sprint",
    name: "Sprint",
    dataType: "ITERATION",
    configuration: {
      duration: 14,
      iterations: [{ id: "i43", title: "Sprint 43", startDate: "2026-10-20", duration: 14 }],
      completedIterations: [
        { id: "i42", title: "Sprint 42", startDate: "2026-10-06", duration: 14 },
        { id: "bad", title: "Sprint 0", startDate: "2026-01-01", duration: 0 },
      ],
    },
  });
  assert.deepEqual(iteration, {
    id: "PVTIF_sprint",
    name: "Sprint",
    dataType: "iteration",
    iterations: [
      { id: "i42", title: "Sprint 42", startDate: "2026-10-06", durationDays: 14, completed: true },
      { id: "i43", title: "Sprint 43", startDate: "2026-10-20", durationDays: 14, completed: false },
    ],
    iterationDurationDays: 14,
  });

  const types = [{ id: "IT_feature", name: "Feature" }];
  assert.deepEqual(source.mapField({ id: "PVTF_type", name: "Type", dataType: "ISSUE_TYPE" }, types).options, types);
  assert.equal(source.mapField({ id: "PVTF_type", name: "Type", dataType: "ISSUE_TYPE" }).options, undefined, "用户名下没有 Issue Type：不带选项");
  assert.deepEqual(source.mapField({ id: "PVTF_x", name: "Tracks", dataType: "TRACKS" }), { id: "PVTF_x", name: "Tracks", dataType: "other" });
  for (const field of [single, multi, iteration]) assert.deepEqual(contract("projectField", field) ?? [], []);
});

test("字段值：六种原始值；标签 / 里程碑这类内置值与读不出的跳过", () => {
  const field = { id: "F" };
  const cases = [
    [{ __typename: "ProjectV2ItemFieldTextValue", text: "hello", field }, { text: "hello" }],
    [{ __typename: "ProjectV2ItemFieldNumberValue", number: 5.5, field }, { number: 5.5 }],
    [{ __typename: "ProjectV2ItemFieldDateValue", date: "2026-10-16", field }, { date: "2026-10-16" }],
    [{ __typename: "ProjectV2ItemFieldSingleSelectValue", optionId: "47fc9ee4", field }, { optionId: "47fc9ee4" }],
    [{ __typename: "ProjectV2ItemFieldMultiSelectValue", options: [{ id: "a1" }, { id: "a2" }], field }, { optionIds: ["a1", "a2"] }],
    [{ __typename: "ProjectV2ItemFieldIterationValue", iterationId: "i42", field }, { iterationId: "i42" }],
  ];
  for (const [raw, value] of cases) assert.deepEqual(source.mapFieldValue(raw), { fieldId: "F", value });
  assert.equal(source.mapFieldValue({ __typename: "ProjectV2ItemFieldLabelValue", field }), null);
  assert.equal(source.mapFieldValue({ __typename: "ProjectV2ItemFieldTextValue", text: null, field }), null);
  assert.equal(source.mapFieldValue({ __typename: "ProjectV2ItemFieldTextValue", text: "x" }), null, "没有字段 id");
  assert.equal(source.mapFieldValue({ __typename: "ProjectV2ItemFieldTextValue", text: "x".repeat(3000), field }).value.text.length, 2000);
});

test("条目：Issue 带身份、内容、原始字段值与关系", () => {
  const item = source.mapItem(issueItem);
  assert.deepEqual(item, {
    id: "PVTI_128",
    contentType: "issue",
    updatedAt: "2026-10-15T04:00:00.123Z",
    content: {
      title: "需求列表 · 分类树与父子表格",
      repository: "fusionseek/jarvis-mac",
      number: 128,
      url: "https://github.com/fusionseek/jarvis-mac/issues/128",
      isOpen: true,
      author: "fusionseek",
      labels: ["feature"],
      milestone: "v3.3.0",
      milestoneDueOn: "2026-10-31",
      issueType: "Feature",
      assignees: ["fusionseek"],
      createdAt: "2026-10-10T01:00:00Z",
    },
    values: {
      PVTF_title: { text: "需求列表 · 分类树与父子表格" },
      PVTSSF_status: { optionId: "47fc9ee4" },
      PVTIF_sprint: { iterationId: "i42" },
      PVTF_target: { date: "2026-10-16" },
      PVTF_estimate: { number: 5 },
    },
    relations: {
      parent: { repository: "fusionseek/jarvis-mac", number: 101 },
      blockedBy: [{ repository: "fusionseek/jarvis-mac", number: 126 }],
      subIssueTotal: 3,
      subIssueDone: 1,
    },
  });
  assert.deepEqual(contract("projectItem", item) ?? [], []);
});

test("条目：PR 没有关系；草稿没有身份；读不出内容（REDACTED / 没权限）与缺身份的丢掉", () => {
  const pr = source.mapItem({
    id: "PVTI_pr",
    updatedAt: "2026-10-15T04:00:00Z",
    isArchived: true,
    type: "PULL_REQUEST",
    fieldValues: { nodes: [] },
    content: {
      __typename: "PullRequest",
      number: 7,
      title: "fix",
      url: "https://github.com/a/b/pull/7",
      closed: true,
      closedAt: "2026-10-14T00:00:00Z",
      createdAt: "2026-10-13T00:00:00Z",
      author: null,
      assignees: { nodes: [] },
      labels: { nodes: [] },
      milestone: null,
      repository: { nameWithOwner: "a/b" },
    },
  });
  assert.deepEqual(pr, {
    id: "PVTI_pr",
    contentType: "pullRequest",
    updatedAt: "2026-10-15T04:00:00Z",
    archived: true,
    content: { title: "fix", repository: "a/b", number: 7, url: "https://github.com/a/b/pull/7", isOpen: false, closedAt: "2026-10-14T00:00:00Z", createdAt: "2026-10-13T00:00:00Z" },
  });
  const draft = source.mapItem({
    id: "PVTI_draft",
    updatedAt: "2026-10-14T09:00:00Z",
    type: "DRAFT_ISSUE",
    content: { __typename: "DraftIssue", title: "速记待办同步到 Project", createdAt: "2026-10-14T08:00:00Z", assignees: { nodes: [{ login: "x" }] } },
  });
  assert.deepEqual(draft, {
    id: "PVTI_draft",
    contentType: "draftIssue",
    updatedAt: "2026-10-14T09:00:00Z",
    content: { title: "速记待办同步到 Project", assignees: ["x"], createdAt: "2026-10-14T08:00:00Z" },
  });
  for (const item of [pr, draft]) assert.deepEqual(contract("projectItem", item) ?? [], []);
  assert.equal(source.mapItem({ id: "PVTI_r", updatedAt: "2026-10-14T09:00:00Z", type: "REDACTED", content: null }), null);
  assert.equal(source.mapItem({ ...issueItem, content: { ...issueItem.content, repository: null } }), null, "Issue 缺仓库");
  assert.equal(source.mapItem({ ...issueItem, updatedAt: "yesterday" }), null);
});

test("上限：标题截到 500、指派人 20、标签 50", () => {
  const item = source.mapItem({
    ...issueItem,
    content: {
      ...issueItem.content,
      title: "长".repeat(600),
      assignees: { nodes: Array.from({ length: 30 }, (_, i) => ({ login: `u${i}` })) },
      labels: { nodes: Array.from({ length: 60 }, (_, i) => ({ name: `l${i}` })) },
    },
  });
  assert.equal(Array.from(item.content.title).length, 500);
  assert.equal(item.content.assignees.length, 20);
  assert.equal(item.content.labels.length, 50);
  assert.equal(source.clamp("😀😀😀", 2), "😀😀", "按码点截，不切坏代理对");
});

test("增量过滤串往前多退一天；游标前缀 all: 表示已经回落到全量", () => {
  assert.equal(source.sinceFilter("2026-10-15T09:00:00Z"), "updated:>=2026-10-14");
  assert.equal(source.sinceFilter("2026-03-01T00:30:00+08:00"), "updated:>=2026-02-27", "按 UTC 的那一天再退一天");
  assert.equal(source.sinceFilter(undefined), undefined);
  assert.equal(source.sinceFilter("not a date"), undefined);
  assert.deepEqual(source.planPage({ projectId: "P", cursor: "abc", since: "2026-10-15T09:00:00Z" }), {
    after: "abc",
    filter: "updated:>=2026-10-14",
    fullScan: false,
  });
  assert.deepEqual(source.planPage({ projectId: "P", cursor: "all:abc", since: "2026-10-15T09:00:00Z" }), { after: "abc", filter: undefined, fullScan: true });
});

test("字段值 → GitHub 输入；空的多选改发清空", () => {
  assert.deepEqual(source.fieldValueInput({ optionId: "x" }), { singleSelectOptionId: "x" });
  assert.deepEqual(source.fieldValueInput({ optionIds: ["a"] }), { multiSelectOptionIds: ["a"] });
  assert.equal(source.fieldValueInput({ optionIds: [] }), null);
  assert.deepEqual(source.fieldValueInput({ iterationId: "i" }), { iterationId: "i" });
  assert.deepEqual(source.fieldValueInput({ date: "2026-10-16" }), { date: "2026-10-16" });
  assert.deepEqual(source.fieldValueInput({ number: 0 }), { number: 0 });
  assert.deepEqual(source.fieldValueInput({ text: "" }), { text: "" });
});

test("建字段的输入：选项默认灰色、迭代从今天起排三个", () => {
  assert.deepEqual(source.createFieldInput({ projectId: "P", name: " 优先级 ", dataType: "singleSelect", options: ["P0", " ", "P1"] }), {
    projectId: "P",
    dataType: "SINGLE_SELECT",
    name: "优先级",
    singleSelectOptions: [
      { name: "P0", color: "GRAY", description: "" },
      { name: "P1", color: "GRAY", description: "" },
    ],
  });
  assert.deepEqual(source.createFieldInput({ projectId: "P", name: "Sprint", dataType: "iteration", iterationDurationDays: 7 }, "2026-10-15"), {
    projectId: "P",
    dataType: "ITERATION",
    name: "Sprint",
    iterationConfiguration: {
      startDate: "2026-10-15",
      duration: 7,
      iterations: [
        { title: "Iteration 1", startDate: "2026-10-15", duration: 7 },
        { title: "Iteration 2", startDate: "2026-10-22", duration: 7 },
        { title: "Iteration 3", startDate: "2026-10-29", duration: 7 },
      ],
    },
  });
  assert.equal(source.createFieldInput({ projectId: "P", name: "S", dataType: "iteration" }, "2026-10-15").iterationConfiguration.duration, 14);
  assert.throws(() => source.createFieldInput({ projectId: "P", name: "  ", dataType: "text" }), /字段名/);
  assert.throws(() => source.createFieldInput({ projectId: "P", name: "x", dataType: "labels" }), /建不了/);
  assert.throws(() => source.createFieldInput({ projectId: "P", name: "x", dataType: "iteration", iterationDurationDays: 400 }), /1–365/);
});

test("错误说成人话：缺 scope 与限流有固定的出路", () => {
  assert.match(source.describeErrors([{ type: "INSUFFICIENT_SCOPES", message: "long english" }]), /read:project/);
  assert.match(source.describeErrors([{ type: "RATE_LIMITED", message: "x" }]), /限流/);
  assert.equal(source.describeErrors([{ type: "NOT_FOUND", message: "Could not resolve" }]), "Could not resolve");
  assert.equal(source.describeErrors([]), "GitHub 没有返回数据");
});
