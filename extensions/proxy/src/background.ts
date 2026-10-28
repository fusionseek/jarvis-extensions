/**
 * 后台会话：菜单栏那枚图标、`/proxy` 指令、内核意外退出的横幅、订阅自动更新、菜单栏速率。
 *
 * 入驻了菜单栏域、图标在显示时，后台会话常驻（P-7）：`daemon.observe` 订在这里才接得住内核的退出——
 * 页面里订的随页面关掉就没了。菜单栏的模型由这里推；页面改了状态也会推一份（同一个构造函数），两边推的是同一种东西。
 */
import { jarvis, sleep, type CommandContext, type DaemonEvent, type MenuBarContext, type Unsubscribe } from "@fusionseek/jarvis-extension-sdk";
import { trafficRate, type TrafficRate, type TrafficSample } from "./clash.js";
import { errorMessage, ProxyCore, type ActionResult, type Snapshot } from "./core.js";
import { URLTEST_TAG } from "./nodes.js";
import {
  buildMenuModel,
  describeFailure,
  lastMeaningfulLine,
  parseMenuItemId,
  parseToggleArgument,
  requiredCapability,
  type FailureRecord,
} from "./status.js";
import { isUpdateDue, storageKeys, type Schedule } from "./store.js";

/** 自动更新多久看一次日程。宿主的定时器单次至多 30 秒，看日程本身只读一个键，一分钟一次足够。 */
const scheduleTickMs = 30_000;

/** 菜单栏速率每秒刷一次；读数的平滑交给「两次快照之差」，不另做。 */
const speedTickMs = 1000;

/** 输出触发的菜单重推至多每 2 秒一次：内核每秒能打几十行日志，菜单不必跟着每行重推。 */
const outputRefreshMs = 2000;

/**
 * 推一份菜单栏模型。被拒（没入驻、用户关了「在菜单栏显示」）只记日志。
 * @param snapshot 快照。
 * @param extra 自动选择此刻选中谁、速率、正在做的事。
 */
export async function pushMenu(snapshot: Snapshot, extra: { autoPick: string | null; rate: TrafficRate | null; busy: string | null }): Promise<void> {
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
      }),
    );
  } catch (error) {
    jarvis.log.debug("菜单栏模型没推上", errorMessage(error));
  }
}

export class Background {
  private readonly core = new ProxyCore(() => void this.refresh());
  private context: MenuBarContext | null = null;
  private unobserve: Unsubscribe | null = null;
  private scheduleRunning = false;
  private speedRunning = false;
  private autoStarted = false;
  private lastSnapshot: Snapshot | null = null;
  private autoPick: string | null = null;
  private rate: TrafficRate | null = null;
  private lastSample: TrafficSample | null = null;
  private lastOutputRefresh = 0;
  private refreshing: Promise<void> | null = null;
  private refreshAgain = false;

  /**
   * 菜单栏 `start`：推第一份模型、订内核事件、按偏好自动开启、起自动更新与速率两条循环。
   * @param context 授权与偏好。
   */
  async start(context: MenuBarContext): Promise<void> {
    this.context = context;
    this.observe(context.granted);
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
   * 菜单栏 `open`：重读状态；开着、延迟又是 5 分钟以前测的，顺手在后台测一遍（菜单开着时宿主就地更新读数）。
   * @param context 授权与偏好。
   */
  async open(context: MenuBarContext): Promise<void> {
    this.context = context;
    this.observe(context.granted);
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
        if (snapshot.daemon?.state === "running") await this.core.turnOff();
        else await this.report(await this.core.turnOn(context), false);
        break;
      case "systemProxy": {
        const active = snapshot.proxy?.owner === "self";
        await this.report(await this.core.setSystemProxy(!active), false);
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
      case "test":
        await this.core.testLatency();
        break;
      case "update":
        await this.report(await this.core.updateSubscriptions({ granted: context.granted }), true);
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

  /**
   * `/proxy`：不带参数切换，`开` / `关` 指定。静默命令只能用横幅交结果。
   * @param context 指令上下文。
   */
  async command(context: CommandContext): Promise<void> {
    this.observe(context.granted);
    const intent = parseToggleArgument(context.argument);
    let result: ActionResult;
    if (intent === null) {
      result = { ok: false, message: `认不出「${context.argument ?? ""}」：用 /proxy 切换，/proxy 开 或 /proxy 关` };
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

  /** 菜单里的动作只在失败（或订阅更新这种要交代结果的）时发横幅：成功的开关菜单图标自己就说明了。 */
  private async report(result: ActionResult, always: boolean): Promise<void> {
    if (!result.ok || always) await this.notify(result.ok ? "代理" : "代理没能完成", result.message);
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
   * 订内核的输出与退出。只订一次；没授权时宿主会拒（SDK 只记一条 warn），所以授权了才订。
   * @param granted 已授予的能力。
   */
  private observe(granted: string[]): void {
    if (this.unobserve || !granted.includes(requiredCapability)) return;
    this.unobserve = jarvis.daemon.observe("sing-box", (event) => void this.onDaemonEvent(event));
  }

  private async onDaemonEvent(event: DaemonEvent): Promise<void> {
    if (event.kind === "output") {
      // 页面或别的会话开 / 关了内核时，这里只看得到输出：节流地重读一次状态，让图标跟上。
      if (Date.now() - this.lastOutputRefresh >= outputRefreshMs) {
        this.lastOutputRefresh = Date.now();
        await this.refresh();
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
    this.rate = null;
    this.lastSample = null;
    await this.refresh();
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
            if (snapshot.phase !== "running") this.rate = null;
            await pushMenu(snapshot, { autoPick: this.autoPick, rate: this.rate, busy: this.core.busy });
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

  /** 订阅自动更新：每 30 秒看一次日程，到点就拉；节点真的变了且开着，`updateSubscriptions` 自己会重开。 */
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
          await this.core.updateSubscriptions({ granted });
          await this.refresh();
        } catch (error) {
          jarvis.log.warn("订阅自动更新出错", errorMessage(error));
        }
      }
    } finally {
      this.scheduleRunning = false;
    }
  }

  /** 菜单栏速率：开着且偏好要显示时每秒读一次连接快照，两次之差就是速率；条件不成立就退出循环。 */
  private async speedLoop(): Promise<void> {
    if (this.speedRunning) return;
    const wanted = () => this.lastSnapshot?.phase === "running" && this.lastSnapshot.preferences.showSpeed;
    if (!wanted()) return;
    this.speedRunning = true;
    try {
      while (wanted()) {
        await sleep(speedTickMs);
        const snapshot = await this.core.connections();
        if (!snapshot) continue;
        const sample: TrafficSample = { at: Date.now(), upload: snapshot.uploadTotal, download: snapshot.downloadTotal };
        this.rate = trafficRate(this.lastSample, sample) ?? this.rate;
        this.lastSample = sample;
        if (this.lastSnapshot) await pushMenu(this.lastSnapshot, { autoPick: this.autoPick, rate: this.rate, busy: this.core.busy });
      }
    } finally {
      this.speedRunning = false;
      this.rate = null;
      this.lastSample = null;
    }
  }
}
