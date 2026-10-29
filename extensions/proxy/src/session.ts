/**
 * 前台会话：工具箱那一页与窗口标签共用的状态（一个 JSContext 同一时刻只画一面）。
 *
 * 页面开着时每秒读一次连接快照（速率与「连接」那一页），每 10 秒重读一次全部状态——菜单栏或指令在另一个会话里开关了代理，
 * 这里要跟上。页面一关，两条都停（`generation` 一变，循环在下一拍退出）。
 */
import { jarvis, networkStatus, sleep, type ActivationContext, type DaemonEvent, type NetworkStatus, type PageDefinition, type Surface, type Unsubscribe } from "@fusionseek/jarvis-extension-sdk";
import { pushMenu, seenConnections } from "./background.js";
import { trafficRate, type ConnectionsSnapshot, type TrafficRate, type TrafficSample } from "./clash.js";
import type { RuleHits } from "./rule-table.js";
import type { RoutePlan } from "./singbox-config.js";
import { processRates, restoreDay, type DayStats, type ProcessRate, type UsageCategory } from "./stats.js";
import { allCapabilities, errorMessage, ProxyCore, tunnelCapability, type ActionResult, type Snapshot } from "./core.js";
import { renderPage } from "./page.js";
import type { PolicyRef } from "./rules.js";
import type { ProxyMode } from "./singbox-config.js";
import { describeFailure, requiredCapability, type GroupView, type PageView } from "./status.js";
import { storageKeys } from "./store.js";
import { TrafficMeter, type TrafficReading } from "./traffic.js";
import { SELECTOR_TAG } from "./nodes.js";

/**
 * 窗口左边栏的四页（jarvis-mac `specs/20261028-191224-git-push-error-proxy-dashboard-issue-links` P-3）：活动、进程、策略、规则。
 * 原来 segmented 里的五页并进来：节点与订阅进「策略」，连接与日志进「进程」，规则照旧。
 */
export type WindowView = "activity" | "processes" | "policies" | "rules";

/** 工具箱里「去窗口里看」的那几处说的旧页名，落到新的哪一页。 */
export const legacyViews: Readonly<Record<string, WindowView>> = {
  nodes: "policies",
  subscriptions: "policies",
  connections: "processes",
  logs: "processes",
  rules: "rules",
};

/** 「流量」卡看全部还是只看经过节点的。 */
export type TrafficScope = "all" | "proxy";

/** 「Internet 延迟」测哪里：苹果自己的连通性检测页，国内直连也通（谷歌那一个直连不通）。必须是 https——sing-box 遇到 http 会换成默认地址。 */
export const internetTestURL = "https://www.apple.com/library/test/success.html";

/** 外部 IP 从哪查（manifest `network.hosts` 写死的那一个）。 */
export const externalIPURL = "https://api.ipify.org?format=json";

/** 外部 IP 多久重查一次：出口换了（切节点、换网络）五分钟内跟上，又不至于每次开窗口都问一遍。 */
export const externalIPTTL = 5 * 60 * 1000;

/** 「Internet 延迟」与网络接口多久重测一次。 */
const internetEveryTicks = 30;

/** 挑 Surge 配置时打开面板的起点：Surge 自己存配置的地方。 */
export const surgeProfilesDirectory = "~/Library/Application Support/Surge/Profiles";

/**
 * 读一次外部 IP 的回答（`{"ip":"…"}`）。
 * @param text 正文。
 * @returns 地址；读不出为 `null`。
 */
export function parseExternalIP(text: string): string | null {
  try {
    const body = JSON.parse(text) as { ip?: unknown };
    return typeof body.ip === "string" && /^[0-9a-fA-F.:]{3,45}$/.test(body.ip) ? body.ip : null;
  } catch {
    return null;
  }
}

/** 窗口页头里成功的那一句停多久：页面一秒一拍，6 秒读得完一句话。 */
export const messageDwell = 6000;

/** 日志留多少行：与宿主 `daemon.logs` 的 500 行一致。 */
const maximumLogLines = 500;

/** 点了「在终端中安装」之后等多久：与 Mole 那一份相同，10 分钟够 Homebrew 下完再装完。 */
const installWaitMs = 10 * 60 * 1000;

/** 状态段那块曲线留多少个点（一秒一个）：与菜单顶部那块同长。 */
export const chartPoints = 60;

export class Session {
  readonly core = new ProxyCore(() => jarvis.ui.update());
  surface: Surface = "toolbox";
  snapshot: Snapshot | null = null;
  view: WindowView = "activity";
  /** 工具箱「订阅」那一段展开了「管理订阅」（宿主画的地址列表，P-2）。 */
  manageSubscriptions = false;
  /** 「流量」卡看哪一份。 */
  trafficScope: TrafficScope = "all";
  /** Top 10 看哪一类。 */
  topCategory: UsageCategory = "processes";
  /** 此刻的主网络接口；没读过为 `null`。 */
  network: NetworkStatus | null = null;
  /** 外部 IP 与查到的时刻；`ip` 为 `null` = 查过但没查到。 */
  externalIP: { ip: string | null; at: number } | null = null;
  /** 「Internet 延迟」：毫秒；`null` 测过但不通；`undefined` 还没测。 */
  internetDelay: number | null | undefined = undefined;
  /** 今天的流量（后台会话每分钟写一次存储，这里每 10 秒读一次）。 */
  stats: DayStats | null = null;
  /** 本次开启以来的规则命中（同上）。 */
  ruleHits: RuleHits | null = null;
  /** 此刻的路由（规则页那张表）。 */
  routes: RoutePlan | null = null;
  /** 每个程序此刻的速率（进程页）。 */
  processes: ProcessRate[] = [];
  /** 节点搜索框里的字。 */
  filter = "";
  /** 进程页选中的程序；`null` = 右边看全部程序的连接（jarvis-mac `specs/20261029-082059-proxy-window-desktop-layout` D-7）。 */
  processSelection: string | null = null;
  /** 进程页页头搜索框里的字：按程序名或主机筛两张表。 */
  processFilter = "";
  /** 策略页左栏选中的策略组（「节点选择」或导入的 Surge 策略组名）。 */
  policyGroup: string = SELECTOR_TAG;
  /** 上一个动作的结果（页面上那一行）。 */
  message: ActionResult | null = null;
  /** `message` 是什么时候记下的（Unix 毫秒）：窗口页头里成功的那一句只停留 {@link messageDwell}。 */
  messageAt = 0;
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
  /** 状态段那块曲线：这一页开着以来最近 60 秒的有效速率（旧的在前，jarvis-mac `specs/20261028-130540-proxy-walkthrough-fixes` W-3）。页面关掉就丢。 */
  history: { upload: number[]; download: number[] } = { upload: [], download: [] };
  /** 「规则」页里读到的当前页面；没读过为 `null`。 */
  currentPage: PageView | null = null;
  private sample: TrafficSample | null = null;
  /** 上一次看到的订阅地址（换行拼起来）；还没看过为 `null`。 */
  private knownSubscriptions: string | null = null;
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
    await this.core.migrateTunSelection();
    await this.refresh();
    this.knownSubscriptions = null;
    await this.checkSubscriptions();
    this.observe();
    if (!this.unwatch) this.unwatch = jarvis.preferences.onChange((changes) => void this.onPreferencesChanged(changes));
    if (this.surface === "window") {
      await this.loadLogs();
      await this.loadDashboard(true);
    }
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
    this.history = { upload: [], download: [] };
    this.meter.reset();
  }

  /**
   * 偏好变了：重读、重画；「规则集地址」变了就去拉一遍。
   * 「增强模式」被设置页改了时换内核的是后台会话（它常驻、只有它一处换，见 `Background.onPreferencesChanged`），这里只跟着重画。
   * @param changes 变了的几项。
   */
  private async onPreferencesChanged(changes: Record<string, unknown>): Promise<void> {
    if ("ruleSets" in changes && this.snapshot?.granted.includes("network.https")) {
      const result = await this.core.updateRuleSets();
      if (result.message) this.setMessage(result);
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
        this.history = { upload: [], download: [] };
        this.meter.reset();
      }
      if (this.installingSince !== null && (snapshot.phase !== "notInstalled" || Date.now() - this.installingSince > installWaitMs)) {
        this.installingSince = null;
      }
      jarvis.ui.update();
      await pushMenu(snapshot, { autoPick: this.autoPick, rate: null, busy: this.core.busy });
    } catch (error) {
      this.setMessage({ ok: false, message: `读不出状态：${errorMessage(error)}` });
      jarvis.ui.update();
    }
  }

  private observe(): void {
    const granted = this.snapshot?.granted ?? [];
    const listener = (event: DaemonEvent) => {
      if (event.kind === "output") {
        this.logs = [...this.logs, ...event.lines].slice(-maximumLogLines);
        this.meter.ingestLines(event.lines, Date.now());
        if (this.surface === "window" && this.view === "processes") jarvis.ui.update();
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
          const seconds = this.sample ? (now - this.sample.at) / 1000 : 1;
          this.processes = processRates(this.connections, snapshot, seconds);
          this.sample = sample;
          this.connections = snapshot;
          const effective = this.meter.ingestSnapshot(snapshot, now);
          if (effective) {
            this.history = {
              upload: [...this.history.upload, effective.upload].slice(-chartPoints),
              download: [...this.history.download, effective.download].slice(-chartPoints),
            };
          }
          this.reading = this.meter.reading(now);
          jarvis.ui.update();
        }
      }
      // 地址框在屏幕上时每 2 秒看一次订阅地址，其余时候跟着 10 秒那一拍看（读的是钥匙串，不必一直问）。
      if ((tick % 2 === 0 && this.editingSubscriptions()) || tick % 10 === 0) await this.checkSubscriptions();
      if (generation !== this.generation) return;
      const waitingInstall = this.installingSince !== null && tick % 2 === 0;
      if (waitingInstall || tick % 10 === 0) await this.refresh();
      if (this.surface === "window" && tick % 10 === 0) await this.loadDashboard(tick % internetEveryTicks === 0);
    }
  }

  /** 订阅地址框此刻在不在屏幕上（工具箱「订阅」那一段展开着、或窗口在策略页）。 */
  private editingSubscriptions(): boolean {
    if (this.surface === "window") return this.view === "policies";
    return this.manageSubscriptions || this.snapshot?.subscriptionCount === 0;
  }

  /**
   * 订阅地址变了没有（P-2）：地址进钥匙串，宿主不把它放进偏好变更通知，所以每 2 秒现问一次。
   * 多了新地址（工具箱里刚填的、设置页里加的）就当场拉一遍；只是删了就重读状态。
   */
  private async checkSubscriptions(): Promise<void> {
    let urls: string[];
    try {
      urls = await this.core.subscriptionURLs();
    } catch {
      return;
    }
    const key = urls.join("\n");
    const known = this.knownSubscriptions;
    this.knownSubscriptions = key;
    if (known === null || key === known) return;
    const before = new Set(known.split("\n"));
    const added = urls.some((url) => !before.has(url));
    if (added && this.snapshot?.granted.includes("network.https")) await this.update();
    else await this.refresh();
  }

  /**
   * 窗口里「活动」「规则」两页要的那几样（P-3）：今天的统计与规则命中（后台写的存储）、此刻的路由、网络接口、外部 IP、Internet 延迟。
   * 每一样读不出都只是那一格写「—」，不进错误屏。
   * @param probe 这一次连网络接口与延迟也重测（开窗口时、每 30 秒）。
   */
  private async loadDashboard(probe: boolean): Promise<void> {
    const now = Date.now();
    try {
      const [stats, hits] = await Promise.all([jarvis.storage.get(storageKeys.statsToday), jarvis.storage.get<RuleHits>(storageKeys.ruleHits)]);
      this.stats = restoreDay(stats, now);
      this.ruleHits = hits && typeof hits === "object" ? hits : null;
    } catch {
      this.stats = this.stats ?? restoreDay(undefined, now);
    }
    const snapshot = this.snapshot;
    if (snapshot) {
      try {
        this.routes = await this.core.routeTable(snapshot);
      } catch {
        this.routes = null;
      }
    }
    if (probe) {
      try {
        this.network = await networkStatus();
      } catch {
        this.network = null;
      }
      this.internetDelay = snapshot?.phase === "running" ? await this.core.internetLatency(internetTestURL) : undefined;
    }
    await this.loadExternalIP(now);
    jarvis.ui.update();
  }

  /**
   * 外部 IP：五分钟内查过就不再查（P-3）。经宿主的 `net.fetch`——它走系统此刻的路由，代理开着时查到的就是出口。
   * @param now 此刻。
   */
  private async loadExternalIP(now: number): Promise<void> {
    if (this.externalIP && now - this.externalIP.at < externalIPTTL) return;
    if (!this.snapshot?.granted.includes("network.https")) return;
    let ip: string | null = null;
    try {
      const response = await jarvis.net.fetch(externalIPURL, { method: "GET" });
      ip = response.status === 200 ? parseExternalIP(response.text) : null;
    } catch {
      ip = null;
    }
    this.externalIP = { ip, at: now };
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
    this.setMessage(result.message ? result : null);
    await this.refresh();
  }

  private setMessage(result: ActionResult | null): void {
    this.message = result;
    this.messageAt = Date.now();
  }

  /**
   * 窗口页头此刻要不要写上一个动作的结果（jarvis-mac `specs/20261029-082059-proxy-window-desktop-layout` D-2）：
   * 出错的一直留到下一个动作；成功的停 {@link messageDwell} 就换回这一页的状态——不然「代理已开启」会一直挡着实时的状态行。
   * @param now Unix 毫秒。
   * @returns 要写的那一句；不写为 `null`。
   */
  headerMessage(now: number): ActionResult | null {
    if (!this.message) return null;
    return !this.message.ok || now - this.messageAt < messageDwell ? this.message : null;
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
   * @param view 哪一页（认旧页名：工具箱里「去窗口里看订阅 / 日志」那几处）。
   */
  openWindow(view: WindowView | keyof typeof legacyViews): void {
    this.view = legacyViews[view] ?? (view as WindowView);
    void jarvis.window.open().catch(() => undefined);
  }

  /**
   * 换窗口里的页（左边栏）。
   * @param view 哪一页。
   */
  async showView(view: WindowView): Promise<void> {
    this.view = view;
    jarvis.ui.update();
    if (view === "processes") await this.loadLogs();
    if (view === "rules" || view === "activity") await this.loadDashboard(false);
  }

  /** 展开 / 收起工具箱「订阅」那一段的地址列表。 */
  toggleManageSubscriptions(): void {
    this.manageSubscriptions = !this.manageSubscriptions;
    jarvis.ui.update();
  }

  /**
   * 「流量」卡换一份。
   * @param scope 全部 / 仅代理。
   */
  setTrafficScope(scope: TrafficScope): void {
    this.trafficScope = scope;
    jarvis.ui.update();
  }

  /**
   * Top 10 换一类。
   * @param category 进程与设备 / 域名 / 策略。
   */
  setTopCategory(category: UsageCategory): void {
    this.topCategory = category;
    jarvis.ui.update();
  }

  /**
   * 「活动」页的「系统代理」开关（P-3）：开着时就是设 / 还原系统代理；关着时打开它 = 开启代理（开启时按偏好顺手设系统代理）。
   * @param on 开还是关。
   */
  activitySystemProxy(on: boolean): Promise<void> {
    if (this.snapshot?.phase === "running") return this.setSystemProxy(on);
    return on ? this.toggle(true) : Promise.resolve();
  }

  /**
   * 「活动」页的「增强模式」开关：开着时换内核；关着时打开它 = 记下要增强模式并开启代理，关掉只记下。
   * @param on 开还是关。
   */
  activityTun(on: boolean): Promise<void> {
    if (this.snapshot?.phase === "running" || !on) return this.setTun(on);
    return this.run(async () => {
      const result = await this.core.setTun(true);
      if (!result.ok) return result;
      return this.core.turnOn();
    });
  }

  /**
   * 策略页点一张节点卡（P-3）：选它，并只测它一个的延迟。
   * @param name 节点名或「自动选择」。
   */
  pickNode(name: string): Promise<void> {
    return this.run(async () => {
      const result = await this.core.selectNode(name);
      if (!result.ok) return result;
      if (this.snapshot?.phase !== "running") return { ok: true, message: "" };
      const tested = await this.core.testLatency([name]);
      return tested.ok ? { ok: true, message: "" } : tested;
    });
  }

  /**
   * 策略页点导入的策略组里的一张卡：选它，并测它的延迟。
   * @param group 组。
   * @param member 组员 tag。
   */
  pickGroupMember(group: GroupView, member: string): Promise<void> {
    return this.run(async () => {
      const result = await this.core.selectGroupMember(group, member);
      if (!result.ok) return result;
      if (this.snapshot?.phase !== "running") return { ok: true, message: "" };
      const tested = await this.core.testLatency([member]);
      return tested.ok ? { ok: true, message: "" } : tested;
    });
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
    void this.loadDashboard(false);
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

  /**
   * 进程页点一个程序（D-7）：右边只看它的连接；再点一次已选中的那一个 = 回到全部。
   * @param name 程序名（进程表那一行的 id）。
   */
  selectProcess(name: string): void {
    this.processSelection = this.processSelection === name ? null : name;
    jarvis.ui.update();
  }

  /**
   * 进程页页头的搜索框。
   * @param value 字。
   */
  searchProcesses(value: string): void {
    this.processFilter = value;
    jarvis.ui.update();
  }

  /**
   * 策略页左栏换一个策略组（D-7）；节点搜索框随之清空——它搜的是上一组的节点。
   * @param name 组名。
   */
  showPolicyGroup(name: string): void {
    if (this.policyGroup === name) return;
    this.policyGroup = name;
    this.filter = "";
    jarvis.ui.update();
  }
}
