/**
 * Google 翻译客户端。**这是扩展自己的逻辑，SDK 里没有任何一行知道 Google。**
 *
 * 两条路（与 Easydict 的 Google 引擎同源，只取翻译这一段）：
 * - 免费的网页端点 `translate.googleapis.com/translate_a/single`（`client=gtx`），无需 key；
 *   没有官方承诺，随时可能限流或改格式，因此解析要宽容、失败要说人话。
 * - 官方 Translation API v2（`translation.googleapis.com/language/translate/v2`），要 API key，
 *   走用户在设置里填的 `secret` 偏好。
 *
 * 两条路都经 `jarvis.net.fetch`：只放行 manifest 白名单里的两个主机、只走 HTTPS、30 秒超时。
 */
import { jarvis, ocr, JarvisError } from "@fusionseek/jarvis-extension-sdk";

export interface Translation {
  text: string;
  /** Google 判定的源语言（它自己的代码，如 `en`、`zh-CN`）；判不出为 `null`。 */
  detectedSource: string | null;
  backend: "gtx" | "v2";
}

/** 单次请求的正文上限。gtx 端点对更长的正文会 4xx；官方端点按字符计费，同样分块。 */
const chunkLength = 4000;

function describe(error: unknown): string {
  if (error instanceof JarvisError) return error.detail ?? error.message;
  return error instanceof Error ? error.message : String(error);
}

function form(params: Record<string, string>): string {
  return Object.entries(params)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&");
}

async function gtx(text: string, target: string, source: string | null): Promise<Translation> {
  const query = form({ client: "gtx", sl: source ?? "auto", tl: target, dt: "t", dj: "1" });
  const response = await jarvis.net.fetch(`https://translate.googleapis.com/translate_a/single?${query}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded;charset=utf-8",
      // 这个端点对空 UA 偶尔 403；给一个浏览器样子的 UA 是 Easydict 等客户端的通行做法。
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15",
    },
    body: form({ q: text }),
  });
  if (response.status !== 200) {
    throw new Error(response.status === 429 ? "Google 免费端点限流了，稍后再试或填一个 API key" : `Google 返回 ${response.status}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(response.text);
  } catch {
    throw new Error("Google 返回的不是 JSON，免费端点的格式可能变了");
  }
  const body = parsed as { sentences?: { trans?: string }[]; src?: string };
  const translated = (body.sentences ?? []).map((s) => s.trans ?? "").join("");
  if (translated.trim() === "") throw new Error("Google 没有返回译文");
  return { text: translated, detectedSource: body.src ?? null, backend: "gtx" };
}

async function v2(text: string, target: string, source: string | null, apiKey: string): Promise<Translation> {
  const response = await jarvis.net.fetch(`https://translation.googleapis.com/language/translate/v2?key=${encodeURIComponent(apiKey)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify({ q: [text], target, format: "text", ...(source ? { source } : {}) }),
  });
  if (response.status === 403 || response.status === 400) {
    throw new Error("Google 拒绝了这个 API key（检查它是否启用了 Cloud Translation API）");
  }
  if (response.status !== 200) throw new Error(`Google Translation API 返回 ${response.status}`);
  const body = JSON.parse(response.text) as {
    data?: { translations?: { translatedText?: string; detectedSourceLanguage?: string }[] };
  };
  const first = body.data?.translations?.[0];
  if (!first?.translatedText) throw new Error("Google Translation API 没有返回译文");
  return { text: first.translatedText, detectedSource: first.detectedSourceLanguage ?? null, backend: "v2" };
}

/**
 * 翻译一段文本。长文本按句边界分块、逐块请求、按段落拼回；任何一块失败整次失败并说清原因。
 * `source` 是用户在语言行里手动指定的原文语言（Google 代码）；`null` = 让 Google 自己判。
 */
export async function translate(text: string, target: string, apiKey: string | null, source: string | null = null): Promise<Translation> {
  const pieces = ocr.chunk(text, chunkLength);
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
  return {
    text: results.map((r) => r.text).join("\n\n"),
    detectedSource: first.detectedSource,
    backend: first.backend,
  };
}
