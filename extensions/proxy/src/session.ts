/**
 * 前台会话：工具箱那一页与窗口标签共用的状态（一个 JSContext 同一时刻只画一面）。
 *
 * 页面开着时每秒读一次连接快照（速率与「连接」那一页），每 10 秒重读一次全部状态——菜单栏或指令在另一个会话里开关了代理，
 * 这里要跟上。页面一关，两条都停（`generation` 一变，循环在下一拍退出）。
 */
import { jarvis, sleep, type ActivationContext, type DaemonEvent, type PageDefinition, type Surface, type Unsubscribe } from "@fusionseek/jarvis-extension-sdk";
import { pushMenu, seenConnections } from "./background.js";
import { trafficRate, type ConnectionsSnapshot, type TrafficRate, type TrafficSample } from "./clash.js";
import { allCapabilities, errorMessage, ProxyCore, tunnelCapability, type ActionResult, type Snapshot } from "./core.js";
import { renderPage } from "./page.js";
import type { PolicyRef } from "./rules.js";
import type { ProxyMode } from "./singbox-config.js";
import { describeFailure, normalizeSelection, requiredCapability, type GroupView, type PageView } from "./status.js";
import { storageKeys } from "./store.js";
import { TrafficMeter, type TrafficReading } from "./traffic.js";

/** 窗口里的五页。 */
export type WindowView = "nodes" | "connections" | "rules" | "logs" | "subscriptions";

/** 挑 Surge 配置时打开面板的起点：Surge 自己存配置的地方。 */
export const surgeProfilesDirectory = "~/Library/Application Support/Surge/Profiles";

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
  /** 这一页自己的成败统计（「连接」页的失败列表、状态段的读数）。 */
  readonly meter = new TrafficMeter();
  reading: TrafficReading | null = null;
  /** 「规则」页里读到的当前页面；没读过为 `null`。 */
  currentPage: PageView | null = null;
  private sample: TrafficSample | null = null;
  private generation = 0;
  private unobserveDaemon: Unsubscribe | null = null;
  private unobserveTunnel: Unsubscribe | null = null;
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
    if (!this.unwatch) this.unwatch = jarvis.preferences.onChange((changes) => void this.onPreferencesChanged(changes));
    if (this.surface === "window") await this.loadLogs();
    void this.loop(generation);
  }

  private deactivate(): void {
    this.generation += 1;
    this.unobserveDaemon?.();
    this.unobserveDaemon = null;
    this.unobserveTunnel?.();
    this.unobserveTunnel = null;
    this.unwatch?.();
    this.unwatch = null;
    this.sample = null;
    this.rate = null;
    this.reading = null;
    this.meter.reset();
  }

  /**
   * 偏好变了：「开启时用增强模式」被改过，就让它重新说了算（丢掉菜单里拨过的那一次）；「规则集地址」变了就去拉一遍。
   * @param changes 变了的几项。
   */
  private async onPreferencesChanged(changes: Record<string, unknown>): Promise<void> {
    if ("tun" in changes) {
      try {
        const selection = normalizeSelection(await jarvis.storage.get(storageKeys.selection));
        await jarvis.storage.set(storageKeys.selection, { ...selection, tun: null });
      } catch {
        // 存储坏了：照旧按拨过的那一次。
      }
    }
    if ("ruleSets" in changes && this.snapshot?.granted.includes("network.https")) {
      const result = await this.core.updateRuleSets();
      if (result.message) this.message = result;
    }
    await this.refresh();
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
        this.reading = null;
        this.meter.reset();
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
    const granted = this.snapshot?.granted ?? [];
    const listener = (event: DaemonEvent) => {
      if (event.kind === "output") {
        this.logs = [...this.logs, ...event.lines].slice(-maximumLogLines);
        this.meter.ingestLines(event.lines, Date.now());
        if (this.surface === "window" && this.view === "logs") jarvis.ui.update();
        return;
      }
      void this.onExit(event.expected, event.lines);
    };
    if (!this.unobserveDaemon && granted.includes(requiredCapability)) this.unobserveDaemon = jarvis.daemon.observe("sing-box", listener);
    if (!this.unobserveTunnel && granted.includes(tunnelCapability)) this.unobserveTunnel = jarvis.tunnel.observe(listener);
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
          const now = Date.now();
          const sample: TrafficSample = { at: now, upload: snapshot.uploadTotal, download: snapshot.downloadTotal };
          this.rate = trafficRate(this.sample, sample) ?? this.rate;
          this.sample = sample;
          this.connections = snapshot;
          this.meter.ingestSnapshot(snapshot, now);
          this.reading = this.meter.reading(now);
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
      await this.refresh();
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

  /** 开 / 关增强模式（开着就换内核重开；第一次打开时宿主弹管理员密码框）。 */
  setTun(on: boolean): Promise<void> {
    return this.run(() => this.core.setTun(on));
  }

  /** 只问增强模式这一项授权（只在用户按下的回调里有效）。 */
  grantTunnel(): Promise<void> {
    return this.run(async () => {
      const result = await jarvis.permissions.request([tunnelCapability]);
      await this.refresh();
      this.observe();
      return result.granted.includes(tunnelCapability) ? { ok: true, message: "" } : { ok: false, message: "没有授权增强模式：照常用系统代理模式" };
    });
  }

  /** 给导入的一个策略组换组员。 */
  selectGroupMember(group: GroupView, member: string): Promise<void> {
    return this.run(() => this.core.selectGroupMember(group, member));
  }

  /** 重新载入配置（不断进程）。 */
  reload(): Promise<void> {
    return this.run(() => this.core.reload());
  }

  /**
   * 给一个域名定策略（`null` = 删掉它的规则）。
   * @param domain 可注册域名。
   * @param policy 策略。
   */
  setPageRule(domain: string, policy: PolicyRef | null): Promise<void> {
    return this.run(() => this.core.setPageRule(domain, policy));
  }

  /** 删一条页面规则。 */
  removePageRule(id: string): Promise<void> {
    return this.run(() => this.core.removePageRule(id));
  }

  /** 读一次浏览器的当前页面（「规则」页上那一段）。 */
  readPage(): Promise<void> {
    return this.run(async () => {
      if (!this.snapshot?.granted.includes("browser.activeTab")) {
        const result = await jarvis.permissions.request(["browser.activeTab"]);
        if (!result.granted.includes("browser.activeTab")) return { ok: false, message: "没有授权读取浏览器当前页" };
      }
      const granted = await this.core.granted();
      const page = await this.core.currentPage(granted, seenConnections(this.meter.recent(Date.now(), 2000)));
      this.currentPage = page;
      return page.status === "ok" || page.status === "unsupported" ? { ok: true, message: "" } : { ok: false, message: page.message || "读不到浏览器的地址" };
    });
  }

  /** 挑一份 Surge 配置导入（宿主画打开面板，起点是 Surge 存配置的地方）。 */
  importSurge(): Promise<void> {
    return this.run(async () => {
      if (!this.snapshot?.granted.includes("files.pick")) {
        const result = await jarvis.permissions.request(["files.pick"]);
        if (!result.granted.includes("files.pick")) return { ok: false, message: "没有授权挑文件：导入要你在打开面板里亲手挑那份配置" };
      }
      const picked = await jarvis.files.pick({ title: "选一份 Surge 配置（.conf）", directory: surgeProfilesDirectory, extensions: ["conf", "txt"] });
      if (!picked) return { ok: true, message: "" };
      this.view = "rules";
      return this.core.importSurge(picked.text, picked.name);
    });
  }

  /** 撤掉导入的 Surge 配置。 */
  clearSurge(): Promise<void> {
    return this.run(() => this.core.clearSurge());
  }

  /** 拉一遍外部规则集。 */
  updateRuleSets(): Promise<void> {
    return this.run(async () => {
      const result = await this.core.updateRuleSets();
      return result.message ? result : { ok: true, message: "没有要拉的外部规则集" };
    });
  }

  /**
   * 命令（菜单栏「导入 Surge 配置」「规则」经它开窗口）。
   * @param id 命令 id。
   */
  async command(id: string): Promise<void> {
    this.view = "rules";
    jarvis.ui.update();
    if (id === "import-surge") await this.importSurge();
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
