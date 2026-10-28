/**
 * 测试共用的东西（不是测试文件，`node --test test/*.test.mjs` 不会把它当测试跑）：
 *
 * 1. `loadSource()`：把 `src/` 里的纯模块现编成一份 ESM 直接 import。产物 `dist/extension.js` 是 IIFE、
 *    只露出 `defineExtension` 那一次注册，解析器与配置生成器从服务那一面看不到；这里**只在测试时**编译，不落盘、不随扩展发布。
 * 2. 一组**合成**的订阅样本：形状照着真实订阅（Just My Socks 的 1 个 Shadowsocks + 5 个 VLESS Reality Vision），
 *    但 UUID、密码、Reality 公钥、short id、主机与 IP 全是编的（主机在 `example.com` 下、IP 在 RFC 5737 文档网段里）。
 *    **不得换成真实订阅**：测试文件随仓库公开。
 */
import { build } from "esbuild";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
export const extensionRoot = join(here, "..");

/**
 * 现编 `src/` 的纯模块（`nodes`、`subscription`、`singbox-config`、`clash`、`store`、`status`）。
 * @returns 模块命名空间。
 */
export async function loadSource() {
  const result = await build({
    stdin: {
      contents: [
        'export * from "./src/nodes.ts";',
        'export * from "./src/subscription.ts";',
        'export * from "./src/singbox-config.ts";',
        'export * from "./src/clash.ts";',
        'export * from "./src/store.ts";',
        'export * from "./src/status.ts";',
      ].join("\n"),
      resolveDir: extensionRoot,
      loader: "ts",
      sourcefile: "test-entry.ts",
    },
    bundle: true,
    format: "esm",
    platform: "neutral",
    target: ["es2020"],
    write: false,
    logLevel: "silent",
    // 纯模块只从 SDK 引类型（编译时擦掉）；别名留着，免得哪天引了一个值时这里找不到包。
    alias: { "@fusionseek/jarvis-extension-sdk": join(extensionRoot, "..", "..", "sdk", "src", "index.ts") },
  });
  const code = result.outputFiles[0].text;
  return import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`);
}

/** 标准 base64（带补位）。 */
export const base64 = (text) => Buffer.from(text, "utf8").toString("base64");
/** URL-safe base64（不带补位）。 */
export const base64url = (text) => Buffer.from(text, "utf8").toString("base64url");

/** 合成的 UUID（`sing-box generate uuid` 生成，与任何真实账号无关）。 */
export const UUID = "025fde5c-47f1-4b99-a1ed-a3712436663f";
export const UUID_2 = "cc8b7fae-aebe-41f8-971d-10c31024da02";
/** 合成的 Reality 公钥（`sing-box generate reality-keypair` 现生成的一对里的公钥，私钥已丢弃）。 */
export const REALITY_PUBLIC_KEY = "PUYiRhf1fWIl6z_Y75g-YyuemGzrp00bn9m5zt-RLE4";
export const REALITY_SHORT_ID = "0123abcd";
/** 合成的 Shadowsocks 密码。 */
export const SS_PASSWORD = "synthetic-password-not-real";

/** 账号号段：编的。JMS 的节点名形如 `JMS-<账号>@<主机>:<端口>`——名字里本身带 `@` 与 `:`，正好考拆链接的顺序。 */
const account = "JMS-1234567";

/** 一份与 Just My Socks 订阅同形的分享链接列表（1 SS + 5 VLESS Reality Vision）。 */
export const jmsLinks = [
  `ss://${base64url(`aes-256-gcm:${SS_PASSWORD}`)}@198.51.100.10:23456#${account}@c95s1.example.com:23456`,
  ...[2, 3, 4, 5, 801].map(
    (index) =>
      `vless://${UUID}@c95s${index}.example.com:443?encryption=none&flow=xtls-rprx-vision&security=reality` +
      `&sni=www.example.org&fp=chrome&pbk=${REALITY_PUBLIC_KEY}&sid=${REALITY_SHORT_ID}&type=tcp&headerType=none` +
      `#${account}@c95s${index}.example.com:443`,
  ),
];

/** 机场实际下发的样子：整段标准 base64（带补位）。 */
export const jmsSubscription = base64(jmsLinks.join("\n"));
