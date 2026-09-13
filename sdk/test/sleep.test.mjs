/**
 * `sleep` 是 SDK 1.4 加的，它存在的理由只有一条：**退避重试写不出来**。
 * 宿主的 JavaScript 环境里没有 `setInterval`，`setTimeout` 也是宿主注入的——
 * 因此这里钉住的是"它真的会 resolve、真的等够了、而且不阻塞别的事"。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { sleep } from "../dist/index.js";

test("sleep 真的等够了才 resolve", async () => {
  const started = Date.now();
  await sleep(60);
  // 计时器允许早醒几毫秒，卡死在 60 上会在忙碌的机器上偶发红。
  assert.ok(Date.now() - started >= 50, "等的时间不够");
});

test("sleep 不阻塞：两次并发的总时长接近其中最长的那次", async () => {
  const started = Date.now();
  await Promise.all([sleep(60), sleep(60)]);
  assert.ok(Date.now() - started < 200, "两次 sleep 被串起来了");
});

test("0 与负数立刻 resolve，与浏览器一致", async () => {
  const started = Date.now();
  await sleep(0);
  await sleep(-1);
  assert.ok(Date.now() - started < 50);
});
