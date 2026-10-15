/**
 * GraphQL 文档：过宿主闸门的规则、变更名与 manifest `git.mutations` 逐字对应、用户的值只进变量。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { declaredMutations, graphQLOperation, loadSource, manifest } from "./support.mjs";

const source = await loadSource();

const queries = {
  ListViewerProjects: source.listViewerProjects,
  ListOwnerProjects: source.listOwnerProjects,
  ListRepositoryProjects: source.listRepositoryProjects,
  ReadSchema: source.readSchema,
  OrganizationIssueTypes: source.organizationIssueTypes,
  ReadItems: source.readItems,
  ReadItemsSince: source.readItemsSince,
  ReadItem: source.readItem,
  ReadField: source.readField,
};

test("每一份查询都是恰好一个具名查询（可以带片段），过得了宿主的读闸门", () => {
  for (const [name, document] of Object.entries(queries)) {
    const operation = graphQLOperation(document);
    assert.equal(operation.kind, "query", name);
    assert.equal(operation.name, name);
  }
});

test("每一份变更只有一个顶层字段，就是它的名字；变更集合与 manifest git.mutations 逐字相同", () => {
  const names = Object.keys(source.mutations);
  for (const name of names) {
    const operation = graphQLOperation(source.mutations[name].document);
    assert.equal(operation.kind, "mutation");
    assert.deepEqual(operation.fields, [name]);
  }
  assert.deepEqual([...names].sort(), [...declaredMutations].sort(), "代码会发的变更 = manifest 声明的变更，一个不多一个不少");
  assert.equal(manifest.git.mutations.length, 16);
});

test("宿主闸门的移植：顶层片段展开、两个操作、订阅都被认出来", () => {
  assert.throws(() => graphQLOperation("mutation { ...F } fragment F on Mutation { closeIssue(input: {}) { clientMutationId } }"), /片段展开/);
  assert.throws(() => graphQLOperation("query A { viewer { login } } query B { viewer { login } }"), /一个操作/);
  assert.equal(graphQLOperation("subscription { x }").kind, "subscription");
  assert.deepEqual(graphQLOperation("mutation { a: closeIssue(input: {issueId: \"x\"}) { clientMutationId } b: reopenIssue(input: {}) { x } }").fields, [
    "closeIssue",
    "reopenIssue",
  ]);
});

test("解析查询：用户给的名字只进变量；别名与变量名是生成的", () => {
  const plan = source.planResolve({ repository: "fusionseek/jarvis-mac", number: 128 }, [
    { op: "setLabels", add: ['bug"} evil'], remove: ["wontfix"] },
    { op: "setMilestone", title: "v3.3.0" },
    { op: "setIssueType", name: "Feature" },
    { op: "setAssignees", logins: ["Alice", "alice", "bob"] },
    { op: "setParent", parent: { repository: "fusionseek/jarvis-mac", number: 101 } },
    { op: "addBlockedBy", ref: { repository: "fusionseek/jarvis-mac", number: 126 } },
    { op: "removeBlockedBy", ref: { repository: "FUSIONSEEK/jarvis-mac", number: 126 } },
  ]);
  const operation = graphQLOperation(plan.document);
  assert.equal(operation.kind, "query");
  assert.equal(operation.name, "ResolveEdit");
  assert.deepEqual(operation.fields, ["repository", "user", "user", "repository", "repository"]);
  assert.ok(!plan.document.includes("evil") && !plan.document.includes("v3.3.0") && !plan.document.includes("Alice"));
  assert.equal(plan.variables.l0, 'bug"} evil');
  assert.equal(plan.variables.l1, "wontfix");
  assert.equal(plan.variables.milestone, "v3.3.0");
  assert.deepEqual([plan.variables.u0, plan.variables.u1], ["Alice", "bob"], "登录名不分大小写去重");
  assert.equal(plan.refs.size, 2, "同一条 Issue（仓库名不分大小写）只解析一次");
  assert.deepEqual([plan.variables.r1Owner, plan.variables.r1Name, plan.variables.r1Number], ["fusionseek", "jarvis-mac", 126]);
  assert.ok(plan.milestones && plan.issueTypes);
});

test("只改字段值时解析查询里没有多余的东西", () => {
  const plan = source.planResolve({ repository: "a/b", number: 1 }, [{ op: "setIssueState", open: false }]);
  assert.deepEqual(graphQLOperation(plan.document).fields, ["repository"]);
  assert.deepEqual(plan.variables, { owner: "a", name: "b", number: 1 });
});
