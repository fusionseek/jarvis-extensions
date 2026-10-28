/**
 * 存储的形状：节点切块、订阅记录、用量头、自动更新的日程。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { loadSource, jmsSubscription } from "./support.mjs";

const {
  parseSubscription,
  chunkNodes,
  utf8Length,
  maximumChunkBytes,
  headerValue,
  parseSubscriptionUserinfo,
  subscriptionId,
  subscriptionHost,
  digest,
  nodesDigest,
  isUpdateDue,
  nextRecord,
  maximumSkippedPerSubscription,
  formatAge,
  describeUsage,
} = await loadSource();

const jmsNodes = parseSubscription(jmsSubscription).nodes;

test("UTF-8 字节数：中文 3 字节、emoji 4 字节", () => {
  assert.equal(utf8Length("abc"), 3);
  assert.equal(utf8Length("香港"), 6);
  assert.equal(utf8Length("🇭🇰"), 8);
  assert.equal(utf8Length("é"), 2);
});

test("节点切块：每块（按 JSON 的 UTF-8 字节）不超过上限、顺序不变、一个不丢", () => {
  const many = Array.from({ length: 600 }, (_, index) => ({ ...jmsNodes[index % jmsNodes.length], name: `香港 ${index} 号节点` }));
  const chunks = chunkNodes(many);
  assert.ok(chunks.length > 1, "几百个节点一块装不下");
  for (const chunk of chunks) assert.ok(Buffer.byteLength(JSON.stringify(chunk), "utf8") <= maximumChunkBytes);
  assert.deepEqual(chunks.flat(), many);
  assert.deepEqual(chunkNodes([]), []);
  const huge = { ...jmsNodes[0], name: "大".repeat(30000) };
  assert.deepEqual(chunkNodes([huge, jmsNodes[1]], 1024), [[huge], [jmsNodes[1]]], "自己就超过上限的节点单独成块，不丢");
});

test("Subscription-Userinfo：不分大小写取头，秒换成毫秒", () => {
  const headers = { "Content-Type": "text/plain", "Subscription-Userinfo": "upload=1024; download=2048; total=10737418240; expire=1798732800" };
  assert.equal(headerValue(headers, "subscription-userinfo"), headers["Subscription-Userinfo"]);
  assert.deepEqual(parseSubscriptionUserinfo(headers["Subscription-Userinfo"]), { upload: 1024, download: 2048, total: 10737418240, expire: 1798732800000 });
  assert.deepEqual(parseSubscriptionUserinfo("upload=0;download=5"), { upload: 0, download: 5, total: 0, expire: null });
  assert.equal(parseSubscriptionUserinfo("hello"), null);
  assert.equal(parseSubscriptionUserinfo(undefined), null);
});

test("订阅 id 与主机：存储里不出现带 token 的地址", () => {
  const url = "https://jmssub.example.com/members/getsub.php?service=123&id=synthetic-token";
  const id = subscriptionId(url);
  assert.match(id, /^[0-9a-f]{16}$/);
  assert.equal(subscriptionId(` ${url} `), id, "前后空白不算不同");
  assert.notEqual(subscriptionId(url + "x"), id);
  assert.ok(!id.includes("synthetic"));
  assert.equal(subscriptionHost(url), "jmssub.example.com");
  assert.equal(subscriptionHost("https://user:pass@[2001:db8::1]:8443/sub"), "[2001:db8::1]");
  assert.equal(subscriptionHost("not a url"), "订阅");
  assert.equal(digest("a"), digest("a"));
  assert.notEqual(nodesDigest(jmsNodes), nodesDigest(jmsNodes.slice(1)));
});

test("自动更新的日程：到点才拉；失败后 30 分钟再试；不自动就永远不拉", () => {
  const hour = 60 * 60 * 1000;
  const fresh = { lastAttemptAt: null, lastSuccessAt: null };
  assert.equal(isUpdateDue(fresh, "daily", 0), true, "从没拉过：马上拉");
  assert.equal(isUpdateDue(fresh, "never", 0), false);
  const ok = { lastAttemptAt: 0, lastSuccessAt: 0 };
  assert.equal(isUpdateDue(ok, "6h", 5 * hour), false);
  assert.equal(isUpdateDue(ok, "6h", 6 * hour), true);
  assert.equal(isUpdateDue(ok, "daily", 23 * hour), false);
  const failed = { lastAttemptAt: 30 * hour, lastSuccessAt: 0 };
  assert.equal(isUpdateDue(failed, "daily", 30 * hour + 10 * 60 * 1000), false, "刚失败过，等 30 分钟");
  assert.equal(isUpdateDue(failed, "daily", 30 * hour + 31 * 60 * 1000), true);
});

test("订阅记录：成功换新、失败留旧只记原因、认不出的行截到上限", () => {
  const url = "https://sub.example.com/a?token=x";
  const skipped = Array.from({ length: 50 }, (_, index) => ({ line: `junk ${index}`, reason: "不是分享链接" }));
  const first = nextRecord(undefined, url, 1, { ok: true, format: "base64", nodes: jmsNodes, skipped, usage: null }, 1, 1000);
  assert.deepEqual(
    { id: first.id, host: first.host, position: first.position, format: first.format, nodeCount: first.nodeCount, chunks: first.chunks, fetchedAt: first.fetchedAt, error: first.error },
    { id: subscriptionId(url), host: "sub.example.com", position: 1, format: "base64", nodeCount: 6, chunks: 1, fetchedAt: 1000, error: null },
  );
  assert.equal(first.skipped.length, maximumSkippedPerSubscription);
  assert.equal(first.skippedTotal, 50);

  const failed = nextRecord(first, url, 2, { ok: false, error: "服务器回了 HTTP 403" }, 0, 2000);
  assert.equal(failed.nodeCount, 6, "失败时节点留着上一次的");
  assert.equal(failed.chunks, 1);
  assert.equal(failed.fetchedAt, 1000);
  assert.equal(failed.attemptedAt, 2000);
  assert.equal(failed.position, 2);
  assert.equal(failed.error, "服务器回了 HTTP 403");

  const empty = nextRecord(first, url, 1, { ok: false, error: "没有认出任何节点", skipped: [{ line: "<html>", reason: "收到的是网页" }] }, 0, 3000);
  assert.deepEqual(empty.skipped, [{ line: "<html>", reason: "收到的是网页" }], "没认出节点时把认不出的行换成这一次的，好让人看见为什么");
  assert.equal(empty.nodeCount, 6);
});

test("读数：多久以前、用量与到期", () => {
  assert.equal(formatAge(0, 30 * 1000), "刚刚");
  assert.equal(formatAge(0, 5 * 60 * 1000), "5 分钟前");
  assert.equal(formatAge(0, 3 * 3600 * 1000), "3 小时前");
  assert.equal(formatAge(0, 72 * 3600 * 1000), "3 天前");
  const usage = { upload: 1 * 1024 ** 3, download: 2 * 1024 ** 3, total: 500 * 1024 ** 3, expire: new Date(2027, 0, 1).getTime() };
  assert.equal(describeUsage(usage), "已用 3.0 GB / 500 GB · 2027-01-01 到期");
  assert.equal(describeUsage({ upload: 0, download: 12 * 1024 ** 3, total: 0, expire: null }), "已用 12 GB");
});
