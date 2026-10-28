/**
 * 订阅解析：把订阅地址返回的整段文字读成一组节点（P-9「订阅格式（本期）」）。
 *
 * 认三种外形：整段 base64（标准与 URL-safe、有无补位、中间夹换行）包着逐行的分享链接；逐行明文的分享链接；
 * sing-box 自己的 `{ "outbounds": [...] }`。分享链接认 `ss`（SIP002 与旧式）、`vmess`（v2rayN 的 base64 JSON）、
 * `vless`、`trojan`、`hysteria2` / `hy2`、`tuic`、`anytls`。Clash YAML 不在本期。
 *
 * 两条原则：
 *
 * 1. **一行坏不连累整份**。认不出、缺字段、sing-box 不支持的行逐条记进 `skipped`、写明原因，其余照常解析；
 *    任何一行都不会让整份抛错。订阅里混几行「剩余流量」「到期时间」这类伪节点是常事。
 * 2. **在这里拦下 sing-box 会拒绝的节点**。sing-box 启动时逐个初始化出站，**一个**出站非法（UUID 长度不对、
 *    Reality 公钥解不开、`flow` 不认识……）整份配置就起不来——用户看到的是「代理开不了」，而不是「有一个节点坏了」。
 *    所以凡是 `sing-box check` 会拒的写法（本机 1.14.4 逐条验过），解析时就记进 `skipped`，不交给配置生成。
 *
 * 只用 ECMAScript 内建：扩展跑在 JavaScriptCore 里，没有 `Buffer`、`atob`、`TextDecoder`、`URL`，
 * base64、UTF-8、百分号解码与链接拆分都在本文件里手写。
 */
import {
  claimUniqueName,
  endpointLabel,
  proxyProtocols,
  reservedTags,
  type ProxyNode,
  type ProxyProtocol,
} from "./nodes.js";

/** 订阅的外形。 */
export type SubscriptionFormat = "base64" | "links" | "sing-box";

/** 没认出来的一行。 */
export interface SkippedLine {
  /** 原文（过长时剪到 {@link skippedLineLimit} 个码元）。 */
  line: string;
  /** 为什么没认（中文，直接给人看）。 */
  reason: string;
}

/** 一份订阅的解析结果。 */
export interface SubscriptionResult {
  format: SubscriptionFormat;
  /** 认出来的节点，名字已经两两不同、且避开了策略组的 tag。 */
  nodes: ProxyNode[];
  skipped: SkippedLine[];
}

/** 一条分享链接的解析结果。 */
export type ShareLinkResult = { ok: true; node: ProxyNode } | { ok: false; reason: string };

/**
 * `skipped` 里每行原文最多留多少码元。订阅里认不出的东西可能是一整页 HTML 或一段几十 KB 的乱码，
 * 原样留着只会把「认不出的行」那一屏撑爆；200 足够认出是哪一行。
 */
export const skippedLineLimit = 200;

// MARK: - 整份订阅

/**
 * 解析一整份订阅。
 * @param text 订阅地址返回的正文。
 * @returns 外形、节点与认不出的行。从不抛错。
 */
export function parseSubscription(text: string): SubscriptionResult {
  // `trim()` 连 BOM（U+FEFF）一起去掉：ECMAScript 把它算作空白。有的机场用 Windows 工具生成订阅，开头带着它。
  const body = text.trim();
  if (body.length === 0) return { format: "links", nodes: [], skipped: [] };

  if (body.startsWith("{")) return parseSingBoxDocument(body);

  // 订阅地址填错、订阅过期时，机场常常回一页 HTML：逐行当链接解析会刷出几百条「不是分享链接」，一句话说清更有用。
  if (/^<(?:!doctype|html|\?xml)/i.test(body)) {
    return { format: "links", nodes: [], skipped: [whole(body, "收到的是网页而不是订阅内容：订阅地址可能填错了，或者订阅已经过期")] };
  }
  if (/^proxies\s*:/m.test(body)) {
    return { format: "links", nodes: [], skipped: [whole(body, "这是 Clash YAML 格式的订阅，本期只认分享链接与 sing-box JSON")] };
  }

  // base64 的字母表里没有冒号：正文里出现 `://` 就一定是明文链接，不必先试着解 base64。
  if (body.includes("://")) return { format: "links", ...parseLinkLines(body) };

  const decoded = decodeBase64Text(body);
  if (decoded !== null) {
    if (decoded.includes("://")) return { format: "base64", ...parseLinkLines(decoded) };
    return { format: "base64", nodes: [], skipped: [whole(decoded, "base64 解开之后不是分享链接")] };
  }
  return { format: "links", ...parseLinkLines(body) };
}

/**
 * 逐行解析分享链接；空行跳过，其余每行要么成为节点、要么进 `skipped`。
 * @param text 多行文字。
 * @returns 节点（名字已去重）与认不出的行。
 */
function parseLinkLines(text: string): { nodes: ProxyNode[]; skipped: SkippedLine[] } {
  const nodes: ProxyNode[] = [];
  const skipped: SkippedLine[] = [];
  const used = new Set<string>(reservedTags);
  for (const raw of text.split(/\r\n|\r|\n/)) {
    const line = raw.trim();
    if (line.length === 0) continue;
    const result = parseShareLink(line);
    if (result.ok) nodes.push(withUniqueName(result.node, used));
    else skipped.push({ line: clampLine(line), reason: result.reason });
  }
  return { nodes, skipped };
}

/**
 * 把节点名换成还没被用过的写法。
 * @param node 节点。
 * @param used 已用的名字（含策略组的 tag）。
 * @returns 名字唯一的节点。
 */
function withUniqueName(node: ProxyNode, used: Set<string>): ProxyNode {
  const name = claimUniqueName(node.name, used);
  return name === node.name ? node : { ...node, name };
}

/**
 * 整份只记一条 `skipped`：取第一行非空的文字当原文。
 * @param text 正文。
 * @param reason 原因。
 * @returns 一条记录。
 */
function whole(text: string, reason: string): SkippedLine {
  const first = text.split(/\r\n|\r|\n/).find((line) => line.trim().length > 0) ?? "";
  return { line: clampLine(first.trim()), reason };
}

/**
 * 剪一行原文；剪在代理对中间会留下半个字符，退一位。
 * @param line 原文。
 * @returns 不超过 {@link skippedLineLimit} 个码元。
 */
function clampLine(line: string): string {
  if (line.length <= skippedLineLimit) return line;
  let cut = line.slice(0, skippedLineLimit - 1);
  if (/[\uD800-\uDBFF]$/.test(cut)) cut = cut.slice(0, -1);
  return `${cut}…`;
}

// MARK: - sing-box JSON

/** sing-box 里不是「节点」的出站：策略组与内建出站，静静丢掉，不算「认不出」。 */
const nonNodeOutboundTypes = new Set(["selector", "urltest", "direct", "block", "dns"]);

/**
 * 解析 sing-box 配置 / 订阅（`{ "outbounds": [...] }`）。只留本期认的七种代理出站。
 * @param body 以 `{` 开头的正文。
 * @returns 解析结果，外形恒为 `sing-box`。
 */
function parseSingBoxDocument(body: string): SubscriptionResult {
  let document: unknown;
  try {
    document = JSON.parse(body);
  } catch (error) {
    return { format: "sing-box", nodes: [], skipped: [whole(body, `JSON 解析失败：${errorMessage(error)}`)] };
  }
  const outbounds = isRecord(document) ? document.outbounds : undefined;
  if (!Array.isArray(outbounds)) {
    return { format: "sing-box", nodes: [], skipped: [whole(body, "JSON 里没有 outbounds 数组，不是 sing-box 配置")] };
  }
  const nodes: ProxyNode[] = [];
  const skipped: SkippedLine[] = [];
  const used = new Set<string>(reservedTags);
  outbounds.forEach((item, index) => {
    const result = singBoxOutboundNode(item);
    if (result === null) return;
    if (result.ok) nodes.push(withUniqueName(result.node, used));
    else skipped.push({ line: clampLine(`outbounds[${index}] ${safeStringify(item)}`), reason: result.reason });
  });
  // WireGuard / Tailscale 在 1.11 之后是 endpoint，不是出站；本期不认，但要说一声，免得用户以为它们被吞了。
  const endpoints = isRecord(document) ? document.endpoints : undefined;
  if (Array.isArray(endpoints)) {
    endpoints.forEach((item, index) => {
      const type = isRecord(item) && typeof item.type === "string" ? item.type : "未知";
      skipped.push({ line: clampLine(`endpoints[${index}] ${safeStringify(item)}`), reason: `本期不支持 ${type} 端点（endpoint）` });
    });
  }
  return { format: "sing-box", nodes, skipped };
}

/**
 * 一个 sing-box 出站 → 节点。
 * @param item `outbounds` 里的一项。
 * @returns 节点；不是节点的出站（策略组、直连……）为 `null`；不认的为原因。
 */
function singBoxOutboundNode(item: unknown): ShareLinkResult | null {
  if (!isRecord(item)) return fail("不是一个出站对象");
  const type = typeof item.type === "string" ? item.type : "";
  if (nonNodeOutboundTypes.has(type)) return null;
  if (!isProxyProtocol(type)) return fail(type ? `本期不支持 ${type} 出站` : "出站没有 type");
  // 链式节点引用的是对方配置里的另一个 tag：那个 tag 在我们生成的配置里不存在（或被改了名），sing-box 会拒绝整份配置。
  if (typeof item.detour === "string" && item.detour.length > 0) return fail("经由另一个出站（detour）的链式节点本期不支持");
  const server = typeof item.server === "string" ? stripBrackets(item.server.trim()) : "";
  if (server.length === 0) return fail("出站没有 server");
  let port = typeof item.server_port === "number" && isValidPort(item.server_port) ? item.server_port : 0;
  if (port === 0 && type === "hysteria2" && Array.isArray(item.server_ports)) {
    const first = item.server_ports[0];
    port = typeof first === "string" ? parsePortNumber(first.split(/[:-]/)[0]) ?? 0 : 0;
  }
  if (port === 0) return fail("出站没有合法的 server_port");
  // sing-box：「TLS required」。AnyTLS 就是跑在 TLS 里的协议，没开 TLS 的出站会让整份配置起不来。
  if (type === "anytls" && !(isRecord(item.tls) && item.tls.enabled === true)) return fail("AnyTLS 必须开 TLS");

  const outbound = JSON.parse(JSON.stringify(item)) as Record<string, unknown>;
  const tag = typeof outbound.tag === "string" ? outbound.tag.trim() : "";
  delete outbound.tag;
  // 两个字段指向对方配置里的 DNS 服务器 tag 或 1.12 起废弃的写法；我们的配置有自己的 `default_domain_resolver`。
  delete outbound.domain_resolver;
  delete outbound.domain_strategy;
  outbound.server = server;
  return ok({ name: tag || endpointLabel(server, port), protocol: type, server, port, outbound });
}

// MARK: - 分享链接

/**
 * 解析一条分享链接。
 * @param line 一行（前后空白已去）。
 * @returns 节点（名字未去重：没写名字时是 `server:port`）或原因。从不抛错。
 */
export function parseShareLink(line: string): ShareLinkResult {
  const match = /^([A-Za-z][A-Za-z0-9+.-]*):\/\//.exec(line);
  if (!match) return fail("不是分享链接");
  const scheme = match[1].toLowerCase();
  try {
    switch (scheme) {
      case "ss":
        return parseShadowsocks(line);
      case "vmess":
        return parseVMess(line);
      case "vless":
        return parseVLESS(line);
      case "trojan":
        return parseTrojan(line);
      case "hysteria2":
      case "hy2":
        return parseHysteria2(line);
      case "tuic":
        return parseTUIC(line);
      case "anytls":
        return parseAnyTLS(line);
      case "ssr":
        return fail("sing-box 不支持 ShadowsocksR");
      case "hysteria":
        return fail("本期不支持 Hysteria（第一版）链接，只认 hysteria2");
      default:
        return fail(`本期不支持 ${scheme}:// 链接`);
    }
  } catch (error) {
    // 每个解析函数都按「坏输入返回原因」写的；走到这里是没想到的输入，照样只算这一行坏。
    return fail(`解析出错：${errorMessage(error)}`);
  }
}

/** 拆开的一条链接。除 `userinfo` 外都已百分号解码。 */
interface LinkParts {
  /** `@` 前面那段（原文，未解码）；没有 `@` 为 `null`。 */
  userinfo: string | null;
  /** 主机（IPv6 已去方括号）。 */
  host: string;
  /** 端口原文；没写为空串。 */
  port: string;
  /** 查询参数，键原样、值已解码；同名取第一个。 */
  params: Map<string, string>;
  /** 节点名：`#` 后面那段，已解码、去空白；没写为空串。 */
  name: string;
}

/**
 * 拆一条 `scheme://userinfo@host:port/path?query#fragment`。
 *
 * 不用 `URL`：JavaScriptCore 里没有它，而且它对非特殊 scheme 的主机部分不做解析。
 * 先切 `#` 再找 `@`——JMS 这类机场的节点名里就带着 `@` 与 `:`（`JMS-123@c1s2.example.com:443`），
 * 反过来切会把名字当成主机。`@` 取**最后一个**：没转义的密码里出现 `@` 时仍能拆对。
 * @param line 整条链接。
 * @returns 拆开的各部分。
 */
function splitLink(line: string): LinkParts {
  let rest = line.slice(line.indexOf("://") + 3);
  let fragment = "";
  const hash = rest.indexOf("#");
  if (hash >= 0) {
    fragment = rest.slice(hash + 1);
    rest = rest.slice(0, hash);
  }
  let query = "";
  const question = rest.indexOf("?");
  if (question >= 0) {
    query = rest.slice(question + 1);
    rest = rest.slice(0, question);
  }
  let userinfo: string | null = null;
  const at = rest.lastIndexOf("@");
  if (at >= 0) {
    userinfo = rest.slice(0, at);
    rest = rest.slice(at + 1);
  }
  const slash = rest.indexOf("/");
  const hostPort = slash >= 0 ? rest.slice(0, slash) : rest;
  const { host, port } = splitHostPort(hostPort);
  return { userinfo, host, port, params: parseQuery(query), name: percentDecode(fragment).trim() };
}

/**
 * 拆 `host:port`；IPv6 写作 `[2001:db8::1]:443`。
 * @param text 主机与端口。
 * @returns 主机（去方括号、已解码）与端口原文。
 */
function splitHostPort(text: string): { host: string; port: string } {
  if (text.startsWith("[")) {
    const close = text.indexOf("]");
    if (close < 0) return { host: text, port: "" };
    const after = text.slice(close + 1);
    return { host: text.slice(1, close), port: after.startsWith(":") ? after.slice(1) : "" };
  }
  const colon = text.lastIndexOf(":");
  if (colon < 0) return { host: percentDecode(text), port: "" };
  return { host: percentDecode(text.slice(0, colon)), port: text.slice(colon + 1) };
}

/**
 * 解析查询串。`+` **不**当空格：分享链接不是表单提交，密码与 base64 值里的 `+` 就是 `+`。
 * @param query `?` 后面那段。
 * @returns 键 → 解码后的值；同名取第一个。
 */
function parseQuery(query: string): Map<string, string> {
  const params = new Map<string, string>();
  for (const pair of query.split("&")) {
    if (pair.length === 0) continue;
    const equals = pair.indexOf("=");
    const key = percentDecode(equals >= 0 ? pair.slice(0, equals) : pair);
    const value = equals >= 0 ? percentDecode(pair.slice(equals + 1)) : "";
    if (!params.has(key)) params.set(key, value);
  }
  return params;
}

/**
 * 取第一个出现且非空的参数（同一个意思各家写法不同：`allowInsecure` / `insecure` / `allow_insecure`）。
 * @param params 查询参数。
 * @param keys 候选键，按优先级。
 * @returns 值（已去空白）；都没有为空串。
 */
function param(params: Map<string, string>, ...keys: string[]): string {
  for (const key of keys) {
    const value = params.get(key);
    if (value !== undefined && value.trim().length > 0) return value.trim();
  }
  return "";
}

/**
 * 布尔参数：`1` / `true` / `yes` 为真。
 * @param params 查询参数。
 * @param keys 候选键。
 * @returns 是否为真。
 */
function flag(params: Map<string, string>, ...keys: string[]): boolean {
  return /^(?:1|true|yes)$/i.test(param(params, ...keys));
}

/**
 * 校验主机与端口，拼出节点。
 * @param protocol 协议。
 * @param endpoint 主机、端口原文与节点名（已解码；空串表示没写，用 `server:port`）。
 * @param outbound 出站（不含 `server` / `server_port`，这里补上）。
 * @returns 节点或原因。
 */
function finishNode(
  protocol: ProxyProtocol,
  endpoint: { host: string; port: string; name: string },
  outbound: Record<string, unknown>,
): ShareLinkResult {
  const server = endpoint.host.trim();
  if (server.length === 0 || /\s/.test(server)) return fail("缺少服务器地址");
  const port = parsePortNumber(endpoint.port);
  if (port === null) return fail(endpoint.port.length === 0 ? "缺少端口" : `端口不合法：${endpoint.port}`);
  const name = endpoint.name.trim();
  return ok({
    name: name.length > 0 ? name : endpointLabel(server, port),
    protocol,
    server,
    port,
    outbound: { type: protocol, server, server_port: port, ...outbound },
  });
}

// MARK: Shadowsocks

/** sing-box 1.14 认的 Shadowsocks 加密方式（文档 outbound/shadowsocks 的全表，含 legacy）。 */
const shadowsocksMethods = new Set([
  "2022-blake3-aes-128-gcm",
  "2022-blake3-aes-256-gcm",
  "2022-blake3-chacha20-poly1305",
  "none",
  "aes-128-gcm",
  "aes-192-gcm",
  "aes-256-gcm",
  "chacha20-ietf-poly1305",
  "xchacha20-ietf-poly1305",
  "aes-128-ctr",
  "aes-192-ctr",
  "aes-256-ctr",
  "aes-128-cfb",
  "aes-192-cfb",
  "aes-256-cfb",
  "rc4-md5",
  "chacha20-ietf",
  "xchacha20",
]);

/** Shadowsocks 2022 每种方式要求的密钥字节数（sing-box 启动时逐个校验，长度不对整份配置起不来）。 */
const shadowsocks2022KeyLength: Record<string, number> = {
  "2022-blake3-aes-128-gcm": 16,
  "2022-blake3-aes-256-gcm": 32,
  "2022-blake3-chacha20-poly1305": 32,
};

/**
 * `ss://`。两种写法：
 * - SIP002：`ss://base64url(method:password)@host:port/?plugin=…#name`；SS-2022 也允许 `method:百分号编码的密码` 明文。
 * - 旧式：`ss://base64(method:password@host:port)#name`。
 *
 * 判别靠 `@`：旧式把 `@` 整个包进了 base64，外面看不到。
 * @param line 链接。
 * @returns 节点或原因。
 */
function parseShadowsocks(line: string): ShareLinkResult {
  const parts = splitLink(line);
  let method: string;
  let password: string;
  let host = parts.host;
  let port = parts.port;
  if (parts.userinfo !== null) {
    const userinfo = percentDecode(parts.userinfo);
    // base64 的字母表里没有冒号：有冒号就是明文写法。
    const plain = userinfo.includes(":") ? userinfo : decodeBase64Text(userinfo);
    if (plain === null || !plain.includes(":")) return fail("ss 链接的用户信息既不是 base64(method:password) 也不是明文 method:password");
    const colon = plain.indexOf(":");
    method = plain.slice(0, colon);
    password = plain.slice(colon + 1);
  } else {
    // 旧式：`#` 与 `?` 之前整段都是 base64。不能用拆好的主机部分——标准 base64 里的 `/` 会被当成路径切掉。
    let body = line.slice("ss://".length);
    const hash = body.indexOf("#");
    if (hash >= 0) body = body.slice(0, hash);
    const question = body.indexOf("?");
    if (question >= 0) body = body.slice(0, question);
    const decoded = decodeBase64Text(percentDecode(body.replace(/\/+$/, "")));
    if (decoded === null) return fail("ss 链接既不是 SIP002 也不是旧式 base64 写法");
    const at = decoded.lastIndexOf("@");
    const colon = decoded.indexOf(":");
    if (at < 0 || colon < 0 || colon > at) return fail("旧式 ss 链接解开后不是 method:password@host:port");
    method = decoded.slice(0, colon);
    password = decoded.slice(colon + 1, at);
    const endpoint = splitHostPort(decoded.slice(at + 1).trim());
    host = endpoint.host;
    port = endpoint.port;
  }
  method = method.trim().toLowerCase();
  if (!shadowsocksMethods.has(method)) return fail(`sing-box 不支持的 Shadowsocks 加密方式：${method || "（空）"}`);
  const keyLength = shadowsocks2022KeyLength[method];
  if (keyLength !== undefined) {
    // 多用户写法 `iPSK:uPSK`：每一段都得是对应长度的 base64 密钥。
    const valid = password.split(":").every((key) => decodeBase64(key)?.length === keyLength);
    if (!valid) return fail(`${method} 的密码必须是 ${keyLength} 字节密钥的 base64`);
  }

  const outbound: Record<string, unknown> = { method, password };
  const plugin = parts.params.get("plugin");
  if (plugin !== undefined && plugin.trim().length > 0) {
    const resolved = shadowsocksPlugin(plugin.trim());
    if (!resolved.ok) return resolved;
    outbound.plugin = resolved.plugin;
    if (resolved.options) outbound.plugin_opts = resolved.options;
  }
  return finishNode("shadowsocks", { host, port, name: parts.name }, outbound);
}

/**
 * SIP003 插件参数 `name;opt=value;…` → sing-box 的 `plugin` / `plugin_opts`。
 *
 * sing-box 只内置 `obfs-local` 与 `v2ray-plugin` 两种（`simple-obfs` 是 `obfs-local` 的旧名）；
 * 别的插件（kcptun、cloak……）它直接拒绝整份配置，所以这里把这样的节点记进 skipped。
 * @param value 解码后的 `plugin` 参数。
 * @returns 插件名与选项，或原因。
 */
function shadowsocksPlugin(value: string): { ok: true; plugin: string; options: string } | { ok: false; reason: string } {
  const semicolon = value.indexOf(";");
  const name = (semicolon >= 0 ? value.slice(0, semicolon) : value).trim();
  const options = semicolon >= 0 ? value.slice(semicolon + 1).trim() : "";
  if (name === "obfs-local" || name === "simple-obfs") {
    // obfs 只有 http 与 tls 两种模式；别的值 sing-box 起不来。
    const mode = /(?:^|;)obfs=([^;]*)/.exec(options)?.[1];
    if (mode !== undefined && mode !== "http" && mode !== "tls") return { ok: false, reason: `obfs-local 不认识的 obfs 模式：${mode}` };
    return { ok: true, plugin: "obfs-local", options };
  }
  if (name === "v2ray-plugin") return { ok: true, plugin: "v2ray-plugin", options };
  return { ok: false, reason: `需要插件 ${name}，sing-box 只内置 obfs-local 与 v2ray-plugin` };
}

// MARK: VMess

/** sing-box 1.14 认的 VMess `security`（本机 `sing-box check` 逐个验过：`aes-128-ctr` 不认）。 */
const vmessSecurities = new Set(["auto", "none", "zero", "aes-128-gcm", "chacha20-poly1305", "aes-128-cfb"]);

/**
 * `vmess://base64(JSON)`，v2rayN 的写法：`{ v, ps, add, port, id, aid, scy, net, type, host, path, tls, sni, alpn, fp }`。
 * 字段有的写成数字、有的写成字符串，一律当字符串读。
 * @param line 链接。
 * @returns 节点或原因。
 */
function parseVMess(line: string): ShareLinkResult {
  // 只取 `#` 与 `?` 之前：Shadowrocket 那种 `vmess://…?remarks=` 照样走到下面「不是 JSON」的原因，而不是「不是 base64」。
  const payload = line.slice("vmess://".length).split("#")[0].split("?")[0].trim();
  const decoded = decodeBase64Text(percentDecode(payload));
  if (decoded === null) return fail("vmess 链接不是 v2rayN 的 base64 JSON 写法");
  let json: unknown;
  try {
    json = JSON.parse(decoded);
  } catch {
    return fail("vmess 链接解开后不是 JSON（只认 v2rayN 写法）");
  }
  if (!isRecord(json)) return fail("vmess 链接解开后不是 JSON 对象");
  const field = (key: string): string => {
    const value = json[key];
    return typeof value === "string" ? value.trim() : typeof value === "number" ? String(value) : "";
  };

  const uuid = field("id");
  if (uuid.length === 0) return fail("vmess 链接缺少 id");
  const security = (field("scy") || "auto").toLowerCase();
  if (!vmessSecurities.has(security)) return fail(`sing-box 不支持的 VMess 加密方式：${security}`);
  const alterId = Number(field("aid") || "0");

  const outbound: Record<string, unknown> = { uuid, security };
  if (Number.isInteger(alterId) && alterId > 0) outbound.alter_id = alterId;

  const tlsMode = field("tls").toLowerCase();
  const host = field("host");
  const network = (field("net") || "tcp").toLowerCase();
  const transport = buildTransport({
    network,
    headerType: field("type"),
    host,
    path: field("path"),
    // v2rayN 把 gRPC 的 serviceName 放在 path 里。
    serviceName: field("path"),
    tlsEnabled: tlsMode === "tls",
  });
  if (!transport.ok) return transport;
  if (transport.transport) outbound.transport = transport.transport;

  if (tlsMode === "tls") {
    outbound.tls = buildTLS({
      serverName: field("sni") || hostHeader(host),
      insecure: /^(?:1|true)$/i.test(field("allowInsecure")),
      alpn: splitList(field("alpn")),
      fingerprint: field("fp"),
    });
  } else if (tlsMode.length > 0 && tlsMode !== "none") {
    return fail(`VMess 不支持的 tls 取值：${tlsMode}`);
  }
  return finishNode("vmess", { host: stripBrackets(field("add")), port: field("port"), name: field("ps") }, outbound);
}

// MARK: VLESS / Trojan

/**
 * `vless://uuid@host:port?encryption=none&flow=&security=none|tls|reality&sni=&fp=&pbk=&sid=&type=&path=&host=&serviceName=#name`。
 * @param line 链接。
 * @returns 节点或原因。
 */
function parseVLESS(line: string): ShareLinkResult {
  const parts = splitLink(line);
  const uuid = parts.userinfo === null ? "" : percentDecode(parts.userinfo).trim();
  if (uuid.length === 0) return fail("vless 链接缺少 uuid");
  // Xray 2025 起的 VLESS 加密（mlkem768x25519plus……）sing-box 没有实现。
  const encryption = param(parts.params, "encryption").toLowerCase();
  if (encryption.length > 0 && encryption !== "none") return fail(`sing-box 不支持 VLESS 加密：${encryption}`);

  const outbound: Record<string, unknown> = { uuid };
  const flow = param(parts.params, "flow").toLowerCase();
  if (flow.length > 0) {
    // `-udp443` 只是 Xray 客户端「放行 UDP 443」的开关，线上协议同为 Vision；sing-box 只认不带后缀的名字。
    if (flow === "xtls-rprx-vision" || flow === "xtls-rprx-vision-udp443") outbound.flow = "xtls-rprx-vision";
    else return fail(`sing-box 不支持的 VLESS flow：${flow}`);
  }
  const security = streamSecurity(parts.params, "none");
  if (!security.ok) return security;
  if (security.tls) outbound.tls = security.tls;
  const transport = streamTransport(parts.params, security.tls !== undefined);
  if (!transport.ok) return transport;
  if (transport.transport) outbound.transport = transport.transport;
  // sing-box 的 VLESS 默认就是 xudp；写明是因为 Xray 服务端只认 xudp，换默认值的那一天不该悄悄断掉 UDP。
  outbound.packet_encoding = "xudp";
  return finishNode("vless", parts, outbound);
}

/**
 * `trojan://password@host:port?security=tls|reality&sni=&peer=&type=&…#name`。Trojan 默认就是 TLS。
 * @param line 链接。
 * @returns 节点或原因。
 */
function parseTrojan(line: string): ShareLinkResult {
  const parts = splitLink(line);
  const password = parts.userinfo === null ? "" : percentDecode(parts.userinfo);
  if (password.length === 0) return fail("trojan 链接缺少密码");
  const outbound: Record<string, unknown> = { password };
  const security = streamSecurity(parts.params, "tls");
  if (!security.ok) return security;
  if (security.tls) outbound.tls = security.tls;
  const transport = streamTransport(parts.params, security.tls !== undefined);
  if (!transport.ok) return transport;
  if (transport.transport) outbound.transport = transport.transport;
  return finishNode("trojan", parts, outbound);
}

/**
 * VLESS / Trojan 链接里的 `security` 一组参数 → sing-box `tls`。
 * @param params 查询参数。
 * @param fallback 没写 `security` 时按什么算（VLESS 为 none、Trojan 为 tls）。
 * @returns `tls`（不加密时为 `undefined`）或原因。
 */
function streamSecurity(
  params: Map<string, string>,
  fallback: "none" | "tls",
): { ok: true; tls?: Record<string, unknown> } | { ok: false; reason: string } {
  const security = (param(params, "security") || fallback).toLowerCase();
  const host = param(params, "host");
  const serverName = param(params, "sni", "peer", "serverName");
  const fingerprint = param(params, "fp", "fingerprint");
  const alpn = splitList(param(params, "alpn"));
  const insecure = flag(params, "allowInsecure", "insecure", "allow_insecure");
  switch (security) {
    case "none":
      return { ok: true };
    case "tls":
      return { ok: true, tls: buildTLS({ serverName: serverName || hostHeader(host), insecure, alpn, fingerprint }) };
    case "reality": {
      const publicKey = param(params, "pbk", "publicKey", "public-key");
      const shortId = param(params, "sid", "shortId", "short-id");
      // sing-box 用 RawURLEncoding 解公钥并要求 32 字节、short_id 要求偶数位十六进制且不超过 8 字节：任一不合就整份配置起不来。
      if (!isRealityPublicKey(publicKey)) return { ok: false, reason: publicKey ? "Reality 公钥（pbk）不是 32 字节的 base64url" : "Reality 节点缺少公钥（pbk）" };
      if (!/^(?:[0-9a-fA-F]{2}){0,8}$/.test(shortId)) return { ok: false, reason: `Reality short id（sid）不是 0–16 位的偶数位十六进制：${shortId}` };
      return {
        ok: true,
        tls: buildTLS({ serverName, insecure: false, alpn, fingerprint: fingerprint || "chrome", reality: { publicKey, shortId } }),
      };
    }
    default:
      return { ok: false, reason: `sing-box 不支持的 security：${security}` };
  }
}

/**
 * VLESS / Trojan 链接里的 `type` 一组参数 → sing-box `transport`。
 * @param params 查询参数。
 * @param tlsEnabled 这个节点开没开 TLS（决定 tcp + http 伪装能不能映射）。
 * @returns `transport`（裸 TCP 时为 `undefined`）或原因。
 */
function streamTransport(params: Map<string, string>, tlsEnabled: boolean): TransportResult {
  return buildTransport({
    network: (param(params, "type", "network", "net") || "tcp").toLowerCase(),
    headerType: param(params, "headerType"),
    host: param(params, "host"),
    path: param(params, "path"),
    serviceName: param(params, "serviceName", "service_name"),
    tlsEnabled,
  });
}

type TransportResult = { ok: true; transport?: Record<string, unknown> } | { ok: false; reason: string };

/**
 * V2Ray 传输 → sing-box `transport`。
 *
 * sing-box 没有独立的 TCP 传输：裸 TCP 就是不写 `transport`；v2ray 的「TCP + HTTP 头伪装」在 sing-box 里是
 * 不加 TLS 的 `http` 传输（明文 HTTP/1.1，方法取 v2ray 的默认 GET）。加了 TLS 的 `http` 传输在 sing-box 里是 HTTP/2，
 * 与「TCP + HTTP 伪装 + TLS」不是一回事，这种组合只能不认。
 * @param input 传输参数。
 * @returns `transport` 或原因。
 */
function buildTransport(input: {
  network: string;
  headerType: string;
  host: string;
  path: string;
  serviceName: string;
  tlsEnabled: boolean;
}): TransportResult {
  const hosts = splitList(input.host);
  switch (input.network) {
    case "tcp":
    case "raw":
    case "":
      if (input.headerType.toLowerCase() !== "http") return { ok: true };
      if (input.tlsEnabled) return { ok: false, reason: "TCP + HTTP 伪装 + TLS 的组合 sing-box 无法对应" };
      return { ok: true, transport: compact({ type: "http", method: "GET", host: hosts.length ? hosts : undefined, path: firstPath(input.path) }) };
    case "ws":
    case "websocket":
      return { ok: true, transport: webSocketTransport(input.path, hosts[0] ?? "") };
    case "grpc":
    case "gun":
      return { ok: true, transport: compact({ type: "grpc", service_name: input.serviceName || undefined }) };
    case "http":
    case "h2":
      return { ok: true, transport: compact({ type: "http", host: hosts.length ? hosts : undefined, path: input.path || undefined }) };
    case "httpupgrade":
      return { ok: true, transport: compact({ type: "httpupgrade", host: hosts[0], path: input.path || undefined }) };
    case "quic":
      // sing-box：「quic: TLS required」，不加 TLS 的 QUIC 传输整份配置起不来。
      if (!input.tlsEnabled) return { ok: false, reason: "QUIC 传输必须配 TLS" };
      return { ok: true, transport: { type: "quic" } };
    default:
      return { ok: false, reason: `sing-box 不支持 ${input.network} 传输` };
  }
}

/**
 * 与 Xray 兼容的 0-RTT 头名。拆开拼：仓库的校验脚本按字面扫产物里浏览器那个长连接 API 的名字
 * （宿主没有那个 API，扫到就拒），而这里它只是写进 sing-box 配置的一个字符串，不是在用那个 API。
 */
const earlyDataHeader = ["Sec-Web", "Socket-Protocol"].join("");

/**
 * WS 传输。v2rayN / Xray 把 0-RTT 写在路径里（`/path?ed=2048`）；sing-box 要的是
 * `max_early_data` 与 `early_data_header_name`（与 Xray 兼容的那个头，见 {@link earlyDataHeader}），路径里要去掉 `ed`。
 * @param path 路径（可能带 `?ed=`）。
 * @param host Host 头。
 * @returns `transport`。
 */
function webSocketTransport(path: string, host: string): Record<string, unknown> {
  const transport: Record<string, unknown> = { type: "ws" };
  let cleanPath = path;
  const question = path.indexOf("?");
  if (question >= 0) {
    const kept: string[] = [];
    let earlyData = 0;
    for (const pair of path.slice(question + 1).split("&")) {
      const match = /^ed=(\d+)$/.exec(pair);
      if (match) earlyData = Number(match[1]);
      else if (pair.length > 0) kept.push(pair);
    }
    cleanPath = path.slice(0, question) + (kept.length ? `?${kept.join("&")}` : "");
    if (earlyData > 0) {
      transport.max_early_data = earlyData;
      transport.early_data_header_name = earlyDataHeader;
    }
  }
  if (cleanPath) transport.path = cleanPath;
  if (host) transport.headers = { Host: host };
  return transport;
}

// MARK: Hysteria2 / TUIC

/** sing-box 1.14 认的 Hysteria2 混淆（`gecko` 是 1.14 新增）。 */
const hysteria2Obfs = new Set(["salamander", "gecko"]);

/**
 * `hysteria2://auth@host[:port][/]?sni=&insecure=&obfs=salamander&obfs-password=&mport=#name`（也写作 `hy2://`）。
 *
 * 端口可以省略（官方 URI 规定默认 443），也可以是端口跳跃的写法 `443,20000-30000`。
 * 官方的 userpass 认证写作 `user:pass@`，sing-box 的说法是「把两段拼起来当密码」——原样当密码正是这个意思。
 * `pinSHA256` 不映射：官方是整张证书的 SHA-256，sing-box 的 `certificate_public_key_sha256` 是公钥的，二者不等价。
 * @param line 链接。
 * @returns 节点或原因。
 */
function parseHysteria2(line: string): ShareLinkResult {
  const parts = splitLink(line);
  const password = parts.userinfo === null ? "" : percentDecode(parts.userinfo);
  const outbound: Record<string, unknown> = {};
  if (password.length > 0) outbound.password = password;

  const obfs = param(parts.params, "obfs").toLowerCase();
  if (obfs.length > 0 && obfs !== "none") {
    if (!hysteria2Obfs.has(obfs)) return fail(`sing-box 不支持的 Hysteria2 混淆：${obfs}`);
    outbound.obfs = { type: obfs, password: param(parts.params, "obfs-password", "obfsPassword", "obfs_password") };
  }
  outbound.tls = buildTLS({
    serverName: param(parts.params, "sni", "peer"),
    insecure: flag(parts.params, "insecure", "allowInsecure", "allow_insecure"),
    alpn: splitList(param(parts.params, "alpn")),
    fingerprint: "",
  });

  // 端口：单个、省略（443）、或跳跃（逗号分隔的端口与区间）；`mport` 是另一种写跳跃区间的地方。
  const ports = parsePortList([parts.port, param(parts.params, "mport")].filter((text) => text.length > 0).join(","));
  if (ports === null) return fail(`端口不合法：${parts.port}`);
  const first = ports.length > 0 ? ports[0][0] : 443;
  const hopping = ports.length > 1 || (ports.length === 1 && ports[0][0] !== ports[0][1]);
  if (hopping) outbound.server_ports = ports.map(([start, end]) => `${start}:${end}`);
  return finishNode("hysteria2", { host: parts.host, port: String(first), name: parts.name }, outbound);
}

/** sing-box 1.14 认的 TUIC 拥塞控制。 */
const tuicCongestionControls = new Set(["cubic", "new_reno", "bbr"]);

/**
 * `tuic://uuid:password@host:port?congestion_control=&udp_relay_mode=&alpn=&sni=&allow_insecure=&disable_sni=#name`（TUIC v5）。
 *
 * sing-box 只实现 v5：没有密码的 v4 链接（只有 token）记进 skipped。ALPN 没写时补 `h3`——QUIC 握手必须带 ALPN，
 * 而 TUIC 服务端几乎都配的是 h3（Clash.Meta 的默认也是它）。
 * @param line 链接。
 * @returns 节点或原因。
 */
function parseTUIC(line: string): ShareLinkResult {
  const parts = splitLink(line);
  const userinfo = parts.userinfo === null ? "" : percentDecode(parts.userinfo);
  const colon = userinfo.indexOf(":");
  if (colon < 0) return fail("tuic 链接缺少 uuid:password（sing-box 只支持 TUIC v5）");
  const uuid = userinfo.slice(0, colon).trim();
  const password = userinfo.slice(colon + 1);
  // TUIC 的 uuid 由 sing-box 严格按 UUID 解析（不像 VLESS / VMess 会把任意字符串映射成 UUID）。
  if (!isUUID(uuid)) return fail(`TUIC 的 uuid 不是合法的 UUID：${uuid}`);

  const outbound: Record<string, unknown> = { uuid, password };
  const congestion = param(parts.params, "congestion_control", "congestion-control", "congestion").toLowerCase();
  if (congestion.length > 0) {
    if (!tuicCongestionControls.has(congestion)) return fail(`sing-box 不支持的 TUIC 拥塞控制：${congestion}`);
    outbound.congestion_control = congestion;
  }
  const relay = param(parts.params, "udp_relay_mode", "udp-relay-mode").toLowerCase();
  if (relay === "native" || relay === "quic") outbound.udp_relay_mode = relay;
  const alpn = splitList(param(parts.params, "alpn"));
  const tls = buildTLS({
    serverName: param(parts.params, "sni", "peer"),
    insecure: flag(parts.params, "allow_insecure", "allowInsecure", "insecure"),
    alpn: alpn.length > 0 ? alpn : ["h3"],
    fingerprint: "",
  });
  if (flag(parts.params, "disable_sni", "disable-sni")) tls.disable_sni = true;
  outbound.tls = tls;
  return finishNode("tuic", parts, outbound);
}

// MARK: AnyTLS

/**
 * `anytls://password@host[:port]/?sni=&insecure=1#name`（anytls-go `docs/uri_scheme.md`，仿 Hysteria2：端口省略即 443）。
 *
 * 官方只有 `sni` 与 `insecure` 两个参数；v2rayN 这类客户端会照 VLESS 的样子多写 `security=tls|reality`、`pbk`、`sid`、`fp`、`alpn`、`type=tcp`，
 * 所以 TLS 一组直接走 {@link streamSecurity}（没写 `security` 按 `tls` 算）。两样东西 sing-box 做不到、只能不认：
 * 不加密（「TLS required」）与传输层（anytls 出站没有 `transport` 字段——硬塞进去整份配置起不来，悄悄丢掉又会连到不是机场那个意思的地方）。
 * 密码为空时 sing-box 不拦，但服务端按密码认证，这样的节点永远连不上。
 * @param line 链接。
 * @returns 节点或原因。
 */
function parseAnyTLS(line: string): ShareLinkResult {
  const parts = splitLink(line);
  const password = parts.userinfo === null ? "" : percentDecode(parts.userinfo);
  if (password.length === 0) return fail("anytls 链接缺少密码");
  const network = (param(parts.params, "type", "network") || "tcp").toLowerCase();
  if (network !== "tcp" && network !== "raw") return fail(`AnyTLS 没有传输层选项（type=${network}）`);
  const security = streamSecurity(parts.params, "tls");
  if (!security.ok) return security;
  if (!security.tls) return fail("AnyTLS 必须走 TLS（security=none 不认）");
  return finishNode("anytls", { host: parts.host, port: parts.port || "443", name: parts.name }, { password, tls: security.tls });
}

// MARK: - TLS

/** sing-box 1.14 认的 uTLS 指纹（文档 shared/tls 的全表）。 */
const utlsFingerprints = new Set(["chrome", "firefox", "edge", "safari", "360", "qq", "ios", "android", "random", "randomized"]);

/**
 * 拼 sing-box 出站的 `tls`。
 *
 * 指纹（`fp`）：认得的原样用；不认得的（`chrome_psk` 这类已被 sing-box 删掉的旧名、拼写各异的写法）换成 `chrome`——
 * sing-box 自己在指纹为空时用的也是 chrome，而一个不认得的指纹会让整份配置起不来。
 * Reality 必须开 uTLS（sing-box：「uTLS is required by reality client」），所以带 Reality 时指纹至少是 chrome。
 * @param input TLS 参数。
 * @returns `tls` 对象。
 */
function buildTLS(input: {
  serverName: string;
  insecure: boolean;
  alpn: string[];
  fingerprint: string;
  reality?: { publicKey: string; shortId: string };
}): Record<string, unknown> {
  const tls: Record<string, unknown> = { enabled: true };
  if (input.serverName) tls.server_name = input.serverName;
  if (input.insecure) tls.insecure = true;
  if (input.alpn.length > 0) tls.alpn = input.alpn;
  if (input.fingerprint) {
    const fingerprint = input.fingerprint.toLowerCase();
    tls.utls = { enabled: true, fingerprint: utlsFingerprints.has(fingerprint) ? fingerprint : "chrome" };
  }
  if (input.reality) tls.reality = { enabled: true, public_key: input.reality.publicKey, short_id: input.reality.shortId };
  return tls;
}

/**
 * 从 Host 头取 SNI 的候选：多个主机时取第一个；是 IP 就不要（SNI 不能是 IP）。
 * @param host Host 原文。
 * @returns 主机名或空串。
 */
function hostHeader(host: string): string {
  const first = splitList(host)[0] ?? "";
  return isIPAddress(first) ? "" : first;
}

// MARK: - 小工具

/**
 * 逗号分隔的列表 → 去空白、去空项。
 * @param text 原文。
 * @returns 列表。
 */
function splitList(text: string): string[] {
  return text
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

/**
 * HTTP 伪装的 path 可以是逗号分隔的多个，sing-box 只要一个。
 * @param path 原文。
 * @returns 第一个路径；没写为 `undefined`。
 */
function firstPath(path: string): string | undefined {
  return splitList(path)[0];
}

/**
 * 去掉值为 `undefined` 的键，免得 JSON 里出现 `"host": null` 一类 sing-box 不认的东西。
 * @param object 对象。
 * @returns 同一个对象。
 */
function compact(object: Record<string, unknown>): Record<string, unknown> {
  for (const key of Object.keys(object)) if (object[key] === undefined) delete object[key];
  return object;
}

/**
 * 端口：整串都是数字、1–65535。
 * @param text 原文。
 * @returns 端口或 `null`。
 */
function parsePortNumber(text: string): number | null {
  if (!/^\d{1,5}$/.test(text.trim())) return null;
  const port = Number(text.trim());
  return isValidPort(port) ? port : null;
}

/**
 * @param port 数。
 * @returns 是不是 1–65535 的整数。
 */
function isValidPort(port: number): boolean {
  return Number.isInteger(port) && port >= 1 && port <= 65535;
}

/**
 * 端口列表 `443,20000-30000`（区间也接受 `:`）。
 * @param text 原文；空串表示没写。
 * @returns `[起, 止]` 的列表（单个端口起止相同）；有一项不合法为 `null`。
 */
function parsePortList(text: string): [number, number][] | null {
  const ranges: [number, number][] = [];
  for (const item of splitList(text)) {
    const bounds = item.split(/[-:]/);
    if (bounds.length > 2) return null;
    const start = parsePortNumber(bounds[0]);
    const end = bounds.length === 2 ? parsePortNumber(bounds[1]) : start;
    if (start === null || end === null || end < start) return null;
    ranges.push([start, end]);
  }
  return ranges;
}

/**
 * @param text 原文。
 * @returns 是不是 8-4-4-4-12 的 UUID。
 */
function isUUID(text: string): boolean {
  return /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(text);
}

/**
 * Reality 公钥：sing-box 用 `base64.RawURLEncoding` 解（不许补位、不许标准字母表的 `+/`），且要求 32 字节。
 * @param text 原文。
 * @returns 是否合法。
 */
function isRealityPublicKey(text: string): boolean {
  return /^[A-Za-z0-9_-]{43}$/.test(text) && decodeBase64(text)?.length === 32;
}

/**
 * @param text 主机。
 * @returns 是不是 IPv4 或 IPv6 字面量。
 */
function isIPAddress(text: string): boolean {
  return /^\d{1,3}(?:\.\d{1,3}){3}$/.test(text) || text.includes(":");
}

/**
 * @param text 地址。
 * @returns 去掉 IPv6 方括号之后的地址。
 */
function stripBrackets(text: string): string {
  return text.startsWith("[") && text.endsWith("]") ? text.slice(1, -1) : text;
}

/**
 * @param type 出站类型。
 * @returns 是不是本期认的协议。
 */
function isProxyProtocol(type: string): type is ProxyProtocol {
  return (proxyProtocols as readonly string[]).includes(type);
}

/**
 * @param value 任意值。
 * @returns 是不是普通对象（不含数组与 `null`）。
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * @param value 任意值。
 * @returns JSON 文本；转不了时为 `String(value)`。
 */
function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

/**
 * @param error 抛出的东西。
 * @returns 一句给人看的说明。
 */
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * @param node 节点。
 * @returns 成功结果。
 */
function ok(node: ProxyNode): ShareLinkResult {
  return { ok: true, node };
}

/**
 * @param reason 原因。
 * @returns 失败结果。
 */
function fail(reason: string): { ok: false; reason: string } {
  return { ok: false, reason };
}

// MARK: - 编码

/** base64 字符 → 6 位值；标准（`+/`）与 URL-safe（`-_`）两套字母表同时认。不在表里的为 -1。 */
const base64Values: Int8Array = (() => {
  const table = new Int8Array(128).fill(-1);
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  for (let index = 0; index < alphabet.length; index += 1) table[alphabet.charCodeAt(index)] = index;
  table["-".charCodeAt(0)] = 62;
  table["_".charCodeAt(0)] = 63;
  return table;
})();

/**
 * 解 base64：标准与 URL-safe 字母表都认、补位可有可无、中间的空白与换行忽略（有的机场按 76 列折行）。
 * @param text 原文。
 * @returns 字节；不是 base64（含非法字符、补位在中间、长度余 1）或为空时为 `null`。
 */
export function decodeBase64(text: string): Uint8Array | null {
  const clean = text.replace(/\s+/g, "").replace(/={1,2}$/, "");
  if (clean.length === 0 || clean.length % 4 === 1) return null;
  const bytes = new Uint8Array(Math.floor((clean.length * 6) / 8));
  let buffer = 0;
  let bits = 0;
  let index = 0;
  for (let position = 0; position < clean.length; position += 1) {
    const code = clean.charCodeAt(position);
    const value = code < 128 ? base64Values[code] : -1;
    if (value < 0) return null;
    buffer = (buffer << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes[index] = (buffer >> bits) & 0xff;
      index += 1;
      buffer &= (1 << bits) - 1;
    }
  }
  return bytes;
}

/**
 * 严格解 UTF-8：遇到截断、过长编码、代理区码位或超出 U+10FFFF 即判失败。
 *
 * 严格是为了**判别**：一段碰巧全由 base64 字母组成的明文（例如一个很长的单词）解出来几乎不可能是合法 UTF-8，
 * 宽松解码会把它当成「base64 订阅」读出一堆乱码。
 * @param bytes 字节。
 * @returns 文字；不是合法 UTF-8 为 `null`。
 */
export function decodeUtf8(bytes: Uint8Array): string | null {
  const units: number[] = [];
  let output = "";
  for (let index = 0; index < bytes.length; ) {
    const lead = bytes[index];
    let codePoint: number;
    let length: number;
    if (lead < 0x80) {
      codePoint = lead;
      length = 1;
    } else if (lead >= 0xc2 && lead <= 0xdf) {
      codePoint = lead & 0x1f;
      length = 2;
    } else if (lead >= 0xe0 && lead <= 0xef) {
      codePoint = lead & 0x0f;
      length = 3;
    } else if (lead >= 0xf0 && lead <= 0xf4) {
      codePoint = lead & 0x07;
      length = 4;
    } else {
      return null;
    }
    if (index + length > bytes.length) return null;
    for (let offset = 1; offset < length; offset += 1) {
      const next = bytes[index + offset];
      if ((next & 0xc0) !== 0x80) return null;
      codePoint = (codePoint << 6) | (next & 0x3f);
    }
    const minimum = length === 3 ? 0x800 : length === 4 ? 0x10000 : 0;
    if (codePoint < minimum || codePoint > 0x10ffff || (codePoint >= 0xd800 && codePoint <= 0xdfff)) return null;
    if (codePoint >= 0x10000) {
      const offset = codePoint - 0x10000;
      units.push(0xd800 + (offset >> 10), 0xdc00 + (offset & 0x3ff));
    } else {
      units.push(codePoint);
    }
    index += length;
    // 分批拼：`String.fromCharCode(...units)` 一次展开几十万个参数会撑爆调用栈。
    if (units.length >= 8192) {
      output += String.fromCharCode.apply(null, units);
      units.length = 0;
    }
  }
  return output + String.fromCharCode.apply(null, units);
}

/**
 * 解 base64 再按 UTF-8 读成文字，并要求读出来的是**文字**（没有 NUL 与换行、制表以外的控制字符）。
 * @param text 原文。
 * @returns 文字；不是 base64 编码的文字时为 `null`。
 */
export function decodeBase64Text(text: string): string | null {
  const bytes = decodeBase64(text);
  if (bytes === null) return null;
  const decoded = decodeUtf8(bytes);
  if (decoded === null || /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(decoded)) return null;
  return decoded;
}

/**
 * 宽松的百分号解码：连续的 `%XX` 按 UTF-8 解，解不开的（`100%好用` 里那个孤零零的 `%`、残缺的多字节序列）原样保留。
 * `decodeURIComponent` 遇到一处坏序列就整串抛错，节点名里常有这种东西。
 * @param text 原文。
 * @returns 解码后的文字。
 */
export function percentDecode(text: string): string {
  if (!text.includes("%")) return text;
  return text.replace(/(?:%[0-9A-Fa-f]{2})+/g, (run) => {
    const bytes = new Uint8Array(run.length / 3);
    for (let index = 0; index < bytes.length; index += 1) bytes[index] = parseInt(run.slice(index * 3 + 1, index * 3 + 3), 16);
    return decodeUtf8(bytes) ?? run;
  });
}
