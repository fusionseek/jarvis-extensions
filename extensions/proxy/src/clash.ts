/**
 * sing-box 的 Clash API：路径怎么拼、响应怎么读、读数怎么写（纯函数，不碰宿主）。
 *
 * 请求一律经 `jarvis.daemon.request` 发往 sing-box 自己的控制口（P-4），这里只管两头的形状。
 * 每一处形状都对过 sing-box 1.14.4 源码 `experimental/clashapi/{configs,proxies,connections}.go`：
 *
 * - `PATCH /configs {"mode": …}`：模式名按大小写不敏感匹配模式表，204；
 * - `PUT /proxies/{name} {"name": …}`：只对 selector 有效，选中不存在的组员 400，成功 204；
 * - `GET /proxies/{name}/delay?url=&timeout=`：成功 `{"delay": n}`，超时 504，连不上 503；`url` 以 `http://` 开头时被丢弃改用默认地址，
 *   `timeout` 按 int16 解析（≤ 32767 毫秒）；
 * - `GET /proxies/{name}`：组带 `now`（此刻选中的组员）；
 * - `GET /connections`：`{ downloadTotal, uploadTotal, connections: [...] }` 的快照（不升级成长连接时）。
 *
 * 路径里的名字用 `encodeURIComponent`：节点名里常有空格、`#`、`@`、`:`、`/`——`daemon.request` 拒绝带空白与 `#` 的路径，
 * 而 sing-box 的路由按转义后的原样路径切段（chi 走 `RawPath`），再 `PathUnescape` 出名字，`%2F` 不会被当成分隔符。
 */

/** manifest `process.daemons[].id`。 */
export const DAEMON_ID = "sing-box";

/**
 * Clash API 请求的发送方：系统代理模式经 `daemon.request`，TUN 经 `tunnel.request`（SDK 2.10）。两者形状相同，只差有没有 `id`。
 */
export type ClashTransport = (request: {
  method: "GET" | "PUT" | "PATCH";
  path: string;
  headers: { Authorization?: string; "Content-Type"?: string };
  body?: string;
  timeout: number;
}) => Promise<{ status: number; headers: Record<string, string>; text: string }>;

/**
 * 控制口的 secret：32 位十六进制。JavaScriptCore 里没有保证可用的 `crypto.getRandomValues`，用 `Math.random`——
 * 控制口只听 127.0.0.1，secret 挡的是同机别的程序顺手调它，不是要对抗能读这台机器内存的人。
 * @param random 随机源（测试注入）。
 * @returns secret。
 */
export function randomSecret(random: () => number = Math.random): string {
  let secret = "";
  for (let index = 0; index < 32; index += 1) secret += Math.floor(random() * 16).toString(16);
  return secret;
}

/** 单个节点测速的超时（毫秒）。5 秒：比 sing-box urltest 默认的更宽一点，慢节点也有个读数，而不是一律「超时」。 */
export const delayTimeoutMs = 5000;

/** 同时在测的节点数。4：一次测完几十个节点只要十几秒，又不至于让控制口与本机网络一下子挤满几十条握手。 */
export const delayConcurrency = 4;

/**
 * 一个出站的路径。
 * @param name 出站 tag。
 * @returns `/proxies/<转义后的名字>`。
 */
export function proxyPath(name: string): string {
  return `/proxies/${encodeURIComponent(name)}`;
}

/**
 * 测一个出站延迟的路径。
 * @param name 出站 tag。
 * @param url 测速地址。
 * @param timeoutMs 超时毫秒。
 * @returns 路径（含查询串）。
 */
export function delayPath(name: string, url: string, timeoutMs: number = delayTimeoutMs): string {
  return `${proxyPath(name)}/delay?url=${encodeURIComponent(url)}&timeout=${Math.round(timeoutMs)}`;
}

/** 控制口响应的最小形状（与 `DaemonResponse` 相同）。 */
export interface ClashResponse {
  status: number;
  text: string;
}

/**
 * 解析 JSON；坏了为 `null`。
 * @param text 正文。
 * @returns 值或 `null`。
 */
function parseJSON(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * @param value 任意值。
 * @returns 是不是普通对象。
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * 读一次测速的结果。
 * @param response 控制口响应。
 * @returns 毫秒；超时、连不上、读不出为 `null`。
 */
export function parseDelay(response: ClashResponse): number | null {
  if (response.status !== 200) return null;
  const body = parseJSON(response.text);
  const delay = isRecord(body) ? body.delay : undefined;
  return typeof delay === "number" && Number.isFinite(delay) && delay > 0 ? Math.round(delay) : null;
}

/**
 * 读一个策略组此刻选中的组员（`GET /proxies/{name}` 的 `now`）。
 * @param response 控制口响应。
 * @returns 组员 tag；读不出为 `null`。
 */
export function parseGroupNow(response: ClashResponse): string | null {
  if (response.status !== 200) return null;
  const body = parseJSON(response.text);
  const now = isRecord(body) ? body.now : undefined;
  return typeof now === "string" && now.length > 0 ? now : null;
}

/** 一条连接（`GET /connections` 里的一项，只留界面用得上的）。 */
export interface ConnectionInfo {
  id: string;
  /** 域名（嗅探到的或请求里的）；没有时为 `IP:端口`。 */
  host: string;
  network: string;
  /** 命中的规则，形如 `rule_set=geosite-cn => route(direct)`，兜底为 `final`。 */
  rule: string;
  /** 出站链，从策略组到最终出站（sing-box 给的顺序是最终出站在前）。 */
  chains: string[];
  upload: number;
  download: number;
  /** 建立时刻，Unix 毫秒；读不出为 0。 */
  start: number;
  /** 本机源地址 `ip:port`（与日志里 `inbound connection from` 那一行对得上）；读不出为空串。 */
  source: string;
  /** 进程路径（`route.find_process` 开着时才有；末尾「 (用户名)」已去掉）；读不出为空串。 */
  process: string;
}

/** 一份连接快照。 */
export interface ConnectionsSnapshot {
  uploadTotal: number;
  downloadTotal: number;
  connections: ConnectionInfo[];
}

/**
 * 读连接快照。
 * @param response 控制口响应。
 * @returns 快照；读不出为 `null`。
 */
export function parseConnections(response: ClashResponse): ConnectionsSnapshot | null {
  if (response.status !== 200) return null;
  const body = parseJSON(response.text);
  if (!isRecord(body)) return null;
  const number = (value: unknown): number => (typeof value === "number" && Number.isFinite(value) ? value : 0);
  const string = (value: unknown): string => (typeof value === "string" ? value : "");
  const list = Array.isArray(body.connections) ? body.connections : [];
  const connections: ConnectionInfo[] = [];
  for (const item of list) {
    if (!isRecord(item)) continue;
    const metadata = isRecord(item.metadata) ? item.metadata : {};
    const domain = string(metadata.host);
    const port = string(metadata.destinationPort);
    const address = domain || string(metadata.destinationIP);
    const started = Date.parse(string(item.start));
    connections.push({
      id: string(item.id),
      host: address && port ? `${address}:${port}` : address,
      network: string(metadata.network),
      rule: string(item.rule),
      chains: Array.isArray(item.chains) ? item.chains.filter((chain): chain is string => typeof chain === "string") : [],
      upload: number(item.upload),
      download: number(item.download),
      start: Number.isFinite(started) ? started : 0,
      source: sourceOf(string(metadata.sourceIP), string(metadata.sourcePort)),
      process: processOf(string(metadata.processPath)),
    });
  }
  return { uploadTotal: number(body.uploadTotal), downloadTotal: number(body.downloadTotal), connections };
}

/**
 * 源地址写成日志里那种 `ip:port`（IPv6 加方括号）。
 * @param ip 源 IP。
 * @param port 源端口。
 * @returns 地址；缺一样为空串。
 */
export function sourceOf(ip: string, port: string): string {
  if (!ip || !port) return "";
  return ip.includes(":") ? `[${ip}]:${port}` : `${ip}:${port}`;
}

/**
 * sing-box 报的进程路径末尾带「 (用户名)」（`/usr/bin/curl (Fusion)`，实测 1.14.4）：去掉它。
 * @param value 原文。
 * @returns 路径。
 */
export function processOf(value: string): string {
  return value.replace(/ \([^()]*\)$/, "");
}

/** 一次流量读数：累计上下行字节与读的时刻。 */
export interface TrafficSample {
  at: number;
  upload: number;
  download: number;
}

/** 速率（字节 / 秒）。 */
export interface TrafficRate {
  up: number;
  down: number;
}

/**
 * 两次快照之间的速率。
 *
 * 累计值变小（sing-box 重启过）或两次读的间隔不到 200 毫秒（同一拍读了两次）时不给读数：
 * 前者算出来是负数，后者分母太小、一个包就能把读数顶到几十 MB/s。
 * @param previous 上一次。
 * @param next 这一次。
 * @returns 速率；算不出为 `null`。
 */
export function trafficRate(previous: TrafficSample | null, next: TrafficSample): TrafficRate | null {
  if (!previous) return null;
  const seconds = (next.at - previous.at) / 1000;
  if (seconds < 0.2) return null;
  const up = next.upload - previous.upload;
  const down = next.download - previous.download;
  if (up < 0 || down < 0) return null;
  return { up: up / seconds, down: down / seconds };
}

/** 二进制单位：与 Clash 系客户端、活动监视器的「网络」一致。 */
const units = ["B", "KB", "MB", "GB", "TB"] as const;

/**
 * 字节数的写法：`0 B`、`512 B`、`1.2 KB`、`36 MB`。
 * @param bytes 字节。
 * @returns 读数。
 */
export function formatBytes(bytes: number): string {
  let value = Math.max(0, bytes);
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  if (unit === 0) return `${Math.round(value)} B`;
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}

/**
 * 速率的写法（页面上）：`1.2 MB/s`。
 * @param bytesPerSecond 字节 / 秒。
 * @returns 读数。
 */
export function formatRate(bytesPerSecond: number): string {
  return `${formatBytes(bytesPerSecond)}/s`;
}


/**
 * 延迟的写法。
 * @param delay 毫秒；`null` = 测过但超时 / 连不上；`undefined` = 没测过。
 * @returns `123 ms`、`超时`，没测过为空串。
 */
export function formatDelay(delay: number | null | undefined): string {
  if (delay === undefined) return "";
  return delay === null ? "超时" : `${delay} ms`;
}

/**
 * 按并发上限跑一组异步任务，每完成一个回调一次（界面据此一个个亮起读数，而不是等全部测完）。
 * @param items 输入。
 * @param limit 同时在跑的上限（≥ 1）。
 * @param work 每一项的任务；抛错由调用方在 `work` 里自己接住。
 * @returns 全部完成时兑现。
 */
export async function runLimited<T>(items: readonly T[], limit: number, work: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const lane = async (): Promise<void> => {
    while (next < items.length) {
      const item = items[next];
      next += 1;
      await work(item);
    }
  };
  const lanes: Promise<void>[] = [];
  for (let index = 0; index < Math.max(1, Math.min(limit, items.length)); index += 1) lanes.push(lane());
  await Promise.all(lanes);
}
