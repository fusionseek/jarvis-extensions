/** 对着构建产物跑：宿主替身经 `code.highlight` 调 `describe / highlight`。 */
import test from "node:test";
import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createTestHost } from "../../../sdk/dist/testing.js";
import { loadSource } from "./support.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const host = createTestHost({});
await import(join(here, "..", "dist", "extension.js"));
const { encode, maximumTokens } = await loadSource();

test("describe：交回认得的全部语言，不要任何授权", async () => {
  const outcome = await host.callService({ point: "code.highlight", service: "syntax", method: "describe", granted: [] });
  assert.equal(outcome.result.ok, true);
  assert.equal(outcome.result.value.languages.length, 20);
  assert.ok(outcome.result.value.languages.includes("swift"));
});

test("highlight：两份文本各自一串三元组，种类只列用到的", async () => {
  const outcome = await host.callService({
    point: "code.highlight", service: "syntax", method: "highlight", granted: [],
    request: { language: "swift", documents: ["let a = 1", "// gone"] },
  });
  assert.deepEqual(outcome.result, { ok: true, value: { kinds: ["keyword", "number", "comment"], documents: [[0, 3, 0, 8, 1, 1], [0, 7, 2]] } });
  assert.equal(host.invocations.filter((call) => call.namespace === "process").length, 0, "纯计算：一个外部命令都不跑");
});

test("不认得的语言交回空记号，不报错", async () => {
  const outcome = await host.callService({
    point: "code.highlight", service: "syntax", method: "highlight", request: { language: "cobol", documents: ["MOVE A TO B"] },
  });
  assert.deepEqual(outcome.result, { ok: true, value: { kinds: [], documents: [[]] } });
});

test("编码：超过上限的记号丢掉，长度为 0 的不交", () => {
  const many = Array.from({ length: maximumTokens + 5 }, (_, i) => ({ start: i, length: 1, kind: "number" }));
  const result = encode([many, [{ start: 0, length: 0, kind: "keyword" }]]);
  assert.equal(result.documents[0].length, maximumTokens * 3);
  assert.deepEqual(result.documents[1], []);
  assert.deepEqual(result.kinds, ["number"]);
});
