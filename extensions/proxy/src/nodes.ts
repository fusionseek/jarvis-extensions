/**
 * 节点模型：订阅解析的产物、sing-box 配置的原料。
 *
 * 一个节点就是**一份不带 `tag` 的 sing-box 出站**，外加几样给人看的字段（名字、协议、地址）。
 * 出站在解析那一刻就写成 sing-box 的字段，而不是先落一套「通用节点」再在生成配置时翻译：
 * 中间层每多一个字段就多一处两边对不上的机会，而 sing-box 的出站本来就是这份数据最准确的写法——
 * 订阅里本来就是 sing-box JSON 的节点也能原样带过来，不必先挤进一套更窄的模型再挤出去。
 *
 * `tag` 不在出站里：tag 就是节点名，名字要在**合并全部订阅之后**才定得下来（去重、避开策略组的名字）。
 *
 * 纯数据，不碰宿主：单测直接喂。
 */

/** 本期认的七种协议（P-9；AnyTLS 见 `20261028-173712-proxy-anytls-protocol`）：也是 sing-box 出站的 `type`。 */
export type ProxyProtocol = "shadowsocks" | "vmess" | "vless" | "trojan" | "hysteria2" | "tuic" | "anytls";

/** 全部协议，按界面上列出的顺序。 */
export const proxyProtocols: readonly ProxyProtocol[] = ["shadowsocks", "vmess", "vless", "trojan", "hysteria2", "tuic", "anytls"];

/** 一个节点。 */
export interface ProxyNode {
  /** 节点名：订阅里写的那个（解码、去空白之后）；没写就是 `server:port`。生成配置时它就是出站的 `tag`。 */
  name: string;
  /** 协议，与 `outbound.type` 相同；单独放一份是给界面画标签用，不必去翻出站。 */
  protocol: ProxyProtocol;
  /** 服务器地址（域名或 IP；IPv6 不带方括号）。只给人看，连接用的是 `outbound.server`。 */
  server: string;
  /** 服务器端口。 */
  port: number;
  /** 一份 sing-box 1.14 出站，**不带 `tag`**。 */
  outbound: Record<string, unknown>;
}

/**
 * 「节点选择」策略组（selector）的 tag。
 *
 * 写在这里而不是配置生成那边：节点名会变成出站 tag，与策略组同一个名字空间——解析订阅时就得避开这几个名字，
 * 否则一个叫「自动选择」的节点会让 sing-box 以「duplicate outbound/endpoint tag」拒绝启动。
 */
export const SELECTOR_TAG = "节点选择";

/** 「自动选择」策略组（urltest）的 tag。 */
export const URLTEST_TAG = "自动选择";

/** 直连出站的 tag。 */
export const DIRECT_TAG = "direct";

/** 节点名不能用的名字：配置里另有同名出站。 */
export const reservedTags: readonly string[] = [SELECTOR_TAG, URLTEST_TAG, DIRECT_TAG];

/**
 * 给一个名字找一个还没被用过的写法：先用原名，撞了就依次试 `名 2`、`名 3` ……
 *
 * 从 2 数起：「香港」与「香港 2」读起来是「第一个」与「第二个」；「香港 1」会让人去找一个并不存在的「香港 0」。
 * @param base 原名（已经去过空白、不为空）。
 * @param used 已经用掉的名字；找到的名字会加进去。
 * @returns 不在 `used` 里的名字。
 */
export function claimUniqueName(base: string, used: Set<string>): string {
  let name = base;
  for (let index = 2; used.has(name); index += 1) name = `${base} ${index}`;
  used.add(name);
  return name;
}

/**
 * 让一组节点的名字两两不同、且不与策略组撞名：先到先得，后来的追加序号。
 *
 * 用在合并多条订阅之后——每条订阅自己解析时已经去过重，但两家机场都有「香港 01」是常事。
 * 界面上显示的名字必须就是配置里的 tag，否则点选一个节点时发给 Clash API 的名字会找不到人；
 * 所以调用方应当先过一遍这个函数、再拿结果既显示又生成配置，而不是只在生成配置时悄悄改名。
 * @param nodes 节点（不改动原数组与原对象）。
 * @returns 新数组；名字没变的节点原样复用，改了名的是一份浅拷贝。
 */
export function dedupeNodeNames(nodes: readonly ProxyNode[]): ProxyNode[] {
  const used = new Set<string>(reservedTags);
  return nodes.map((node) => {
    const base = node.name.trim() || endpointLabel(node.server, node.port);
    const name = claimUniqueName(base, used);
    return name === node.name ? node : { ...node, name };
  });
}

/**
 * `server:port` 的写法；IPv6 加方括号，否则 `2001:db8::1:443` 分不清端口从哪里开始。
 * @param server 地址（IPv6 不带方括号）。
 * @param port 端口。
 * @returns 例如 `example.com:443`、`[2001:db8::1]:443`。
 */
export function endpointLabel(server: string, port: number): string {
  return server.includes(":") ? `[${server}]:${port}` : `${server}:${port}`;
}
