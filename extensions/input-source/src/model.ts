/**
 * 纯函数：规则、决定切到哪一个、显示用的短名与说明、菜单栏模型。测试直接 import 它（`test/support.mjs` 现编）。
 *
 * 宿主不认识「规则」：它只给读 / 切输入源、前台应用、提示这几样通用的东西（jarvis-mac `specs/20261030-170731-input-source-switch-p1`），
 * 哪个应用用哪个输入法、没写规则的怎么办，全在这里。
 */
import type { InputSource, MenuBarItem, MenuBarModel } from "@fusionseek/jarvis-extension-sdk";

/** 一个应用的规则。`name` 是定规则时的应用名：列表里要画，而那个应用此刻未必开着。 */
export type Rule =
  | { mode: "fixed"; source: string; name: string }
  | { mode: "remember"; name: string }
  | { mode: "ignore"; name: string };

/** bundle id → 规则。 */
export type Rules = Record<string, Rule>;

/** 没写规则的应用怎么办。 */
export type Others = "keep" | "remember" | "default";

/** 提示贴在哪。 */
export type HUDAnchor = "caret" | "pointer" | "screen";

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
  hudAnchor: "caret",
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
    hudAnchor: pick(preferences.hudAnchor, ["caret", "pointer", "screen"] as const, defaultSettings.hudAnchor),
    hudOnManual: flag(preferences.hudOnManual, defaultSettings.hudOnManual),
    menuBarLabel: flag(preferences.menuBarLabel, defaultSettings.menuBarLabel),
    paused: flag(preferences.paused, defaultSettings.paused),
  };
}

/** 存在 `jarvis.storage` 里的三样。 */
export interface Memory {
  rules: Rules;
  /** bundle id → 你在那个应用里最后一次**手动**换到的输入法。 */
  lastUsed: Record<string, string>;
  /** 「换成默认输入法」换成哪一个。 */
  fallbackSource?: string;
}

export const emptyMemory: Memory = { rules: {}, lastUsed: {} };

/** 规则存多少条：每条几十字节，宿主给每个扩展 2 MB / 2000 条，这里只占一个键。300 个应用已经远超一个人会写规则的数。 */
export const maximumRules = 300;
/** 「记住上次」记多少个应用：最旧的先丢。 */
export const maximumRemembered = 300;

/**
 * 切到这个应用时该换成哪一个；不换为 `undefined`。
 *
 * - 应用有规则：`fixed` 换成那一个；`remember` 换成上次手动用的（没记过就不动）；`ignore` 不动。
 * - 没有规则：按「没写规则的应用」——不动 / 记住上次 / 默认输入法。
 * - 目标此刻没启用（用户在系统设置里删掉了）：不动，不报错。
 *
 * @param bundleId 切到的应用。
 * @param memory 规则与记忆。
 * @param settings 偏好。
 * @param enabled 此刻启用的输入法 id。
 * @returns 目标 id 或 `undefined`。
 */
export function resolveTarget(bundleId: string, memory: Memory, settings: Settings, enabled: readonly string[]): string | undefined {
  const rule = memory.rules[bundleId];
  let target: string | undefined;
  if (rule) {
    if (rule.mode === "fixed") target = rule.source;
    else if (rule.mode === "remember") target = memory.lastUsed[bundleId];
    else return undefined;
  } else if (settings.others === "remember") {
    target = memory.lastUsed[bundleId];
  } else if (settings.others === "default") {
    target = memory.fallbackSource;
  }
  return target !== undefined && enabled.includes(target) ? target : undefined;
}

/**
 * 记一次手动切换：最近的放到最后，超过上限丢最旧的。
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

/** 选择器里的取值：`fixed:<输入法 id>` / `remember` / `ignore` / `none`（跟着「没写规则的应用」）。 */
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
  if (choice === "ignore") return { mode: "ignore", name };
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
 * 「没写规则的应用」那一档的名字。
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
 * @param settings 偏好（没写规则时说「跟着……」）。
 * @returns 说明。
 */
export function ruleTitle(rule: Rule | undefined, sources: readonly InputSource[], settings: Settings): string {
  if (!rule) return `没写规则 · ${othersTitle(settings.others)}`;
  switch (rule.mode) {
    case "fixed": {
      const source = sources.find((candidate) => candidate.id === rule.source);
      return source ? source.name : "那个输入法已经停用了";
    }
    case "remember":
      return "记住上次用的";
    case "ignore":
      return "不管它";
  }
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
  if (itemId === "remember" || itemId === "ignore" || itemId === "none") return itemId;
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
      { kind: "item", id: "ignore", title: "不管它", checked: choice === "ignore" },
      {
        kind: "item",
        id: "none",
        title: "不写规则",
        subtitle: clip(`跟着「没写规则的应用」：${othersTitle(state.settings.others)}`, 80),
        checked: choice === "none",
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

function clip(text: string, limit: number): string {
  const characters = [...text];
  return characters.length <= limit ? text : characters.slice(0, limit).join("");
}
