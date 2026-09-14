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
import { jarvis, ocr, JarvisError } from "@fusionseek/jarvis-extension-sdk";

export interface Translation {
  text: string;
  /** Google 判定的源语言（它自己的代码，如 `en`、`zh-CN`）；判不出为 `null`。 */
  detectedSource: string | null;
  backend: "gtx" | "v2";
  /**
   * 词典。**只有免费端点、且 Google 自己判定原文是一个词时才有**，否则是 `null`。
   *
   * 这个"是不是一个词"的判断交给 Google，不在这里用长度或正则再判一次：实测
   * `found!`（带标点）、`  found  `（带空格）都给词条，而 `Hello, world!`、
   * `Save Changes`、`git commit -m` 一条都不给。自己再判一次只会与它打架——
   * 要么把它给的词条藏掉，要么在它什么都没给的时候画一个空壳。
   */
  dictionary: Dictionary | null;
}

/** 一个词性下的全部词义（`v. 创建; 创立; 成立; …`）。 */
export interface DictionarySense {
  /** Google 给的词性原文（`hl=en`，如 `verb`）。 */
  pos: string;
  /** 词性缩写（`v.`）；目录里没有的原样用 `pos`——宁可长一点也不要猜错。 */
  short: string;
  /** 词义，按 Google 给的顺序：它是按使用频率排的，重排等于把最常用的那个挪走。 */
  terms: string[];
}

export interface Dictionary {
  /**
   * 这条词典查的是哪个词。
   *
   * 与原文可能不同：`founded` 查到的是 `found`，而朗读、音标说的都是它。
   */
  baseForm: string | null;
  /**
   * 原文的读音。英文是 Google 的**美式重拼**（`həˈlō`，不是 IPA），中文是拼音。
   *
   * 与 `senses` 同生共死：Google 对整句也给 `src_translit`（一整段拼音），
   * 那东西放进结果卡里是噪音。只在有词条时才读它，于是这一块要么整块在、要么整块不在。
   */
  phonetic: { text: string; label: string } | null;
  senses: DictionarySense[];
}

/**
 * 词性缩写。**与 Easydict 的那张卡片对齐**：`v.` / `n.` 比 `verb` / `noun` 省一行，
 * 而 400pt 宽的弹窗里每一行都算数。
 *
 * 查不到的原样用英文原文——Google 的词性集合没有公开清单，猜一个缩写出来
 * 是在用户读不懂和读到错的之间选了后者。
 */
const posAbbreviations: Record<string, string> = {
  noun: "n.",
  verb: "v.",
  "auxiliary verb": "aux.",
  adjective: "adj.",
  adverb: "adv.",
  pronoun: "pron.",
  preposition: "prep.",
  conjunction: "conj.",
  interjection: "int.",
  exclamation: "int.",
  determiner: "det.",
  article: "art.",
  numeral: "num.",
  particle: "part.",
  abbreviation: "abbr.",
  prefix: "pref.",
  suffix: "suf.",
};

/**
 * 读音那一枚标签。
 *
 * 英文写「美」：Google 给的是美式重拼，写成「英」会是一句假话。中文写「拼音」，
 * 日韩写「罗马音」——它们与音标是两回事，混作一谈会让用户以为那是发音符号。
 */
function phoneticLabel(source: string | null): string {
  const lower = (source ?? "").toLowerCase();
  if (lower === "en" || lower.startsWith("en-")) return "美";
  if (lower.startsWith("zh")) return "拼音";
  if (lower.startsWith("ja") || lower.startsWith("ko")) return "罗马音";
  return "读音";
}

/**
 * 免费端点的候选：**(主机, client) 的组合，按顺序试，被限流就换下一个。**
 *
 * 这一版是对着实测改的（2026-09-13 本机）：同一主机、同一 IP、同一秒，
 * `client=gtx` 返回 429 与一张 sorry 页，而 `client=at` 与 `client=dict-chrome-ex`
 * 返回 200 与**完全一样形状**的 JSON。也就是说这个端点的限流按 **(主机, client)** 算，
 * 不是单纯按 IP。
 *
 * 上一版写着"限流时绝不换主机，换了只是给同一个 IP 加压"——**那条判断被实测推翻了**。
 * 它正是"经常翻译不出来"的来源：`gtx` 是每篇教程都在用的那个值，被压得最狠，
 * 而我们退避三次之后就放弃了，从没试过别的组合。
 *
 * 顺序上把 Easydict 走的那一个放第一位（`translate.google.com` + `gtx`），
 * 它在那边长期工作；后面几个是本机实测 200 的。
 */
const candidates: { host: string; client: string }[] = [
  { host: "translate.google.com", client: "gtx" },
  { host: "translate.googleapis.com", client: "gtx" },
  { host: "translate.googleapis.com", client: "at" },
  { host: "translate.googleapis.com", client: "dict-chrome-ex" },
];

/**
 * 一个候选被限流之后，多久之内不再碰它。
 *
 * **这是这一版的重点：少发请求本身就是止损。** 限流是按用量算的，而"被拒之后马上再试"
 * 等于一边被拒一边加深限流。Google 的限流窗口是分钟量级，1.2 秒之后重扫一轮
 * 不会有别的结果，只会多四个注定失败的请求——上一版就是这么把自己的额度烧掉的。
 *
 * 5 分钟：短到网络环境一变就能恢复，长到足够跨过一次限流窗口。
 * 服务端给了更长的 `Retry-After` 就听它的。
 */
const cooldownMs = 5 * 60 * 1000;

/** 每个候选的冷却到期时刻（`Date.now()` 毫秒）。只在内存里。 */
const coolingUntil = new Map<string, number>();

/**
 * 上一次成功的那个候选，下一次从它开始扫。
 *
 * **这是为了少发请求，而不是为了快。** 限流是按用量算的，而第一个候选一旦在这台机器上
 * 被压住，不记住的话**每一次翻译**都要先撞它一次再往后走——那些注定失败的请求本身
 * 就在加深限流。记住之后，一次会话里只在第一次付这个代价。
 *
 * 只在内存里，不落盘：换个网络环境、过一阵子，被压住的那个多半又通了，
 * 而一个记在磁盘上的偏好会让它永远排在后面。
 */
let preferred = 0;

/**
 * 单次请求的正文上限，按语种分档，与 Easydict 的两档一致。
 *
 * 中文原文 1800、其余 5000。实测这个长度的中文放进查询串是 16 KB 的 URL，端点照收。
 * 我们是**分块**而不是像 Easydict 那样截断——截断意味着用户看不到后半段，
 * 而他并不知道是被截了。
 */
const chunkLimits = { cjk: 1800, latin: 5000 };

/** 译文缓存。按（源语言 + 目标语言 + 原文）记，最多这么多条。 */
const cacheLimit = 64;
const cache = new Map<string, Translation>();

/**
 * UA。**逐字取自 Easydict 的 `kGoogleUserAgent`**（`GoogleService+Translate.swift:12`）。
 *
 * 它是一个 2019 年的 Chrome 77 串，看着该换新，但这里不换：这一轮的目的就是与那边对齐，
 * 而"换成新串会不会更好"没有任何证据——反过来，这个串在 Easydict 上长期工作是有证据的。
 * 端点对空 UA 偶尔 403，所以它不能省。
 */
const userAgent =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/77.0.3865.120 Safari/537.36";

function chunkLength(text: string): number {
  return /[\u3400-\u9fff\uf900-\ufaff]/.test(text) ? chunkLimits.cjk : chunkLimits.latin;
}

function describe(error: unknown): string {
  if (error instanceof JarvisError) return error.detail ?? error.message;
  return error instanceof Error ? error.message : String(error);
}

/** 查询串。**取 entries 而不是对象**：`dt` 要发好几个，对象装不下重复的键。 */
function form(params: [string, string][]): string {
  return params.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&");
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
  candidate: { host: string; client: string },
  text: string,
  target: string,
  source: string | null
): Promise<Attempt> {
  // **GET，`q` 放查询串**，与 Easydict 一致（它显式 `method: .get`，Alamofire 的
  // `URLEncoding.default` 对 GET 走查询串分支，从不设 body）。实测 1800 个汉字、
  // URL 16 KB，端点照收。
  //
  // 键按字典序排：Alamofire 编码时会 `keys.sorted()`，于是 Easydict 发出去的就是这个顺序。
  // 顺序大概率无关紧要，但这一轮的目的是对齐，能对的就都对上，省得下次再怀疑它。
  //
  // `dj=1` 把回应换成 JSON 对象（`{"sentences":[…],"src":…}`）。不加它拿到的是位置数组，
  // 要按 [0][1][2][8] 硬取下标——Easydict 的 webapp 路径就是那样，
  // 而 Google 一旦调整字段顺序，那种解析会安静地取到错误的东西。
  //
  // **`dt` 发三个**（实测 2026-09-14 本机，四个候选形状一致）：
  // - `t` 译文，一直都在；
  // - `bd` 双语词典（`dict`：词性 + 按频率排的词义 + `base_form`）；
  // - `rm` 转写（`sentences[].src_translit`：英文是美式重拼，中文是拼音）。
  //
  // 只有这一个词的时候 Google 才给后两个，整句它自己就不给——因此多要这两段
  // 对整句翻译**一个字节的代价都没有**，而对单词是从"只有译文"到"有一张词典卡"。
  //
  // `hl=en` 钉住词性的语言。不写它拿到的也是英文，但那是**观察到的默认值不是承诺**；
  // 而缩写表（`posAbbreviations`）是按英文键查的，默认值哪天变成跟随区域，
  // 表现就是缩写整列失效、退回一串本地化词性——写死这一个参数比事后查那种问题便宜。
  const query = form([
    ["client", candidate.client],
    ["dj", "1"],
    ["dt", "t"],
    ["dt", "bd"],
    ["dt", "rm"],
    ["hl", "en"],
    ["ie", "UTF-8"],
    ["q", text],
    ["sl", source ?? "auto"],
    ["tl", target],
  ]);
  let response: Awaited<ReturnType<typeof jarvis.net.fetch>>;
  try {
    response = await jarvis.net.fetch(`https://${candidate.host}/translate_a/single?${query}`, {
      method: "GET",
      headers: { "User-Agent": userAgent },
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
  const body = parsed as GTXBody;
  const translated = (body.sentences ?? []).map((s) => s.trans ?? "").join("");
  if (translated.trim() === "") return { kind: "failed", reason: "Google 没有返回译文" };
  const detectedSource = body.src ?? null;
  return {
    kind: "ok",
    value: {
      text: translated,
      detectedSource,
      backend: "gtx",
      dictionary: readDictionary(body, detectedSource),
    },
  };
}

/** 免费端点的回应里我们读的那几段。没读的字段不写进来——写了就等于承诺会跟着它变。 */
interface GTXBody {
  sentences?: { trans?: string; src_translit?: string }[];
  dict?: { pos?: string; terms?: string[]; base_form?: string }[];
  src?: string;
}

/**
 * 把 `dict` 与 `src_translit` 读成一张词典卡；Google 什么都没给时是 `null`。
 *
 * **词条是这一块的开关**：没有词条就整块不画，读音也一起丢掉（理由见 `Dictionary.phonetic`）。
 */
function readDictionary(body: GTXBody, detectedSource: string | null): Dictionary | null {
  const senses: DictionarySense[] = [];
  for (const entry of body.dict ?? []) {
    const pos = typeof entry.pos === "string" ? entry.pos.trim() : "";
    const terms = (entry.terms ?? []).filter((t): t is string => typeof t === "string" && t.trim() !== "");
    if (terms.length === 0) continue;
    // 查不到就原样用英文原文；`pos` 本来就是空串时这一步给回空串，`dictionary.ts` 据此不画徽章。
    senses.push({ pos, short: posAbbreviations[pos.toLowerCase()] ?? pos, terms });
  }
  if (senses.length === 0) return null;
  const translit = (body.sentences ?? [])
    .map((s) => s.src_translit)
    .find((t): t is string => typeof t === "string" && t.trim() !== "");
  const baseForm = (body.dict ?? [])
    .map((e) => e.base_form)
    .find((f): f is string => typeof f === "string" && f.trim() !== "");
  return {
    baseForm: baseForm ?? null,
    phonetic: translit ? { text: translit.trim(), label: phoneticLabel(detectedSource) } : null,
    senses,
  };
}

/**
 * 扫一遍候选。被限流就**立刻换下一个**，不在这里等——等是给同一个组合等，
 * 而下一个组合此刻多半是通的。
 */
function key(candidate: { host: string; client: string }): string {
  return `${candidate.host}|${candidate.client}`;
}

/** 这个候选此刻还在冷却里吗。 */
function cooling(candidate: { host: string; client: string }, now: number): boolean {
  const until = coolingUntil.get(key(candidate));
  if (until === undefined) return false;
  if (until <= now) {
    coolingUntil.delete(key(candidate));
    return false;
  }
  return true;
}

/**
 * 扫一遍候选。**只扫一遍。**
 *
 * 从上一次成功的那个开始绕一圈，跳过还在冷却里的；被限流的当场进冷却。
 * 一整轮都不通就如实报出去——不再等一会儿重扫，那只是多四个注定失败的请求。
 */
async function gtx(text: string, target: string, source: string | null): Promise<Translation> {
  const now = Date.now();
  let reason: string | undefined;
  let tried = 0;
  for (let step = 0; step < candidates.length; step++) {
    // 从上一次成功的那个开始，绕一圈。
    const index = (preferred + step) % candidates.length;
    const candidate = candidates[index]!;
    if (cooling(candidate, now)) continue;
    tried += 1;
    const outcome = await gtxOnce(candidate, text, target, source);
    if (outcome.kind === "ok") {
      preferred = index;
      return outcome.value;
    }
    if (outcome.kind === "throttled") {
      coolingUntil.set(key(candidate), now + Math.max(cooldownMs, outcome.waitMs ?? 0));
      continue;
    }
    reason = outcome.reason;
  }
  if (reason !== undefined) throw new Error(reason);
  // 全在冷却里：**一个请求都没发**，这正是想要的——被压住的时候安静地等，而不是继续敲。
  throw new Error(
    tried === 0
      ? "Google 的免费端点还在限流冷却里。过几分钟再试，或者在设置里填一个 API key"
      : "Google 的免费端点把这台机器限流了。过几分钟再试，或者在设置里填一个 API key"
  );
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
    // 官方 v2 **没有**词典这一段：它只翻译。填了 API key 的用户因此看不到词典卡，
    // 这写在扩展设置的说明里，不在这里悄悄退回免费端点补一次——那等于背着用户多发一个请求。
    dictionary: null,
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
    // **分了块就没有词典。** 那时第一块的词条只描述前 1800 字里的一个词，
    // 把它挂在整段译文上等于指着一段话说"这是它的词性"。分块只发生在长文本上，
    // 而长文本 Google 本来也不给词条——这一行拦的是"万一它给了"。
    dictionary: pieces.length === 1 ? first.dictionary : null,
  };
  remember(key, merged);
  return merged;
}

/** 清空译文缓存，并把候选偏好与冷却全部复位。 */
export function forgetTranslations(): void {
  cache.clear();
  coolingUntil.clear();
  preferred = 0;
}
