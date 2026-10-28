/**
 * 有效流量与成败（jarvis-mac `specs/20261028-111714-proxy-tun-orb-traffic-page-rules` T-6，仓库主人确认过的口径）：
 * 悬浮球外圈的青 / 红两段与球心的两行速率都从这里来（纯逻辑，不碰宿主；时钟由调用方给）。
 *
 * **一条连接一个状态机**，按 sing-box 的连接 id（日志里 `[169851245 0ms]` 那个数）：
 *
 * | 看到 | 记成 |
 * |---|---|
 * | `inbound connection to <host>` | 开始（`from <src>` 那一行给出它的本机源地址，用来与连接快照对上） |
 * | `outbound connection to <host>` | 已经交给出站在拨号 |
 * | `ERROR … connection: open connection to … : <原因>` | **失败**：拨号失败、解析失败、超时、被重置、REALITY 握手失败 |
 * | 开始后 3 秒还没有 `outbound connection` | **失败**：被规则拒绝（sing-box 在 info 级别不给拒绝打日志——实测，见 validation） |
 * | Clash API `/connections` 里同一个源地址的连接拿到过下行字节 | **成功** |
 * | 开始后 10 秒既没失败、也没在快照里看到回包 | 按**成功**计：它没有打开失败，只是还没说话（长连接空闲时的握手） |
 *
 * 发往 53 端口的（TUN 下被劫持的 DNS）不算：它们不经过出站，也不是用户的「交互」。
 *
 * **有效速率** = 两次快照之间累计字节的增量，减去「仍然一个回包都没拿到」的那些连接自己的增量——失败的连接几乎只有上行的那几百字节握手，
 * 不该让一个连不上的节点在球上显示「有流量」。两次快照之间关掉的连接，它们最后那一段落在总量差里、算作有效（它们多半是正常结束的）。
 */
import type { ConnectionsSnapshot } from "./clash.js";

/** 一次连接尝试。 */
export interface Attempt {
  /** sing-box 日志里的连接 id。 */
  id: string;
  /** 本机源地址 `ip:port`；还没看到 `from` 那一行为空串。 */
  source: string;
  /** 目标主机（不带端口）。 */
  host: string;
  port: number;
  /** 进程路径（`router: found process path` 那一行）；不知道为空串。 */
  process: string;
  startedAt: number;
  /** 已经交给出站。 */
  dialing: boolean;
  outcome: "pending" | "succeeded" | "failed";
  /** 判定的时刻；还没判定为 `null`。 */
  settledAt: number | null;
  /** 失败的原因（给「最近请求」看）；成功为空串。 */
  reason: string;
  /** 出站链（最终出站在前），从连接快照补上；不知道为空。 */
  chains: string[];
}

/** 外圈与球心要的读数。 */
export interface TrafficReading {
  upload: number;
  download: number;
  succeeded: number;
  failed: number;
}

/** 日志里一行的样子：级别、连接 id、正文。 */
export interface LogLine {
  level: string;
  id: string;
  text: string;
}

/**
 * 读一行 sing-box 日志：`INFO[0001] [169851245 0ms] inbound/…` 或带时间戳的 `+0800 2026-10-28 11:31:39 INFO [494042012 0ms] …`（颜色码先去掉）。
 * @param line 一行。
 * @returns 级别、id 与正文；不是某条连接的日志为 `null`。
 */
export function parseLogLine(line: string): LogLine | null {
  const plain = line.replace(/\u001b\[[0-9;]*m/g, "");
  const match = /\b(TRACE|DEBUG|INFO|WARN|ERROR|FATAL)\b(?:\[\d+\])?\s*\[(\d+)\s[^\]]*\]\s+(.*)$/.exec(plain);
  if (!match) return null;
  return { level: match[1], id: match[2], text: match[3] };
}

/**
 * `host:port`、`[v6]:port` 拆开。
 * @param value 原文。
 * @returns 主机与端口；端口读不出为 0。
 */
export function splitHostPort(value: string): { host: string; port: number } {
  const bracket = /^\[([^\]]+)\]:(\d+)$/.exec(value);
  if (bracket) return { host: bracket[1].toLowerCase(), port: Number(bracket[2]) };
  const plain = /^(.*):(\d+)$/.exec(value);
  if (plain && !plain[1].includes(":")) return { host: plain[1].toLowerCase(), port: Number(plain[2]) };
  return { host: value.toLowerCase(), port: 0 };
}

/** 计数器的几个时间常数。 */
export interface MeterOptions {
  /** 外圈看最近多久（毫秒）。 */
  windowMs: number;
  /** 开始后多久还没交给出站就算被拒绝。 */
  rejectAfterMs: number;
  /** 开始后多久既没失败也没看见回包就按成功计。 */
  successAfterMs: number;
  /** 记录留多久（「最近请求」与「当前页面」看 30 秒，留 60 秒）。 */
  keepMs: number;
  /** 至多留几条：一秒几百条连接的下载场景里，不让这张表无限长。 */
  maximumAttempts: number;
}

export const defaultMeterOptions: Readonly<MeterOptions> = {
  windowMs: 10_000,
  rejectAfterMs: 3_000,
  successAfterMs: 10_000,
  keepMs: 60_000,
  maximumAttempts: 2_000,
};

/** 一条连接在两次快照之间的字节数。 */
interface Bytes {
  upload: number;
  download: number;
}

export class TrafficMeter {
  private readonly options: MeterOptions;
  /** 连接 id → 尝试，按开始的先后。 */
  private readonly attempts = new Map<string, Attempt>();
  private previousTotals: (Bytes & { at: number }) | null = null;
  private previousConnections = new Map<string, Bytes>();
  private lastRate: { upload: number; download: number } = { upload: 0, download: 0 };

  constructor(options: Partial<MeterOptions> = {}) {
    this.options = { ...defaultMeterOptions, ...options };
  }

  /** 清空（内核停了、换了一个）。 */
  reset(): void {
    this.attempts.clear();
    this.previousTotals = null;
    this.previousConnections.clear();
    this.lastRate = { upload: 0, download: 0 };
  }

  /**
   * 吃进一批日志行。
   * @param lines 行。
   * @param now 现在。
   */
  ingestLines(lines: readonly string[], now: number): void {
    for (const line of lines) {
      const parsed = parseLogLine(line);
      if (!parsed) continue;
      const { id, text } = parsed;
      const inbound = /inbound (?:packet )?connection (from|to) (\S+)$/.exec(text);
      if (inbound && /^inbound\//.test(text)) {
        const attempt = this.attempts.get(id) ?? this.start(id, now);
        if (inbound[1] === "from") attempt.source = inbound[2];
        else {
          const { host, port } = splitHostPort(inbound[2]);
          attempt.host = host;
          attempt.port = port;
        }
        continue;
      }
      const attempt = this.attempts.get(id);
      if (!attempt) continue;
      if (/^outbound\/\S+: outbound (?:packet )?connection to /.test(text)) {
        attempt.dialing = true;
        continue;
      }
      const process = /router: found process path: (.+?)(?:, user: .*)?$/.exec(text);
      if (process) {
        attempt.process = process[1];
        continue;
      }
      const failure = /^connection: open (?:packet )?connection to \S+(?: using \S+)?: (.*)$/.exec(text);
      if (failure && attempt.outcome === "pending") {
        attempt.outcome = "failed";
        attempt.settledAt = now;
        attempt.reason = failure[1];
      }
    }
    this.prune(now);
  }

  /**
   * 吃进一份连接快照：给拿到回包的连接判成功、补上出站链，并算出有效速率。
   * @param snapshot 快照。
   * @param now 现在。
   * @returns 有效速率（字节 / 秒）；第一份、或累计值变小（内核重启过）时为 `null`。
   */
  ingestSnapshot(snapshot: ConnectionsSnapshot, now: number): { upload: number; download: number } | null {
    const bySource = new Map<string, ConnectionsSnapshot["connections"][number]>();
    for (const connection of snapshot.connections) if (connection.source) bySource.set(connection.source, connection);
    for (const attempt of this.attempts.values()) {
      if (!attempt.source) continue;
      const live = bySource.get(attempt.source);
      if (!live) continue;
      if (live.chains.length > 0) attempt.chains = live.chains;
      if (attempt.outcome === "pending" && live.download > 0) {
        attempt.outcome = "succeeded";
        attempt.settledAt = now;
      }
    }
    const current = new Map<string, Bytes>();
    for (const connection of snapshot.connections) current.set(connection.id, { upload: connection.upload, download: connection.download });
    const previous = this.previousTotals;
    const previousConnections = this.previousConnections;
    this.previousTotals = { at: now, upload: snapshot.uploadTotal, download: snapshot.downloadTotal };
    this.previousConnections = current;
    if (!previous) return null;
    const seconds = (now - previous.at) / 1000;
    const totalUp = snapshot.uploadTotal - previous.upload;
    const totalDown = snapshot.downloadTotal - previous.download;
    if (seconds < 0.2 || totalUp < 0 || totalDown < 0) return null;
    let silentUp = 0;
    let silentDown = 0;
    for (const connection of snapshot.connections) {
      if (connection.download > 0) continue;
      const before = previousConnections.get(connection.id) ?? { upload: 0, download: 0 };
      silentUp += Math.max(0, connection.upload - before.upload);
      silentDown += Math.max(0, connection.download - before.download);
    }
    this.lastRate = { upload: Math.max(0, totalUp - silentUp) / seconds, download: Math.max(0, totalDown - silentDown) / seconds };
    return this.lastRate;
  }

  /**
   * 此刻的读数：最近一次算出的有效速率，与最近一个窗口里判定了的成败数。
   * @param now 现在。
   * @returns 读数。
   */
  reading(now: number): TrafficReading {
    this.settleByTime(now);
    let succeeded = 0;
    let failed = 0;
    for (const attempt of this.attempts.values()) {
      if (attempt.settledAt === null || now - attempt.settledAt > this.options.windowMs) continue;
      if (attempt.outcome === "succeeded") succeeded += 1;
      else if (attempt.outcome === "failed") failed += 1;
    }
    return { upload: this.lastRate.upload, download: this.lastRate.download, succeeded, failed };
  }

  /**
   * 最近的尝试，新的在前（「最近请求」与「当前页面」用）。
   * @param now 现在。
   * @param limit 至多几条。
   * @returns 尝试（拷贝）。
   */
  recent(now: number, limit: number): Attempt[] {
    this.settleByTime(now);
    const out: Attempt[] = [];
    const list = [...this.attempts.values()];
    for (let index = list.length - 1; index >= 0 && out.length < limit; index -= 1) {
      const attempt = list[index];
      if (attempt.host) out.push({ ...attempt, chains: [...attempt.chains] });
    }
    return out;
  }

  private start(id: string, now: number): Attempt {
    const attempt: Attempt = { id, source: "", host: "", port: 0, process: "", startedAt: now, dialing: false, outcome: "pending", settledAt: null, reason: "", chains: [] };
    this.attempts.set(id, attempt);
    return attempt;
  }

  /** 按时间判：3 秒没交给出站 = 被拒绝；10 秒没失败 = 成功。DNS 不算，直接丢掉。 */
  private settleByTime(now: number): void {
    for (const [id, attempt] of this.attempts) {
      if (attempt.port === 53) {
        this.attempts.delete(id);
        continue;
      }
      if (attempt.outcome !== "pending") continue;
      const age = now - attempt.startedAt;
      if (!attempt.dialing && age >= this.options.rejectAfterMs) {
        attempt.outcome = "failed";
        attempt.settledAt = attempt.startedAt + this.options.rejectAfterMs;
        attempt.reason = "被规则拒绝";
      } else if (attempt.dialing && age >= this.options.successAfterMs) {
        attempt.outcome = "succeeded";
        attempt.settledAt = attempt.startedAt + this.options.successAfterMs;
      }
    }
  }

  /** 删掉过期的、超出条数的（Map 按插入顺序，最旧的在前）。 */
  private prune(now: number): void {
    for (const [id, attempt] of this.attempts) {
      const old = now - attempt.startedAt > this.options.keepMs;
      if (!old && this.attempts.size <= this.options.maximumAttempts) break;
      this.attempts.delete(id);
    }
  }
}

/**
 * 菜单栏标题这一段攒够了没有：攒够 `interval` 个点（每秒一个）就交回平均值，否则 `null`（W-2：「更新频率可以调整，1 秒 - 60 秒之间」）。
 * @param window 这一段攒下的和与个数。
 * @param interval 偏好 `speedInterval`（1–60 秒）。
 * @returns 平均有效速率；还没攒够为 `null`。
 */
export function titleAverage(window: { upload: number; download: number; count: number }, interval: number): { upload: number; download: number } | null {
  const needed = Math.min(60, Math.max(1, Math.round(interval)));
  if (window.count < needed) return null;
  return { upload: window.upload / window.count, download: window.download / window.count };
}

/**
 * 菜单栏那两行的速率写法：**恰好 4 个字符**（jarvis-mac `specs/20261028-130540-proxy-walkthrough-fixes` W-2）——
 * 一律以 K 为最小单位、1024 进位，不足 4 位左侧补空格：`0.0K`、`0.5K`、`1.2K`、` 34K`、`512K`、`1.2M`、` 12M`、`1.1G`。
 *
 * 仓库主人：「数字一直在跳，这块改成固定 4 个字符显示」。宿主用等宽字体画这两行，字数不变宽度就不变；
 * 上一版 `shortRate` 是 1–4 个字符（`0`、`512`、`34K`），状态项宽度跟着读数伸缩。
 * @param bytesPerSecond 字节 / 秒。
 * @returns 4 个字符。
 */
export function fixedRate(bytesPerSecond: number): string {
  const units = ["K", "M", "G", "T"];
  let value = Math.max(0, Number.isFinite(bytesPerSecond) ? bytesPerSecond : 0) / 1024;
  let unit = 0;
  // 进位看的是「写出来的数」：9.96K 四舍五入成 10.0 已经是 5 个字符，得写成 ` 10K`；999.6K 写出来是 1000，得进到 M。
  while (Math.round(value) >= 1000 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const digits = Math.round(value * 10) / 10 < 10 ? (Math.round(value * 10) / 10).toFixed(1) : `${Math.min(999, Math.round(value))}`;
  return `${digits}${units[unit]}`.padStart(4, " ");
}

/**
 * 球心那两行的速率写法：至多 4 个字符——`0`、`512`、`34K`、`1.2M`、`12M`、`1.1G`（宿主画，这里给悬停提示与菜单用同一种写法）。
 * @param bytesPerSecond 字节 / 秒。
 * @returns 短字。
 */
export function shortRate(bytesPerSecond: number): string {
  const units = ["", "K", "M", "G", "T"];
  let value = Math.max(0, bytesPerSecond);
  let unit = 0;
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  if (unit === 0) return `${Math.round(value)}`;
  return `${value < 10 ? (Math.round(value * 10) / 10).toString() : Math.round(value)}${units[unit]}`;
}
