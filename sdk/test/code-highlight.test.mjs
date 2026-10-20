import test from "node:test";
import assert from "node:assert/strict";
import { createTestHost } from "../dist/testing.js";

// Git 的代码高亮（SDK 2.8）：code.highlight 的服务分派。
const host = createTestHost({});
const { defineExtension } = await import("../dist/index.js");

defineExtension({
  services: {
    syntax: {
      describe() {
        return { languages: ["swift"] };
      },
      highlight(request) {
        return { kinds: ["keyword"], documents: request.documents.map((text) => (text.startsWith("let") ? [0, 3, 0] : [])) };
      },
    },
  },
});

test("code.highlight · describe：语言清单经 service.resolve 交回", async () => {
  const outcome = await host.callService({ point: "code.highlight", service: "syntax", method: "describe" });
  assert.deepEqual(outcome.result, { ok: true, value: { languages: ["swift"] } });
});

test("code.highlight · highlight：入参原样交给实现，同步交回也行", async () => {
  const outcome = await host.callService({
    point: "code.highlight", service: "syntax", method: "highlight",
    request: { language: "swift", documents: ["let a = 1", "var b = 2"] },
  });
  assert.deepEqual(outcome.result, { ok: true, value: { kinds: ["keyword"], documents: [[0, 3, 0], []] } });
});

test("code.highlight 不认识的方法：交回 capability.unknown", async () => {
  const outcome = await host.callService({ point: "code.highlight", service: "syntax", method: "format" });
  assert.equal(outcome.result.ok, false);
  assert.equal(outcome.result.error.code, "capability.unknown");
});
