/**
 * 测试共用的东西（不是测试文件，`node --test test/*.test.mjs` 不会把它当测试跑）：
 *
 * 1. `loadSource()`：把 `src/` 的纯模块现编成 ESM 直接 import（产物是 IIFE，内部函数从服务那一面看不到）。
 * 2. `graphQLOperation()`：宿主闸门 `GitHostingGraphQLPolicy.operation` 的 JS 移植——一份文档恰好一个操作、
 *    片段定义可以有、顶层不许片段展开、按别名之后的真名取顶层字段。**每一份发出去的文档都过它**，
 *    并按宿主的规则判：查询走 `query`，变更的顶层字段都在 manifest `git.mutations` 里。
 * 3. `fakeGitHub()`：线缆另一端的 GitHub：按操作名把请求交给每条测试自己摆的处理函数，记下发过的每一份。
 * 4. `contract()`：本机有 jarvis-mac 时，用宿主的 `bridge.v2.schema.json` 校验引擎交回的东西；没有时跳过（CI 只有本仓库）。
 *
 * **从不访问真的 GitHub。**
 */
import { build } from "esbuild";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
export const extensionRoot = join(here, "..");
const repositoryRoot = join(extensionRoot, "..", "..");
const require = createRequire(import.meta.url);

/** manifest。 */
export const manifest = JSON.parse(readFileSync(join(extensionRoot, "extension.json"), "utf8"));
/** manifest 声明的变更。 */
export const declaredMutations = new Set(manifest.git.mutations);

/**
 * 现编 `src/` 的纯模块。
 * @returns 模块命名空间。
 */
export async function loadSource() {
  const result = await build({
    stdin: {
      contents: [
        'export * from "./src/limits.ts";',
        'export * from "./src/mapping.ts";',
        'export * from "./src/documents.ts";',
        'export { planResolve, fieldValueInput, refKey, changeTitle } from "./src/edit.ts";',
        'export { sinceFilter, planPage, fullScanPrefix } from "./src/items.ts";',
        'export { createFieldInput, iterationConfiguration, existingOptions } from "./src/fields.ts";',
        'export { describeErrors } from "./src/graphql.ts";',
      ].join("\n"),
      resolveDir: extensionRoot,
      loader: "ts",
      sourcefile: "test-entry.ts",
    },
    bundle: true,
    format: "esm",
    platform: "neutral",
    target: ["es2020"],
    write: false,
    logLevel: "silent",
    alias: { "@fusionseek/jarvis-extension-sdk": join(repositoryRoot, "sdk", "src", "index.ts") },
  });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`);
}

// ---------------------------------------------------------------------------
// 宿主闸门的移植（jarvis-mac Sources/Jarvis/Domain/GitHosting/GitHostingGraphQL.swift）
// ---------------------------------------------------------------------------

function tokenize(document) {
  const tokens = [];
  let i = 0;
  const isNameStart = (c) => /[_A-Za-z]/.test(c);
  const isName = (c) => /[_0-9A-Za-z]/.test(c);
  while (i < document.length) {
    const c = document[i];
    if (c === "#") {
      while (i < document.length && document[i] !== "\n") i += 1;
      continue;
    }
    if (/\s/.test(c) || c === "," || c === "﻿") {
      i += 1;
      continue;
    }
    if (c === '"') {
      if (document.startsWith('"""', i)) {
        const end = document.indexOf('"""', i + 3);
        if (end < 0) throw new Error("块字符串没有结束");
        i = end + 3;
      } else {
        i += 1;
        while (i < document.length && document[i] !== '"') {
          if (document[i] === "\\") i += 1;
          if (document[i] === "\n") throw new Error("字符串里换行");
          i += 1;
        }
        if (i >= document.length) throw new Error("字符串没有结束");
        i += 1;
      }
      tokens.push({ value: true });
      continue;
    }
    if (c === "$" || c === "-" || /[0-9]/.test(c)) {
      i += 1;
      while (i < document.length && (isName(document[i]) || ".+-".includes(document[i]))) i += 1;
      tokens.push({ value: true });
      continue;
    }
    if (isNameStart(c)) {
      let name = "";
      while (i < document.length && isName(document[i])) name += document[i++];
      tokens.push({ name });
      continue;
    }
    if (c === ".") {
      if (!document.startsWith("...", i)) throw new Error("孤立的「.」");
      tokens.push({ punct: "..." });
      i += 3;
      continue;
    }
    if ("{}()[]:=@!|&".includes(c)) {
      tokens.push({ punct: c });
      i += 1;
      continue;
    }
    throw new Error(`认不出的字符「${c}」`);
  }
  return tokens;
}

const isPunct = (token, p) => token?.punct === p;

function skip(tokens, open, left, right) {
  let depth = 0;
  for (let i = open; i < tokens.length; i += 1) {
    if (isPunct(tokens[i], left)) depth += 1;
    if (isPunct(tokens[i], right)) {
      depth -= 1;
      if (depth === 0) return i + 1;
    }
  }
  throw new Error("括号不配对");
}

/**
 * 认出一份文档的操作（与宿主同一套规则）。
 * @param document GraphQL 文档。
 * @returns `{ kind, name, fields }`：`name` 是操作名（没有为 `undefined`），`fields` 是顶层字段的真名。
 */
export function graphQLOperation(document) {
  if (!document.trim()) throw new Error("GraphQL 文档是空的");
  if (Buffer.byteLength(document) > 64 * 1024) throw new Error("GraphQL 文档超过 64 KB");
  const tokens = tokenize(document);
  const operations = [];
  let index = 0;
  while (index < tokens.length) {
    const token = tokens[index];
    if (token.name === "fragment") {
      const open = tokens.findIndex((t, i) => i > index && isPunct(t, "{"));
      if (open < 0) throw new Error("片段没有选择集");
      index = skip(tokens, open, "{", "}");
      continue;
    }
    if (["query", "mutation", "subscription"].includes(token.name) || isPunct(token, "{")) {
      const kind = token.name === "mutation" ? "mutation" : token.name === "subscription" ? "subscription" : "query";
      const name = tokens[index + 1]?.name;
      let open = index;
      while (open < tokens.length && !isPunct(tokens[open], "{")) {
        open = isPunct(tokens[open], "(") ? skip(tokens, open, "(", ")") : open + 1;
      }
      if (open >= tokens.length) throw new Error("操作没有选择集");
      const fields = [];
      let i = open + 1;
      for (;;) {
        const t = tokens[i];
        if (!t) throw new Error("选择集没有结束");
        if (isPunct(t, "}")) {
          i += 1;
          break;
        }
        if (isPunct(t, "...")) throw new Error("顶层不支持片段展开");
        if (!t.name) throw new Error("选择集里意外的符号");
        let field = t.name;
        if (isPunct(tokens[i + 1], ":") && tokens[i + 2]?.name) {
          field = tokens[i + 2].name;
          i += 2;
        }
        fields.push(field);
        i += 1;
        if (isPunct(tokens[i], "(")) i = skip(tokens, i, "(", ")");
        while (isPunct(tokens[i], "@") && tokens[i + 1]?.name) {
          i += 2;
          if (isPunct(tokens[i], "(")) i = skip(tokens, i, "(", ")");
        }
        if (isPunct(tokens[i], "{")) i = skip(tokens, i, "{", "}");
      }
      operations.push({ kind, name: kind === "query" && isPunct(token, "{") ? undefined : name, fields });
      index = i;
      continue;
    }
    throw new Error("意外的符号");
  }
  if (operations.length !== 1) throw new Error(operations.length ? "一份文档只能有一个操作" : "没有操作");
  return operations[0];
}

// ---------------------------------------------------------------------------
// 假的 GitHub（线缆另一端）
// ---------------------------------------------------------------------------

/**
 * 一个按操作名路由的假 GitHub。处理函数拿到 `variables`，返回 GraphQL 响应（`{ data, errors? }`）。
 * 宿主闸门的判定在这里照做：读能力只放行查询；写能力只放行声明过的变更。
 * @returns `{ stubs, calls, usedMutations, handlers, viewer }`。
 */
export function fakeGitHub() {
  const github = {
    /** 每一次请求：`{ via, kind, name, fields, variables, query }`。 */
    calls: [],
    /** 测试里真的发出去过的变更名。 */
    usedMutations: new Set(),
    /** 操作名 → `(variables, call) => 响应`。 */
    handlers: {},
    /** `git.hosting.viewer` 的结果；是函数时调用它（可以抛错）。 */
    viewer: { login: "fusionseek", scopes: ["repo", "project"], projectAccess: "readWrite" },
    reset() {
      github.calls.length = 0;
      github.handlers = {};
    },
    /** 某个操作名的请求。 */
    callsOf(name) {
      return github.calls.filter((call) => call.name === name);
    },
  };
  const handle = (via) => async (params) => {
    if (params.hosting !== undefined && !manifest.contributes.git.hosting.includes(params.hosting)) {
      throw { code: "capability.undeclared", message: `contributes.git.hosting · ${params.hosting}` };
    }
    let operation;
    try {
      operation = graphQLOperation(params.query);
    } catch (error) {
      throw { code: "invalid.argument", message: `GraphQL 文档读不懂：${error.message}` };
    }
    if (via === "query" && operation.kind !== "query") throw { code: "invalid.argument", message: "git.hosting.read 只能执行查询" };
    if (operation.kind === "subscription") throw { code: "invalid.argument", message: "不支持订阅" };
    if (operation.kind === "mutation") {
      const undeclared = operation.fields.filter((field) => !declaredMutations.has(field));
      if (undeclared.length) throw { code: "capability.undeclared", message: `manifest 没有声明这些变更：${undeclared.join("、")}` };
      for (const field of operation.fields) github.usedMutations.add(field);
    }
    const call = { via, ...operation, variables: params.variables ?? {}, query: params.query };
    github.calls.push(call);
    const handler = github.handlers[operation.name];
    if (!handler) throw { code: "host.failure", message: `假 GitHub 没有处理 ${operation.name}` };
    return handler(call.variables, call);
  };
  github.stubs = {
    "git.hosting.viewer": async () => (typeof github.viewer === "function" ? github.viewer() : github.viewer),
    "git.hosting.query": handle("query"),
    "git.hosting.mutate": handle("mutate"),
  };
  return github;
}

/** 一条与 GitHub 同形的 Issue 条目。 */
export const issueNode = {
  id: "PVTI_128",
  updatedAt: "2026-10-15T04:00:00.123Z",
  isArchived: false,
  type: "ISSUE",
  fieldValues: {
    nodes: [
      { __typename: "ProjectV2ItemFieldTextValue", text: "需求列表 · 分类树与父子表格", field: { id: "PVTF_title" } },
      { __typename: "ProjectV2ItemFieldSingleSelectValue", optionId: "47fc9ee4", field: { id: "PVTSSF_status" } },
      { __typename: "ProjectV2ItemFieldIterationValue", iterationId: "i42", field: { id: "PVTIF_sprint" } },
      { __typename: "ProjectV2ItemFieldDateValue", date: "2026-10-16", field: { id: "PVTF_target" } },
      { __typename: "ProjectV2ItemFieldNumberValue", number: 5, field: { id: "PVTF_estimate" } },
      { __typename: "ProjectV2ItemFieldLabelValue" },
    ],
  },
  content: {
    __typename: "Issue",
    number: 128,
    title: "需求列表 · 分类树与父子表格",
    url: "https://github.com/fusionseek/jarvis-mac/issues/128",
    closed: false,
    createdAt: "2026-10-10T01:00:00Z",
    closedAt: null,
    author: { login: "fusionseek" },
    assignees: { nodes: [{ login: "fusionseek" }] },
    labels: { nodes: [{ name: "feature" }] },
    milestone: { title: "v3.3.0", dueOn: "2026-10-31T07:00:00Z" },
    issueType: { name: "Feature" },
    repository: { nameWithOwner: "fusionseek/jarvis-mac" },
    parent: { number: 101, repository: { nameWithOwner: "fusionseek/jarvis-mac" } },
    blockedBy: { nodes: [{ number: 126, repository: { nameWithOwner: "fusionseek/jarvis-mac" } }] },
    subIssuesSummary: { total: 3, completed: 1 },
  },
};

/** 变更的通用成功响应。 */
export const ok = (field) => ({ data: { [field]: { clientMutationId: null } } });

// ---------------------------------------------------------------------------
// 宿主的契约（有就校验，没有就跳过）
// ---------------------------------------------------------------------------

const bridgeSchemaPath = join(repositoryRoot, "..", "jarvis-mac", "contracts", "schemas", "extensions", "bridge.v2.schema.json");
let validators = null;

/**
 * 用宿主的 bridge schema 校验一个返回值。本机没有 jarvis-mac（例如 CI）时返回 `null`。
 * @param def `$defs` 里的名字，例如 `projectEngineItems`。
 * @param value 引擎交回的值。
 * @returns 错误列表（空 = 通过）；跳过时为 `null`。
 */
export function contract(def, value) {
  if (!existsSync(bridgeSchemaPath)) return null;
  if (!validators) {
    const Ajv = require("ajv/dist/2020.js");
    const addFormats = require("ajv-formats");
    const ajv = new Ajv({ allErrors: true, strict: false });
    addFormats(ajv);
    const schema = JSON.parse(readFileSync(bridgeSchemaPath, "utf8"));
    ajv.addSchema(schema);
    validators = { ajv, id: schema.$id };
  }
  const validate = validators.ajv.getSchema(`${validators.id}#/$defs/${def}`);
  if (!validate) return [`bridge schema 里没有 $defs/${def}`];
  return validate(value) ? [] : validate.errors.map((error) => `${error.instancePath || "/"} ${error.message}`);
}
