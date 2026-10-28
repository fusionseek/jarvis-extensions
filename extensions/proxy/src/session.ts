/**
 * 前台会话：工具箱那一页与窗口标签共用的状态（一个 JSContext 同一时刻只画一面）。
 *
 * 页面开着时每秒读一次连接快照（速率与「连接」那一页），每 10 秒重读一次全部状态——菜单栏或指令在另一个会话里开关了代理，
 * 这里要跟上。页面一关，两条都停（`generation` 一变，循环在下一拍退出）。
 */
import { jarvis, sleep, type ActivationContext, type PageDefinition, type Surface, type Unsubscribe } from "@fusionseek/jarvis-extension-sdk";
import { pushMenu } from "./background.js";
import { trafficRate, type ConnectionsSnapshot, type TrafficRate, type TrafficSample } from "./clash.js";
import { allCapabilities, errorMessage, ProxyCore, type ActionResult, type Snapshot } from "./core.js";
import { renderPage } from "./page.js";
import type { ProxyMode } from "./singbox-config.js";
import { describeFailure, requiredCapability } from "./status.js";
import { storageKeys } from "./store.js";

/** 窗口里的四页。 */
export type WindowView = "nodes" | "connections" | "logs" | "subscriptions";

/** 日志留多少行：与宿主 `daemon.logs` 的 500 行一致。 */
const maximumLogLines = 500;

/** 点了「在终端中安装」之后等多久：与 Mole 那一份相同，10 分钟够 Homebrew 下完再装完。 */
const installWaitMs = 10 * 60 * 1000;

export class Session {
  readonly core = new ProxyCore(() => jarvis.ui.update());
  surface: Surface = "toolbox";
  snapshot: Snapshot | null = null;
  view: WindowView = "nodes";
  /** 节点搜索框里的字。 */
  filter = "";
  /** 上一个动作的结果（页面上那一行）。 */
  message: ActionResult | null = null;
  rate: TrafficRate | null = null;
  connections: ConnectionsSnapshot | null = null;
  logs: string[] = [];
  /** 「自动选择」此刻选中的节点。 */
  autoPick: string | null = null;
  /** 点「在终端中安装」的时刻；不在等为 `null`。 */
  installingSince: number | null = null;
  private sample: TrafficSample | null = null;
  private generation = 0;
  private unobserve: Unsubscribe | null = null;
  private unwatch: Unsubscribe | null = null;

  /** 交给 `defineExtension` 的页面（工具箱与窗口同一份，按 `surface` 画）。 */
  readonly page: PageDefinition = {
    activate: (context) => this.activate(context),
    deactivate: () => this.deactivate(),
    render: () => renderPage(this),
  };

  private async activate(context: ActivationContext): Promise<void> {
    this.surface = context.surface;
    this.generation += 1;
    const generation = this.generation;
    await this.refresh();
    this.observe();
    if (!this.unwatch) this.unwatch = jarvis.preferences.onChange(() => void this.refresh());
    if (this.surface === "window") await this.loadLogs();
    void this.loop(generation);
  }

  private deactivate(): void {
    this.generation += 1;
    this.unobserve?.();
    this.unobserve = null;
    this.unwatch?.();
    this.unwatch = null;
    this.sample = null;
    this.rate = null;
  }

  /** 重读全部状态，重画，并把菜单栏也推一份（后台会话可能此刻没在跑，图标不能停在旧状态）。 */
  async refresh(): Promise<void> {
    try {
      const snapshot = await this.core.snapshot();
      this.snapshot = snapshot;
      this.autoPick = snapshot.phase === "running" ? await this.core.autoPick() : null;
      if (snapshot.phase !== "running") {
        this.rate = null;
        this.connections = null;
      }
      if (this.installingSince !== null && (snapshot.phase !== "notInstalled" || Date.now() - this.installingSince > installWaitMs)) {
        this.installingSince = null;
      }
      jarvis.ui.update();
      await pushMenu(snapshot, { autoPick: this.autoPick, rate: null, busy: this.core.busy });
    } catch (error) {
      this.message = { ok: false, message: `读不出状态：${errorMessage(error)}` };
      jarvis.ui.update();
    }
  }

  private observe(): void {
    if (this.unobserve || !this.snapshot?.granted.includes(requiredCapability)) return;
    this.unobserve = jarvis.daemon.observe("sing-box", (event) => {
      if (event.kind === "output") {
        this.logs = [...this.logs, ...event.lines].slice(-maximumLogLines);
        if (this.surface === "window" && this.view === "logs") jarvis.ui.update();
        return;
      }
      void this.onExit(event.expected, event.lines);
    });
  }

  /**
   * 内核退出了。意外退出时也在这里记一份失败（后台会话没在跑时——用户关了「在菜单栏显示」——没有别人会记），
   * 开启过程中的退出除外：那由正在开启的一方处理。
   */
  private async onExit(expected: boolean, lines: string[]): Promise<void> {
    if (!expected) {
      const control = await this.core.control();
      if (!control?.starting) {
        const preferences = await this.core.preferences();
        const { message, hint } = describeFailure(lines, preferences);
        try {
          await jarvis.storage.set(storageKeys.failure, { at: Date.now(), message, lines: lines.slice(-20), hint });
        } catch {
          // 存不进去也照样刷新：宿主报的 exited 状态本身就会让页面进「起不来」那一屏。
        }
      }
    }
    await this.refresh();
  }

  private async loadLogs(): Promise<void> {
    this.logs = (await this.core.logs()).slice(-maximumLogLines);
    jarvis.ui.update();
  }

  /** 页面开着时的每秒一拍。 */
  private async loop(generation: number): Promise<void> {
    for (let tick = 1; ; tick += 1) {
      await sleep(1000);
      if (generation !== this.generation) return;
      if (this.snapshot?.phase === "running") {
        const snapshot = await this.core.connections();
        if (generation !== this.generation) return;
        if (snapshot) {
          const sample: TrafficSample = { at: Date.now(), upload: snapshot.uploadTotal, download: snapshot.downloadTotal };
          this.rate = trafficRate(this.sample, sample) ?? this.rate;
          this.sample = sample;
          this.connections = snapshot;
          jarvis.ui.update();
        }
      }
      const waitingInstall = this.installingSince !== null && tick % 2 === 0;
      if (waitingInstall || tick % 10 === 0) await this.refresh();
    }
  }

  /**
   * 跑一个动作：记下结果那一句、重读状态。
   * @param action 动作。
   */
  private async run(action: () => Promise<ActionResult>): Promise<void> {
    this.message = null;
    jarvis.ui.update();
    let result: ActionResult;
    try {
      result = await action();
    } catch (error) {
      result = { ok: false, message: errorMessage(error) };
    }
    this.message = result.message ? result : null;
    await this.refresh();
  }

  /** 开 / 关。 */
  toggle(on: boolean): Promise<void> {
    return this.run(() => (on ? this.core.turnOn() : this.core.turnOff()));
  }

  /** 重开（设置或订阅改过）。 */
  restart(): Promise<void> {
    return this.run(() => this.core.restart());
  }

  /** 一次问完全部授权（只在用户按下的回调里有效）。 */
  grant(): Promise<void> {
    return this.run(async () => {
      const result = await jarvis.permissions.request([...allCapabilities]);
      this.observe();
      return result.denied.includes(requiredCapability)
        ? { ok: false, message: "没有授权在后台运行 sing-box，「代理」开不起来" }
        : { ok: true, message: "" };
    });
  }

  /** 在终端里装 / 升级 sing-box；没授权终端先问一次。 */
  install(): Promise<void> {
    return this.run(async () => {
      if (!this.snapshot?.granted.includes("terminal.run")) {
        const result = await jarvis.permissions.request(["terminal.run"]);
        if (!result.granted.includes("terminal.run")) return { ok: false, message: "没有授权打开终端：自己在终端里运行 brew install sing-box 也行" };
      }
      const result = await this.core.install();
      if (result.ok) this.installingSince = Date.now();
      return result;
    });
  }

  /** 打开设置里「代理」那一块。 */
  openSettings(): void {
    void jarvis.system.openExtensionSettings().catch(() => undefined);
  }

  /**
   * 在工作区窗口里打开，并落在某一页。
   * @param view 哪一页。
   */
  openWindow(view: WindowView): void {
    this.view = view;
    void jarvis.window.open().catch(() => undefined);
  }

  /**
   * 换窗口里的页。
   * @param view 哪一页。
   */
  async showView(view: WindowView): Promise<void> {
    this.view = view;
    jarvis.ui.update();
    if (view === "logs") await this.loadLogs();
  }

  setMode(mode: ProxyMode): Promise<void> {
    return this.run(() => this.core.setMode(mode));
  }

  selectNode(name: string): Promise<void> {
    return this.run(() => this.core.selectNode(name));
  }

  setSystemProxy(on: boolean): Promise<void> {
    return this.run(() => this.core.setSystemProxy(on));
  }

  test(): Promise<void> {
    return this.run(() => this.core.testLatency());
  }

  update(): Promise<void> {
    return this.run(() => this.core.updateSubscriptions());
  }

  /**
   * 改搜索框。
   * @param value 字。
   */
  search(value: string): void {
    this.filter = value;
  }
}
