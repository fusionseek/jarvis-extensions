/**
 * 菜单栏管理的纯逻辑：状态、三枚状态项的模型、该订哪几种指针事件、自动收回的倒计时、工具箱页的分段。
 *
 * 宿主不知道「段」：它只给了三样通用的东西——一个扩展可以有几枚状态项、每枚可以定宽 / 留空白，菜单栏上的指针，
 * 菜单栏上有哪些项。三段收放是这里拼出来的：两枚空白状态项当边界，收起时把边界撑到 10000 点宽，它左边的图标就被挤出屏幕。
 * （jarvis-mac `specs/20261029-225323-menubar-manager-p1` N-7）
 */
import type { MenuBarExtra, MenuBarModel, MenuBarModifier, MenuBarPointerEvent, ScreenInfo } from "@fusionseek/jarvis-extension-sdk";

/** 三枚状态项（manifest `contributes.menuBar.items`），从右到左。 */
export const TOGGLE = "toggle";
export const HIDDEN = "hidden";
export const ALWAYS = "always";

/**
 * 收起时边界撑多宽。宿主的上限，也是「挤出去」需要的宽度：macOS 26 上系统把它夹到约 5000 点，左边的图标全部落到屏幕外（本机实测）。
 */
export const HIDE_LENGTH = 10000;

/** 设置（manifest `contributes.settings.preferences`）。 */
export interface Settings {
  /** 点菜单栏空白处显示 / 收起。 */
  clickReveal: boolean;
  /** 指针停在菜单栏上时显示。要一个随鼠标移动触发的监听，默认关。 */
  hoverReveal: boolean;
  /** 在菜单栏上滚动：向上显示、向下收起。滚动监听在别的应用里滚动时也会醒，默认关。 */
  scrollReveal: boolean;
  /** 指针离开菜单栏多少秒后自动收回；0 = 不自动收回。 */
  autoRehide: number;
  /** 启用「永远隐藏」段：只有 ⌥ 点控制项才露出来。 */
  alwaysHidden: boolean;
}

export const defaultSettings: Settings = {
  clickReveal: true,
  hoverReveal: false,
  scrollReveal: false,
  autoRehide: 10,
  alwaysHidden: true,
};

/**
 * 从偏好里读设置；缺的、类型不对的用默认值。
 * @param preferences 宿主给的偏好。
 * @returns 设置。
 */
export function readSettings(preferences: Record<string, unknown>): Settings {
  const flag = (key: keyof Settings, fallback: boolean) => (typeof preferences[key] === "boolean" ? (preferences[key] as boolean) : fallback);
  const seconds = typeof preferences.autoRehide === "number" && Number.isFinite(preferences.autoRehide) ? preferences.autoRehide : defaultSettings.autoRehide;
  return {
    clickReveal: flag("clickReveal", defaultSettings.clickReveal),
    hoverReveal: flag("hoverReveal", defaultSettings.hoverReveal),
    scrollReveal: flag("scrollReveal", defaultSettings.scrollReveal),
    autoRehide: Math.max(0, Math.min(120, Math.round(seconds))),
    alwaysHidden: flag("alwaysHidden", defaultSettings.alwaysHidden),
  };
}

/** 此刻露没露。 */
export interface State {
  /** 隐藏段露出来了。 */
  expanded: boolean;
  /** 永远隐藏段也露出来了（⌥ 点）。 */
  alwaysRevealed: boolean;
}

export const collapsedState: State = { expanded: false, alwaysRevealed: false };

/**
 * 点了控制项：⌥ 点在「全部露出」与「全部收起」之间切换；普通点在「露出隐藏段」与「全部收起」之间切换。
 * @param state 此刻。
 * @param modifiers 按着的修饰键。
 * @param settings 设置（永远隐藏段关掉时 ⌥ 点等于普通点）。
 * @returns 之后。
 */
export function press(state: State, modifiers: MenuBarModifier[], settings: Settings): State {
  if (modifiers.includes("option") && settings.alwaysHidden) {
    return state.alwaysRevealed ? collapsedState : { expanded: true, alwaysRevealed: true };
  }
  return state.expanded ? collapsedState : { expanded: true, alwaysRevealed: false };
}

/**
 * 三枚状态项的模型（宿主按 `statusItem` 各画各的）。
 * @param state 此刻。
 * @param settings 设置。
 * @returns 控制项、隐藏段边界、永远隐藏段边界。
 */
export function statusModels(state: State, settings: Settings): MenuBarModel[] {
  const toggleItems: MenuBarModel["items"] = [
    { kind: "item", id: state.expanded ? "collapse" : "reveal", title: state.expanded ? "收起" : "显示隐藏的图标" },
  ];
  if (settings.alwaysHidden) {
    toggleItems.push({ kind: "item", id: state.alwaysRevealed ? "collapse-all" : "reveal-all", title: state.alwaysRevealed ? "全部收起" : "全部显示（含永远隐藏）" });
  }
  toggleItems.push({ kind: "separator" }, { kind: "header", title: "按住 ⌘ 把图标拖到竖线左边就会被收起" });

  const toggle: MenuBarModel = {
    statusItem: TOGGLE,
    // 收着时指向左边那些被藏起来的；露着时指回去，点一下收起。
    symbol: state.expanded ? "chevron.right" : "chevron.left",
    primaryClick: "event",
    tooltip: state.expanded ? "点一下收起" : settings.alwaysHidden ? "点一下显示隐藏的图标，⌥ 点连永远隐藏的一起显示" : "点一下显示隐藏的图标",
    items: toggleItems,
  };
  const divider = (id: string, shown: boolean, tooltip: string): MenuBarModel =>
    shown
      ? { statusItem: id, symbol: "poweron", length: "auto", tooltip, items: [{ kind: "item", id: "collapse", title: "收起" }] }
      : { statusItem: id, blank: true, length: HIDE_LENGTH, items: [] };
  const hidden = divider(HIDDEN, state.expanded, "隐藏段：竖线左边的图标收起时隐藏");
  const always: MenuBarModel = settings.alwaysHidden
    ? divider(ALWAYS, state.alwaysRevealed, "永远隐藏段：竖线左边的图标只有 ⌥ 点时才出来")
    : { statusItem: ALWAYS, hidden: true, length: "auto", items: [] };
  return [toggle, hidden, always];
}

/**
 * 此刻该订哪几种指针事件。**只订用得着的**：`enter` / `exit` 要一个随鼠标移动触发的全局监听，
 * 只在开了悬停显示、或者露着且要等指针离开再收回时才订；收着且没开悬停时一个移动监听都不装。
 * @param state 此刻。
 * @param settings 设置。
 * @param granted 有没有 `menuBar.pointer` 的授权。
 * @returns 要订的种类，排好序；空数组 = 不订。
 */
export function pointerTypes(state: State, settings: Settings, granted: boolean): MenuBarPointerEvent["type"][] {
  if (!granted) return [];
  const types = new Set<MenuBarPointerEvent["type"]>();
  if (settings.hoverReveal || (state.expanded && settings.autoRehide > 0)) {
    types.add("enter");
    types.add("exit");
  }
  // 露着时也订点击：点在某一颗图标上说明用户正在用它（菜单开着），收回要等久一点。
  if (settings.clickReveal || (state.expanded && settings.autoRehide > 0)) types.add("click");
  if (settings.scrollReveal) types.add("scroll");
  const order: MenuBarPointerEvent["type"][] = ["enter", "exit", "click", "scroll"];
  return order.filter((type) => types.has(type));
}

/**
 * 点在菜单栏上的这一下算不算「点空白处」：没点在任何一颗图标上，也没点在前台应用的菜单标题上。
 * 宿主还没读到菜单标题的范围（`onAppMenu` 为 `null`，没有辅助功能权限时常见）时，只认屏幕右半边——菜单标题都在左边。
 * @param event 点击事件。
 * @param screens 屏幕（拿屏宽）。
 * @returns 算为 `true`。
 */
export function isEmptyAreaClick(event: Extract<MenuBarPointerEvent, { type: "click" }>, screens: ScreenInfo[]): boolean {
  if (event.button !== "left" || event.onItem) return false;
  if (event.onAppMenu !== null) return !event.onAppMenu;
  const screen = screens.find((candidate) => candidate.id === event.screen);
  return screen !== undefined && event.x > screen.frame.width / 2;
}

/** 悬停多久才露出来：甩过菜单栏的那一下不算。 */
export const HOVER_DELAY_MS = 250;
/** 点在一颗图标上之后，收回至少再等多久：它的菜单多半开着。 */
export const INTERACTION_REHIDE_SECONDS = 20;

/**
 * 指针离开菜单栏之后多久收回。
 * @param settings 设置。
 * @param interacting 露着期间点过某一颗图标。
 * @returns 毫秒；`null` = 不自动收回。
 */
export function rehideDelay(settings: Settings, interacting: boolean): number | null {
  if (settings.autoRehide <= 0) return null;
  return (interacting ? Math.max(settings.autoRehide, INTERACTION_REHIDE_SECONDS) : settings.autoRehide) * 1000;
}

// ---------------------------------------------------------------------------
// 工具箱页的分段
// ---------------------------------------------------------------------------

/** 一颗图标在哪一段。 */
export type Section = "shown" | "hidden" | "always";

/** 分好的菜单栏。 */
export interface Layout {
  shown: MenuBarExtra[];
  hidden: MenuBarExtra[];
  always: MenuBarExtra[];
  /** 在显示段、却被刘海挡住的。 */
  notched: MenuBarExtra[];
  /** 找到了隐藏段的边界（没找到时全部算显示段）。 */
  hasDivider: boolean;
  /** 隐藏段此刻是收着的（边界撑开了）。 */
  collapsed: boolean;
}

/**
 * 按自己那两枚边界的位置，把菜单栏上的项分成三段。边界收着时被撑得很宽、落在屏幕外，比较的是它的左边——左边的一律在它左边。
 * @param items `jarvis.menuBarExtras.list()`。
 * @param screens `jarvis.screens.list()`。
 * @returns 分段。
 */
export function classify(items: MenuBarExtra[], screens: ScreenInfo[]): Layout {
  const hiddenDivider = items.find((item) => item.mine === HIDDEN);
  const alwaysDivider = items.find((item) => item.mine === ALWAYS);
  const layout: Layout = { shown: [], hidden: [], always: [], notched: [], hasDivider: hiddenDivider !== undefined, collapsed: false };
  layout.collapsed = hiddenDivider !== undefined && hiddenDivider.frame.width > 1000;
  for (const item of items) {
    if (item.mine) continue;
    const center = item.frame.x + item.frame.width / 2;
    if (alwaysDivider && center < alwaysDivider.frame.x) {
      layout.always.push(item);
    } else if (hiddenDivider && center < hiddenDivider.frame.x) {
      layout.hidden.push(item);
    } else {
      layout.shown.push(item);
      if (isBehindNotch(item, screens)) layout.notched.push(item);
    }
  }
  return layout;
}

/**
 * 在屏幕上、却被刘海挡住：窗口服务器说它不在屏幕上，而它落在刘海两侧之间。
 * @param item 一颗图标。
 * @param screens 屏幕。
 * @returns 是为 `true`。
 */
export function isBehindNotch(item: MenuBarExtra, screens: ScreenInfo[]): boolean {
  if (item.onScreen || item.screen === null) return false;
  const notch = screens.find((screen) => screen.id === item.screen)?.notch;
  if (!notch) return false;
  const gapStart = notch.left.x + notch.left.width;
  const gapEnd = notch.right.x;
  return item.frame.x < gapEnd && item.frame.x + item.frame.width > gapStart;
}

/**
 * 一颗图标在列表里叫什么：应用名，没有就用 AX 说明，再没有就是 id。
 * @param item 一颗图标。
 * @returns 名字。
 */
export function displayName(item: MenuBarExtra): string {
  return item.ownerName || item.title || item.id;
}
