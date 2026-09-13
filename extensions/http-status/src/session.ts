/**
 * 会话状态：页面、原地弹窗与两条命令共用的那一份。
 *
 * 只有一个真源——**输入框里那串字**。详情屏不是另一个状态，而是"这串字恰好指向一条码"；
 * 点清单里的一行、点相关码的一枚 chip，做的都是同一件事：把 `query` 改成那个码。
 * 这样「在面板里打开」从弹窗切到页面时什么都不用同步，两棵树读的是同一个对象。
 *
 * 偏好与会话值分开：`copyFormat` / `specSource` 是偏好（在设置页改，页面里不许再画一份）；
 * 「含非标准码」与「只看 5xx」是**会话值**，从偏好初始化，清空搜索就回到偏好——
 * 它们是"这一次要看什么"，不是"我以后都想这样"。
 */
import { jarvis, type ActivationContext, type CommandContext, type CommandSummary, type Unsubscribe } from "@fusionseek/jarvis-extension-sdk";
import { byCode, type StatusCode } from "./data.js";
import { extractCode, search, type SearchOutcome, type StatusClass } from "./search.js";

/** ⌥⌘/ 那条命令这一轮的结果。页面与弹窗都按它画。 */
export type ClipboardState =
  | { kind: "idle" }
  /** 用户没给 clipboard.read，或者后来撤了。 */
  | { kind: "denied" }
  /** 读到了，但里面没有 100–599 的码。 */
  | { kind: "empty"; text: string }
  | { kind: "hit"; text: string; entry: StatusCode }
  /** 剪贴板是空的、被标记为机密，或者宿主那一侧失败了。 */
  | { kind: "failed"; message: string };

export type CopyFormat = "code" | "name" | "line";
export type SpecSource = "rfc" | "mdn";

export interface DocLink {
  title: string;
  url: string;
}

const MDN = (code: number) => `https://developer.mozilla.org/zh-CN/docs/Web/HTTP/Reference/Status/${code}`;

export class Session {
  /** 输入框里的字。空串 = 分类那一屏。 */
  query = "";
  /** 从清单点进详情之前那串字；有它时详情屏上多一条「回到…」。 */
  previousQuery: string | null = null;
  /** 会话值，从偏好初始化。 */
  includeUnofficial = true;
  classFilter: StatusClass | null = null;
  clipboard: ClipboardState = { kind: "idle" };
  /** 用户刚拒了「打开链接」：详情屏改成把地址交给他自己去开，而不是再问一次。 */
  urlDenied = false;

  private granted: string[] = [];
  private preferences: Record<string, unknown> = {};
  private commands: CommandSummary[] = [];
  private unwatch: Unsubscribe | null = null;

  // ── 宿主给的上下文 ────────────────────────────────────────────────────
  adopt(context: ActivationContext | CommandContext): void {
    this.granted = context.granted;
    this.preferences = context.preferences;
    if ("commands" in context) this.commands = context.commands;
    this.includeUnofficial = this.preference("includeUnofficial", true);
    if (this.has("clipboard.read") && this.clipboard.kind === "denied") this.clipboard = { kind: "idle" };
    if (this.has("system.openURL")) this.urlDenied = false;
  }

  /** 面板开着期间用户在设置里改了偏好：把会话值拉回新的默认，并重画。 */
  watchPreferences(): void {
    if (this.unwatch) return;
    this.unwatch = jarvis.preferences.onChange((changes) => {
      this.preferences = { ...this.preferences, ...changes };
      if ("includeUnofficial" in changes) this.includeUnofficial = this.preference("includeUnofficial", true);
      jarvis.ui.update();
    });
  }

  stopWatchingPreferences(): void {
    this.unwatch?.();
    this.unwatch = null;
  }

  has(capability: string): boolean {
    return this.granted.includes(capability);
  }

  /**
   * 刚在按钮回调里问到了一项能力：先记在本地。
   * 宿主随后会发 `permissionsChanged`，下一次 `activate` 也会带来权威的清单——
   * 这里只是让**这一次点击**的后半段能接着跑，不必等下一轮。
   */
  grantLocally(capability: string): void {
    if (!this.granted.includes(capability)) this.granted = [...this.granted, capability];
  }

  /** 用户此刻配置的快捷键显示串（用户改过就是改过的那个）；没配为 `undefined`。 */
  hotkey(commandId: string): string | undefined {
    return this.commands.find((command) => command.id === commandId)?.hotkey;
  }

  /**
   * 文案里怎么称呼一条命令。
   *
   * 有快捷键就用快捷键（用户改过就是改过的那个），没有就用命令名——
   * `hotkeys.register` 被拒时全局快捷键根本没注册，界面上再写「⌥⌘/」就是在骗人。
   */
  commandRef(id: string, title: string): string {
    const key = this.hotkey(id);
    return key ? `${key}「${title}」` : `「${title}」`;
  }

  preference<T>(key: string, fallback: T): T {
    const value = this.preferences[key];
    return value === undefined ? fallback : (value as T);
  }

  // ── 搜索 ──────────────────────────────────────────────────────────────
  outcome(): SearchOutcome {
    return search(this.query, { includeUnofficial: this.includeUnofficial, classFilter: this.classFilter });
  }

  setQuery(next: string): void {
    if (next.trim() === "") this.previousQuery = null;
    this.query = next;
  }

  /** 点清单里的一行、点一枚相关码：改 `query`，并记住从哪儿来的。 */
  openCode(code: number, from?: string): void {
    this.previousQuery = from && from.trim() !== "" && !/^\d{3}$/.test(from.trim()) ? from : null;
    this.query = String(code);
  }

  back(): void {
    if (this.previousQuery === null) return;
    this.query = this.previousQuery;
    this.previousQuery = null;
  }

  clear(): void {
    this.query = "";
    this.previousQuery = null;
    this.classFilter = null;
    this.includeUnofficial = this.preference("includeUnofficial", true);
  }

  // ── 一条码的周边 ──────────────────────────────────────────────────────
  /** 复制钮写进剪贴板的那串字，形状由偏好定。 */
  copyText(entry: StatusCode): string {
    const format = this.preference<CopyFormat>("copyFormat", "name");
    if (format === "code") return String(entry.code);
    if (format === "line") return `HTTP/1.1 ${entry.code} ${entry.name}`;
    return `${entry.code} ${entry.name}`;
  }

  /**
   * 「打开原文」那一两颗按钮。
   *
   * 标准码有两边（RFC 与 MDN），偏好决定谁排前面；非标准码只有厂商文档那一边——
   * MDN 上没有 499 这一页，给一个必定 404 的链接不如不给。
   */
  links(entry: StatusCode): DocLink[] {
    if (entry.unofficial) return [{ title: `打开 ${entry.unofficial} 文档`, url: entry.specUrl }];
    const rfc: DocLink = { title: `打开 ${entry.spec.split(" §")[0]}`, url: entry.specUrl };
    const mdn: DocLink = { title: "MDN", url: MDN(entry.code) };
    return this.preference<SpecSource>("specSource", "rfc") === "mdn" ? [{ ...mdn, title: "打开 MDN" }, { ...rfc, title: entry.spec.split(" §")[0] }] : [rfc, mdn];
  }

  // ── ⌥⌘/：读一次剪贴板 ────────────────────────────────────────────────
  async readClipboard(): Promise<void> {
    if (!this.has("clipboard.read")) {
      this.clipboard = { kind: "denied" };
      return;
    }
    try {
      const text = await jarvis.clipboard.read();
      if (text === null || text.trim() === "") {
        this.clipboard = { kind: "failed", message: "剪贴板是空的，或者里面的内容被标记为机密。" };
        return;
      }
      const code = extractCode(text);
      const entry = code === null ? undefined : byCode(code);
      if (entry) {
        this.clipboard = { kind: "hit", text, entry };
        this.query = String(entry.code);
        this.previousQuery = null;
        return;
      }
      this.clipboard = { kind: "empty", text };
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code === "permission.denied") {
        this.clipboard = { kind: "denied" };
        return;
      }
      this.clipboard = { kind: "failed", message: (error as Error).message || "读剪贴板失败。" };
    }
  }

  /** 弹窗或页面上那颗「授权」。只能在用户动作 1 秒内调，因此它只从按钮回调里走。 */
  async requestClipboard(): Promise<void> {
    const result = await jarvis.permissions.request(["clipboard.read"]);
    this.granted = [...new Set([...this.granted, ...result.granted])];
    if (this.has("clipboard.read")) {
      this.clipboard = { kind: "idle" };
      await this.readClipboard();
    }
    jarvis.ui.update();
  }

  /** 剪贴板里读到的那一段，画在弹窗上给人核对"翻的是哪一段"。太长就截断。 */
  clipboardExcerpt(limit = 72): string {
    const text = this.clipboard.kind === "hit" || this.clipboard.kind === "empty" ? this.clipboard.text : "";
    const flat = text.replace(/\s+/g, " ").trim();
    return flat.length > limit ? `${flat.slice(0, limit)}…` : flat;
  }

  clipboardLength(): number {
    const text = this.clipboard.kind === "hit" || this.clipboard.kind === "empty" ? this.clipboard.text : "";
    return Array.from(text).length;
  }
}
