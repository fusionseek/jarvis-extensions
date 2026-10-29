/**
 * 后台会话里的那一份：管收放、指针订阅与自动收回。菜单栏域的代码跑在后台会话，常驻（图标在菜单栏上）。
 *
 * **空闲时什么都不做**：收着、没开悬停时只有点击（与可选的滚动）监听，它们只在用户点、滚的时候醒；一个定时器都不挂。
 * 露着时才订指针进出、开始倒计时，收起时退订。
 */
import { jarvis, type MenuBarModifier, type MenuBarPointerEvent, type ScreenInfo, type Unsubscribe } from "@fusionseek/jarvis-extension-sdk";
import {
  HOVER_DELAY_MS,
  collapsedState,
  defaultSettings,
  isEmptyAreaClick,
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
    this.pointerGranted = granted.includes("menuBar.pointer");
    this.state = collapsedState;
    this.stopPreferences ??= jarvis.preferences.onChange(() => void this.reloadPreferences());
    await this.render();
  }

  /**
   * 控制项被左键点了。
   * @param modifiers 按着的修饰键。
   */
  async press(modifiers: MenuBarModifier[]): Promise<void> {
    await this.apply(press(this.state, modifiers, this.settings));
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

  /** 快捷键 / 指令：在露与收之间切换。 */
  async toggle(): Promise<void> {
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
    this.pointerGranted = (await jarvis.permissions.granted()).includes("menuBar.pointer");
    if (!this.settings.alwaysHidden && this.state.alwaysRevealed) this.state = { ...this.state, alwaysRevealed: false };
    await this.render();
  }

  private async apply(next: State): Promise<void> {
    const wasExpanded = this.state.expanded;
    this.state = next;
    // 指针在不在菜单栏上只听宿主的：订阅进出时它会先补发一条「此刻就在」的 enter。
    // 不自己假定——从指令、快捷键、工具箱页露出来时指针根本不在菜单栏上，假定它在，exit 永远不来，图标就一直不收。
    if (next.expanded && !wasExpanded) this.interacting = false;
    await this.render();
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
            if (this.pointerInBar && !this.state.expanded) void this.apply({ expanded: true, alwaysRevealed: false });
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
        if (event.deltaY > 0 && !this.state.expanded) await this.apply({ expanded: true, alwaysRevealed: false });
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
    if (!this.state.expanded || delay === null) return;
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
    this.rehideDeadline = undefined;
  }
}
