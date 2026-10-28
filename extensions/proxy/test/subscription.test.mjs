/**
 * 订阅解析：三种外形、六种分享链接（含 ss 的两种写法）、base64 的各种变体、认不出的行与重名。
 * 样本全是合成的（见 support.mjs）。
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  loadSource,
  base64,
  base64url,
  jmsLinks,
  jmsSubscription,
  UUID,
  UUID_2,
  REALITY_PUBLIC_KEY,
  REALITY_SHORT_ID,
  SS_PASSWORD,
} from "./support.mjs";

const { parseSubscription, parseShareLink, decodeBase64, decodeBase64Text, percentDecode, skippedLineLimit, dedupeNodeNames } =
  await loadSource();

/** 解析一条链接，断言成功并返回节点。 */
const node = (line) => {
  const result = parseShareLink(line);
  assert.equal(result.ok, true, `应当认出：${line}\n原因：${result.reason}`);
  return result.node;
};

/** 解析一条链接，断言失败并返回原因。 */
const reason = (line) => {
  const result = parseShareLink(line);
  assert.equal(result.ok, false, `不应认出：${line}`);
  assert.ok(result.reason.length > 0);
  return result.reason;
};

/** v2rayN 的 vmess 链接。 */
const vmess = (fields, encode = base64) => `vmess://${encode(JSON.stringify(fields))}`;

// MARK: - Just My Socks 形状的订阅

test("JMS 形状的订阅：整段 base64 解出 1 个 SS 与 5 个 VLESS Reality Vision，名字原样保留", () => {
  const result = parseSubscription(jmsSubscription);
  assert.equal(result.format, "base64");
  assert.deepEqual(result.skipped, []);
  assert.equal(result.nodes.length, 6);
  assert.deepEqual(
    result.nodes.map((n) => n.protocol),
    ["shadowsocks", "vless", "vless", "vless", "vless", "vless"],
  );
  assert.deepEqual(
    result.nodes.map((n) => n.name),
    [
      "JMS-1234567@c95s1.example.com:23456",
      "JMS-1234567@c95s2.example.com:443",
      "JMS-1234567@c95s3.example.com:443",
      "JMS-1234567@c95s4.example.com:443",
      "JMS-1234567@c95s5.example.com:443",
      "JMS-1234567@c95s801.example.com:443",
    ],
    "节点名里的 @ 与 : 不会被当成用户信息与端口",
  );

  const [ss, vless] = result.nodes;
  assert.deepEqual(ss, {
    name: "JMS-1234567@c95s1.example.com:23456",
    protocol: "shadowsocks",
    server: "198.51.100.10",
    port: 23456,
    outbound: { type: "shadowsocks", server: "198.51.100.10", server_port: 23456, method: "aes-256-gcm", password: SS_PASSWORD },
  });
  assert.deepEqual(vless, {
    name: "JMS-1234567@c95s2.example.com:443",
    protocol: "vless",
    server: "c95s2.example.com",
    port: 443,
    outbound: {
      type: "vless",
      server: "c95s2.example.com",
      server_port: 443,
      uuid: UUID,
      flow: "xtls-rprx-vision",
      tls: {
        enabled: true,
        server_name: "www.example.org",
        utls: { enabled: true, fingerprint: "chrome" },
        reality: { enabled: true, public_key: REALITY_PUBLIC_KEY, short_id: REALITY_SHORT_ID },
      },
      packet_encoding: "xudp",
    },
  });
  assert.equal("tag" in vless.outbound, false, "出站不带 tag：tag 在生成配置时由节点名决定");
});

// MARK: - 外形与 base64 变体

test("同一组链接：标准 / 无补位 / URL-safe / 76 列折行 / CRLF 的 base64 都认得，明文逐行也认得", () => {
  const text = jmsLinks.join("\n");
  const variants = {
    standard: base64(text),
    unpadded: base64(text).replace(/=+$/, ""),
    urlsafe: base64url(text),
    wrapped: base64(text).replace(/.{76}/g, "$&\n"),
    crlf: base64(jmsLinks.join("\r\n")).replace(/.{76}/g, "$&\r\n"),
    padded: `\uFEFF  ${base64(text)}\n\n`,
  };
  for (const [label, body] of Object.entries(variants)) {
    const result = parseSubscription(body);
    assert.equal(result.format, "base64", label);
    assert.equal(result.nodes.length, 6, label);
    assert.deepEqual(result.skipped, [], label);
  }
  const plain = parseSubscription(`${jmsLinks.join("\r\n")}\n\n`);
  assert.equal(plain.format, "links");
  assert.equal(plain.nodes.length, 6);
});

test("decodeBase64：两套字母表、补位可有可无、空白忽略；非法输入为 null", () => {
  const bytes = (text) => Array.from(decodeBase64(text) ?? []);
  assert.deepEqual(bytes("+/8="), [0xfb, 0xff]);
  assert.deepEqual(bytes("-_8"), [0xfb, 0xff]);
  assert.deepEqual(bytes("aGk"), [0x68, 0x69]);
  assert.deepEqual(bytes("aG\nk="), [0x68, 0x69]);
  assert.equal(decodeBase64(""), null);
  assert.equal(decodeBase64("a"), null, "长度余 1 不可能是 base64");
  assert.equal(decodeBase64("aG=k"), null, "补位只能在末尾");
  assert.equal(decodeBase64("aGk==="), null);
  assert.equal(decodeBase64("a*bc"), null);
  assert.equal(decodeBase64Text(base64("香港 🇭🇰")), "香港 🇭🇰");
  assert.equal(decodeBase64Text(Buffer.from([0xff, 0xfe, 0x00]).toString("base64")), null, "不是 UTF-8 的字节不算文字");
  assert.equal(decodeBase64Text("abcd"), null, "碰巧由 base64 字母组成的单词不会被当成 base64 订阅");
});

test("percentDecode：连续的 %XX 按 UTF-8 解，坏的序列原样保留", () => {
  assert.equal(percentDecode("%E9%A6%99%E6%B8%AF%2001"), "香港 01");
  assert.equal(percentDecode("100%好用"), "100%好用");
  assert.equal(percentDecode("a%E9%A6b"), "a%E9%A6b", "残缺的多字节序列不硬解");
  assert.equal(percentDecode("a+b"), "a+b", "+ 不当空格");
});

test("sing-box JSON：只留六种代理出站，策略组与内建出站静静丢掉，其余逐条说明", () => {
  const document = {
    log: { level: "warn" },
    outbounds: [
      { type: "selector", tag: "proxy", outbounds: ["a"] },
      { type: "urltest", tag: "auto", outbounds: ["a"] },
      { type: "direct", tag: "direct" },
      { type: "block", tag: "block" },
      { type: "dns", tag: "dns-out" },
      { type: "trojan", tag: "a", server: "a.example.com", server_port: 443, password: "pw", tls: { enabled: true }, domain_resolver: "their-dns" },
      { type: "hysteria2", tag: "direct", server: "[2001:db8::1]", server_port: 8443, password: "pw", tls: { enabled: true } },
      { type: "hysteria2", tag: "跳跃", server: "h.example.com", server_ports: ["20000:30000"], password: "pw", tls: { enabled: true } },
      { type: "hysteria", tag: "v1", server: "a.example.com", server_port: 443 },
      { type: "vless", tag: "chain", server: "a.example.com", server_port: 443, uuid: UUID, detour: "a" },
      { type: "vmess", tag: "no-port", server: "a.example.com", uuid: UUID },
      "not an object",
    ],
    endpoints: [{ type: "wireguard", tag: "wg" }],
  };
  const result = parseSubscription(JSON.stringify(document, null, 2));
  assert.equal(result.format, "sing-box");
  assert.deepEqual(
    result.nodes.map((n) => [n.name, n.protocol, n.server, n.port]),
    [
      ["a", "trojan", "a.example.com", 443],
      ["direct 2", "hysteria2", "2001:db8::1", 8443],
      ["跳跃", "hysteria2", "h.example.com", 20000],
    ],
    "撞了直连出站 tag 的节点改名；IPv6 去方括号；只有 server_ports 的取第一个端口",
  );
  assert.deepEqual(result.nodes[0].outbound, {
    type: "trojan",
    server: "a.example.com",
    server_port: 443,
    password: "pw",
    tls: { enabled: true },
  });
  assert.deepEqual(
    result.skipped.map((s) => s.reason),
    [
      "本期不支持 hysteria 出站",
      "经由另一个出站（detour）的链式节点本期不支持",
      "出站没有合法的 server_port",
      "不是一个出站对象",
      "本期不支持 wireguard 端点（endpoint）",
    ],
  );
  assert.ok(result.skipped[0].line.startsWith("outbounds[8] "));
});

test("sing-box JSON：解析失败与缺 outbounds 各一条说明", () => {
  const broken = parseSubscription('{ "outbounds": [ ');
  assert.equal(broken.format, "sing-box");
  assert.equal(broken.nodes.length, 0);
  assert.match(broken.skipped[0].reason, /^JSON 解析失败/);
  const empty = parseSubscription('{ "inbounds": [] }');
  assert.deepEqual(empty.skipped.map((s) => s.reason), ["JSON 里没有 outbounds 数组，不是 sing-box 配置"]);
});

test("网页与 Clash YAML：整份一句话，不逐行刷屏", () => {
  const html = parseSubscription("<!DOCTYPE html>\n<html><body><a href=\"https://example.com\">login</a></body></html>");
  assert.equal(html.skipped.length, 1);
  assert.match(html.skipped[0].reason, /网页/);
  const yaml = parseSubscription("port: 7890\nproxies:\n  - { name: a, type: ss, server: a.example.com }\n");
  assert.equal(yaml.skipped.length, 1);
  assert.match(yaml.skipped[0].reason, /Clash YAML/);
});

// MARK: - Shadowsocks

test("ss SIP002：base64url 用户信息、明文的 SS-2022 写法、插件", () => {
  assert.deepEqual(node(`ss://${base64url("chacha20-ietf-poly1305:p@ss:word")}@203.0.113.7:8388/#a`).outbound, {
    type: "shadowsocks",
    server: "203.0.113.7",
    server_port: 8388,
    method: "chacha20-ietf-poly1305",
    password: "p@ss:word",
  });
  // 标准字母表、带补位、补位被百分号编码：都见过。
  const padded = base64("aes-128-gcm:p>100?");
  assert.ok(padded.includes("/"), "前提：这段 base64 里有 /");
  assert.equal(node(`ss://${padded.replace(/=/g, "%3D")}@203.0.113.7:8388#b`).outbound.password, "p>100?");

  const key = Buffer.alloc(16, 7).toString("base64");
  const ss2022 = node(`ss://2022-blake3-aes-128-gcm:${encodeURIComponent(key)}@[2001:db8::2]:443#c`);
  assert.equal(ss2022.server, "2001:db8::2");
  assert.equal(ss2022.outbound.password, key);

  const obfs = node(`ss://${base64url("aes-256-gcm:pw")}@a.example.com:443/?plugin=${encodeURIComponent("simple-obfs;obfs=http;obfs-host=b.example.com")}#d`);
  assert.equal(obfs.outbound.plugin, "obfs-local", "simple-obfs 是 obfs-local 的旧名");
  assert.equal(obfs.outbound.plugin_opts, "obfs=http;obfs-host=b.example.com");
  const v2 = node(`ss://${base64url("aes-256-gcm:pw")}@a.example.com:443?plugin=${encodeURIComponent("v2ray-plugin;tls;host=b.example.com")}`);
  assert.equal(v2.outbound.plugin, "v2ray-plugin");
});

test("ss 旧式：整段 base64(method:password@host:port)，标准字母表里的 / 不被当成路径", () => {
  const encoded = base64("chacha20-ietf-poly1305:0>>?@203.0.113.7:8388");
  assert.ok(encoded.includes("/"), "前提：这段 base64 里有 /");
  const legacy = node(`ss://${encoded}#${encodeURIComponent("旧式 节点")}`);
  assert.equal(legacy.name, "旧式 节点");
  assert.deepEqual(legacy.outbound, {
    type: "shadowsocks",
    server: "203.0.113.7",
    server_port: 8388,
    method: "chacha20-ietf-poly1305",
    password: "0>>?",
  });
  assert.equal(node(`ss://${base64url("aes-256-gcm:pw@a.example.com:443")}`).name, "a.example.com:443", "没写名字用 server:port");
});

test("ss 认不出的：未知加密、SS-2022 密钥长度不对、sing-box 没有的插件、坏的 base64", () => {
  assert.match(reason(`ss://${base64url("rc4:pw")}@a.example.com:443`), /不支持的 Shadowsocks 加密方式：rc4/);
  const shortKey = Buffer.alloc(16, 1).toString("base64");
  assert.match(reason(`ss://2022-blake3-aes-256-gcm:${encodeURIComponent(shortKey)}@a.example.com:443`), /32 字节密钥/);
  assert.match(reason(`ss://${base64url("aes-256-gcm:pw")}@a.example.com:443?plugin=kcptun%3Bmode%3Dfast`), /需要插件 kcptun/);
  assert.match(reason(`ss://${base64url("aes-256-gcm:pw")}@a.example.com:443?plugin=obfs-local%3Bobfs%3Dwebsocket`), /obfs 模式/);
  assert.match(reason("ss://%%%@a.example.com:443"), /用户信息/);
  assert.match(reason("ss://!!!!#x"), /既不是 SIP002 也不是旧式/);
  assert.match(reason(`ss://${base64url("aes-256-gcm:pw")}@a.example.com:99999`), /端口不合法/);
  assert.match(reason(`ss://${base64url("aes-256-gcm:pw")}@a.example.com`), /缺少端口/);
});

// MARK: - VMess

test("vmess（v2rayN JSON）：ws + TLS + 0-RTT、ALPN、指纹；SNI 缺省取 Host", () => {
  const parsed = node(
    vmess({
      v: "2",
      ps: "香港 01",
      add: "hk.example.com",
      port: "443",
      id: UUID,
      aid: "0",
      scy: "auto",
      net: "ws",
      type: "none",
      host: "cdn.example.com",
      path: "/ray?ed=2048",
      tls: "tls",
      sni: "",
      alpn: "h2,http/1.1",
      fp: "chrome",
    }),
  );
  assert.equal(parsed.name, "香港 01");
  assert.deepEqual(parsed.outbound, {
    type: "vmess",
    server: "hk.example.com",
    server_port: 443,
    uuid: UUID,
    security: "auto",
    transport: {
      type: "ws",
      path: "/ray",
      headers: { Host: "cdn.example.com" },
      max_early_data: 2048,
      early_data_header_name: "Sec-WebSocket-Protocol",
    },
    tls: {
      enabled: true,
      server_name: "cdn.example.com",
      alpn: ["h2", "http/1.1"],
      utls: { enabled: true, fingerprint: "chrome" },
    },
  });
});

test("vmess：数字字段、URL-safe 无补位、gRPC / h2 / 裸 TCP / HTTP 伪装、旧协议 alter_id", () => {
  const grpc = node(vmess({ add: "g.example.com", port: 443, id: UUID, aid: 0, net: "grpc", path: "svc", tls: "tls", sni: "s.example.com" }, base64url));
  assert.deepEqual(grpc.outbound.transport, { type: "grpc", service_name: "svc" });
  assert.equal(grpc.outbound.tls.server_name, "s.example.com");
  assert.equal(grpc.port, 443);

  const h2 = node(vmess({ add: "h.example.com", port: "443", id: UUID, net: "h2", host: "a.example.com,b.example.com", path: "/h2", tls: "tls" }));
  assert.deepEqual(h2.outbound.transport, { type: "http", host: ["a.example.com", "b.example.com"], path: "/h2" });

  const tcp = node(vmess({ add: "203.0.113.9", port: "10086", id: UUID, aid: "64", net: "tcp", scy: "aes-128-gcm" }));
  assert.equal(tcp.outbound.transport, undefined);
  assert.equal(tcp.outbound.tls, undefined);
  assert.equal(tcp.outbound.alter_id, 64);
  assert.equal(tcp.outbound.security, "aes-128-gcm");
  assert.equal(tcp.name, "203.0.113.9:10086");

  const fake = node(vmess({ add: "f.example.com", port: "80", id: UUID, net: "tcp", type: "http", host: "www.example.net", path: "/a,/b" }));
  assert.deepEqual(fake.outbound.transport, { type: "http", method: "GET", host: ["www.example.net"], path: "/a" });
});

test("vmess 认不出的：非 JSON、缺 id、sing-box 不认的加密 / 传输 / TLS 组合", () => {
  assert.match(reason(`vmess://${base64("auto:uuid@a.example.com:443")}?remarks=x`), /不是 JSON/);
  assert.match(reason("vmess://not-base64!"), /base64 JSON/);
  assert.match(reason(vmess({ add: "a.example.com", port: "443" })), /缺少 id/);
  assert.match(reason(vmess({ add: "a.example.com", port: "443", id: UUID, scy: "aes-128-ctr" })), /加密方式：aes-128-ctr/);
  assert.match(reason(vmess({ add: "a.example.com", port: "443", id: UUID, net: "kcp" })), /不支持 kcp 传输/);
  assert.match(reason(vmess({ add: "a.example.com", port: "443", id: UUID, net: "tcp", type: "http", tls: "tls" })), /TCP \+ HTTP 伪装 \+ TLS/);
  assert.match(reason(vmess({ add: "", port: "443", id: UUID })), /缺少服务器地址/);
});

// MARK: - VLESS

test("vless：TLS + ws、gRPC、httpupgrade、IPv6、Vision 的 udp443 变体", () => {
  const ws = node(
    `vless://${UUID_2}@[2001:db8::3]:8443?encryption=none&security=tls&sni=v.example.com&alpn=h2%2Chttp%2F1.1&fp=safari&allowInsecure=1&type=ws&host=cdn.example.com&path=%2Fws%3Fed%3D2560#WS`,
  );
  assert.equal(ws.server, "2001:db8::3");
  assert.deepEqual(ws.outbound, {
    type: "vless",
    server: "2001:db8::3",
    server_port: 8443,
    uuid: UUID_2,
    tls: {
      enabled: true,
      server_name: "v.example.com",
      insecure: true,
      alpn: ["h2", "http/1.1"],
      utls: { enabled: true, fingerprint: "safari" },
    },
    transport: {
      type: "ws",
      path: "/ws",
      headers: { Host: "cdn.example.com" },
      max_early_data: 2560,
      early_data_header_name: "Sec-WebSocket-Protocol",
    },
    packet_encoding: "xudp",
  });

  const grpc = node(`vless://${UUID}@g.example.com:443?security=reality&sni=www.example.org&pbk=${REALITY_PUBLIC_KEY}&type=grpc&serviceName=grpc-svc#G`);
  assert.deepEqual(grpc.outbound.transport, { type: "grpc", service_name: "grpc-svc" });
  assert.deepEqual(grpc.outbound.tls.utls, { enabled: true, fingerprint: "chrome" }, "Reality 没写 fp 也要开 uTLS");
  assert.equal(grpc.outbound.tls.reality.short_id, "", "sid 可以为空");

  const upgrade = node(`vless://${UUID}@u.example.com:80?type=httpupgrade&host=u.example.com&path=%2Fup#U`);
  assert.deepEqual(upgrade.outbound.transport, { type: "httpupgrade", host: "u.example.com", path: "/up" });
  assert.equal(upgrade.outbound.tls, undefined, "VLESS 没写 security 即不加密");

  const udp443 = node(`vless://${UUID}@a.example.com:443?flow=xtls-rprx-vision-udp443&security=tls&sni=a.example.com`);
  assert.equal(udp443.outbound.flow, "xtls-rprx-vision");

  const odd = node(`vless://${UUID}@a.example.com:443?security=tls&fp=chrome_psk`);
  assert.deepEqual(odd.outbound.tls.utls, { enabled: true, fingerprint: "chrome" }, "sing-box 不认的指纹换成 chrome");
});

test("vless 认不出的：VLESS 加密、旧 XTLS flow、Reality 公钥 / short id 不合法、sing-box 没有的传输与 security", () => {
  const base = `vless://${UUID}@a.example.com:443`;
  assert.match(reason(`${base}?encryption=mlkem768x25519plus.native.0rtt.abc`), /VLESS 加密/);
  assert.match(reason(`${base}?flow=xtls-rprx-direct&security=tls`), /flow：xtls-rprx-direct/);
  assert.match(reason(`${base}?security=reality&sni=a&sid=${REALITY_SHORT_ID}`), /缺少公钥/);
  assert.match(reason(`${base}?security=reality&pbk=${REALITY_PUBLIC_KEY}=&sid=ab`), /32 字节的 base64url/);
  assert.match(reason(`${base}?security=reality&pbk=${REALITY_PUBLIC_KEY}&sid=abc`), /short id/);
  assert.match(reason(`${base}?security=reality&pbk=${REALITY_PUBLIC_KEY}&sid=0123456789abcdef01`), /short id/);
  assert.match(reason(`${base}?type=xhttp&security=tls`), /不支持 xhttp 传输/);
  assert.match(reason(`${base}?type=quic`), /QUIC 传输必须配 TLS/);
  assert.deepEqual(node(`${base}?type=quic&security=tls&sni=a.example.com`).outbound.transport, { type: "quic" });
  assert.match(reason(`${base}?security=xtls`), /security：xtls/);
  assert.match(reason("vless://a.example.com:443"), /缺少 uuid/);
});

// MARK: - Trojan

test("trojan：默认 TLS、peer 是 sni 的旧名、ws 传输、百分号编码的密码", () => {
  const plain = node("trojan://p%40ss%23word@t.example.com:443?peer=sni.example.com&allowInsecure=true#Trojan");
  assert.deepEqual(plain.outbound, {
    type: "trojan",
    server: "t.example.com",
    server_port: 443,
    password: "p@ss#word",
    tls: { enabled: true, server_name: "sni.example.com", insecure: true },
  });
  const ws = node("trojan://pw@t.example.com:443?security=tls&type=ws&path=%2Ftj&host=cdn.example.com");
  assert.deepEqual(ws.outbound.tls, { enabled: true, server_name: "cdn.example.com" }, "没写 sni 时取 Host");
  assert.deepEqual(ws.outbound.transport, { type: "ws", path: "/tj", headers: { Host: "cdn.example.com" } });
  assert.match(reason("trojan://@t.example.com:443"), /缺少密码/);
});

// MARK: - Hysteria2

test("hysteria2 / hy2：混淆、跳过证书校验、端口省略为 443、端口跳跃", () => {
  const full = node("hysteria2://letmein@h.example.com:8443/?sni=s.example.com&insecure=1&obfs=salamander&obfs-password=cry#HY2");
  assert.deepEqual(full.outbound, {
    type: "hysteria2",
    server: "h.example.com",
    server_port: 8443,
    password: "letmein",
    obfs: { type: "salamander", password: "cry" },
    tls: { enabled: true, server_name: "s.example.com", insecure: true },
  });
  const short = node("hy2://user:pass@h.example.com?sni=h.example.com");
  assert.equal(short.port, 443, "官方 URI：端口省略即 443");
  assert.equal(short.outbound.password, "user:pass", "userpass 认证按 sing-box 的说法拼成一个密码");
  const hopping = node("hy2://pw@h.example.com:443,20000-30000/?mport=40000-41000");
  assert.equal(hopping.outbound.server_port, 443);
  assert.deepEqual(hopping.outbound.server_ports, ["443:443", "20000:30000", "40000:41000"]);
  assert.match(reason("hy2://pw@h.example.com:443?obfs=wechat-video"), /混淆：wechat-video/);
  assert.match(reason("hy2://pw@h.example.com:30000-20000"), /端口不合法/);
});

// MARK: - TUIC

test("tuic：v5 的 uuid:password、拥塞控制、ALPN 缺省 h3、disable_sni", () => {
  const parsed = node(`tuic://${UUID}:p%3Aw@q.example.com:443?congestion_control=bbr&udp_relay_mode=quic&sni=q.example.com&allow_insecure=1&disable_sni=1#TUIC`);
  assert.deepEqual(parsed.outbound, {
    type: "tuic",
    server: "q.example.com",
    server_port: 443,
    uuid: UUID,
    password: "p:w",
    congestion_control: "bbr",
    udp_relay_mode: "quic",
    tls: { enabled: true, server_name: "q.example.com", insecure: true, alpn: ["h3"], disable_sni: true },
  });
  assert.deepEqual(node(`tuic://${UUID}:pw@q.example.com:443?alpn=h3,spdy/3.1`).outbound.tls.alpn, ["h3", "spdy/3.1"]);
  assert.match(reason("tuic://token-only@q.example.com:443"), /TUIC v5/);
  assert.match(reason("tuic://not-a-uuid:pw@q.example.com:443"), /不是合法的 UUID/);
  assert.match(reason(`tuic://${UUID}:pw@q.example.com:443?congestion_control=brutal`), /拥塞控制：brutal/);
});

// MARK: - 认不出的行与名字

test("认不出的行逐条记下、不中断整份，原文过长时剪短", () => {
  const long = `vless://${"x".repeat(500)}`;
  const text = [
    "STATUS=剩余流量：100GB.♥.过期时间：2027-01-01",
    jmsLinks[1],
    "ssr://bm90IHN1cHBvcnRlZA",
    "hysteria://h.example.com:443?auth=x",
    "socks://a.example.com:1080",
    long,
    "",
    "   ",
    jmsLinks[2],
  ].join("\n");
  const result = parseSubscription(text);
  assert.equal(result.format, "links");
  assert.equal(result.nodes.length, 2);
  assert.deepEqual(
    result.skipped.map((s) => s.reason),
    [
      "不是分享链接",
      "sing-box 不支持 ShadowsocksR",
      "本期不支持 Hysteria（第一版）链接，只认 hysteria2",
      "本期不支持 socks:// 链接",
      "vless 链接缺少 uuid",
    ],
  );
  assert.equal(result.skipped[4].line.length, skippedLineLimit);
  assert.ok(result.skipped[4].line.endsWith("…"));
});

test("任何输入都不抛错", () => {
  const samples = [
    "", " ", "{", "[1,2]", "null", "vmess://", "ss://", "ss://@:", "vless://@", "tuic://:", "hy2://", "trojan://#",
    "vless://u@[::1", "ss://YWVzLTI1Ni1nY206cHc@a.example.com:443?plugin", "%E0%A4%A", "a://b://c", "😀".repeat(100),
    "vmess://" + base64("[]"), "vmess://" + base64("null"), JSON.stringify({ outbounds: [null, 1, [], {}] }),
  ];
  for (const sample of samples) {
    assert.doesNotThrow(() => parseSubscription(sample), sample);
    assert.doesNotThrow(() => parseShareLink(sample), sample);
  }
});

test("重名的节点依次加「 2」「 3」；与策略组 / 直连撞名的也改；没写名字用 server:port", () => {
  const ss = (name) => `ss://${base64url("aes-256-gcm:pw")}@a.example.com:443${name === null ? "" : `#${encodeURIComponent(name)}`}`;
  const result = parseSubscription(
    [ss("香港"), ss("香港"), ss("香港 2"), ss("香港"), ss("节点选择"), ss("自动选择"), ss("direct"), ss(null), ss("   "), ss(null)].join("\n"),
  );
  assert.deepEqual(
    result.nodes.map((n) => n.name),
    ["香港", "香港 2", "香港 2 2", "香港 3", "节点选择 2", "自动选择 2", "direct 2", "a.example.com:443", "a.example.com:443 2", "a.example.com:443 3"],
  );
  assert.equal(node("trojan://pw@[2001:db8::9]:443").name, "[2001:db8::9]:443", "IPv6 的 server:port 加方括号");
});

test("dedupeNodeNames：合并多条订阅后再去一次重，不改原对象", () => {
  const first = parseSubscription(jmsLinks.slice(0, 2).join("\n")).nodes;
  const second = parseSubscription(jmsLinks.slice(0, 2).join("\n")).nodes;
  const merged = dedupeNodeNames([...first, ...second]);
  assert.deepEqual(
    merged.map((n) => n.name),
    [
      "JMS-1234567@c95s1.example.com:23456",
      "JMS-1234567@c95s2.example.com:443",
      "JMS-1234567@c95s1.example.com:23456 2",
      "JMS-1234567@c95s2.example.com:443 2",
    ],
  );
  assert.equal(merged[0], first[0], "没改名的节点原样复用");
  assert.equal(second[0].name, "JMS-1234567@c95s1.example.com:23456", "改名的是拷贝");
});
