/**
 * 纯函数：规则、决定切到哪一个、显示用的短名与说明、菜单栏模型。测试直接 import 它（`test/support.mjs` 现编）。
 *
 * 宿主不认识「规则」：它只给读 / 切输入源、前台应用、提示这几样通用的东西（jarvis-mac `specs/20261030-170731-input-source-switch-p1`），
 * 哪个应用用哪个输入法、无规则的应用怎么办，全在这里。
 */
import type { FileHandle, InputSource, MacApp, MenuBarItem, MenuBarModel } from "@fusionseek/jarvis-extension-sdk";

/**
 * 一个应用的规则。`name` 是定规则时的应用名：列表里要画，而那个应用此刻未必开着。
 *
 * 只有两种（jarvis-mac `specs/20261030-194903-input-source-cards-orb-flash` C-5）：用某个输入法、记住上次用的。
 * 原来的「不管它」与「不写规则」合成「无规则」——没有规则，跟着「无规则的应用」那一条走；存储里留下的 `ignore` 读的时候丢掉。
 */
export type Rule = { mode: "fixed"; source: string; name: string } | { mode: "remember"; name: string };

/** bundle id → 规则。 */
export type Rules = Record<string, Rule>;

/** 无规则的应用怎么办。 */
export type Others = "keep" | "remember" | "default";

/** 提示在哪（C-8）：屏幕中间偏下（固定）/ 悬浮球旁粘连闪现（图标进球心，球看不见时宿主退回屏幕）。 */
export type HUDAnchor = "screen" | "orb";

/** 偏好（manifest `contributes.settings`）。 */
export interface Settings {
  others: Others;
  hud: boolean;
  hudAnchor: HUDAnchor;
  hudOnManual: boolean;
  menuBarLabel: boolean;
  paused: boolean;
}

export const defaultSettings: Settings = {
  others: "keep",
  hud: true,
  hudAnchor: "screen",
  hudOnManual: false,
  menuBarLabel: true,
  paused: false,
};

/**
 * 读偏好；不认识的值退回默认。
 * @param preferences 宿主给的偏好。
 * @returns 设置。
 */
export function readSettings(preferences: Record<string, unknown>): Settings {
  const pick = <T extends string>(value: unknown, allowed: readonly T[], fallback: T): T =>
    typeof value === "string" && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
  const flag = (value: unknown, fallback: boolean) => (typeof value === "boolean" ? value : fallback);
  return {
    others: pick(preferences.others, ["keep", "remember", "default"] as const, defaultSettings.others),
    hud: flag(preferences.hud, defaultSettings.hud),
    // 原来的 caret / window / pointer 三档去掉了（仓库主人要固定的位置）：存着它们的读作默认。
    hudAnchor: pick(preferences.hudAnchor, ["screen", "orb"] as const, defaultSettings.hudAnchor),
    hudOnManual: flag(preferences.hudOnManual, defaultSettings.hudOnManual),
    menuBarLabel: flag(preferences.menuBarLabel, defaultSettings.menuBarLabel),
    paused: flag(preferences.paused, defaultSettings.paused),
  };
}

/**
 * 一条网站规则（jarvis-mac `specs/20261030-234919-input-source-site-rules` S-2）：在这个网站上用哪个输入法。
 * `pattern` 是规范化过的主机名（`github.com`，同时管子域）或「主机名 + 路径前缀」（`docs.google.com/spreadsheets`，按段对齐）。
 * 网站上没有「记住上次」：同一个应用里的「上次」已经由应用规则管。
 */
export interface SiteRule {
  pattern: string;
  source: string;
}

/** 存在 `jarvis.storage` 里的四样。 */
export interface Memory {
  rules: Rules;
  /**
   * bundle id → 你上次在那个应用里用的输入法：手动换的那一下当场记；换走时那一刻用着的也记
   * （jarvis-mac `specs/20261031-080909-input-source-walkthrough-fixes` W-2：从没手动换过的应用也学得会）。
   */
  lastUsed: Record<string, string>;
  /** 「换成默认输入法」换成哪一个。 */
  fallbackSource?: string;
  /** 网站规则。 */
  sites: SiteRule[];
}

export const emptyMemory: Memory = { rules: {}, lastUsed: {}, sites: [] };

/** 此刻前台浏览器的当前页（宿主 `browser.watchActiveTab` 推来的、或 `browser.activeTab()` 读到的、状态是 `ok` 的那一页）。 */
export interface Page {
  /** 哪个浏览器。网站规则只在它就是此刻前台时生效。 */
  bundleId: string;
  url: string;
}

/** 规则存多少条：每条几十字节，宿主给每个扩展 2 MB / 2000 条，这里只占一个键。300 个应用已经远超一个人会写规则的数。 */
export const maximumRules = 300;
/** 「记住上次」记多少个应用：最旧的先丢。 */
export const maximumRemembered = 300;

/**
 * 切到这个应用时该换成哪一个；不换为 `undefined`。
 *
 * - 前台是浏览器、它的当前页命中网站规则（且那个输入法还启用着）：换成网站规则的那一个——网站规则比应用规则具体（S-2）。
 * - 应用有规则：`fixed` 换成那一个；`remember` 换成上次在那里用的（没记过就不动）。
 * - 无规则：按「无规则的应用」——不动 / 记住上次 / 默认输入法。
 * - 目标此刻没启用（用户在系统设置里删掉了）：不动，不报错。
 *
 * @param bundleId 切到的应用。
 * @param memory 规则与记忆。
 * @param settings 偏好。
 * @param enabled 此刻启用的输入法 id。
 * @param page 此刻的页面；只有 `page.bundleId === bundleId`（这个浏览器就是前台）时才看。
 * @returns 目标 id 或 `undefined`。
 */
export function resolveTarget(
  bundleId: string,
  memory: Memory,
  settings: Settings,
  enabled: readonly string[],
  page?: Page,
): string | undefined {
  if (page && page.bundleId === bundleId) {
    const site = matchSite(page.url, memory.sites);
    if (site && enabled.includes(site.source)) return site.source;
  }
  const rule = memory.rules[bundleId];
  let target: string | undefined;
  if (rule) {
    target = rule.mode === "fixed" ? rule.source : memory.lastUsed[bundleId];
  } else if (settings.others === "remember") {
    target = memory.lastUsed[bundleId];
  } else if (settings.others === "default") {
    target = memory.fallbackSource;
  }
  return target !== undefined && enabled.includes(target) ? target : undefined;
}

/**
 * 记一次「在这个应用里用的是它」（手动换的那一下、或换走时用着的那一个）：最近的放到最后，超过上限丢最旧的。
 * @param lastUsed 旧的记忆。
 * @param bundleId 哪个应用。
 * @param source 换到的输入法。
 * @returns 新的记忆；没变时原样交回（调用方据此省一次写库）。
 */
export function remember(lastUsed: Record<string, string>, bundleId: string, source: string): Record<string, string> {
  if (lastUsed[bundleId] === source) return lastUsed;
  const next: Record<string, string> = {};
  const keys = Object.keys(lastUsed).filter((key) => key !== bundleId);
  for (const key of keys.slice(Math.max(0, keys.length - (maximumRemembered - 1)))) next[key] = lastUsed[key];
  next[bundleId] = source;
  return next;
}

/** 选择器里的取值：`fixed:<输入法 id>` / `remember` / `none`（无规则，跟着「无规则的应用」）。 */
export type RuleChoice = string;

/**
 * 规则 → 选择器的值。
 * @param rule 规则；没有为 `undefined`。
 * @returns 取值。
 */
export function ruleChoice(rule: Rule | undefined): RuleChoice {
  if (!rule) return "none";
  return rule.mode === "fixed" ? `fixed:${rule.source}` : rule.mode;
}

/**
 * 选择器的值 → 规则；`none` 为 `undefined`（删掉规则）。
 * @param choice 取值。
 * @param name 应用名。
 * @returns 规则。
 */
export function ruleFromChoice(choice: RuleChoice, name: string): Rule | undefined {
  if (choice.startsWith("fixed:")) return { mode: "fixed", source: choice.slice("fixed:".length), name };
  if (choice === "remember") return { mode: "remember", name };
  return undefined;
}

/**
 * 写一条规则（`undefined` = 删掉）。超过上限时不加新的。
 * @param rules 旧的。
 * @param bundleId 哪个应用。
 * @param rule 新的规则。
 * @returns 新的规则表。
 */
export function setRule(rules: Rules, bundleId: string, rule: Rule | undefined): Rules {
  const next = { ...rules };
  if (rule === undefined) {
    delete next[bundleId];
    return next;
  }
  if (!(bundleId in next) && Object.keys(next).length >= maximumRules) return rules;
  next[bundleId] = rule;
  return next;
}

const othersTitles: Record<Others, string> = {
  keep: "不动",
  remember: "记住上次用的",
  default: "换成默认输入法",
};

/**
 * 「无规则的应用」那一档的名字。
 * @param others 偏好。
 * @returns 名字。
 */
export function othersTitle(others: Others): string {
  return othersTitles[others];
}

/**
 * 规则的一句说明（列表行的副标题、菜单的勾）。
 * @param rule 规则。
 * @param sources 此刻启用的输入法。
 * @param settings 偏好（无规则时说它跟着哪一档）。
 * @returns 说明。
 */
export function ruleTitle(rule: Rule | undefined, sources: readonly InputSource[], settings: Settings): string {
  if (!rule) return `无规则 · ${othersTitle(settings.others)}`;
  if (rule.mode === "remember") return "记住上次用的";
  const source = sources.find((candidate) => candidate.id === rule.source);
  return source ? source.name : "那个输入法已经停用了";
}

/**
 * 是不是系统自带的输入法（id 以 `com.apple.` 开头：ABC、简体拼音、日文假名……）。
 *
 * 切换时的提示：系统自带的画成一枚字标键帽（与菜单栏上那个字一致），三方输入法用它自己的图标
 * （jarvis-mac `specs/20261030-210500-input-source-orb-crash-keycap` K-3，仓库主人：「只有切换到三方的输入法才需要用三方输入法的ICON」）。
 * @param source 输入法。
 * @returns 系统自带为真。
 */
export function isSystemSource(source: InputSource): boolean {
  return source.id.startsWith("com.apple.");
}

/**
 * 菜单栏图标旁的一个字：中文「中」、日文「あ」、韩文「한」，其余取名字的第一个字母（ABC → A）。
 * @param source 输入法；不知道时为 `undefined`。
 * @returns 一两个字；不知道为空串。
 */
export function shortLabel(source: InputSource | undefined): string {
  if (!source) return "";
  const language = source.languages[0] ?? "";
  if (language.startsWith("zh")) return language === "zh-Hant" ? "繁" : "中";
  if (language.startsWith("ja")) return "あ";
  if (language.startsWith("ko")) return "한";
  const first = [...source.name.trim()][0] ?? "";
  return first.toUpperCase();
}

/** 菜单栏模型需要的东西。 */
export interface MenuState {
  /** 此刻在前台的应用（点菜单栏图标不换前台，所以就是你刚才在用的那个）。 */
  app?: { bundleId: string; name: string };
  /** 前台浏览器的当前页（S-2）：有它时菜单多一段「在 github.com 上用」。 */
  page?: Page;
  sites?: readonly SiteRule[];
  rules: Rules;
  sources: readonly InputSource[];
  currentId?: string;
  settings: Settings;
}

/** 菜单项 id：输入法的 id 可能带空格、可能很长，菜单里按序号引用（`fixed:<序号>`）。 */
export function fixedItemID(index: number): string {
  return `fixed:${index}`;
}

/**
 * 菜单项 id → 选择器取值；不认识为 `undefined`。
 * @param itemId 菜单项 id。
 * @param sources 推这份菜单时的输入法（序号按它）。
 * @returns 取值，或 `pause`。
 */
export function choiceFromMenuItem(itemId: string, sources: readonly InputSource[]): RuleChoice | "pause" | undefined {
  if (itemId === "pause") return "pause";
  if (itemId === "remember" || itemId === "none") return itemId;
  if (itemId.startsWith("site:")) return undefined;
  const match = /^fixed:(\d+)$/.exec(itemId);
  if (!match) return undefined;
  const source = sources[Number(match[1])];
  return source ? `fixed:${source.id}` : undefined;
}

/**
 * 菜单栏模型：图标旁一个字；菜单是「此刻这个应用用什么」的单选，加一项暂停。
 * @param state 此刻的状态。
 * @returns 模型。
 */
export function menuModel(state: MenuState): MenuBarModel {
  const current = state.sources.find((source) => source.id === state.currentId);
  const items: MenuBarItem[] = [];
  if (state.app) {
    const rule = state.rules[state.app.bundleId];
    const choice = ruleChoice(rule);
    items.push({ kind: "header", title: clip(`在「${state.app.name}」里用`, 80) });
    state.sources.forEach((source, index) => {
      items.push({ kind: "item", id: fixedItemID(index), title: clip(source.name, 80), checked: choice === `fixed:${source.id}` });
    });
    items.push(
      { kind: "item", id: "remember", title: "记住上次用的", checked: choice === "remember" },
      {
        kind: "item",
        id: "none",
        title: "无规则",
        subtitle: clip(`跟着「无规则的应用」：${othersTitle(state.settings.others)}`, 80),
        checked: choice === "none",
      },
      { kind: "separator" },
    );
  }
  const site = state.page ? sitePatternFor(state.page.url, state.sites ?? []) : undefined;
  if (site) {
    const matched = matchSite(state.page!.url, state.sites ?? []);
    items.push({ kind: "header", title: clip(`在「${site}」上用`, 80) });
    state.sources.forEach((source, index) => {
      items.push({ kind: "item", id: siteItemID(index), title: clip(source.name, 80), checked: matched?.source === source.id });
    });
    items.push(
      {
        kind: "item",
        id: "site:none",
        title: "跟随应用",
        subtitle: matched ? "删掉这个网站的规则" : "这个网站没有规则，按应用的来",
        checked: !matched,
      },
      { kind: "separator" },
    );
  }
  items.push({
    kind: "item",
    id: "pause",
    title: "暂停自动切换",
    subtitle: state.settings.paused ? "只记下你用的输入法，不替你切" : undefined,
    checked: state.settings.paused,
  });
  const label = state.settings.menuBarLabel ? shortLabel(current) : "";
  return {
    symbol: state.settings.paused ? "keyboard.badge.ellipsis" : "keyboard",
    ...(label ? { title: label } : {}),
    tooltip: clip(current ? `此刻：${current.name}${state.settings.paused ? "（自动切换已暂停）" : ""}` : "输入法切换", 80),
    items,
  };
}

// MARK: - 第二轮：按输入法分组、自己加应用、推荐（jarvis-mac `specs/20261030-182223-input-source-rules-ux`）

/**
 * 一个选择的名字：「用 ABC」「记住上次用的」「无规则」。
 * @param choice 选择器的值。
 * @param sources 此刻启用的输入法。
 * @returns 名字。
 */
export function choiceTitle(choice: RuleChoice, sources: readonly InputSource[]): string {
  if (choice.startsWith("fixed:")) {
    const id = choice.slice("fixed:".length);
    const source = sources.find((candidate) => candidate.id === id);
    return source ? `用 ${source.name}` : "用一个已停用的输入法";
  }
  if (choice === "remember") return "记住上次用的";
  return "无规则";
}

/** 一枚一点即定的选项。 */
export interface ChoiceChip {
  value: RuleChoice;
  /** chip 上那几个字（短）。 */
  title: string;
  /** 悬停说明（长）。 */
  help: string;
  image?: FileHandle;
  symbol: string;
}

/**
 * 「此刻」与「换成」那一排：每个输入法一枚（带它的图标），再加记住上次、无规则——两个输入法时一行四枚（C-5）。
 * @param sources 此刻启用的输入法。
 * @returns 选项。
 */
export function choiceChips(sources: readonly InputSource[]): ChoiceChip[] {
  const chips: ChoiceChip[] = sources.map((source) => ({
    value: `fixed:${source.id}`,
    title: source.name,
    help: `切到这个应用就换成 ${source.name}`,
    image: source.icon,
    symbol: "keyboard",
  }));
  chips.push(
    { value: "remember", title: "记住上次", help: "换成你上次在这个应用里用的那个", symbol: "arrow.uturn.backward" },
    { value: "none", title: "无规则", help: "不给它定规则，跟着「无规则的应用」那一条走（默认不动）", symbol: "circle.dashed" },
  );
  return chips;
}

/** 一组规则。 */
export interface RuleGroup {
  /** 这一组的选择（`fixed:<id>` / `remember`），停用的那一组是 `stale`。 */
  key: string;
  title: string;
  source?: InputSource;
  entries: { bundleId: string; rule: Rule }[];
  /** 能不能往这一组里加应用（停用的那一组不能）。 */
  addable: boolean;
}

/**
 * 按输入法分组：每个启用的输入法一组（空的也给：用户第一眼就看得到「我可以给 ABC 加应用」），
 * 记住上次那一组有内容才给；指向已停用输入法的规则单独一组。组内按应用名排。
 * 网站不在这里分组：它们在自己的那张「网站」卡里（`siteList`，W-3）。
 * @param rules 规则。
 * @param sources 此刻启用的输入法。
 * @returns 分组，顺序同系统输入法菜单，然后是记住上次、已停用。
 */
export function groupRules(rules: Rules, sources: readonly InputSource[]): RuleGroup[] {
  const byName = (a: { rule: Rule; bundleId: string }, b: { rule: Rule; bundleId: string }) =>
    (a.rule.name || a.bundleId).localeCompare(b.rule.name || b.bundleId, "zh-Hans");
  const entries = Object.entries(rules).map(([bundleId, rule]) => ({ bundleId, rule }));
  const enabled = new Set(sources.map((source) => source.id));
  const groups: RuleGroup[] = sources.map((source) => ({
    key: `fixed:${source.id}`,
    title: `用 ${source.name}`,
    source,
    entries: entries.filter((entry) => entry.rule.mode === "fixed" && entry.rule.source === source.id).sort(byName),
    addable: true,
  }));
  const remembered = entries.filter((entry) => entry.rule.mode === "remember").sort(byName);
  if (remembered.length > 0) groups.push({ key: "remember", title: "记住上次用的", entries: remembered, addable: true });
  const stale = entries.filter((entry) => entry.rule.mode === "fixed" && !enabled.has(entry.rule.source)).sort(byName);
  if (stale.length > 0) groups.push({ key: "stale", title: "输入法已停用", entries: stale, addable: false });
  return groups;
}

/** 「网站」卡上的一行（W-3）。 */
export interface SiteEntry {
  site: SiteRule;
  /** 它用的输入法；停用了为 `undefined`。 */
  source?: InputSource;
}

/**
 * 「网站」卡上的全部网站规则：按 pattern 排，每条带上它用的输入法（停用的标出来，点一下换一个还启用着的）。
 * @param sites 网站规则。
 * @param sources 此刻启用的输入法。
 * @returns 一行一条。
 */
export function siteList(sites: readonly SiteRule[], sources: readonly InputSource[]): SiteEntry[] {
  return [...sites]
    .sort((a, b) => a.pattern.localeCompare(b.pattern))
    .map((site) => ({ site, source: sources.find((source) => source.id === site.source) }));
}

/**
 * 换走的那一刻，要不要把这个应用此刻用着的输入法记成「上次在它里面用的」（W-2）。
 * 输入法是规则定的就不记：应用有固定规则；它是浏览器、此刻这一页命中了网站规则。其余（记住上次、无规则）都记——
 * 「无规则的应用」此刻不是「记住上次」也记，换成那一档时就不用从头学。
 * @param bundleId 被换走的应用。
 * @param memory 规则与网站规则。
 * @param page 这个应用（若是浏览器）此刻的那一页。
 * @returns 该记为真。
 */
export function learnsOnLeave(bundleId: string, memory: Pick<Memory, "rules" | "sites">, page?: Page): boolean {
  if (memory.rules[bundleId]?.mode === "fixed") return false;
  if (page && page.bundleId === bundleId && matchSite(page.url, memory.sites)) return false;
  return true;
}

/** 加应用那一步的一行。 */
export interface AppCandidate {
  bundleId: string;
  name: string;
  lastUsedAt: number | null;
  category: string | null;
}

/** 加应用那一步至多列几行：一行一个节点，60 行在 520 高的面板里要滚四五屏，再多就该搜了。 */
export const maximumCandidates = 60;

/**
 * 加应用那一步的列表：有 bundle id 的应用（同一个 bundle 装了两份只留最近用过的那份），按最近一次打开排、没打开过的按名字排在后面；
 * 有搜索词时在全部里按名字或 bundle id 找。
 * @param apps `apps.list()` 的结果。
 * @param query 搜索词。
 * @returns 至多 60 行，以及是不是还有没列出来的。
 */
export function candidates(apps: readonly MacApp[], query: string): { list: AppCandidate[]; truncated: boolean } {
  const byBundle = new Map<string, AppCandidate>();
  for (const app of apps) {
    if (!app.bundleId) continue;
    const existing = byBundle.get(app.bundleId);
    if (existing && (existing.lastUsedAt ?? -1) >= (app.lastUsedAt ?? -1)) continue;
    byBundle.set(app.bundleId, { bundleId: app.bundleId, name: app.name, lastUsedAt: app.lastUsedAt, category: app.category });
  }
  const needle = query.trim().toLowerCase();
  const all = [...byBundle.values()]
    .filter((app) => !needle || app.name.toLowerCase().includes(needle) || app.bundleId.toLowerCase().includes(needle))
    .sort((a, b) => {
      if (a.lastUsedAt !== b.lastUsedAt) return (b.lastUsedAt ?? -1) - (a.lastUsedAt ?? -1);
      return a.name.localeCompare(b.name, "zh-Hans");
    });
  return { list: all.slice(0, maximumCandidates), truncated: all.length > maximumCandidates };
}

/** 一条推荐。 */
export interface Suggestion {
  bundleId: string;
  name: string;
  choice: RuleChoice;
}

/** 推荐至多几条：一张卡一句话说得完的量。 */
export const maximumSuggestions = 6;
/** 只推一个月内打开过的：装了没用的应用不该占这张卡。 */
export const suggestionWindowMs = 30 * 24 * 60 * 60 * 1000;

/**
 * 按 App Store 分类猜几条规则：开发工具 → 第一个键盘布局（ABC），社交 / 聊天 → 第一个中日韩输入法。
 * 没有分类的不猜——猜错一个比少推一个更招人烦。已经有规则的不推。
 * @param apps `apps.list()` 的结果。
 * @param rules 规则。
 * @param sources 此刻启用的输入法。
 * @param now 此刻（Unix 毫秒）。
 * @returns 至多 6 条，最近用过的在前。
 */
export function suggestions(apps: readonly MacApp[], rules: Rules, sources: readonly InputSource[], now: number): Suggestion[] {
  const layout = sources.find((source) => source.kind === "keyboardLayout");
  const cjk = sources.find((source) => source.languages.some((language) => /^(zh|ja|ko)/.test(language)));
  const targetFor = (category: string | null): InputSource | undefined => {
    if (category === "public.app-category.developer-tools") return layout;
    if (category === "public.app-category.social-networking") return cjk;
    return undefined;
  };
  const seen = new Set<string>();
  return candidates(apps, "").list
    .filter((app) => app.lastUsedAt !== null && now - app.lastUsedAt <= suggestionWindowMs && !(app.bundleId in rules))
    .flatMap((app) => {
      const target = targetFor(app.category);
      if (!target || seen.has(app.bundleId)) return [];
      seen.add(app.bundleId);
      return [{ bundleId: app.bundleId, name: app.name, choice: `fixed:${target.id}` }];
    })
    .slice(0, maximumSuggestions);
}

/**
 * 推荐卡上那一句：「Xcode、终端 → ABC；微信 → 微信输入法」。
 * @param list 推荐。
 * @param sources 此刻启用的输入法。
 * @returns 一句话。
 */
export function suggestionSummary(list: readonly Suggestion[], sources: readonly InputSource[]): string {
  const byChoice = new Map<string, string[]>();
  for (const item of list) byChoice.set(item.choice, [...(byChoice.get(item.choice) ?? []), item.name]);
  return [...byChoice.entries()]
    .map(([choice, names]) => `${names.join("、")} → ${choiceTitle(choice, sources).replace(/^用 /, "")}`)
    .join("；");
}

/**
 * 「3 天前用过」这样的一句；没记过为 `undefined`。
 * @param lastUsedAt 最近一次打开（Unix 毫秒）。
 * @param now 此刻（Unix 毫秒）。
 * @returns 一句或 `undefined`。
 */
export function lastUsedTitle(lastUsedAt: number | null, now: number): string | undefined {
  if (lastUsedAt === null) return undefined;
  const days = Math.floor((now - lastUsedAt) / (24 * 60 * 60 * 1000));
  if (days <= 0) return "今天用过";
  if (days === 1) return "昨天用过";
  if (days < 30) return `${days} 天前用过`;
  const months = Math.floor(days / 30);
  return months < 12 ? `${months} 个月前用过` : "一年多没用过";
}

function clip(text: string, limit: number): string {
  const characters = [...text];
  return characters.length <= limit ? text : characters.slice(0, limit).join("");
}

// MARK: - 网站规则（jarvis-mac `specs/20261030-234919-input-source-site-rules` S-2）

/** 网站规则存多少条：每条几十字节、一个键；200 个网站已经远超一个人会写规则的数。 */
export const maximumSites = 200;

/** 主机名：字母、数字、连字符的标签以点相连（`localhost` 这样的单标签也收）；IPv4 自然落在里面。 */
const HOST_PATTERN = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$/;

/** 拆开的一个网址：主机名（小写、去掉 `www.` 与端口）与路径（不带查询与片段，去掉结尾的 `/`）。 */
interface Location {
  host: string;
  path: string;
}

function locate(text: string): Location | undefined {
  let rest = text.trim();
  const scheme = /^[a-z][a-z0-9+.-]*:\/\//i.exec(rest);
  if (scheme) rest = rest.slice(scheme[0].length);
  rest = rest.replace(/[?#].*$/, "");
  const slash = rest.indexOf("/");
  let host = (slash < 0 ? rest : rest.slice(0, slash)).toLowerCase();
  let path = slash < 0 ? "" : rest.slice(slash);
  host = host.replace(/^[^@]*@/, "").replace(/:\d*$/, "").replace(/^\*\./, "").replace(/^\.+/, "").replace(/\.+$/, "");
  if (host.startsWith("www.")) host = host.slice(4);
  path = path.replace(/\/{2,}/g, "/").replace(/\/+$/, "");
  if (!host || host.length > 253 || !HOST_PATTERN.test(host)) return undefined;
  return { host, path };
}

/**
 * 用户填的一个网址或主机名 → 规范化的 pattern：去掉协议、`www.`、端口、查询与片段、结尾的 `/`，主机名小写；
 * 路径保留大小写（网址的路径区分大小写）。填的不像网址为 `undefined`。
 * @param input 用户填的。
 * @returns pattern 或 `undefined`。
 */
export function normalizePattern(input: string): string | undefined {
  const location = locate(input);
  return location ? location.host + location.path : undefined;
}

function split(pattern: string): Location {
  const slash = pattern.indexOf("/");
  return slash < 0 ? { host: pattern, path: "" } : { host: pattern.slice(0, slash), path: pattern.slice(slash) };
}

/**
 * 一个网页命中哪条网站规则：只认 `http(s)`；主机名相同或是它的子域，路径（有的话）按段对齐地以它开头。多条命中取 pattern 最长的。
 * @param url 网页地址。
 * @param sites 网站规则。
 * @returns 命中的那一条或 `undefined`。
 */
export function matchSite(url: string, sites: readonly SiteRule[]): SiteRule | undefined {
  if (!/^https?:\/\//i.test(url)) return undefined;
  const page = locate(url);
  if (!page) return undefined;
  let best: SiteRule | undefined;
  for (const site of sites) {
    const { host, path } = split(site.pattern);
    if (page.host !== host && !page.host.endsWith(`.${host}`)) continue;
    if (path && page.path !== path && !page.path.startsWith(`${path}/`)) continue;
    if (!best || site.pattern.length > best.pattern.length) best = site;
  }
  return best;
}

/**
 * 「给此刻这一页定输入法」落到哪条 pattern 上：已经命中一条就是那一条（改它，不另起一条更短的），否则是这一页的主机名。
 * 不是 `http(s)` 的页（`chrome://`、本地文件）为 `undefined`。
 * @param url 网页地址。
 * @param sites 网站规则。
 * @returns pattern 或 `undefined`。
 */
export function sitePatternFor(url: string, sites: readonly SiteRule[]): string | undefined {
  if (!/^https?:\/\//i.test(url)) return undefined;
  return matchSite(url, sites)?.pattern ?? locate(url)?.host;
}

/**
 * 写一条网站规则（`source` 为 `undefined` = 删掉）。同一个 pattern 只留一条；超过上限时不加新的。
 * @param sites 旧的。
 * @param pattern 规范化过的 pattern。
 * @param source 输入法 id。
 * @returns 新的网站规则。
 */
export function setSite(sites: readonly SiteRule[], pattern: string, source: string | undefined): SiteRule[] {
  const others = sites.filter((site) => site.pattern !== pattern);
  if (source === undefined) return others;
  if (others.length === sites.length && sites.length >= maximumSites) return [...sites];
  return [...others, { pattern, source }];
}

/** 菜单里网站那一段的输入法项（`site:<序号>`，序号按推菜单时的输入法）。 */
export function siteItemID(index: number): string {
  return `site:${index}`;
}

/**
 * 菜单项 id → 网站那一段的选择：`{ source }` 换成那个输入法，`{ source: undefined }` 删掉这个网站的规则；不是网站那一段为 `undefined`。
 * @param itemId 菜单项 id。
 * @param sources 推这份菜单时的输入法。
 * @returns 选择或 `undefined`。
 */
export function siteChoiceFromMenuItem(itemId: string, sources: readonly InputSource[]): { source: string | undefined } | undefined {
  if (itemId === "site:none") return { source: undefined };
  const match = /^site:(\d+)$/.exec(itemId);
  if (!match) return undefined;
  const source = sources[Number(match[1])];
  return source ? { source: source.id } : undefined;
}

/**
 * 一页的主机名（列表与「此刻」卡上画的那几个字）。
 * @param url 网页地址。
 * @returns 主机名；读不出为原样。
 */
export function pageHost(url: string): string {
  return locate(url)?.host ?? url;
}
