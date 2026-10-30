/**
 * 后台会话里的那一份：管收放、指针订阅与自动收回，副栏模式下开副栏，点开藏起来的图标。菜单栏域的代码跑在后台会话，常驻（图标在菜单栏上）。
 *
 * **空闲时什么都不做**：收着、没开悬停时只有点击（与可选的滚动）监听，它们只在用户点、滚的时候醒；一个定时器都不挂。
 * 露着时才订指针进出、开始倒计时，收起时退订。截图只在三个时刻（启动时、展开之后、为点开而露出时），从不定时。
 */
import { jarvis, type MenuBarExtra, type MenuBarMenuState, type MenuBarModifier, type MenuBarPointerEvent, type ScreenInfo, type Unsubscribe } from "@fusionseek/jarvis-extension-sdk";
import {
  ALWAYS,
  CLOSE_REHIDE_MS,
  HIDDEN,
  HOVER_DELAY_MS,
  REVEAL_POLL_MS,
  REVEAL_TIMEOUT_MS,
  SETTLE_MS,
  TOGGLE,
  barItems,
  captureTargets,
  classify,
  collapsedState,
  defaultSettings,
  isEmptyAreaClick,
  isWithinScreens,
  pointerTypes,
  press,
  readSettings,
  rehideDelay,
  statusModels,
  type Settings,
  type State,
} from "./model.js";

/** 宿主的 `setTimeout` 单次至多 30 s：更长的倒计时一段一段接起来。 */
const MAXIMUM_TIMER_MS = 30_000;

type Timer = ReturnType<typeof setTimeout>;

function cancel(timer: Timer | undefined): undefined {
  if (timer !== undefined) clearTimeout(timer);
  return undefined;
}

export class Controller {
  private state: State = collapsedState;
  private settings: Settings = defaultSettings;
  private pointerGranted = false;
  private subscribedTypes = "";
  private unsubscribePointer: Unsubscribe | undefined;
  /** 指针此刻在菜单栏那一条上（只在订了 enter / exit 时知道）。 */
  private pointerInBar = false;
  /** 露着期间点过某一颗图标（它的菜单多半开着，收回要等久一点）。 */
  private interacting = false;
  private rehideDeadline: number | undefined;
  private rehideTimer: Timer | undefined;
  private hoverTimer: Timer | undefined;
  private screens: ScreenInfo[] = [];
  private stopPreferences: Unsubscribe | undefined;
  private granted: string[] = [];
  /** 点开的那一颗菜单正开着：开着时不倒计时（1.1）。 */
  private menuOpen = false;
  /** 这一次露出来只是为了点开一颗（副栏模式）：它的菜单一关就收回。 */
  private transient = false;
  private closeTimer: Timer | undefined;
  private settleTimer: Timer | undefined;

  /** 此刻的状态（测试读）。 */
  get current(): State {
    return this.state;
  }

  /**
   * 菜单栏域的 `start`：读偏好与授权，推第一份模型（启动时一律收着，与 Bartender 一样），按设置订指针。
   * @param preferences 此刻的偏好。
   * @param granted 此刻的授权。
   */
  async start(preferences: Record<string, unknown>, granted: string[]): Promise<void> {
    this.settings = readSettings(preferences);
    this.granted = granted;
    this.pointerGranted = granted.includes("menuBar.pointer");
    this.state = collapsedState;
    this.stopPreferences ??= jarvis.preferences.onChange(() => void this.reloadPreferences());
    // 副栏模式：Jarvis 刚创建的状态项还没定宽，藏起来的图标此刻都还在屏上——收起之前截一次，副栏里才画得出它们的样子。
    // 只在这时截，之后藏着的图标露不出来就截不到（宿主留着这一张）。
    if (this.settings.showIn === "bar") await this.captureHidden();
    await this.render();
  }

  /**
   * 控制项被左键点了。
   * @param modifiers 按着的修饰键。
   */
  async press(modifiers: MenuBarModifier[]): Promise<void> {
    if (this.settings.showIn === "bar" && !this.state.expanded) {
      const all = modifiers.includes("option") && this.settings.alwaysHidden;
      return this.openBar(all ? "all" : "hidden", TOGGLE);
    }
    await this.apply(press(this.state, modifiers, this.settings));
  }

  /**
   * 副栏里点了一颗（静默命令 `reveal-item`）：露出它所在的段、等它挪进屏幕、点开它；菜单关上就收回。
   * 宿主只给「点一下」，「先露出来、点开、等菜单关上、再收回」是这里拼的（jarvis-mac `specs/20261030-081832-menubar-manager-p2` N-2）。
   * @param id `list()` 给的 id。
   * @param granted 命令上下文里此刻的授权（用户可能刚在副栏里点了「允许」，会话启动时记下的那份已经旧了）。
   */
  async revealItem(id: string, granted: string[]): Promise<void> {
    this.granted = granted;
    if (!granted.includes("menuBarExtras.control") || !granted.includes("menuBarExtras.read")) return;
    const screens = await this.currentScreens();
    let items = await jarvis.menuBarExtras.list();
    let target = items.find((item) => item.id === id);
    if (!target) return;
    const layout = classify(items, screens);
    const inAlways = layout.always.some((item) => item.id === id);
    const inHidden = layout.hidden.some((item) => item.id === id);
    if ((inAlways && !this.state.alwaysRevealed) || (inHidden && !this.state.expanded)) {
      this.transient = !this.state.expanded;
      await this.apply({ expanded: true, alwaysRevealed: this.state.alwaysRevealed || inAlways });
      target = await this.waitUntilWithinScreens(id, screens);
      if (!target) return this.finishTransient();
      items = await jarvis.menuBarExtras.list();
    }
    this.interacting = true;
    try {
      await jarvis.menuBarExtras.press(id, { onMenu: (state) => this.menuChanged(state) });
    } catch (error) {
      jarvis.log.warn("点不开这颗图标", { id, error: error instanceof Error ? error.message : String(error) });
      return this.finishTransient();
    }
    // 它们此刻都露着：顺手刷新副栏要用的截图。
    void this.captureHidden(items);
  }

  /**
   * 菜单里点了一项（控制项与两枚边界的菜单）。
   * @param itemId 那一项。
   */
  async select(itemId: string): Promise<void> {
    switch (itemId) {
      case "reveal":
        return this.apply({ expanded: true, alwaysRevealed: false });
      case "reveal-all":
        return this.apply({ expanded: true, alwaysRevealed: this.settings.alwaysHidden });
      case "collapse":
      case "collapse-all":
        return this.apply(collapsedState);
    }
  }

  /** 快捷键 / 指令：在露与收之间切换；副栏模式下开副栏。 */
  async toggle(): Promise<void> {
    if (this.settings.showIn === "bar" && !this.state.expanded) return this.openBar("hidden", TOGGLE);
    await this.apply(this.state.expanded ? collapsedState : { expanded: true, alwaysRevealed: false });
  }

  /** 会话要收了：退订、停表（宿主同时把边界的宽度复原）。 */
  stop(): void {
    this.clearTimers();
    this.unsubscribePointer?.();
    this.unsubscribePointer = undefined;
    this.subscribedTypes = "";
    this.stopPreferences?.();
    this.stopPreferences = undefined;
  }

  // ---------------------------------------------------------------------------

  private async reloadPreferences(): Promise<void> {
    this.settings = readSettings(await jarvis.preferences.all());
    this.granted = await jarvis.permissions.granted();
    this.pointerGranted = this.granted.includes("menuBar.pointer");
    if (!this.settings.alwaysHidden && this.state.alwaysRevealed) this.state = { ...this.state, alwaysRevealed: false };
    await this.render();
  }

  private async apply(next: State): Promise<void> {
    const wasExpanded = this.state.expanded;
    this.state = next;
    // 指针在不在菜单栏上只听宿主的：订阅进出时它会先补发一条「此刻就在」的 enter。
    // 不自己假定——从指令、快捷键、工具箱页露出来时指针根本不在菜单栏上，假定它在，exit 永远不来，图标就一直不收。
    if (next.expanded && !wasExpanded) this.interacting = false;
    if (!next.expanded) {
      this.transient = false;
      this.menuOpen = false;
      this.closeTimer = cancel(this.closeTimer);
      this.settleTimer = cancel(this.settleTimer);
    }
    await this.render();
    // 在菜单栏里展开了（不是为了点开一颗而临时露出）：等图标挪到位，截一次、看看有没有被刘海挡住的。
    if (next.expanded && !wasExpanded && !this.transient) {
      this.settleTimer = cancel(this.settleTimer);
      this.settleTimer = setTimeout(() => {
        this.settleTimer = undefined;
        void this.afterExpand();
      }, SETTLE_MS);
    }
  }

  /** 展开到位之后：截隐藏段（给副栏）；被刘海挡住的放进副栏，锚在隐藏段那条竖线下面（点「‹」收起时不会被当成「关副栏」吞掉）。 */
  private async afterExpand(): Promise<void> {
    if (!this.state.expanded || !this.granted.includes("menuBarExtras.read")) return;
    const items = await jarvis.menuBarExtras.list().catch(() => [] as MenuBarExtra[]);
    void this.captureHidden(items);
    if (!this.settings.notchToBar) return;
    const screens = await this.currentScreens();
    if (barItems(items, screens, "obscured").length > 0) await this.openBar("obscured", HIDDEN);
  }

  /** 开副栏（`bar` 命令，弹窗锚在自己的一枚状态项下面）。 */
  private async openBar(scope: "hidden" | "all" | "obscured", anchor: typeof TOGGLE | typeof HIDDEN | typeof ALWAYS): Promise<void> {
    await jarvis.commands.run("bar", { argument: scope, anchor: { statusItem: anchor } }).catch((error: unknown) => {
      jarvis.log.warn("副栏没开出来", error instanceof Error ? error.message : String(error));
    });
  }

  /** 截隐藏段与永远隐藏段里此刻露着的那几颗（宿主按窗口留着，副栏打开时就有图）。没授权就什么都不做。 */
  private async captureHidden(known?: MenuBarExtra[]): Promise<void> {
    if (!this.granted.includes("menuBarExtras.capture") || !this.granted.includes("menuBarExtras.read")) return;
    try {
      const items = known ?? (await jarvis.menuBarExtras.list());
      const ids = captureTargets(items, await this.currentScreens());
      if (ids.length > 0) await jarvis.menuBarExtras.capture(ids);
    } catch (error) {
      jarvis.log.debug("这一次没截到", error instanceof Error ? error.message : String(error));
    }
  }

  /** 点开那一颗之后它的菜单开了、关了，或者弹的根本不是菜单。 */
  private menuChanged(state: MenuBarMenuState): void {
    if (state === "opened") {
      this.menuOpen = true;
      this.rehideTimer = cancel(this.rehideTimer);
      this.rehideDeadline = undefined;
      return;
    }
    this.menuOpen = false;
    if (state === "closed" && this.transient) {
      this.closeTimer = cancel(this.closeTimer);
      this.closeTimer = setTimeout(() => {
        this.closeTimer = undefined;
        if (!this.menuOpen) void this.apply(collapsedState);
      }, CLOSE_REHIDE_MS);
      return;
    }
    // 弹的是窗口、面板（`none`），或者是在菜单栏里展开时点的：按「点过某颗图标」的规则自己收。
    this.transient = false;
    this.scheduleRehide();
  }

  /** 为点开而临时露出、却没点成：收回去。 */
  private async finishTransient(): Promise<void> {
    if (this.transient) await this.apply(collapsedState);
  }

  /** 露出来之后等那一颗挪进屏幕的横向范围（刘海下面也算，AXPress 照样能开它的菜单）。 */
  private async waitUntilWithinScreens(id: string, screens: ScreenInfo[]): Promise<MenuBarExtra | undefined> {
    const deadline = Date.now() + REVEAL_TIMEOUT_MS;
    for (;;) {
      const item = (await jarvis.menuBarExtras.list()).find((candidate) => candidate.id === id);
      if (item && isWithinScreens(item, screens)) return item;
      if (!item || Date.now() >= deadline) return undefined;
      await new Promise<void>((resolve) => setTimeout(resolve, REVEAL_POLL_MS));
    }
  }

  private async currentScreens(): Promise<ScreenInfo[]> {
    if (this.screens.length === 0) this.screens = await jarvis.screens.list().catch(() => [] as ScreenInfo[]);
    return this.screens;
  }

  private async render(): Promise<void> {
    for (const model of statusModels(this.state, this.settings)) await jarvis.menuBar.update(model);
    this.syncPointer();
    this.scheduleRehide();
  }

  /** 订阅范围变了才重订：没变的不碰（宿主那边一订一退都是一次调用）。 */
  private syncPointer(): void {
    const types = pointerTypes(this.state, this.settings, this.pointerGranted);
    const signature = types.join(",");
    if (signature === this.subscribedTypes) return;
    this.unsubscribePointer?.();
    this.unsubscribePointer = undefined;
    this.subscribedTypes = signature;
    // 重订之后的初始状态由宿主补发的 enter 告诉我们；在那之前当作不在。
    this.pointerInBar = false;
    if (types.length === 0) return;
    if (types.includes("click") && this.screens.length === 0) {
      void jarvis.screens.list().then((screens) => (this.screens = screens), () => undefined);
    }
    this.unsubscribePointer = jarvis.menuBar.observePointer(types, (event) => void this.pointer(event));
  }

  private async pointer(event: MenuBarPointerEvent): Promise<void> {
    switch (event.type) {
      case "enter":
        this.pointerInBar = true;
        this.scheduleRehide();
        if (!this.state.expanded && this.settings.hoverReveal) {
          this.hoverTimer = cancel(this.hoverTimer);
          this.hoverTimer = setTimeout(() => {
            this.hoverTimer = undefined;
            if (this.pointerInBar && !this.state.expanded) void this.toggle();
          }, HOVER_DELAY_MS);
        }
        return;
      case "exit":
        this.pointerInBar = false;
        this.hoverTimer = cancel(this.hoverTimer);
        this.scheduleRehide();
        return;
      case "click":
        if (this.state.expanded && event.onItem) {
          this.interacting = true;
          this.scheduleRehide();
          return;
        }
        if (this.settings.clickReveal && isEmptyAreaClick(event, this.screens)) await this.toggle();
        return;
      case "scroll":
        if (!this.settings.scrollReveal || Math.abs(event.deltaY) < 1) return;
        if (event.deltaY > 0 && !this.state.expanded) await this.toggle();
        if (event.deltaY < 0 && this.state.expanded) await this.apply(collapsedState);
        return;
    }
  }

  /**
   * 倒计时：露着、指针不在菜单栏上时开始；指针回到菜单栏上就停。到点收起。
   * 收着时不挂任何定时器。
   */
  private scheduleRehide(): void {
    this.rehideTimer = cancel(this.rehideTimer);
    this.rehideDeadline = undefined;
    const delay = rehideDelay(this.settings, this.interacting);
    // 点开的那一颗菜单开着：用户正在里面挑，不倒计时；关上之后再说。
    if (!this.state.expanded || delay === null || this.menuOpen) return;
    // 没订 enter / exit（没有授权）时不知道指针在哪：露出来之后直接倒计时。
    const knowsPointer = this.subscribedTypes.includes("exit");
    if (knowsPointer && this.pointerInBar) return;
    this.rehideDeadline = Date.now() + delay;
    this.armRehide();
  }

  private armRehide(): void {
    if (this.rehideDeadline === undefined) return;
    const remaining = this.rehideDeadline - Date.now();
    if (remaining <= 0) {
      this.rehideDeadline = undefined;
      this.rehideTimer = undefined;
      void this.apply(collapsedState);
      return;
    }
    this.rehideTimer = setTimeout(() => this.armRehide(), Math.min(remaining, MAXIMUM_TIMER_MS));
  }

  private clearTimers(): void {
    this.rehideTimer = cancel(this.rehideTimer);
    this.hoverTimer = cancel(this.hoverTimer);
    this.closeTimer = cancel(this.closeTimer);
    this.settleTimer = cancel(this.settleTimer);
    this.rehideDeadline = undefined;
  }
}
