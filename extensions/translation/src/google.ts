/**
 * Google 翻译客户端。**这是扩展自己的逻辑，SDK 里没有任何一行知道 Google。**
 *
 * 两条路（与 Easydict 的 Google 引擎同源，只取翻译这一段）：
 * - 免费的网页端点 `translate_a/single`（`client=gtx`），**不需要 key，也不需要 `tk` 签名**。
 *   读过 Easydict 的源码之后这条可以确定：它的 gtx 路径一个 `tk` 都不发，webapp 路径发的是
 *   拿一个 2022 年写死的 TKK 种子算出来的值、且刷新函数只有语音合成会调——两条路都在工作，
 *   说明这个端点根本不校验它。那套 JS 签名机器只对 `translate_tts` 还有意义。
 * - 官方 Translation API v2（`translation.googleapis.com/language/translate/v2`），要 API key，
 *   走用户在设置里填的 `secret` 偏好。Easydict 没有这一条，我们有。
 *
 * 两条路都经 `jarvis.net.fetch`：只放行 manifest 白名单里的主机、只走 HTTPS、30 秒超时。
 */
import { jarvis, ocr, sleep, JarvisError } from "@fusionseek/jarvis-extension-sdk";

export interface Translation {
  text: string;
  /** Google 判定的源语言（它自己的代码，如 `en`、`zh-CN`）；判不出为 `null`。 */
  detectedSource: string | null;
  backend: "gtx" | "v2";
}

/**
 * 免费端点的两个主机，**按顺序试**。
 *
 * 主用 `translate.googleapis.com`，备用 `translate.google.com`（Easydict 用的那一个）。
 * 两个都不要 key、跑同一套 `translate_a/single`。
 *
 * **换主机只在"这台答得不对"时发生，被限流时绝不换**：限流是按 IP 算的，换个域名还是同一个 IP，
 * 只会给一台已经在拒绝你的服务器加压。Easydict 恰恰做错了这一条——它的 webapp 路径失败后
 * 会回落到 gtx 再打一次同一个主机。
 */
const gtxHosts = [
  "https://translate.googleapis.com/translate_a/single",
  "https://translate.google.com/translate_a/single",
];

/**
 * 退避档位。三次之后仍被挡就报出来——再试下去只是给同一个 IP 加压。
 * 服务端给了 `Retry-After` 就听它的，这几个数只是它没给时的兜底。
 */
const backoffMs = [500, 1500, 4000];

/**
 * 单次请求的正文上限，按语种分档，与 Easydict 的两档一致。
 *
 * 中文原文 1800、其余 5000：同样长度的 q，中文更容易被这个端点 4xx。
 * 我们是**分块**而不是像 Easydict 那样截断——截断意味着用户看不到后半段，
 * 而他并不知道是被截了。
 */
const chunkLimits = { cjk: 1800, latin: 5000 };

/** 译文缓存。按（源语言 + 目标语言 + 原文）记，最多这么多条。 */
const cacheLimit = 64;
const cache = new Map<string, Translation>();

function chunkLength(text: string): number {
  return /[㐀-鿿豈-﫿]/.test(text) ? chunkLimits.cjk : chunkLimits.latin;
}

function describe(error: unknown): string {
  if (error instanceof JarvisError) return error.detail ?? error.message;
  return error instanceof Error ? error.message : String(error);
}

function form(params: Record<string, string>): string {
  return Object.entries(params)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&");
}

function header(headers: Record<string, string>, name: string): string | null {
  const wanted = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === wanted) return value;
  }
  return null;
}

/**
 * 这次回应是不是"被挡住了"。
 *
 * **不能只看 429。** 过了阈值 Google 会用 200 或 302 返回一张 sorry / captcha 的 HTML，
 * 而那会落到 JSON 解析失败那条分支上——提示词变成"格式可能变了"，用户照着这句话去查格式，
 * 查不出任何东西。正文第一个非空字符是 `<` 就当作被挡，这比解析失败更早、也更准。
 */
function throttled(status: number, body: string): boolean {
  if (status === 429 || status === 503) return true;
  const head = body.slice(0, 400).trimStart().toLowerCase();
  return head.startsWith("<!doctype") || head.startsWith("<html");
}

/** `Retry-After` 只认秒数；HTTP 日期那种写法这个端点不用，认了也是给自己找解析错。 */
function retryAfterMs(headers: Record<string, string>): number | null {
  const raw = header(headers, "Retry-After");
  if (raw === null) return null;
  const seconds = Number.parseInt(raw.trim(), 10);
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  // 宿主的定时器单次上限是 30s，超过就等于没等够——这里先夹一次，免得静默变成"立刻重试"。
  return Math.min(seconds, 30) * 1000;
}

type Attempt =
  | { kind: "ok"; value: Translation }
  | { kind: "throttled"; waitMs: number | null }
  | { kind: "failed"; reason: string };

async function gtxOnce(
  endpoint: string,
  text: string,
  target: string,
  source: string | null
): Promise<Attempt> {
  const query = form({
    client: "gtx",
    sl: source ?? "auto",
    tl: target,
    dt: "t",
    // `dj=1` 把回应换成 JSON 对象（`{"sentences":[…],"src":…}`）。
    // 不加它拿到的是位置数组，要按 [0][1][2][8] 硬取下标——Easydict 的 webapp 路径就是那样，
    // 而 Google 一旦调整字段顺序，那种解析会安静地取到错误的东西。
    dj: "1",
    ie: "UTF-8",
  });
  let response: Awaited<ReturnType<typeof jarvis.net.fetch>>;
  try {
    response = await jarvis.net.fetch(`${endpoint}?${query}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded;charset=utf-8",
        // 这个端点对空 UA 偶尔 403。Easydict 冻着一个 2019 年的 Chrome 串；给一个当下的
        // Safari 串同样管用，而且不像那种老串一样一眼就是个脚本。
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15",
      },
      // q 走 POST 体而不是查询串（Easydict 是放查询串的）：长文本不受 URL 长度限制。
      body: form({ q: text }),
    });
  } catch (error) {
    return { kind: "failed", reason: describe(error) };
  }

  if (throttled(response.status, response.text)) {
    return { kind: "throttled", waitMs: retryAfterMs(response.headers) };
  }
  if (response.status !== 200) {
    return { kind: "failed", reason: `Google 返回 ${response.status}` };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(response.text);
  } catch {
    return { kind: "failed", reason: "Google 返回的不是 JSON，免费端点的格式可能变了" };
  }
  const body = parsed as { sentences?: { trans?: string }[]; src?: string };
  const translated = (body.sentences ?? []).map((s) => s.trans ?? "").join("");
  if (translated.trim() === "") return { kind: "failed", reason: "Google 没有返回译文" };
  return {
    kind: "ok",
    value: { text: translated, detectedSource: body.src ?? null, backend: "gtx" },
  };
}

async function gtx(text: string, target: string, source: string | null): Promise<Translation> {
  let reason = "Google 没有返回译文";
  for (const endpoint of gtxHosts) {
    for (let attempt = 0; ; attempt++) {
      const outcome = await gtxOnce(endpoint, text, target, source);
      if (outcome.kind === "ok") return outcome.value;
      if (outcome.kind === "failed") {
        // 这台答得不对：换下一台。
        reason = outcome.reason;
        break;
      }
      if (attempt >= backoffMs.length) {
        // 退避用尽。**不换主机**——见 `gtxHosts` 的注释。
        throw new Error("Google 的免费端点把这台机器限流了。等几分钟再试，或者在设置里填一个 API key");
      }
      await sleep(outcome.waitMs ?? backoffMs[attempt]!);
    }
  }
  throw new Error(reason);
}

async function v2(
  text: string,
  target: string,
  source: string | null,
  apiKey: string
): Promise<Translation> {
  const response = await jarvis.net.fetch(
    `https://translation.googleapis.com/language/translate/v2?key=${encodeURIComponent(apiKey)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({ q: [text], target, format: "text", ...(source ? { source } : {}) }),
    }
  );
  if (response.status === 403 || response.status === 400) {
    throw new Error("Google 拒绝了这个 API key（检查它是否启用了 Cloud Translation API）");
  }
  if (response.status === 429) {
    throw new Error("这个 API key 的配额用完了");
  }
  if (response.status !== 200) throw new Error(`Google Translation API 返回 ${response.status}`);
  const body = JSON.parse(response.text) as {
    data?: { translations?: { translatedText?: string; detectedSourceLanguage?: string }[] };
  };
  const first = body.data?.translations?.[0];
  if (!first?.translatedText) throw new Error("Google Translation API 没有返回译文");
  return {
    text: first.translatedText,
    detectedSource: first.detectedSourceLanguage ?? null,
    backend: "v2",
  };
}

function remember(key: string, value: Translation): void {
  // Map 记得插入顺序，第一个键就是最老的那条。
  if (cache.size >= cacheLimit) {
    const oldest = cache.keys().next();
    if (!oldest.done) cache.delete(oldest.value);
  }
  cache.set(key, value);
}

/**
 * 翻译一段文本。长文本按句边界分块、逐块请求、按段落拼回；任何一块失败整次失败并说清原因。
 * `source` 是用户在语言行里手动指定的原文语言（Google 代码）；`null` = 让 Google 自己判。
 *
 * **命中缓存就不发请求。** 免费端点是按 IP 限流的，而重复翻译同一段（截了同一块、
 * 或者来回切换目标语言又切回来）在真实使用里非常常见——缓存是唯一能真正减少 IP 暴露的手段。
 */
export async function translate(
  text: string,
  target: string,
  apiKey: string | null,
  source: string | null = null
): Promise<Translation> {
  const key = `${source ?? "auto"} ${target} ${apiKey ? "v2" : "gtx"} ${text}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const pieces = ocr.chunk(text, chunkLength(text));
  if (pieces.length === 0) throw new Error("没有可翻译的文字");
  const results: Translation[] = [];
  for (const piece of pieces) {
    try {
      results.push(apiKey ? await v2(piece, target, source, apiKey) : await gtx(piece, target, source));
    } catch (error) {
      throw new Error(describe(error));
    }
  }
  const first = results[0]!;
  const merged: Translation = {
    text: results.map((r) => r.text).join("\n\n"),
    detectedSource: first.detectedSource,
    backend: first.backend,
  };
  remember(key, merged);
  return merged;
}

/** 清空译文缓存。只给测试用。 */
export function forgetTranslations(): void {
  cache.clear();
}
