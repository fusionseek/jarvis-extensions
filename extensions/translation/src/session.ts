/**
 * 一次「截屏 → 识字 → 检测语言 → 翻译」的全部状态与编排。
 *
 * 页面（面板里那五屏）与原地弹窗只是它的两种画法，读的是同一个对象。宿主每次 `activate` 是新的一次，
 * 但状态留在这里——快捷键按下之后弹窗才出现，那时结果必须已经算好放在这里。
 * 截图、OCR、语言检测、朗读、网络全在宿主；这里只有编排与状态。
 */
import {
  jarvis,
  ocr,
  JarvisError,
  type ActivationContext,
  type CapabilityID,
  type CommandContext,
  type CommandSummary,
  type FileHandle,
  type OCRResult,
} from "@fusionseek/jarvis-extension-sdk";
import { translate, forgetTranslations, type Translation } from "./google.js";

export type Phase = "idle" | "capturing" | "recognizing" | "translating" | "done" | "failed";
export type Origin = "screenshot" | "clipboard" | "typed";

export interface Prefs {
  targetLanguage: string;
  alternateLanguage: string;
  ocrLanguages: string[];
  autoCopy: boolean;
}

export const defaultPrefs: Prefs = { targetLanguage: "zh-CN", alternateLanguage: "en", ocrLanguages: ["zh-Hans", "en-US"], autoCopy: false };

/** Google 的语言代码与标题；与 manifest 里 `targetLanguage` 的选项一致。 */
export const languageOptions: { value: string; title: string }[] = [
  { value: "zh-CN", title: "简体中文" },
  { value: "zh-TW", title: "繁體中文" },
  { value: "en", title: "English" },
  { value: "ja", title: "日本語" },
  { value: "ko", title: "한국어" },
  { value: "fr", title: "Français" },
  { value: "de", title: "Deutsch" },
  { value: "es", title: "Español" },
];

/** Vision 的识别语言（BCP-47）与标题；与 manifest 里 `ocrLanguages` 的选项一致。 */
export const ocrLanguageOptions: { value: string; title: string }[] = [
  { value: "zh-Hans", title: "简体中文" },
  { value: "zh-Hant", title: "繁體中文" },
  { value: "en-US", title: "English" },
  { value: "ja-JP", title: "日本語" },
  { value: "ko-KR", title: "한국어" },
  { value: "fr-FR", title: "Français" },
  { value: "de-DE", title: "Deutsch" },
  { value: "es-ES", title: "Español" },
];

export type FailureKind = "network" | "empty" | "clipboard" | "denied" | "other";

/** 失败要说人话：标题一句、正文一句、还剩哪条路由 kind 决定。 */
export interface Failure {
  kind: FailureKind;
  title: string;
  body: string;
}

/** NaturalLanguage / Vision 的 BCP-47 → Google 的代码：只差中文那几档。 */
/**
 * 这段文字里有没有**值得翻译**的东西。
 *
 * 不是 `trim() !== ""`：OCR 在一块空白上偶尔会认出一两个标点或框线残影，
 * 而"把「·」翻译一下"对用户没有任何意义，却会弹一个框出来。
 * 判据是至少有一个字母或数字——`\p{L}` 把汉字、假名、西里尔也一并涵盖了。
 */
export function hasTranslatableText(text: string): boolean {
  return /[\p{L}\p{N}]/u.test(text);
}

export function toGoogle(code: string): string {
  const lower = code.toLowerCase().replace("_", "-");
  if (lower.startsWith("zh")) return lower.includes("hant") || lower.includes("tw") || lower.includes("hk") ? "zh-TW" : "zh-CN";
  return lower.split("-")[0] ?? lower;
}

export function sameLanguage(a: string | null, b: string): boolean {
  return a !== null && toGoogle(a) === toGoogle(b);
}

/** 原文已经是目标语言时改翻成备选语言——否则 Google 会原样吐回来。 */
export function resolveTarget(detected: string | null, prefs: Prefs): string {
  return sameLanguage(detected, prefs.targetLanguage) ? prefs.alternateLanguage : prefs.targetLanguage;
}

/** 语言的显示名：先问宿主（按用户的区域本地化，「英语」而不是 English）；宿主认不出时用目录里的标题。 */
export function languageTitle(code: string): string {
  let localized: string | null = null;
  try {
    localized = jarvis.text.language.displayName(code);
  } catch {
    localized = null;
  }
  if (localized && localized !== code) return localized;
  return languageOptions.find((o) => o.value === toGoogle(code))?.title ?? code;
}

export function readPrefs(raw: Record<string, unknown>, previous: Prefs): Prefs {
  return {
    targetLanguage: typeof raw["targetLanguage"] === "string" ? raw["targetLanguage"] : previous.targetLanguage,
    alternateLanguage: typeof raw["alternateLanguage"] === "string" ? raw["alternateLanguage"] : previous.alternateLanguage,
    ocrLanguages: Array.isArray(raw["ocrLanguages"]) ? (raw["ocrLanguages"] as string[]) : previous.ocrLanguages,
    autoCopy: typeof raw["autoCopy"] === "boolean" ? raw["autoCopy"] : previous.autoCopy,
  };
}

export function describe(error: unknown): string {
  if (error instanceof JarvisError) return error.detail ?? error.message;
  return error instanceof Error ? error.message : String(error);
}

/** 把一次异常变成用户读得懂的一屏。 */
export function failureFor(error: unknown): Failure {
  if (error instanceof JarvisError && error.code === "permission.denied") {
    return { kind: "denied", title: "没有这项授权", body: `${describe(error)}。点「授权」再问一次，或在 设置 › 扩展 里打开。` };
  }
  if (error instanceof JarvisError && error.code === "rate.limited") {
    return { kind: "network", title: "请求太频繁", body: "宿主限了这个扩展的调用频率，缓一缓再试。" };
  }
  return { kind: "network", title: "翻译失败", body: `${describe(error)}。原文还留在上面，重试不用再截一次。` };
}

export class Session {
  phase: Phase = "idle";
  source = "";
  origin: Origin = "typed";
  /** OCR 认出的行数；打字进来的原文按换行数。 */
  lines = 0;
  /**
   * 这一轮被忽略了（框到的那块里没有文字）。
   *
   * 它只活在一次 `capture()` 里，作用是**拦住那次提交**——宿主要等第一次提交才开弹窗，
   * 提交了就等于给一次误拖弹一个空框。
   */
  ignoredRound = false;
  image: FileHandle | null = null;
  imageSize: { width: number; height: number } | null = null;
  detected: { code: string | null; name: string } = { code: null, name: "" };
  /** 用户在语言行里手动指定的原文语言（Google 代码）；`null` = 自动检测。 */
  sourceOverride: string | null = null;
  target = defaultPrefs.targetLanguage;
  alternate = defaultPrefs.alternateLanguage;
  ocrLanguages = defaultPrefs.ocrLanguages;
  translation: Translation | null = null;
  elapsedMs = 0;
  autoCopied = false;
  /** 原文或语言改过、译文还是旧的。 */
  dirty = false;
  failure: Failure | null = null;
  /** `screenshot.capture` 抛过 `permission.unavailable`：Jarvis 自己还没有屏幕录制权限。 */
  systemPermissionMissing = false;
  granted = new Set<CapabilityID>();
  prefs = defaultPrefs;
  commands: CommandSummary[] = [];

  private targetTouched = false;
  private alternateTouched = false;
  private ocrTouched = false;
  private prefsSubscribed = false;

  has(id: CapabilityID): boolean {
    return this.granted.has(id);
  }

  /** 用户此刻配置的快捷键显示串；没配为 `undefined`。 */
  hotkey(commandID: string): string | undefined {
    return this.commands.find((c) => c.id === commandID)?.hotkey ?? undefined;
  }

  get busy(): boolean {
    return this.phase === "capturing" || this.phase === "recognizing" || this.phase === "translating";
  }

  get targetTitle(): string {
    return languageTitle(this.target);
  }

  /** 每次进入页面 / 弹窗 / 命令都会拿到最新的授权与偏好；命令上下文没有命令清单，留着上一次的。 */
  adopt(context: ActivationContext | CommandContext): void {
    this.granted = new Set(context.granted as CapabilityID[]);
    this.applyPrefs(context.preferences);
    if ("commands" in context) this.commands = context.commands;
    if (!this.prefsSubscribed) {
      this.prefsSubscribed = true;
      jarvis.preferences.onChange((changes) => this.applyPrefs({ ...changes }));
    }
  }

  private applyPrefs(raw: Record<string, unknown>): void {
    this.prefs = readPrefs(raw, this.prefs);
    // 会话里的目标 / 备选 / 识别语言跟着偏好走，除非用户在这一次里手动改过。
    if (!this.targetTouched) this.target = this.prefs.targetLanguage;
    if (!this.alternateTouched) this.alternate = this.prefs.alternateLanguage;
    if (!this.ocrTouched) this.ocrLanguages = this.prefs.ocrLanguages;
  }

  // ---------------------------------------------------------------------------
  // 编排
  // ---------------------------------------------------------------------------

  /** 框选一块并识字。返回 true = 认出了文字，可以接着翻。 */
  async capture(): Promise<boolean> {
    const previous: Phase = this.translation ? "done" : "idle";
    this.phase = "capturing";
    this.failure = null;
    this.ignoredRound = false;
    jarvis.ui.update();
    try {
      const shot = await jarvis.screenshot.capture({
        selectionOnly: true,
        recognizeText: true,
        ocr: { languages: this.ocrLanguages, level: "accurate" },
        hint: "松手即翻译",
        // 不压暗、不画参照线：用户此刻在**读屏幕上那段字**，把它压暗再盖上网格
        // 等于让他先把工具的装饰读掉一遍。光标尾巴上挂一枚 translate，
        // 好让他一眼看出这一下按的是翻译不是截图。
        appearance: { dim: false, guides: false, cursorSymbol: "translate" },
      });
      this.systemPermissionMissing = false;
      this.image = shot.file;
      this.imageSize = { width: shot.width, height: shot.height };
      return this.adoptOCR(shot.ocr, "screenshot", previous);
    } catch (error) {
      if (error instanceof JarvisError && error.code === "cancelled") {
        this.phase = previous;
        return false;
      }
      if (error instanceof JarvisError && error.code === "permission.unavailable") {
        this.systemPermissionMissing = true;
        this.phase = previous;
        return false;
      }
      if (error instanceof JarvisError && error.code === "permission.denied") {
        this.granted.delete("screenshot.capture");
        this.phase = previous;
        return false;
      }
      this.fail(failureFor(error));
      return false;
    } finally {
      if (this.ignoredRound) {
        // SDK 在命令处理函数结束后总会自动提交一次，因此"什么都不做"做不到"什么都不弹"。
        // 明说一句：这一轮不值得弹。宿主随即把等着开弹窗的那个锚点丢掉。
        await jarvis.ui.dismissPopover();
      } else {
        jarvis.ui.update();
      }
    }
  }

  /**
   * 把 OCR 的行合成段落、检测语言，作为新的原文。
   *
   * `previous` 是这次动作开始前的阶段：框到的那块里没有文字时要回到它，当这一次没发生过。
   */
  adoptOCR(result: OCRResult | undefined, origin: Origin, previous: Phase = "idle"): boolean {
    const lines = result?.lines ?? [];
    this.origin = origin;
    this.lines = lines.length;
    this.translation = null;
    this.dirty = false;
    this.autoCopied = false;
    this.sourceOverride = null;
    // 先按无语言合一次拿去检测，再按检测出的语言合一次——中英夹杂的截图两次结果可能不同。
    const draft = lines.length === 0 ? "" : ocr.mergeLines(lines);
    if (!hasTranslatableText(draft)) {
      this.source = "";
      this.detected = { code: null, name: "" };
      if (origin === "screenshot") {
        // **框空了就当这一次没发生过。** 框到一块没有字的地方几乎总是误拖——
        // 为一次误拖弹一个"没认出文字"的框，是拿一件用户不关心的事去打断他。
        this.phase = previous;
        this.ignoredRound = true;
        return false;
      }
      // 剪贴板那条路不一样：用户在面板里按了一个按钮，什么都不说才是坏的。
      this.fail({
        kind: "empty",
        title: "没认出文字",
        body: "这张图里没有可识别的文字。",
      });
      return false;
    }
    this.detect(draft);
    this.source = ocr.mergeLines(lines, this.detected.code ? { language: this.detected.code } : {});
    this.phase = "recognizing";
    return hasTranslatableText(this.source);
  }

  detect(text: string): void {
    try {
      const result = jarvis.text.language.detect(text, { hints: this.ocrLanguages });
      this.detected = { code: result.code, name: result.code ? languageTitle(result.code) : "" };
    } catch {
      this.detected = { code: null, name: "" };
    }
  }

  /** 把当前原文翻成目标语言。返回 true = 有译文了。 */
  async translate(): Promise<boolean> {
    const text = this.source.trim();
    if (text === "") return false;
    this.phase = "translating";
    this.failure = null;
    jarvis.ui.update();
    // 翻译跨越指针离开：面板与弹窗在译文回来之前都不该被 15 秒倒计时收走。
    const hold = jarvis.panel.hold("正在翻译");
    const started = Date.now();
    try {
      if (!this.detected.code && !this.sourceOverride) this.detect(text);
      const from = this.sourceOverride ?? this.detected.code;
      if (!this.targetTouched) this.target = resolveTarget(from, { ...this.prefs, alternateLanguage: this.alternate });
      const apiKey = await this.readAPIKey();
      this.translation = await translate(text, this.target, apiKey, this.sourceOverride);
      if (!this.detected.code && this.translation.detectedSource) {
        this.detected = { code: this.translation.detectedSource, name: languageTitle(this.translation.detectedSource) };
      }
      this.elapsedMs = Date.now() - started;
      this.dirty = false;
      this.phase = "done";
      this.autoCopied = false;
      if (this.prefs.autoCopy && this.has("clipboard.write")) {
        try {
          await jarvis.clipboard.write(this.translation.text);
          this.autoCopied = true;
        } catch {
          // 复制失败不算翻译失败：译文还在屏幕上。
        }
      }
      return true;
    } catch (error) {
      this.fail(failureFor(error));
      return false;
    } finally {
      hold.release();
      jarvis.ui.update();
    }
  }

  private async readAPIKey(): Promise<string | null> {
    try {
      const key = await jarvis.preferences.get<string>("apiKey");
      return typeof key === "string" && key.trim() !== "" ? key.trim() : null;
    } catch {
      return null;
    }
  }

  /** 剪贴板里是图就先识字，是文字就直接当原文。返回 true = 有原文了。 */
  async readClipboard(): Promise<boolean> {
    this.failure = null;
    try {
      const picture = await jarvis.clipboard.readImage();
      if (picture) {
        this.image = picture;
        this.imageSize = null;
        this.source = "";
        this.phase = "recognizing";
        jarvis.ui.update();
        const result = await jarvis.ocr.recognize(picture, { languages: this.ocrLanguages, level: "accurate" });
        return this.adoptOCR(result, "clipboard");
      }
      const text = await jarvis.clipboard.read();
      if (text === null || text.trim() === "") {
        this.fail({ kind: "clipboard", title: "剪贴板是空的", body: "剪贴板里没有文字，也没有图片。先复制一段文字或一张图。" });
        return false;
      }
      this.source = text;
      this.origin = "clipboard";
      this.lines = text.split(/\r?\n/).length;
      this.image = null;
      this.imageSize = null;
      this.translation = null;
      this.sourceOverride = null;
      this.dirty = false;
      this.detect(text);
      this.phase = "recognizing";
      return true;
    } catch (error) {
      this.fail(failureFor(error));
      return false;
    } finally {
      jarvis.ui.update();
    }
  }

  fail(failure: Failure): void {
    this.failure = failure;
    this.phase = "failed";
  }

  /** 静默命令没成时也得让用户知道：横幅说清原因，点横幅展开到本扩展的页面（那里画着错误屏）。 */
  async reportFailureSilently(): Promise<void> {
    if (!this.failure) return;
    if (!this.has("notifications.post")) {
      jarvis.log.warn("静默命令失败，但没有横幅授权", this.failure);
      return;
    }
    await jarvis.notifications.post({ title: this.failure.title, body: this.failure.body });
  }

  async requestCapabilities(ids: CapabilityID[]): Promise<void> {
    const result = await jarvis.permissions.request(ids);
    this.granted = new Set([...this.granted, ...result.granted]);
    jarvis.ui.update();
  }

  async openScreenRecordingSettings(): Promise<void> {
    await jarvis.permissions.openSystemSettings("screenRecording");
  }

  speak(text: string, language: string | null): void {
    if (!this.has("speech.speak") || text.trim() === "") return;
    void jarvis.speech.speak(text, language ? { language } : {});
  }

  // ---------------------------------------------------------------------------
  // 用户在页面 / 弹窗里改东西
  // ---------------------------------------------------------------------------

  setSource(value: string): void {
    this.source = value;
    this.origin = "typed";
    this.lines = value === "" ? 0 : value.split(/\r?\n/).length;
    this.sourceOverride = null;
    this.dirty = this.translation !== null;
    if (value.trim() !== "") this.detect(value);
    else this.detected = { code: null, name: "" };
    if (this.phase === "failed" && this.failure?.kind === "empty") {
      this.failure = null;
      this.phase = "recognizing";
    }
  }

  setTarget(code: string): void {
    this.target = code;
    this.targetTouched = true;
    this.dirty = this.translation !== null;
  }

  setAlternate(code: string): void {
    this.alternate = code;
    this.alternateTouched = true;
  }

  /** `"auto"` = 让 Google 自己判。 */
  setSourceOverride(code: string): void {
    this.sourceOverride = code === "auto" ? null : code;
    this.dirty = this.translation !== null;
  }

  toggleOCRLanguage(code: string): void {
    this.ocrTouched = true;
    this.ocrLanguages = this.ocrLanguages.includes(code) ? this.ocrLanguages.filter((c) => c !== code) : [...this.ocrLanguages, code];
    if (this.ocrLanguages.length === 0) this.ocrLanguages = [code];
  }

  /** 语言改了就立刻重翻——弹窗里没有「翻译」按钮的位置，也不该有。 */
  retranslate(): void {
    if (this.source.trim() === "" || this.busy) return;
    void this.translate();
  }

  /**
   * 「清空」：回到空屏。语言行里手动改过的也一并回到偏好——这是用户唯一的"重来"。
   *
   * 译文缓存也一起丢掉。缓存平时是好事（重复翻译同一段不再打 Google，那是唯一能真正减少
   * IP 暴露的手段），但「清空」这个动作的含义就是"把刚才那次忘掉"——留着缓存的话，
   * 用户重新截同一块屏会拿到一份他以为已经丢掉的旧译文。
   */
  clear(): void {
    forgetTranslations();
    this.targetTouched = false;
    this.alternateTouched = false;
    this.ocrTouched = false;
    this.applyPrefs({});
    this.systemPermissionMissing = false;
    this.phase = "idle";
    this.source = "";
    this.origin = "typed";
    this.lines = 0;
    this.image = null;
    this.imageSize = null;
    this.detected = { code: null, name: "" };
    this.sourceOverride = null;
    this.translation = null;
    this.elapsedMs = 0;
    this.autoCopied = false;
    this.dirty = false;
    this.failure = null;
  }
}
