/**
 * 有效流量与成败（T-6，仓库主人确认过的口径）：日志行怎么读、一条连接的状态机、按连接快照判成功、有效速率扣掉「一个回包都没拿到」的那些。
 *
 * 日志行照 sing-box 1.14.4 实测的原样写（带 / 不带时间戳两种），见 jarvis-mac 本期 validation。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { loadSource } from "./support.mjs";

const { TrafficMeter, parseLogLine, splitHostPort, shortRate } = await loadSource();

/** 一条连接的几行日志（`timestamp: true` 的写法）。 */
const lines = (id, source, target, { dial = true, process = "/Applications/Google Chrome.app/Contents/Frameworks/Google Chrome Framework.framework/Helpers/Google Chrome Helper.app/Contents/MacOS/Google Chrome Helper" } = {}) => [
  `+0800 2026-10-28 11:31:39 INFO [${id} 0ms] inbound/mixed[mixed-in]: inbound connection from ${source}`,
  `+0800 2026-10-28 11:31:39 INFO [${id} 0ms] inbound/mixed[mixed-in]: inbound connection to ${target}`,
  `+0800 2026-10-28 11:31:39 INFO [${id} 2ms] router: found process path: ${process}, user: Fusion`,
  ...(dial ? [`+0800 2026-10-28 11:31:39 INFO [${id} 2ms] outbound/vless[c95s5]: outbound connection to ${target}`] : []),
];

const snapshot = (connections, totals) => ({
  uploadTotal: totals.upload,
  downloadTotal: totals.download,
  connections: connections.map((connection, index) => ({ id: `uuid-${index}`, host: "", network: "tcp", rule: "final", chains: ["c95s5", "节点选择"], start: 0, process: "", ...connection })),
});

test("日志行：两种写法都认；不是某条连接的行为 null", () => {
  assert.deepEqual(parseLogLine("INFO[0001] [169851245 0ms] inbound/mixed[mixed-in]: inbound connection to example.com:443"), {
    level: "INFO",
    id: "169851245",
    text: "inbound/mixed[mixed-in]: inbound connection to example.com:443",
  });
  assert.equal(parseLogLine("\u001b[31mERROR\u001b[0m[0006] [3568306026 5.0s] connection: open connection to 10.255.255.1:81 using outbound/direct[d]: dial tcp 10.255.255.1:81: i/o timeout").id, "3568306026");
  assert.equal(parseLogLine("+0800 2026-10-28 11:31:38 INFO sing-box started (0.00s)"), null);
  assert.deepEqual(splitHostPort("[2001:db8::1]:443"), { host: "2001:db8::1", port: 443 });
  assert.deepEqual(splitHostPort("Example.COM:80"), { host: "example.com", port: 80 });
});

test("失败：拨号报错的那条立刻记失败、带原因", () => {
  const meter = new TrafficMeter();
  meter.ingestLines([...lines("1", "127.0.0.1:50001", "no-such.example:443"), "ERROR[0001] [1 47ms] connection: open connection to no-such.example:443 using outbound/direct[direct]: lookup no-such.example: NXDOMAIN"], 1000);
  assert.deepEqual(meter.reading(1100), { upload: 0, download: 0, succeeded: 0, failed: 1 });
  const [attempt] = meter.recent(1100, 5);
  assert.equal(attempt.outcome, "failed");
  assert.equal(attempt.reason, "lookup no-such.example: NXDOMAIN");
  assert.match(attempt.process, /Google Chrome Helper$/);
});

test("被规则拒绝：3 秒还没交给出站就记失败（sing-box 不给拒绝打日志）", () => {
  const meter = new TrafficMeter();
  meter.ingestLines(lines("2", "127.0.0.1:50002", "ads.example.com:443", { dial: false }), 0);
  assert.equal(meter.reading(2900).failed, 0);
  assert.equal(meter.reading(3000).failed, 1);
  assert.equal(meter.recent(3000, 1)[0].reason, "被规则拒绝");
});

test("成功：快照里同一个源地址拿到过回包；没说话的 10 秒后按成功计；DNS 不算", () => {
  const meter = new TrafficMeter();
  meter.ingestLines([...lines("3", "127.0.0.1:50003", "github.com:443"), ...lines("4", "127.0.0.1:50004", "idle.example.com:443"), ...lines("5", "172.19.0.1:50005", "172.19.0.2:53")], 0);
  meter.ingestSnapshot(snapshot([{ source: "127.0.0.1:50003", upload: 500, download: 9000 }, { source: "127.0.0.1:50004", upload: 300, download: 0 }], { upload: 800, download: 9000 }), 1000);
  const first = meter.reading(1000);
  assert.equal(first.succeeded, 1, "拿到回包的那条");
  assert.equal(first.failed, 0);
  assert.deepEqual(meter.recent(1000, 5).find((attempt) => attempt.host === "github.com").chains, ["c95s5", "节点选择"], "出站链从快照补上");
  assert.equal(meter.reading(10_000).succeeded, 2, "10 秒没失败的按成功计");
  assert.ok(!meter.recent(10_000, 10).some((attempt) => attempt.port === 53), "劫持的 DNS 不进统计");
  assert.equal(meter.reading(21_000).succeeded, 0, "窗口 10 秒，过了就不算");
});

test("有效速率：总量差减去一个回包都没拿到的连接的增量；第一份快照没有读数；累计值变小不给读数", () => {
  const meter = new TrafficMeter();
  assert.equal(meter.ingestSnapshot(snapshot([], { upload: 0, download: 0 }), 0), null);
  const rate = meter.ingestSnapshot(
    snapshot(
      [
        { id: "ok", source: "127.0.0.1:1", upload: 1000, download: 2_000_000 },
        { id: "silent", source: "127.0.0.1:2", upload: 600, download: 0 },
      ],
      { upload: 1600 + 400, download: 2_000_000 + 48_000 },
    ),
    2000,
  );
  assert.deepEqual(rate, { upload: (2000 - 600) / 2, download: 2_048_000 / 2 }, "关掉的连接那一段（400 / 48000）算有效");
  assert.equal(meter.ingestSnapshot(snapshot([], { upload: 0, download: 0 }), 3000), null, "内核重启过");
  assert.equal(meter.reading(3000).download, 2_048_000 / 2, "读数留着上一次的");
});

test("记录有上限：超过的从最旧的删", () => {
  const meter = new TrafficMeter({ maximumAttempts: 3 });
  for (let index = 0; index < 5; index += 1) meter.ingestLines(lines(String(index), `127.0.0.1:${50000 + index}`, `h${index}.example.com:443`), index);
  assert.deepEqual(meter.recent(10, 10).map((attempt) => attempt.host), ["h4.example.com", "h3.example.com", "h2.example.com"]);
});

test("球心的短写：至多 4 个字符", () => {
  assert.equal(shortRate(0), "0");
  assert.equal(shortRate(512), "512");
  assert.equal(shortRate(34 * 1024), "34K");
  assert.equal(shortRate(1.2 * 1024 * 1024), "1.2M");
  assert.equal(shortRate(12 * 1024 * 1024), "12M");
  assert.equal(shortRate(1.1 * 1024 ** 3), "1.1G");
  for (const value of [0, 999, 1000, 1023, 9.96 * 1024, 999 * 1024, 1024 ** 3 * 999]) assert.ok(shortRate(value).length <= 4, `${value} → ${shortRate(value)}`);
});
