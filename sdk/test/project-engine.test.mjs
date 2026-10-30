import test from "node:test";
import assert from "node:assert/strict";
import { createTestHost } from "../dist/testing.js";

// project.engine 的分派与 Git 操作域的命名空间：入参从 params.request 来，方法名照线缆上的原样。
const seen = [];
const host = createTestHost({
  async: {
    "git.repositories": async () => [{ name: "jarvis-mac", host: "github.com", repository: "fusionseek/jarvis-mac" }],
    "git.hosting.viewer": async (params) => {
      seen.push({ method: "viewer", params });
      return { login: "fusionseek", scopes: ["repo", "project"], projectAccess: "readWrite" };
    },
    "git.hosting.query": async (params) => {
      seen.push({ method: "query", params });
      return { data: { viewer: { login: "fusionseek" } } };
    },
    "git.hosting.mutate": async (params) => {
      seen.push({ method: "mutate", params });
      return { data: null, errors: [{ message: "nope", type: "FORBIDDEN" }] };
    },
  },
});
const { defineExtension, jarvis, JarvisError, sdkVersion, capabilityTiers } = await import("../dist/index.js");

let cancelled = false;
let releaseItems;
let createItemRequest;
let addItemRequest;

defineExtension({
  services: {
    github: {
      describe: (context) => ({
        contractVersion: 1,
        ready: context.granted.includes("git.hosting.read"),
        summary: "ok",
        hosting: "github",
        features: ["createFields"],
      }),
      listProjects: async (request) => ({ projects: [{ id: "P", number: 1, title: request.owner ?? "viewer", owner: "o", url: "u" }] }),
      readSchema: async (request) => ({ project: { id: request.projectId, number: 1, title: "T", owner: "o", url: "u" }, fields: [] }),
      readItems: async (request, _context, signal) => {
        if (request.cursor === "wait") {
          await new Promise((resolve) => {
            releaseItems = resolve;
            signal.onCancel(() => {
              cancelled = true;
              resolve();
            });
          });
        }
        return { items: [], nextCursor: request.cursor === "wait" ? undefined : "next", totalCount: 0 };
      },
      applyEdit: async (request) => {
        if (request.changes[0].op === "boom") throw new JarvisError({ code: "invalid.argument", message: "不认识的一步" });
        if (request.changes[0].op === "crash") throw new Error("GitHub 拒绝了");
        return {};
      },
      createField: async (request) => ({ field: { id: "F", name: request.name, dataType: request.dataType } }),
      // createOption 故意不实现：宿主应收到 capability.unknown。
      createIteration: async (request) => ({
        field: { id: request.fieldId, name: "Sprint", dataType: "iteration", iterations: [{ id: "I", title: request.name, startDate: request.startDate, durationDays: request.iterationDurationDays, completed: false }] },
      }),
      createItem: async (request) => {
        createItemRequest = request;
        return {
          item: {
            id: "PVTI_new",
            contentType: "issue",
            updatedAt: "2026-10-17T00:00:00Z",
            content: { repository: request.repository, number: 7, title: request.title, isOpen: true },
            values: {},
          },
        };
      },
      // jarvis-mac specs/20261028-191224-git-push-error-proxy-dashboard-issue-links I-1：把已有的 Issue 加进 Project。
      addItem: async (request) => {
        addItemRequest = request;
        return {
          item: {
            id: "PVTI_added",
            contentType: "issue",
            updatedAt: "2026-10-28T00:00:00Z",
            content: { repository: request.repository, number: request.number, title: "已有的 Issue", isOpen: true },
            values: {},
          },
        };
      },
    },
  },
});

const call = (method, request, granted = ["git.hosting.read"]) =>
  host.callService({ point: "project.engine", service: "github", method, granted, ...(request ? { request } : {}) });

test("SDK 版本与 Git 操作域的档位", () => {
  assert.equal(sdkVersion, "2.12.0");
  assert.equal(capabilityTiers["git.repository.read"], "medium");
  assert.equal(capabilityTiers["git.hosting.read"], "medium");
  assert.equal(capabilityTiers["git.hosting.write"], "high");
});

test("describe 拿到宿主给的授权；没有 request 也能调", async () => {
  const outcome = await call("describe");
  assert.deepEqual(outcome.result, {
    ok: true,
    value: { contractVersion: 1, ready: true, summary: "ok", hosting: "github", features: ["createFields"] },
  });
  const denied = await call("describe", undefined, []);
  assert.equal(denied.result.value.ready, false);
});

test("各方法的入参来自 params.request", async () => {
  assert.equal((await call("listProjects", { owner: "fusionseek" })).result.value.projects[0].title, "fusionseek");
  assert.equal((await call("listProjects")).result.value.projects[0].title, "viewer");
  assert.equal((await call("readSchema", { projectId: "PVT_1" })).result.value.project.id, "PVT_1");
  assert.equal((await call("readItems", { projectId: "PVT_1" })).result.value.nextCursor, "next");
  assert.equal((await call("readItems", { projectId: "PVT_1", itemIds: ["PVTI_1"] })).result.value.nextCursor, "next", "itemIds（SDK 2.6）随 params.request 原样交给 readItems");
  assert.deepEqual((await call("createField", { projectId: "PVT_1", name: "估点", dataType: "number" })).result.value, {
    field: { id: "F", name: "估点", dataType: "number" },
  });
  const iteration = await call("createIteration", { projectId: "PVT_1", fieldId: "IT", name: "Sprint 43", startDate: "2026-10-20", iterationDurationDays: 14 });
  assert.equal(iteration.result.value.field.iterations[0].title, "Sprint 43", "createIteration（SDK 2.2）按 params.request 分派");
  const createRequest = { projectId: "PVT_1", repository: "fusionseek/jarvis-mac", title: "新建条目", body: "正文" };
  const created = await call("createItem", createRequest);
  assert.deepEqual(createItemRequest, createRequest, "createItem（SDK 2.3）按 params.request 分派，可选的 body 原样转交");
  assert.deepEqual(created.result.value.item.content, { repository: "fusionseek/jarvis-mac", number: 7, title: "新建条目", isOpen: true });
  const addRequest = { projectId: "PVT_1", repository: "fusionseek/jarvis-mac", number: 117 };
  const added = await call("addItem", addRequest);
  assert.deepEqual(addItemRequest, addRequest, "addItem 按 params.request 分派");
  assert.equal(added.result.value.item.id, "PVTI_added");
  assert.equal(added.result.value.item.content.number, 117);
});

test("抛出的 JarvisError 原样交回，别的错误变成 host.failure；没实现的方法是 capability.unknown", async () => {
  const boom = await call("applyEdit", { projectId: "P", itemId: "I", changes: [{ op: "boom" }] });
  assert.deepEqual(boom.result.error, { code: "invalid.argument", message: "不认识的一步" });
  const crash = await call("applyEdit", { projectId: "P", itemId: "I", changes: [{ op: "crash" }] });
  assert.deepEqual(crash.result.error, { code: "host.failure", message: "GitHub 拒绝了" });
  const missing = await call("createOption", { projectId: "P", fieldId: "F", name: "x" });
  assert.equal(missing.result.error.code, "capability.unknown");
});

test("serviceCancel 触发项目引擎的取消信号", async () => {
  const callId = host.nextCallId;
  const pending = call("readItems", { projectId: "P", cursor: "wait" });
  await host.settle();
  host.cancelService(callId);
  const outcome = await pending;
  assert.equal(cancelled, true);
  assert.equal(outcome.result.ok, true);
  assert.equal(typeof releaseItems, "function");
});

test("jarvis.git 按 namespace = git、method = hosting.* 上线缆；部分成功原样交回", async () => {
  assert.deepEqual(await jarvis.git.repositories(), [{ name: "jarvis-mac", host: "github.com", repository: "fusionseek/jarvis-mac" }]);
  assert.equal((await jarvis.git.hosting.viewer()).projectAccess, "readWrite");
  const response = await jarvis.git.hosting.query({ query: "query { viewer { login } }", variables: { a: 1 } });
  assert.deepEqual(response, { data: { viewer: { login: "fusionseek" } } });
  const mutation = await jarvis.git.hosting.mutate({ hosting: "github", query: "mutation { x }" });
  assert.equal(mutation.errors[0].type, "FORBIDDEN");
  assert.deepEqual(
    seen.map((entry) => [entry.method, entry.params]),
    [
      ["viewer", {}],
      ["query", { query: "query { viewer { login } }", variables: { a: 1 } }],
      ["mutate", { hosting: "github", query: "mutation { x }" }],
    ],
  );
  const keys = host.invocations.map((request) => `${request.namespace}.${request.method}`);
  assert.ok(keys.includes("git.hosting.viewer") && keys.includes("git.hosting.query") && keys.includes("git.hosting.mutate"));
});
