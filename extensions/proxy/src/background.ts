/**
 * 后台会话：菜单栏那枚图标、`/proxy` 指令、内核意外退出的横幅、订阅与规则集自动更新、悬浮球上的流量（SDK 2.10 `orb.update`）。
 *
 * 入驻了菜单栏域、图标在显示时，后台会话常驻（P-7）：`daemon.observe` / `tunnel.observe` 订在这里才接得住内核的退出与日志——
 * 页面里订的随页面关掉就没了。成败统计（`traffic.ts`）也在这里：它要每一行日志，悬浮球要每一秒的读数，只有常驻的这一边做得到。
 * 菜单栏的模型由这里推；页面改了状态也会推一份（同一个构造函数），两边推的是同一种东西。
 */
import { jarvis, sleep, type CommandContext, type DaemonEvent, type MenuBarContext, type Unsubscribe } from "@fusionseek/jarvis-extension-sdk";
import { trafficRate, type TrafficRate, type TrafficSample } from "./clash.js";
import { errorMessage, ProxyCore, tunnelCapability, type ActionResult, type Snapshot } from "./core.js";
import { URLTEST_TAG } from "./nodes.js";
import { registrableDomain, type SeenConnection } from "./rules.js";
import {
  buildMenuModel,
  describeFailure,
  lastMeaningfulLine,
  menuPolicyRef,
  parseMenuItemId,
  parseToggleArgument,
  requiredCapability,
  type FailureRecord,
  type PageView,
} from "./status.js";
import { isTunSwitchEcho, isUpdateDue, storageKeys, type Schedule } from "./store.js";
import { shortRate, titleAverage, TrafficMeter, type Attempt, type TrafficReading } from "./traffic.js";

/** 自动更新多久看一次日程。宿主的定时器单次至多 30 秒，看日程本身只读一个键，一分钟一次足够。 */
const scheduleTickMs = 30_000;

/** 流量每秒读一次：悬浮球、菜单栏的两行速率与曲线都用这一份。 */
const speedTickMs = 1000;

/** 输出触发的菜单重推至多每 2 秒一次：内核每秒能打几十行日志，菜单不必跟着每行重推。 */
const outputRefreshMs = 2000;

/** 菜单顶部那块曲线留多少个点（一秒一个）。 */
const historyLength = 60;

/** 菜单里的额外读数。 */
export interface MenuExtras {
  autoPick: string | null;
  rate: TrafficRate | null;
  busy: string | null;
  reading?: TrafficReading | null;
  history?: { upload: number[]; download: number[] } | null;
  /** 菜单栏两行写的那一份：最近 `speedInterval` 秒的平均有效速率（W-2）。 */
  titleRate?: { upload: number; download: number } | null;
  page?: PageView | null;
  recent?: Attempt[];
}

/**
 * 推一份菜单栏模型。被拒（没入驻、用户关了「在菜单栏显示」）只记日志。
 * @param snapshot 快照。
 * @param extra 自动选择此刻选中谁、速率、正在做的事、成败、曲线、当前页面、最近请求。
 */
export async function pushMenu(snapshot: Snapshot, extra: MenuExtras): Promise<void> {
  try {
    await jarvis.menuBar.update(
      buildMenuModel({
        phase: snapshot.phase,
        preferences: snapshot.preferences,
        selection: snapshot.selection,
        nodes: snapshot.nodes,
        latency: snapshot.latency.values,
        proxy: snapshot.proxy,
        granted: snapshot.granted,
        autoPick: extra.autoPick,
        rate: extra.rate,
        failure: snapshot.failure,
        busy: extra.busy,
        kernel: snapshot.kernel,
        tun: snapshot.tun,
        groups: snapshot.groups,
        page: extra.page ?? null,
        pageRules: snapshot.pageRules,
        recent: extra.recent ?? [],
        reading: extra.reading ?? null,
        history: extra.history ?? null,
        titleRate: extra.titleRate ?? null,
      }),
    );
  } catch (error) {
    jarvis.log.debug("菜单栏模型没推上", errorMessage(error));
  }
}

/**
 * 最近的连接（给「当前页面」）：日志里的尝试（有进程、有成败，短连接也在）加上快照里的出站链。
 * @param attempts 尝试。
 * @returns 连接记录。
 */
export function seenConnections(attempts: readonly Attempt[]): SeenConnection[] {
  return attempts.map((attempt) => ({ host: attempt.host, process: attempt.process, at: attempt.startedAt, chains: attempt.chains, failed: attempt.outcome === "failed" }));
}

/**
 * 悬浮球上的那一句补充（≤ 40 字）：此刻走的是哪个组、哪个节点。
 * @param snapshot 快照。
 * @param autoPick 「自动选择」此刻选中的节点。
 * @returns 一句话。
 */
export function orbCaption(snapshot: Snapshot, autoPick: string | null): string {
  const node = snapshot.selection.node === URLTEST_TAG && autoPick ? `${URLTEST_TAG} · ${autoPick}` : snapshot.selection.node;
  const text = snapshot.kernel === "tunnel" ? `增强模式 · ${node}` : node;
  return text.length <= 40 ? text : text.slice(0, 40);
}

/** 读数的一行写法（菜单曲线下面、页面状态段）：`↓ 1.2MB/s  ↑ 34KB/s · 10 秒内成功 42、失败 3`。 */
export function readingLine(reading: TrafficReading): string {
  return `↓ ${shortRate(reading.download)}B/s  ↑ ${shortRate(reading.upload)}B/s · 10 秒内成功 ${reading.succeeded}、失败 ${reading.failed}`;
}

export class Background {
  private readonly core = new ProxyCore(() => void this.refresh());
  private readonly meter = new TrafficMeter();
  private context: MenuBarContext | null = null;
  private unobserveDaemon: Unsubscribe | null = null;
  private unobserveTunnel: Unsubscribe | null = null;
  private scheduleRunning = false;
  private speedRunning = false;
  private autoStarted = false;
  private lastSnapshot: Snapshot | null = null;
  private autoPick: string | null = null;
  private rate: TrafficRate | null = null;
  private reading: TrafficReading | null = null;
  private history: { upload: number[]; download: number[] } = { upload: [], download: [] };
  private page: PageView | null = null;
  private lastSample: TrafficSample | null = null;
  private lastOutputRefresh = 0;
  private orbShown = false;
  private refreshing: Promise<void> | null = null;
  private refreshAgain = false;
  /** 菜单栏两行此刻写的那一份（W-2）；还没攒满第一段为 `null`。 */
  private titleRate: { upload: number; download: number } | null = null;
  /** 这一段里攒下的有效速率：凑满 `speedInterval` 个点取平均，换一次标题。 */
  private titleWindow: { upload: number; download: number; count: number } = { upload: 0, download: 0, count: 0 };
  private unwatchPreferences: Unsubscribe | null = null;

  private extras(): MenuExtras {
    return {
      autoPick: this.autoPick,
      rate: this.rate,
      busy: this.core.busy,
      reading: this.reading,
      history: this.history,
      titleRate: this.titleRate,
      page: this.page,
      recent: this.meter.recent(Date.now(), 12),
    };
  }

  /**
   * 菜单栏 `start`：推第一份模型、订内核事件、按偏好自动开启、起自动更新与流量两条循环。
   * @param context 授权与偏好。
   */
  async start(context: MenuBarContext): Promise<void> {
    this.context = context;
    this.observe(context.granted);
    if (!this.unwatchPreferences) this.unwatchPreferences = jarvis.preferences.onChange((changes) => void this.onPreferencesChanged(changes));
    await this.core.migrateTunSelection();
    await this.refresh();
    const snapshot = this.lastSnapshot;
    if (snapshot && snapshot.preferences.autoStart && !this.autoStarted && (snapshot.phase === "stopped" || snapshot.phase === "failed")) {
      this.autoStarted = true;
      await this.core.turnOn({ granted: context.granted, preferences: context.preferences });
      await this.refresh();
    }
    void this.scheduleLoop();
    void this.speedLoop();
  }

  /**
   * 菜单栏 `open`：重读状态与「当前页面」；开着、延迟又是 5 分钟以前测的，顺手在后台测一遍（菜单开着时宿主就地更新读数）。
   * @param context 授权与偏好。
   */
  async open(context: MenuBarContext): Promise<void> {
    this.context = context;
    this.observe(context.granted);
    this.page = await this.core.currentPage(context.granted, seenConnections(this.meter.recent(Date.now(), 2000)));
    await this.refresh();
    const snapshot = this.lastSnapshot;
    const stale = !snapshot?.latency.testedAt || Date.now() - snapshot.latency.testedAt > 5 * 60 * 1000;
    if (snapshot?.phase === "running" && stale && snapshot.nodes.length > 0) void this.core.testLatency().then(() => this.refresh());
    void this.speedLoop();
  }

  /**
   * 菜单栏 `select`。
   * @param context 授权与偏好。
   * @param itemId 点的是哪一项。
   */
  async select(context: MenuBarContext, itemId: string): Promise<void> {
    this.context = context;
    this.observe(context.granted);
    const action = parseMenuItemId(itemId);
    if (!action) return;
    // 现读一份：上一份可能是页面开 / 关、换系统代理之前读的；节点序号也要对上用户此刻看到的那份菜单。
    const snapshot = await this.core.snapshot(context);
    switch (action.kind) {
      case "toggle":
        if (snapshot.phase === "running") await this.core.turnOff();
        else await this.report(await this.core.turnOn(context), false);
        break;
      case "systemProxy": {
        const active = snapshot.proxy?.owner === "self";
        await this.report(await this.core.setSystemProxy(!active), false);
        break;
      }
      case "tun": {
        const on = snapshot.phase === "running" ? snapshot.kernel !== "tunnel" : !snapshot.tun.wanted;
        await this.report(await this.core.setTun(on), snapshot.phase !== "running");
        break;
      }
      case "mode":
        await this.core.setMode(action.mode);
        break;
      case "node": {
        const name = action.index < 0 ? URLTEST_TAG : snapshot.nodes[action.index]?.name;
        if (name) await this.core.selectNode(name);
        break;
      }
      case "group": {
        const group = snapshot.groups[action.group];
        const member = group?.members[action.member];
        if (group && member) await this.report(await this.core.selectGroupMember(group, member.tag), false);
        break;
      }
      case "page": {
        const domain = this.page?.domains[action.domain]?.domain;
        if (domain) await this.report(await this.core.setPageRule(domain, menuPolicyRef(action.policy, snapshot.groups)), true);
        break;
      }
      case "recent": {
        const attempt = this.meter.recent(Date.now(), 12)[action.request];
        if (attempt) await this.report(await this.core.setPageRule(registrableDomain(attempt.host), menuPolicyRef(action.policy, snapshot.groups)), true);
        break;
      }
      case "test":
        await this.core.testLatency();
        break;
      case "update":
        await this.report(await this.core.updateAll(context.granted), true);
        break;
      case "reload":
        await this.report(await this.core.reload(), true);
        break;
      case "import":
        // 挑文件要用户在场（前台会话）：经命令开窗口，窗口那一边接着弹打开面板。
        await this.runCommand("import-surge");
        break;
      case "rules":
        await this.runCommand("rules");
        break;
      case "copy":
        try {
          await jarvis.clipboard.write(this.core.terminalCommand(snapshot.preferences, snapshot.control));
        } catch (error) {
          jarvis.log.warn("终端代理命令没复制上", errorMessage(error));
        }
        break;
      case "install":
        await this.core.install();
        break;
    }
    await this.refresh();
    void this.speedLoop();
  }

  private async runCommand(id: string): Promise<void> {
    try {
      await jarvis.commands.run(id);
    } catch (error) {
      jarvis.log.warn(`命令 ${id} 没跑起来`, errorMessage(error));
    }
  }

  /**
   * `/proxy`：不带参数切换，`开` / `关` 指定，`tun` / `系统代理` 换模式。静默命令只能用横幅交结果。
   * @param context 指令上下文。
   */
  async command(context: CommandContext): Promise<void> {
    this.observe(context.granted);
    const intent = parseToggleArgument(context.argument);
    let result: ActionResult;
    if (intent === null) {
      result = { ok: false, message: `认不出「${context.argument ?? ""}」：用 /proxy 切换，/proxy 开、/proxy 关、/proxy tun、/proxy 系统代理` };
    } else if (intent === "tun" || intent === "notun") {
      result = await this.core.setTun(intent === "tun");
      if (result.ok && !result.message) result = { ok: true, message: intent === "tun" ? "已换成增强模式" : "已换成系统代理模式" };
    } else {
      const running = await this.core.isRunning();
      const on = intent === "toggle" ? !running : intent === "on";
      if (on === running) result = { ok: true, message: running ? "代理已经开着" : "代理已经关着" };
      else result = on ? await this.core.turnOn({ granted: context.granted, preferences: context.preferences }) : await this.core.turnOff();
    }
    await this.notify(result.ok ? "代理" : "代理没能完成", result.message, context.granted);
    await this.refresh();
    void this.speedLoop();
  }

  /**
   * 偏好变了（设置页、或某个会话经 `preferences.set` 写的）：菜单与读数按新偏好重推。
   * 「增强模式」被设置页改了、代理开着、内核与它不符 → 在这里换内核（W-6：设置页与工具箱同一份真源，改哪边都当场生效）。
   * 自己人写的那一次（`tunSwitch` 30 秒内、值相同）由写的那一方换，这里不再换一次。后台会话常驻，换内核只在这一处。
   * @param changes 变了的几项。
   */
  private async onPreferencesChanged(changes: Record<string, unknown>): Promise<void> {
    if (this.context) this.context = { ...this.context, preferences: { ...this.context.preferences, ...changes } };
    if ("speedInterval" in changes) this.titleWindow = { upload: 0, download: 0, count: 0 };
    if (typeof changes.tun === "boolean") {
      let echo = false;
      try {
        echo = isTunSwitchEcho(await jarvis.storage.get(storageKeys.tunSwitch), changes.tun, Date.now());
      } catch {
        echo = false;
      }
      if (!echo) await this.report(await this.core.applyTun(changes.tun), false);
    }
    await this.refresh();
    void this.speedLoop();
  }

  /** 菜单里的动作只在失败（或订阅更新这种要交代结果的）时发横幅：成功的开关菜单图标自己就说明了。 */
  private async report(result: ActionResult, always: boolean): Promise<void> {
    if (!result.ok || (always && result.message)) await this.notify(result.ok ? "代理" : "代理没能完成", result.message);
  }

  private async notify(title: string, body: string, granted?: string[]): Promise<void> {
    const list = granted ?? this.context?.granted ?? (await this.core.granted());
    if (!list.includes("notifications.post") || body.length === 0) return;
    try {
      await jarvis.notifications.post({ title, body: body.slice(0, 200) });
    } catch (error) {
      jarvis.log.warn("横幅没发出去", errorMessage(error));
    }
  }

  /**
   * 订两个内核的输出与退出。各只订一次；没授权时宿主会拒（SDK 只记一条 warn），所以授权了才订。
   * @param granted 已授予的能力。
   */
  private observe(granted: string[]): void {
    if (!this.unobserveDaemon && granted.includes(requiredCapability)) {
      this.unobserveDaemon = jarvis.daemon.observe("sing-box", (event) => void this.onKernelEvent(event));
    }
    if (!this.unobserveTunnel && granted.includes(tunnelCapability)) {
      this.unobserveTunnel = jarvis.tunnel.observe((event) => void this.onKernelEvent(event));
    }
  }

  private async onKernelEvent(event: DaemonEvent): Promise<void> {
    if (event.kind === "output") {
      this.meter.ingestLines(event.lines, Date.now());
      // 页面或别的会话开 / 关了内核时，这里只看得到输出：节流地重读一次状态，让图标跟上。
      if (Date.now() - this.lastOutputRefresh >= outputRefreshMs) {
        this.lastOutputRefresh = Date.now();
        if (this.lastSnapshot?.phase !== "running") await this.refresh();
        void this.speedLoop();
      }
      return;
    }
    if (!event.expected) {
      const control = await this.core.control();
      // 还在开启中的退出由正在开启的那一方自己处理（不分流重试、或写失败记录），这里不另发横幅。
      if (!control?.starting) {
        const preferences = await this.core.preferences(this.context?.preferences);
        const { message, hint } = describeFailure(event.lines, preferences);
        const failure: FailureRecord = { at: Date.now(), message, lines: event.lines.slice(-20), hint };
        try {
          await jarvis.storage.set(storageKeys.failure, failure);
        } catch {
          // 存不进去也照样发横幅。
        }
        const last = lastMeaningfulLine(event.lines);
        await this.notify("代理已停止：sing-box 意外退出", `${last || message}。系统代理已还原。`);
      }
    }
    this.resetTraffic();
    await this.refresh();
  }

  private resetTraffic(): void {
    this.meter.reset();
    this.rate = null;
    this.reading = null;
    this.lastSample = null;
    this.history = { upload: [], download: [] };
    this.titleRate = null;
    this.titleWindow = { upload: 0, download: 0, count: 0 };
  }

  /** 重读状态、重推菜单。同一时刻只有一次在跑，期间再要求的合并成跑完后的一次。 */
  async refresh(): Promise<void> {
    if (this.refreshing) {
      this.refreshAgain = true;
      return this.refreshing;
    }
    this.refreshing = (async () => {
      try {
        do {
          this.refreshAgain = false;
          try {
            const snapshot = await this.core.snapshot(this.context ? { granted: this.context.granted, preferences: this.context.preferences } : {});
            this.lastSnapshot = snapshot;
            this.autoPick = snapshot.phase === "running" && snapshot.selection.node === URLTEST_TAG ? await this.core.autoPick() : null;
            if (snapshot.phase !== "running") {
              this.resetTraffic();
              await this.pushOrb(null);
            }
            await pushMenu(snapshot, this.extras());
          } catch (error) {
            jarvis.log.warn("菜单栏状态没刷新上", errorMessage(error));
          }
        } while (this.refreshAgain);
      } finally {
        // 在这里清，而不是在调用方的 finally 里：循环跑完到调用方恢复之间还隔着几拍，那几拍里来的请求会搭上一个已经跑完的 Promise、被丢掉。
        this.refreshing = null;
      }
    })();
    return this.refreshing;
  }

  /**
   * 推悬浮球那一层。撤掉（`null`）只推一次：没在显示时不必每次刷新都撤一遍。
   * @param reading 读数；`null` 撤掉。
   */
  private async pushOrb(reading: TrafficReading | null): Promise<void> {
    if (reading === null && !this.orbShown) return;
    try {
      if (reading === null) await jarvis.orb.update(null);
      else {
        await jarvis.orb.update({
          kind: "traffic",
          upload: Math.round(reading.upload),
          download: Math.round(reading.download),
          succeeded: reading.succeeded,
          failed: reading.failed,
          ...(this.lastSnapshot ? { caption: orbCaption(this.lastSnapshot, this.autoPick) } : {}),
        });
      }
      this.orbShown = reading !== null;
    } catch (error) {
      // 旧宿主没有这一层、或用户关了「在悬浮球上显示」：只记一条 debug。
      jarvis.log.debug("悬浮球那一层没推上", errorMessage(error));
      this.orbShown = false;
    }
  }

  /** 订阅与外部规则集自动更新：每 30 秒看一次日程，到点就拉；节点或规则真的变了且开着，会自己重新载入。 */
  private async scheduleLoop(): Promise<void> {
    if (this.scheduleRunning) return;
    this.scheduleRunning = true;
    try {
      for (;;) {
        await sleep(scheduleTickMs);
        try {
          const preferences = await this.core.preferences();
          const schedule = (await jarvis.storage.get<Schedule>(storageKeys.schedule)) ?? { lastAttemptAt: null, lastSuccessAt: null };
          if (!isUpdateDue(schedule, preferences.updateInterval, Date.now())) continue;
          const granted = await this.core.granted();
          if (!granted.includes("network.https") || (await this.core.subscriptionURLs()).length === 0) continue;
          await this.core.updateAll(granted);
          await this.refresh();
        } catch (error) {
          jarvis.log.warn("订阅自动更新出错", errorMessage(error));
        }
      }
    } finally {
      this.scheduleRunning = false;
    }
  }

  /**
   * 攒一个点进这一段；凑满 `speedInterval` 个就取平均、换标题（W-2）。间隔 1 秒时每个点都换，与上一版相同。
   * @param effective 这一秒的有效速率。
   */
  private accumulateTitle(effective: { upload: number; download: number }): void {
    const interval = this.lastSnapshot?.preferences.speedInterval ?? 1;
    this.titleWindow = {
      upload: this.titleWindow.upload + effective.upload,
      download: this.titleWindow.download + effective.download,
      count: this.titleWindow.count + 1,
    };
    const next = titleAverage(this.titleWindow, interval);
    if (next) {
      this.titleRate = next;
      this.titleWindow = { upload: 0, download: 0, count: 0 };
    } else if (!this.titleRate) {
      // 第一段还没攒满：先写第一个点，之后照间隔换。空着的话图标旁那两行要等满一段才出现——状态项宽度又跳一次。
      this.titleRate = { upload: effective.upload, download: effective.download };
    }
  }

  /**
   * 流量：开着时每秒读一次连接快照——喂给成败统计（拿到回包的判成功）、算有效速率，推悬浮球与菜单（两行速率、曲线）。
   * 条件不成立（关了）就退出循环并撤掉悬浮球那一层。
   */
  private async speedLoop(): Promise<void> {
    if (this.speedRunning) return;
    const wanted = () => this.lastSnapshot?.phase === "running";
    if (!wanted()) return;
    this.speedRunning = true;
    try {
      while (wanted()) {
        await sleep(speedTickMs);
        const snapshot = await this.core.connections();
        if (!snapshot) continue;
        const now = Date.now();
        const sample: TrafficSample = { at: now, upload: snapshot.uploadTotal, download: snapshot.downloadTotal };
        this.rate = trafficRate(this.lastSample, sample) ?? this.rate;
        this.lastSample = sample;
        const effective = this.meter.ingestSnapshot(snapshot, now);
        if (effective) {
          this.history.upload = [...this.history.upload, effective.upload].slice(-historyLength);
          this.history.download = [...this.history.download, effective.download].slice(-historyLength);
          this.accumulateTitle(effective);
        }
        this.reading = this.meter.reading(now);
        await this.pushOrb(this.reading);
        if (this.lastSnapshot) await pushMenu(this.lastSnapshot, this.extras());
      }
    } finally {
      this.speedRunning = false;
      this.resetTraffic();
      await this.pushOrb(null);
    }
  }
}
