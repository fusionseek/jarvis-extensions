/**
 * 截屏翻译 —— 第一个用「命令 + 页面」模型写的扩展，也是这个平台的参考实现。
 *
 * 三条命令：
 * - `capture-translate`（⌥⌘T，panel）：框选 → OCR → 合并段落 → 检测语言 → Google → 面板里看结果；
 * - `capture-copy`（⌥⌘O，silent）：同上，但译文直接进剪贴板 + 一条横幅，不开面板；
 * - `translate-clipboard`（panel）：剪贴板里是文字就翻文字，是图就先 OCR。
 *
 * 页面是结果的落点，也能手动改原文重翻。每一项能力都有拒绝态。
 * OCR、截图、语音、网络全在宿主；这里只有编排与 Google 的请求 / 响应。
 */
import {
  defineExtension,
  jarvis,
  ocr,
  ui,
  JarvisError,
  type ActionSpec,
  type CapabilityID,
  type CommandContext,
  type FileHandle,
  type OCRResult,
  type UINode,
} from "@fusionseek/jarvis-extension-sdk";
import { translate, type Translation } from "./google.js";

// ---------------------------------------------------------------------------
// 状态：模块变量。页面收回再打开是新的一次 activate，但这些值留着——用户按下快捷键之后
// 面板才展开，结果必须在 activate 之前就已经算好放在这里。
// ---------------------------------------------------------------------------

type Phase = "idle" | "capturing" | "recognizing" | "translating" | "done" | "failed";

interface Prefs {
  targetLanguage: string;
  alternateLanguage: string;
  ocrLanguages: string[];
  autoCopy: boolean;
}

let phase: Phase = "idle";
let source = "";
let sourceOrigin: "screenshot" | "clipboard" | "typed" = "typed";
let sourceLines = 0;
let image: FileHandle | null = null;
let detected: { code: string | null; name: string } = { code: null, name: "" };
let target = "zh-CN";
let translation: Translation | null = null;
let failure: string | null = null;
let granted = new Set<CapabilityID>();
let prefs: Prefs = { targetLanguage: "zh-CN", alternateLanguage: "en", ocrLanguages: ["zh-Hans", "en-US"], autoCopy: false };
let translatedAt: string | null = null;

const has = (id: CapabilityID) => granted.has(id);

function describe(error: unknown): string {
  if (error instanceof JarvisError) return error.detail ?? error.message;
  return error instanceof Error ? error.message : String(error);
}

function readPrefs(raw: Record<string, unknown>): void {
  prefs = {
    targetLanguage: typeof raw["targetLanguage"] === "string" ? raw["targetLanguage"] : prefs.targetLanguage,
    alternateLanguage: typeof raw["alternateLanguage"] === "string" ? raw["alternateLanguage"] : prefs.alternateLanguage,
    ocrLanguages: Array.isArray(raw["ocrLanguages"]) ? (raw["ocrLanguages"] as string[]) : prefs.ocrLanguages,
    autoCopy: typeof raw["autoCopy"] === "boolean" ? raw["autoCopy"] : prefs.autoCopy,
  };
  if (target === "" || target === prefs.targetLanguage) target = prefs.targetLanguage;
}

/** Google 的语言代码与 BCP-47 之间只差中文那几档。 */
function sameLanguage(a: string | null, b: string): boolean {
  if (!a) return false;
  const norm = (code: string) => code.toLowerCase().replace("zh-hans", "zh-cn").replace("zh-hant", "zh-tw").replace("_", "-");
  const x = norm(a);
  const y = norm(b);
  return x === y || x.split("-")[0] === y.split("-")[0] && !x.startsWith("zh");
}

/** 原文已经是目标语言时，改翻成备选语言——否则 Google 会原样吐回来。 */
function resolveTarget(detectedCode: string | null): string {
  return sameLanguage(detectedCode, prefs.targetLanguage) ? prefs.alternateLanguage : prefs.targetLanguage;
}

function detectLanguage(text: string): void {
  try {
    const result = jarvis.text.language.detect(text, { hints: prefs.ocrLanguages });
    detected = { code: result.code, name: result.code ? jarvis.text.language.displayName(result.code) : "" };
  } catch {
    detected = { code: null, name: "" };
  }
}

// ---------------------------------------------------------------------------
// 编排
// ---------------------------------------------------------------------------

async function captureAndRecognize(): Promise<boolean> {
  phase = "capturing";
  failure = null;
  jarvis.ui.update();
  try {
    const shot = await jarvis.screenshot.capture({
      selectionOnly: true,
      recognizeText: true,
      ocr: { languages: prefs.ocrLanguages, level: "accurate" },
    });
    image = shot.file;
    adoptOCR(shot.ocr, "screenshot");
    return source.trim() !== "";
  } catch (error) {
    if (error instanceof JarvisError && error.code === "cancelled") {
      phase = translation ? "done" : "idle";
      return false;
    }
    failure = describe(error);
    phase = "failed";
    return false;
  } finally {
    jarvis.ui.update();
  }
}

function adoptOCR(result: OCRResult | undefined, origin: "screenshot" | "clipboard"): void {
  const lines = result?.lines ?? [];
  sourceLines = lines.length;
  sourceOrigin = origin;
  if (lines.length === 0) {
    source = "";
    detected = { code: null, name: "" };
    failure = "这块区域里没有可识别的文字";
    phase = "failed";
    return;
  }
  // 先按无语言合一次拿去检测，再按检测出的语言合一次——中英夹杂的截图两次结果可能不同。
  const draft = ocr.mergeLines(lines);
  detectLanguage(draft);
  source = ocr.mergeLines(lines, detected.code ? { language: detected.code } : {});
  phase = "recognizing";
}

async function translateSource(): Promise<boolean> {
  const text = source.trim();
  if (text === "") return false;
  phase = "translating";
  failure = null;
  jarvis.ui.update();
  // 翻译跨越指针离开：用户按下快捷键之后眼睛在原来的窗口上，15 秒倒计时不该收走这一屏。
  const hold = jarvis.panel.hold("正在翻译");
  try {
    if (!detected.code) detectLanguage(text);
    target = resolveTarget(detected.code);
    const apiKey = await readAPIKey();
    translation = await translate(text, target, apiKey);
    if (!detected.code && translation.detectedSource) {
      detected = { code: translation.detectedSource, name: jarvis.text.language.displayName(translation.detectedSource) };
    }
    translatedAt = new Date().toISOString();
    phase = "done";
    if (prefs.autoCopy && has("clipboard.write")) await jarvis.clipboard.write(translation.text);
    return true;
  } catch (error) {
    failure = describe(error);
    phase = "failed";
    return false;
  } finally {
    hold.release();
    jarvis.ui.update();
  }
}

async function readAPIKey(): Promise<string | null> {
  try {
    const key = await jarvis.preferences.get<string>("apiKey");
    return typeof key === "string" && key.trim() !== "" ? key.trim() : null;
  } catch {
    return null;
  }
}

async function readClipboard(): Promise<void> {
  failure = null;
  try {
    const picture = await jarvis.clipboard.readImage();
    if (picture) {
      image = picture;
      phase = "recognizing";
      jarvis.ui.update();
      adoptOCR(await jarvis.ocr.recognize(picture, { languages: prefs.ocrLanguages, level: "accurate" }), "clipboard");
      return;
    }
    const text = await jarvis.clipboard.read();
    if (text === null || text.trim() === "") {
      failure = "剪贴板里没有文字，也没有图片";
      phase = "failed";
      return;
    }
    source = text;
    sourceOrigin = "clipboard";
    sourceLines = text.split(/\r?\n/).length;
    image = null;
    detectLanguage(text);
    phase = "recognizing";
  } catch (error) {
    failure = describe(error);
    phase = "failed";
  } finally {
    jarvis.ui.update();
  }
}

async function requestCapabilities(ids: CapabilityID[]): Promise<void> {
  const result = await jarvis.permissions.request(ids);
  granted = new Set([...granted, ...result.granted]);
  jarvis.ui.update();
}

// ---------------------------------------------------------------------------
// 命令
// ---------------------------------------------------------------------------

async function commandCaptureTranslate(context: CommandContext): Promise<void> {
  granted = new Set(context.granted as CapabilityID[]);
  readPrefs(context.preferences);
  if (!(await captureAndRecognize())) return;
  await translateSource();
}

async function commandCaptureCopy(context: CommandContext): Promise<void> {
  granted = new Set(context.granted as CapabilityID[]);
  readPrefs(context.preferences);
  if (!(await captureAndRecognize())) return;
  if (!(await translateSource()) || !translation) return;
  try {
    await jarvis.clipboard.write(translation.text);
    if (has("notifications.post")) {
      await jarvis.notifications.post({ title: "已复制译文", body: translation.text.slice(0, 120) });
    }
  } catch (error) {
    failure = describe(error);
    phase = "failed";
    // 静默命令失败了也得让用户知道：把面板展开到这里，错误屏会说清原因。
    await jarvis.panel.present();
  }
}

async function commandTranslateClipboard(context: CommandContext): Promise<void> {
  granted = new Set(context.granted as CapabilityID[]);
  readPrefs(context.preferences);
  await readClipboard();
  if (phase === "recognizing") await translateSource();
}

// ---------------------------------------------------------------------------
// 页面：每一段自己回答"我现在是什么状态"
// ---------------------------------------------------------------------------

const languageOptions = [
  { value: "zh-CN", title: "简体中文" },
  { value: "zh-TW", title: "繁體中文" },
  { value: "en", title: "English" },
  { value: "ja", title: "日本語" },
  { value: "ko", title: "한국어" },
  { value: "fr", title: "Français" },
  { value: "de", title: "Deutsch" },
  { value: "es", title: "Español" },
];

function deniedNote(id: CapabilityID, title: string, body: string): UINode {
  return ui.note({
    tint: "alert",
    symbol: "lock",
    title,
    body,
    actions: [{ id: `grant-${id}`, title: "授权", onPress: () => void requestCapabilities([id]) }],
  });
}

function sourceSection(): UINode {
  const children: UINode[] = [];
  if (!has("screenshot.capture")) {
    children.push(deniedNote("screenshot.capture", "没有截图的授权", "截屏翻译要先框选屏幕上的一块。你也可以直接把文字粘进下面的框里。"));
  }
  if (image) {
    children.push(ui.image({ key: "shot", file: image, label: sourceOrigin === "screenshot" ? "刚截到的那一块" : "剪贴板里的图片", size: "small" }));
  }
  children.push(
    ui.editor({
      key: "source",
      value: source,
      rows: 4,
      maxRows: 10,
      placeholder: "按 ⌥⌘T 截一块屏幕，或把要翻译的文字放到这里…",
      label: "原文",
      onChange: (value) => {
        source = value;
        sourceOrigin = "typed";
        if (value.trim() !== "") detectLanguage(value);
      },
    }),
  );
  const meta: string[] = [];
  if (detected.name) meta.push(`检测为 ${detected.name}`);
  if (sourceOrigin === "screenshot" && sourceLines > 0) meta.push(`识别自截图 · ${sourceLines} 行`);
  if (meta.length) children.push(ui.text({ text: meta.join(" · "), style: "footnote" }));

  const actions: ActionSpec[] = [
    {
      id: "clipboard",
      title: "读剪贴板",
      symbol: "doc.on.clipboard",
      help: "把剪贴板里的文字或图片拿来翻译",
      disabled: !has("clipboard.read") || phase === "capturing" || phase === "translating",
      onPress: () => void readClipboard(),
    },
    {
      id: "speak",
      title: "朗读",
      symbol: "speaker.wave.2",
      help: "朗读原文",
      disabled: !has("speech.speak") || source.trim() === "",
      onPress: () => void jarvis.speech.speak(source, detected.code ? { language: detected.code } : {}),
    },
    {
      id: "clear",
      title: "清空",
      symbol: "xmark.circle",
      help: "清空原文与译文",
      disabled: source === "" && translation === null,
      onPress: () => {
        source = "";
        translation = null;
        image = null;
        detected = { code: null, name: "" };
        failure = null;
        phase = "idle";
      },
    },
  ];
  return ui.section({
    title: "原文 · SOURCE",
    trailing: source === "" ? undefined : `${Array.from(source).length} 字符`,
    actions,
    children,
  });
}

function targetSection(): UINode {
  return ui.section({
    title: "翻译成 · TARGET",
    children: [
      ui.picker({
        key: "target",
        options: languageOptions,
        value: target,
        label: "目标语言",
        onChange: (value) => {
          target = value;
        },
      }),
    ],
  });
}

function translationSection(): UINode {
  const children: UINode[] = [];
  if (!has("network.https")) {
    children.push(deniedNote("network.https", "没有访问 Google 翻译的授权", "译文要经 translate.googleapis.com 取回；不授权就只能识字，不能翻译。"));
  }
  if (phase === "translating") {
    children.push(ui.progress({ tint: "accent", label: "正在翻译…" }));
  }
  if (phase === "capturing") {
    children.push(ui.note({ tint: "accent", symbol: "viewfinder", body: "在屏幕上框一块；按 Esc 取消。" }));
  }
  if (failure) {
    children.push(ui.note({ tint: "danger", symbol: "exclamationmark.triangle", title: "这一次没成", body: failure }));
  }
  children.push(
    ui.result({
      key: "translation",
      text: translation?.text ?? "",
      mono: false,
      copy: true,
      empty: source.trim() === "" ? "译文会出现在这里" : "按「翻译」把上面的原文翻出来",
    }),
  );
  if (translation && translatedAt) {
    const when = new Date(translatedAt).toLocaleTimeString();
    children.push(ui.text({ text: `${when} · Google ${translation.backend === "v2" ? "官方接口" : "免费端点"} · ${detected.name || "未知语言"} → ${languageOptions.find((o) => o.value === target)?.title ?? target}`, style: "footnote" }));
  }
  return ui.section({
    title: "译文 · TRANSLATION",
    actions: [
      {
        id: "speak-translation",
        title: "朗读译文",
        symbol: "speaker.wave.2",
        help: "朗读译文",
        disabled: !has("speech.speak") || !translation,
        onPress: () => void jarvis.speech.speak(translation?.text ?? "", { language: target }),
      },
    ],
    children,
  });
}

function actionSection(): UINode {
  const busy = phase === "capturing" || phase === "translating";
  return ui.section({
    title: "动作 · ACTIONS",
    children: [
      ui.stack({
        axis: "horizontal",
        spacing: "regular",
        children: [
          ui.button({
            title: "截屏翻译",
            symbol: "viewfinder",
            variant: "primary",
            size: "bar",
            disabled: busy || !has("screenshot.capture"),
            help: "框选屏幕上的一块，识字并翻译（⌥⌘T）",
            onPress: () => void jarvis.commands.run("capture-translate"),
          }),
          ui.button({
            title: "翻译",
            symbol: "arrow.right",
            variant: "secondary",
            size: "bar",
            disabled: busy || source.trim() === "" || !has("network.https"),
            help: "把上面的原文翻译成目标语言",
            onPress: () => void translateSource(),
          }),
        ],
      }),
    ],
  });
}

defineExtension({
  page: {
    activate(context) {
      granted = new Set(context.granted as CapabilityID[]);
      readPrefs(context.preferences);
      jarvis.preferences.onChange((changes) => readPrefs({ ...prefs, ...changes }));
    },
    render() {
      return ui.scroll({ children: [sourceSection(), targetSection(), translationSection(), actionSection()] });
    },
  },
  commands: {
    "capture-translate": commandCaptureTranslate,
    "capture-copy": commandCaptureCopy,
    "translate-clipboard": commandTranslateClipboard,
  },
});
