/**
 * Clash API 的两头：路径怎么拼、响应怎么读、读数怎么写（纯函数，形状对的是 sing-box 1.14.4 `experimental/clashapi`）。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { loadSource } from "./support.mjs";

const {
  proxyPath,
  delayPath,
  parseDelay,
  parseGroupNow,
  parseConnections,
  trafficRate,
  formatBytes,
  formatRate,
  compactRate,
  formatDelay,
  runLimited,
  randomSecret,
} = await loadSource();

test("路径：名字整段转义，空格、#、@、:、/ 都不会漏进路径", () => {
  assert.equal(proxyPath("节点选择"), "/proxies/%E8%8A%82%E7%82%B9%E9%80%89%E6%8B%A9");
  const path = proxyPath("JMS-1234567@c95s2.example.com:443 #2/备用");
  assert.doesNotMatch(path, /[\s#]/);
  assert.equal(decodeURIComponent(path.slice("/proxies/".length)), "JMS-1234567@c95s2.example.com:443 #2/备用");
  assert.equal(
    delayPath("香港 01", "https://www.gstatic.com/generate_204"),
    "/proxies/%E9%A6%99%E6%B8%AF%2001/delay?url=https%3A%2F%2Fwww.gstatic.com%2Fgenerate_204&timeout=5000",
  );
  assert.ok(!/\/\//.test(delayPath("a", "https://x.example.com/")), "查询串里的 // 也转义了：daemon.request 拒绝带 // 的路径");
});

test("控制口 secret：32 位十六进制", () => {
  assert.match(randomSecret(), /^[0-9a-f]{32}$/);
  assert.equal(randomSecret(() => 0.999), "f".repeat(32));
  assert.notEqual(randomSecret(), randomSecret());
});

test("测速：200 读 delay，超时 / 连不上 / 坏 JSON 为 null", () => {
  assert.equal(parseDelay({ status: 200, text: '{"delay":123}' }), 123);
  assert.equal(parseDelay({ status: 504, text: '{"message":"Timeout"}' }), null);
  assert.equal(parseDelay({ status: 503, text: '{"message":"An error occurred in the delay test"}' }), null);
  assert.equal(parseDelay({ status: 200, text: "oops" }), null);
  assert.equal(parseDelay({ status: 200, text: '{"delay":0}' }), null);
});

test("组此刻选中的组员", () => {
  assert.equal(parseGroupNow({ status: 200, text: '{"type":"URLTest","name":"自动选择","now":"香港 01","all":[]}' }), "香港 01");
  assert.equal(parseGroupNow({ status: 404, text: "" }), null);
  assert.equal(parseGroupNow({ status: 200, text: '{"now":""}' }), null);
});

test("连接快照：域名优先、没有域名用 IP、带端口；坏项跳过", () => {
  const snapshot = parseConnections({
    status: 200,
    text: JSON.stringify({
      downloadTotal: 100,
      uploadTotal: 50,
      connections: [
        { id: "a", metadata: { network: "tcp", host: "www.example.org", destinationIP: "", destinationPort: "443" }, upload: 1, download: 2, start: "2026-10-28T10:00:00Z", chains: ["n1", "节点选择"], rule: "final" },
        { id: "b", metadata: { network: "udp", host: "", destinationIP: "203.0.113.5", destinationPort: "53" }, upload: 0, download: 0, start: "bad", chains: [1, "direct"], rule: "ip_is_private=true => route(direct)" },
        "junk",
      ],
    }),
  });
  assert.equal(snapshot.downloadTotal, 100);
  assert.deepEqual(snapshot.connections.map((c) => [c.host, c.network, c.chains, c.start]), [
    ["www.example.org:443", "tcp", ["n1", "节点选择"], Date.parse("2026-10-28T10:00:00Z")],
    ["203.0.113.5:53", "udp", ["direct"], 0],
  ]);
  assert.equal(parseConnections({ status: 401, text: "" }), null);
});

test("速率：两次快照之差；间隔太短或计数倒退（内核重启过）不给读数", () => {
  assert.equal(trafficRate(null, { at: 1000, upload: 0, download: 0 }), null);
  assert.deepEqual(trafficRate({ at: 0, upload: 0, download: 0 }, { at: 2000, upload: 2048, download: 4096 }), { up: 1024, down: 2048 });
  assert.equal(trafficRate({ at: 0, upload: 0, download: 0 }, { at: 100, upload: 1, download: 1 }), null);
  assert.equal(trafficRate({ at: 0, upload: 100, download: 100 }, { at: 1000, upload: 0, download: 0 }), null);
});

test("读数的写法", () => {
  assert.equal(formatBytes(0), "0 B");
  assert.equal(formatBytes(512), "512 B");
  assert.equal(formatBytes(1536), "1.5 KB");
  assert.equal(formatBytes(36 * 1024 * 1024), "36 MB");
  assert.equal(formatRate(3 * 1024 * 1024), "3.0 MB/s");
  assert.equal(compactRate({ up: 36 * 1024, down: 1.2 * 1024 * 1024 }), "↓1.2M ↑36K");
  assert.equal(compactRate({ up: 0, down: 900 }), "↓900 ↑0");
  assert.ok(compactRate({ up: 1023 * 1024 * 1024, down: 1023 * 1024 * 1024 }).length <= 16, "菜单栏短字 ≤ 16 字");
  assert.equal(formatDelay(undefined), "");
  assert.equal(formatDelay(null), "超时");
  assert.equal(formatDelay(88), "88 ms");
});

test("按并发上限跑：同时在跑的不超过上限，全部跑完", async () => {
  let running = 0;
  let peak = 0;
  const done = [];
  await runLimited([1, 2, 3, 4, 5, 6, 7, 8, 9], 4, async (item) => {
    running += 1;
    peak = Math.max(peak, running);
    await new Promise((resolve) => setImmediate(resolve));
    done.push(item);
    running -= 1;
  });
  assert.equal(peak, 4);
  assert.deepEqual(done.sort((a, b) => a - b), [1, 2, 3, 4, 5, 6, 7, 8, 9]);
  await runLimited([], 4, async () => assert.fail("空列表不该跑"));
});
