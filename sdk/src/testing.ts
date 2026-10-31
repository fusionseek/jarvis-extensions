/**
 * 宿主替身：让扩展在 node 里跑单测（SDK 2）。
 *
 * 装上一个假的 `__jarvisHost`，把能力调用路由到你给的桩，把每一次 UI 提交攒下来，
 * 并提供 `dispatch()` 让测试自己触发 `activate` / `command` / `ui` 事件、`callService()` 调服务扩展点。
 *
 * **它不是宿主，只是线缆另一端的一个玩偶**：不画界面、不校验节点、不管授权、不查 manifest 声明。
 * 它证明的是"扩展的逻辑在没有 Jarvis 的机器上也能被断言"，仅此而已。
 *
 * 用法（先装替身，再 import 扩展或 SDK）：
 *
 * ```ts
 * import { createTestHost } from "@fusionseek/jarvis-extension-sdk/testing";
 * const host = createTestHost({ async: { "clipboard.read": async () => "hello" } });
 * const { defineExtension, jarvis } = await import("@fusionseek/jarvis-extension-sdk");
 * ```
 *
 * Android 操作域（SDK 2.4）另有一台假手机 `fakeAndroid()`：它按宿主的规则答 `android.*`（1…8 个包、设备要 ready），
 * 记下每一次调用与同时在途的 `appDetails` 个数，并能挂住、能让下一次失败——「一次一批」「换设备丢掉旧结果」靠它断言。
 *
 * 菜单栏域（SDK 2.9）由替身自己接住：`menuBar.update` 不用给桩，收下的模型攒在 `menuBarModels`；`menuBarEvent()` 发 `start` / `open` / `select`。
 * 常驻进程与系统代理另有 `fakeDaemons()`：按宿主的规则答 `daemon.*` 与 `systemProxy.*`，`output()` / `crash()` 往订阅者推事件，
 * 进程没了就照宿主兜底把系统代理还原——「内核死了、横幅一条、系统代理已还原」靠它断言。
 *
 * SDK 2.10：`orb.update` 同样由替身接住，收下的读数（含撤掉的 `null`）攒在 `orbModels`；`fakeDaemons()` 多答 `daemon.reload` 与 `tunnel.*`——
 * 网络助手装没装、用户取消管理员授权、别的 VPN 占着主网卡、配置没过守卫（守卫照宿主那张表演了最常见的几条），都能演。
 */
import type {
  CommitRequest,
  DaemonEvent,
  DaemonRequest,
  DaemonResponse,
  DaemonStatus,
  HostEvent,
  InvokeRequest,
  InvokeResult,
  MenuBarActionItem,
  MenuBarItem,
  MenuBarModel,
  MenuBarModifier,
  OrbMeterModel,
  SerializedNode,
  ServiceCall,
  SystemProxyBlocker,
  SystemProxyStatus,
  TunnelBlocker,
  TunnelHelperState,
  TunnelRequest,
  TunnelStartRequest,
  TunnelStatus,
} from "./bridge.js";
import type { AndroidApp, AndroidAppDetail, AndroidAppScope, AndroidDevice, AndroidTool, JarvisErrorShape } from "./capabilities.js";
import { maximumAndroidAppDetailsPerCall } from "./capabilities.js";
import type { ServicePoint } from "./manifest.js";
import type { CodeFormatRequest, CodeHighlightRequest, FileActionsRequest, ProjectEngineRequest } from "./services.js";

/** 异步桩。第二个参数可以往订阅 token 上推事件（`process.run` 推输出行就靠它）。 */
export type AsyncStub = (params: unknown, host: TestHost) => Promise<unknown> | unknown;
/** 同步桩。 */
export type SyncStub = (params: unknown) => unknown;

/** 替身的配置。 */
export interface TestHostOptions {
  /** `namespace.method` → 异步桩。返回值就是 Promise 的结果；抛 `JarvisErrorShape` 形状的对象等于宿主拒绝。 */
  async?: Record<string, AsyncStub>;
  /** `namespace.method` → 同步桩（`text.*` / `host.*`）。 */
  sync?: Record<string, SyncStub>;
  hostInfo?: { version: string; channel: "release" | "development" };
  environment?: { reduceMotion: boolean; reduceTransparency: boolean; increaseContrast: boolean; locale: string };
}

/** 一次服务调用的结果。 */
export interface ServiceOutcome {
  result: InvokeResult;
  /** 这次调用里扩展报过的全部进度，按先后。 */
  progress: unknown[];
}

/** 替身。 */
export interface TestHost {
  /** 每一次提交的树，最新的在最后。 */
  commits: SerializedNode[];
  /** 与 `commits` 一一对应：那棵树画在哪一面（`toolbox` / `popover` / `window`）。 */
  surfaces: string[];
  /** 最新一次提交画在哪一面；还没提交过为 `undefined`。 */
  readonly latestSurface: string | undefined;
  /** 每一次能力调用（不含 `service.resolve` / `service.progress`）。 */
  invocations: InvokeRequest[];
  logs: { level: string; message: string; data: unknown }[];
  /** 最新一棵树；还没提交过为 `undefined`。 */
  readonly latest: SerializedNode | undefined;
  /**
   * SDK 2.9：每一份被收下的 `jarvis.menuBar.update` 模型，按先后。替身默认收下一切（宿主的 250 ms 合并与上限它不演）；
   * 要演「没入驻菜单栏域」就给 `menuBar.update` 一个抛 `surface.unavailable` 的桩，被拒的模型不进这里。
   */
  menuBarModels: MenuBarModel[];
  /** 最新一份菜单栏模型：宿主只缓存、只画这一份。还没推过为 `undefined`。 */
  readonly latestMenuBar: MenuBarModel | undefined;
  /** 在最新一份菜单栏模型里按 id 找一项可点的条目（含子菜单里的）；没有为 `undefined`。 */
  menuItem(id: string): MenuBarActionItem | undefined;
  /** SDK 2.10：每一份被收下的 `jarvis.orb.update` 读数（撤掉是 `null`），按先后。宿主的 250 ms 合并与 5 秒过期替身不演。 */
  orbModels: OrbMeterModel[];
  /** 最新一份悬浮球读数；还没推过为 `undefined`，撤掉了为 `null`。 */
  readonly latestOrb: OrbMeterModel | undefined;
  /**
   * SDK 2.9：发一次 `menuBar` 事件并等落定。`select` 要带 `itemId`，且这一项必须在最新一份模型里、用户点得到
   * （它与它所在的子菜单都没有 `enabled: false`）——否则抛错：用户点不到的东西，测试也不该点到。
   */
  menuBarEvent(
    event: "start" | "open" | "select" | "press",
    options?: { itemId?: string; statusItem?: string; modifiers?: MenuBarModifier[]; granted?: string[]; preferences?: Record<string, unknown> },
  ): Promise<void>;
  /**
   * SDK 2.11：某一枚状态项此刻生效的那份模型（`menuBar.update` 按 `statusItem` 分开记，省略 = 第一枚 `main`）。
   * 还没推过为 `undefined`。
   */
  statusItem(id: string): MenuBarModel | undefined;
  /**
   * 某个命名空间最近一次订阅的 token（`menuBarPointer` / `menuBarExtras` / `screens` …）；没订过为 `undefined`。
   * `method` 省略为 `observe`；不叫 `observe` 的订阅（SDK 2.13 `browser.watchActiveTab`）要写出来。
   */
  subscriptionToken(namespace: string, method?: string): string | undefined;
  /** 给 SDK 发一个宿主事件。 */
  dispatch(event: HostEvent): void;
  /** 往一个订阅 token 上推一次事件。 */
  emit(token: string, payload: unknown): void;
  /**
   * 调一次服务扩展点的方法，等扩展交回结果。`point` 省略时是 `junkClean.engine`；
   * `project.engine` 的方法入参放在 `request`（线缆上的 `params.request`）。
   */
  callService(request: {
    point?: ServicePoint;
    service: string;
    method: ServiceCall["method"];
    preferences?: Record<string, unknown>;
    granted?: string[];
    actionId?: string;
    request?: ProjectEngineRequest | CodeFormatRequest | CodeHighlightRequest | FileActionsRequest;
  }): Promise<ServiceOutcome>;
  /** 取消一次进行中的服务调用（发 `serviceCancel`）。`callService` 之前先拿 `nextCallId`。 */
  cancelService(callId: number): void;
  /** 下一次 `callService` 会用的 callId。 */
  readonly nextCallId: number;
  /** 等待所有在途的能力调用与合并的提交落定。 */
  settle(): Promise<void>;
  /** 按节点 `key` 或 `kind` 找到第一个节点。 */
  find(predicate: (node: SerializedNode) => boolean): SerializedNode | undefined;
  /** 触发某个节点上的某个事件，如 `press` / `change`。 */
  fire(node: SerializedNode, event: string, payload?: unknown): Promise<void>;
  /** 卸掉替身。 */
  uninstall(): void;
}

function isErrorShape(value: unknown): value is JarvisErrorShape {
  return typeof value === "object" && value !== null && "code" in value && "message" in value;
}

/** 在一列菜单项里按 id 找可点的条目。`reachable` 为假时找到也算点不到（它或它所在的子菜单被禁用了）。 */
function findMenuItem(items: MenuBarItem[], id: string, reachable = true): { item: MenuBarActionItem; reachable: boolean } | undefined {
  for (const item of items) {
    if (item.kind === "item" && item.id === id) return { item, reachable: reachable && item.enabled !== false };
    if (item.kind === "submenu") {
      const hit = findMenuItem(item.items, id, reachable && item.enabled !== false);
      if (hit) return hit;
    }
  }
  return undefined;
}

function walk(node: SerializedNode, visit: (node: SerializedNode) => boolean): SerializedNode | undefined {
  if (visit(node)) return node;
  for (const child of node.children ?? []) {
    const hit = walk(child, visit);
    if (hit) return hit;
  }
  return undefined;
}

/** 装上宿主替身。必须在 SDK 第一次调宿主之前调用。 */
export function createTestHost(options: TestHostOptions = {}): TestHost {
  const commits: SerializedNode[] = [];
  const surfaces: string[] = [];
  const menuBarModels: MenuBarModel[] = [];
  const orbModels: OrbMeterModel[] = [];
  const invocations: InvokeRequest[] = [];
  const logs: { level: string; message: string; data: unknown }[] = [];
  let inflight: Promise<unknown>[] = [];
  let callCounter = 1;
  const serviceWaiters = new Map<number, { resolve: (outcome: ServiceOutcome) => void; progress: unknown[] }>();
  // 替身自己接住的隐式能力：给了同名的桩就用桩（演拒绝）。
  const asyncStubs: Record<string, AsyncStub> = {
    "menuBar.update": () => null,
    "orb.update": () => null,
    ...(options.async ?? {}),
  };
  const syncStubs: Record<string, SyncStub> = {
    "host.info": () => options.hostInfo ?? { version: "0.0.0-test", channel: "development" },
    "host.environment": () =>
      options.environment ?? { reduceMotion: false, reduceTransparency: false, increaseContrast: false, locale: "zh-Hans-CN" },
    ...(options.sync ?? {}),
  };

  const dispatchToRuntime = (event: HostEvent) => {
    const runtime = globalThis.__jarvisRuntime;
    if (!runtime) throw new Error("SDK 还没注册 __jarvisRuntime：先 defineExtension() 或调一次能力。");
    runtime.dispatch(JSON.stringify(event));
  };

  const host: TestHost = {
    commits,
    surfaces,
    invocations,
    logs,
    get latest() {
      return commits[commits.length - 1];
    },
    get latestSurface() {
      return surfaces[surfaces.length - 1];
    },
    menuBarModels,
    get latestMenuBar() {
      return menuBarModels[menuBarModels.length - 1];
    },
    menuItem(id) {
      const latest = menuBarModels[menuBarModels.length - 1];
      return latest ? findMenuItem(latest.items, id)?.item : undefined;
    },
    orbModels,
    get latestOrb() {
      return orbModels.length === 0 ? undefined : orbModels[orbModels.length - 1];
    },
    async menuBarEvent(event, eventOptions = {}) {
      const granted = eventOptions.granted ?? [];
      const preferences = eventOptions.preferences ?? {};
      if (event === "select") {
        const itemId = eventOptions.itemId;
        if (itemId === undefined) throw new Error("menuBarEvent(\"select\") 要带 itemId。");
        const latest = eventOptions.statusItem === undefined ? menuBarModels[menuBarModels.length - 1] : host.statusItem(eventOptions.statusItem);
        const hit = latest ? findMenuItem(latest.items, itemId) : undefined;
        if (!hit) throw new Error(`最新一份菜单栏模型里没有「${itemId}」这一项。`);
        if (!hit.reachable) throw new Error(`菜单项「${itemId}」被禁用了（它或它所在的子菜单 enabled: false），用户点不到。`);
        const statusItem = eventOptions.statusItem;
        dispatchToRuntime({ type: "menuBar", menuBar: statusItem === undefined ? { event, itemId, granted, preferences } : { event, itemId, statusItem, granted, preferences } });
      } else if (event === "press") {
        const statusItem = eventOptions.statusItem;
        if (statusItem === undefined) throw new Error("menuBarEvent(\"press\") 要带 statusItem。");
        if (host.statusItem(statusItem)?.primaryClick !== "event") {
          throw new Error(`状态项「${statusItem}」的最新模型不是 primaryClick: "event"：宿主不会为它发 press。`);
        }
        dispatchToRuntime({ type: "menuBar", menuBar: { event, statusItem, modifiers: eventOptions.modifiers ?? [], granted, preferences } });
      } else if (event === "open") {
        const statusItem = eventOptions.statusItem;
        dispatchToRuntime({ type: "menuBar", menuBar: statusItem === undefined ? { event, granted, preferences } : { event, statusItem, granted, preferences } });
      } else {
        dispatchToRuntime({ type: "menuBar", menuBar: { event, granted, preferences } });
      }
      await host.settle();
    },
    statusItem(id) {
      return [...menuBarModels].reverse().find((model) => (model.statusItem ?? "main") === id);
    },
    subscriptionToken(namespace, method = "observe") {
      const request = [...invocations].reverse().find((entry) => entry.namespace === namespace && entry.method === method);
      return (request?.params as { token?: string } | undefined)?.token;
    },
    get nextCallId() {
      return callCounter;
    },
    dispatch: dispatchToRuntime,
    emit(token, payload) {
      dispatchToRuntime({ type: "subscription", token, payload });
    },
    callService(request) {
      const callId = callCounter++;
      return new Promise<ServiceOutcome>((resolve) => {
        serviceWaiters.set(callId, { resolve, progress: [] });
        dispatchToRuntime({
          type: "service",
          call: {
            callId,
            point: request.point ?? "junkClean.engine",
            service: request.service,
            method: request.method,
            params: {
              preferences: request.preferences ?? {},
              granted: request.granted ?? [],
              ...(request.actionId !== undefined ? { actionId: request.actionId } : {}),
              ...(request.request !== undefined ? { request: request.request } : {}),
            },
          },
        });
      });
    },
    cancelService(callId) {
      dispatchToRuntime({ type: "serviceCancel", callId });
    },
    async settle() {
      // 在途调用会触发新的调用与提交，循环到没有新东西为止。SDK 里的合并提交与扩展的
      // `await` 续体都是微任务，因此每轮多让几拍微任务就够了。
      const drain = async () => {
        for (let i = 0; i < 16; i += 1) await Promise.resolve();
      };
      while (inflight.length) {
        const batch = inflight;
        inflight = [];
        await Promise.all(batch);
        await drain();
      }
      await drain();
    },
    find(predicate) {
      const latest = commits[commits.length - 1];
      return latest ? walk(latest, predicate) : undefined;
    },
    async fire(node, event, payload = {}) {
      const handler = node.on?.[event];
      if (!handler) throw new Error(`节点 ${node.kind}${node.key ? `#${node.key}` : ""} 上没有 ${event} 事件。`);
      dispatchToRuntime({ type: "ui", handler, payload });
      await host.settle();
    },
    uninstall() {
      globalThis.__jarvisHost = undefined;
    },
  };

  globalThis.__jarvisHost = {
    invoke(requestJSON) {
      const request = JSON.parse(requestJSON) as InvokeRequest;
      const key = `${request.namespace}.${request.method}`;
      // 服务调用的两个回话由替身自己接住：它们是线缆的一部分，不是能力。
      if (key === "service.progress" || key === "service.resolve") {
        const params = request.params as { callId: number; progress?: unknown; result?: InvokeResult };
        const waiter = serviceWaiters.get(params.callId);
        if (waiter && key === "service.progress") waiter.progress.push(params.progress);
        if (waiter && key === "service.resolve" && params.result) {
          serviceWaiters.delete(params.callId);
          waiter.resolve({ result: params.result, progress: waiter.progress });
        }
        const done = Promise.resolve().then(() => dispatchToRuntime({ type: "settle", id: request.id, result: { ok: true, value: null } }));
        inflight.push(done);
        return;
      }
      invocations.push(request);
      const stub = asyncStubs[key];
      const run = (async (): Promise<InvokeResult> => {
        if (!stub) return { ok: false, error: { code: "capability.unknown", message: `测试替身没有桩：${key}` } };
        try {
          const value = await stub(request.params, host);
          // 宿主只画收下了的那份模型：被拒的不进 menuBarModels。
          if (key === "menuBar.update") menuBarModels.push(request.params as MenuBarModel);
          if (key === "orb.update") orbModels.push(request.params as OrbMeterModel);
          return { ok: true, value };
        } catch (error) {
          if (isErrorShape(error)) return { ok: false, error };
          return { ok: false, error: { code: "host.failure", message: error instanceof Error ? error.message : String(error) } };
        }
      })().then((result) => dispatchToRuntime({ type: "settle", id: request.id, result }));
      inflight.push(run);
    },
    commit(commitJSON) {
      const request = JSON.parse(commitJSON) as CommitRequest;
      commits.push(request.root);
      surfaces.push(request.surface);
    },
    log(level, message, dataJSON) {
      logs.push({ level, message, data: dataJSON === null ? undefined : JSON.parse(dataJSON) });
    },
    invokeSync(requestJSON) {
      const request = JSON.parse(requestJSON) as InvokeRequest;
      const key = `${request.namespace}.${request.method}`;
      const stub = syncStubs[key];
      if (!stub) return JSON.stringify({ ok: false, error: { code: "capability.unknown", message: `测试替身没有同步桩：${key}` } });
      try {
        return JSON.stringify({ ok: true, value: stub(request.params) });
      } catch (error) {
        return JSON.stringify({ ok: false, error: isErrorShape(error) ? error : { code: "host.failure", message: String(error) } });
      }
    },
  };

  return host;
}

// ---------------------------------------------------------------------------
// Android 操作域的假手机（SDK 2.4）
// ---------------------------------------------------------------------------

/** 替身那一侧的一台设备。 */
export interface FakeAndroidDevice {
  serial: string;
  /** 省略 = 序列号（与宿主读不出型号时一样）。 */
  name?: string;
  /** 省略 = `device`（连着且允许了调试）。 */
  state?: AndroidDevice["state"];
  /** 装着的应用（含系统应用；`scope: "user"` 时替身按 `system` 滤掉）。 */
  apps?: AndroidApp[];
  /** 包名 → 读安装包得到的东西；省略的字段为 `null`。装着却不在表里的包，应用名、版本、图标都是 `null`。 */
  details?: Record<string, Partial<Omit<AndroidAppDetail, "package">>>;
}

/** `fakeAndroid()` 收到的一次调用。 */
export interface FakeAndroidCall {
  method: "devices" | "apps" | "appDetails" | "openTool";
  params: unknown;
}

/** 一台假手机（其实是一排）。字段都可以在测试之间改，下一次调用读到的就是改过的。 */
export interface FakeAndroid {
  devices: FakeAndroidDevice[];
  /** 交给 `createTestHost({ async })` 的桩：`android.devices` / `android.apps` / `android.appDetails` / `android.openTool`。 */
  readonly stubs: Record<string, AsyncStub>;
  /** 每一次调用（含被拒的），按先后。 */
  readonly calls: FakeAndroidCall[];
  /** `openTool` 成功交出去的。 */
  readonly opened: { tool: AndroidTool; package: string }[];
  /** 下一次（只一次）调用这个方法时以 `error` 拒绝：模拟「未找到 adb」「没有 aapt2」。 */
  failNext(method: FakeAndroidCall["method"], error: JarvisErrorShape): void;
  /**
   * 挂住 `appDetails`：从现在起的调用都等到返回的 `release()` 被调才答。
   * 挂着的时候**别调 `host.settle()`**——它会一直等那几次调用落定。
   */
  holdDetails(): () => void;
  /** 此刻在途的 `appDetails` 个数。 */
  readonly detailsInFlight: number;
  /** 到目前为止同时在途的 `appDetails` 最多有几个。 */
  readonly maxDetailsInFlight: number;
}

const androidTools: readonly AndroidTool[] = ["apkScan", "dataExport"];
const androidScopes: readonly AndroidAppScope[] = ["user", "all"];

/**
 * 装一排假手机。规则照宿主（`docs/06-capabilities.md`「Android 操作域」）：
 *
 * - `apps` / `appDetails`：`serial` 为空 → `invalid.argument`；设备不在或不是 `ready` → `host.failure`；
 * - `apps`：`scope` 省略为 `user`，不认识 → `invalid.argument`；
 * - `appDetails`：`packages` 不是 1…8 个非空字符串 → `invalid.argument`；设备上没装的包 `problem` 写一句，其余照常；
 * - `openTool`：`tool` 只认 `apkScan` / `dataExport`，`package` 不能为空，否则 `invalid.argument`。
 *
 * 它不画任何东西、不拉任何安装包；图标句柄由测试自己在 `details` 里给。
 *
 * @param options.devices 一开始连着的设备；省略为一台都没有。
 * @returns 假手机：把 `stubs` 摊进 `createTestHost({ async })`。
 */
export function fakeAndroid(options: { devices?: FakeAndroidDevice[] } = {}): FakeAndroid {
  const calls: FakeAndroidCall[] = [];
  const opened: { tool: AndroidTool; package: string }[] = [];
  const failures = new Map<FakeAndroidCall["method"], JarvisErrorShape>();
  let gate: Promise<void> | null = null;
  let inFlight = 0;
  let maxInFlight = 0;

  const invalid = (message: string): JarvisErrorShape => ({ code: "invalid.argument", message });
  const record = (method: FakeAndroidCall["method"], params: unknown) => {
    calls.push({ method, params });
    const failure = failures.get(method);
    if (failure) {
      failures.delete(method);
      throw failure;
    }
  };
  const readyDevice = (serial: unknown): FakeAndroidDevice => {
    if (typeof serial !== "string" || serial === "") throw invalid("serial 不能为空");
    const device = fake.devices.find((candidate) => candidate.serial === serial);
    if (!device) throw { code: "host.failure", message: `设备 ${serial} 没有连着` } satisfies JarvisErrorShape;
    const state = device.state ?? "device";
    if (state === "unauthorized") throw { code: "host.failure", message: "手机上还没有允许 USB 调试" } satisfies JarvisErrorShape;
    if (state !== "device") throw { code: "host.failure", message: `设备 ${serial} 此刻读不了（${state}）` } satisfies JarvisErrorShape;
    return device;
  };

  const stubs: Record<string, AsyncStub> = {
    "android.devices": async (params) => {
      record("devices", params);
      return fake.devices.map((device) => {
        const state = device.state ?? "device";
        return { serial: device.serial, name: device.name ?? device.serial, state, ready: state === "device" };
      });
    },
    "android.apps": async (params) => {
      record("apps", params);
      const { serial, scope } = (params ?? {}) as { serial?: unknown; scope?: unknown };
      if (scope !== undefined && !androidScopes.includes(scope as AndroidAppScope)) throw invalid(`不认识的 scope：${String(scope)}`);
      const device = readyDevice(serial);
      const apps = device.apps ?? [];
      return { apps: (scope ?? "user") === "user" ? apps.filter((app) => !app.system) : [...apps] };
    },
    "android.appDetails": async (params) => {
      record("appDetails", params);
      const { serial, packages } = (params ?? {}) as { serial?: unknown; packages?: unknown };
      if (
        !Array.isArray(packages) ||
        packages.length < 1 ||
        packages.length > maximumAndroidAppDetailsPerCall ||
        packages.some((name) => typeof name !== "string" || name === "")
      ) {
        throw invalid(`packages 要 1…${maximumAndroidAppDetailsPerCall} 个包名`);
      }
      const device = readyDevice(serial);
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      try {
        if (gate) await gate;
        const installed = new Set((device.apps ?? []).map((app) => app.package));
        return (packages as string[]).map((name): AndroidAppDetail => {
          if (!installed.has(name)) return { package: name, label: null, versionName: null, icon: null, problem: "设备上没有这个应用" };
          return { label: null, versionName: null, icon: null, problem: null, ...(device.details?.[name] ?? {}), package: name };
        });
      } finally {
        inFlight -= 1;
      }
    },
    "android.openTool": async (params) => {
      record("openTool", params);
      const { tool, package: name } = (params ?? {}) as { tool?: unknown; package?: unknown };
      if (!androidTools.includes(tool as AndroidTool)) throw invalid(`不认识的工具：${String(tool)}`);
      if (typeof name !== "string" || name === "") throw invalid("package 不能为空");
      opened.push({ tool: tool as AndroidTool, package: name });
      return null;
    },
  };

  const fake: FakeAndroid = {
    devices: options.devices ?? [],
    stubs,
    calls,
    opened,
    failNext(method, error) {
      failures.set(method, error);
    },
    holdDetails() {
      let release: () => void = () => undefined;
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      gate = held;
      return () => {
        if (gate === held) gate = null;
        release();
      };
    },
    get detailsInFlight() {
      return inFlight;
    },
    get maxDetailsInFlight() {
      return maxInFlight;
    },
  };
  return fake;
}

// ---------------------------------------------------------------------------
// 常驻进程与系统代理的替身（SDK 2.9）
// ---------------------------------------------------------------------------

/** 替身那一侧的一个常驻进程（manifest `process.daemons[]` 的一项）。 */
export interface FakeDaemonDeclaration {
  /** manifest `process.daemons[].id`。 */
  id: string;
  /**
   * 宿主此刻定位到的可执行文件路径；**空串 = 没装**（`status` 答空串、`start` 以 `host.failure` 拒绝）。
   * 省略 = `/opt/homebrew/bin/<id>`。可以在测试之间改（演「在终端里装好了」）。
   */
  located?: string;
  /** manifest 声明了 `config`：`start` 必须带配置正文，没声明却带了同样拒绝。 */
  config?: boolean;
  /** SDK 2.10：manifest 声明了 `reload: "SIGHUP"`。没声明时 `daemon.reload` 以 `capability.undeclared` 拒绝。 */
  reload?: boolean;
}

/** `fakeDaemons()` 认的方法（线缆上的 `namespace.method`）。 */
export type FakeDaemonMethod =
  | "daemon.start"
  | "daemon.stop"
  | "daemon.status"
  | "daemon.logs"
  | "daemon.request"
  | "daemon.observe"
  | "daemon.unsubscribe"
  | "daemon.reload"
  | "systemProxy.status"
  | "systemProxy.enable"
  | "systemProxy.disable"
  | "tunnel.status"
  | "tunnel.start"
  | "tunnel.reload"
  | "tunnel.stop"
  | "tunnel.logs"
  | "tunnel.request"
  | "tunnel.observe"
  | "tunnel.unsubscribe";

/** `fakeDaemons()` 收到的一次调用。 */
export interface FakeDaemonCall {
  method: FakeDaemonMethod;
  params: unknown;
}

/** 常驻进程与系统代理的替身。字段都可以在测试之间改，下一次调用读到的就是改过的。 */
export interface FakeDaemons {
  /** 声明过的常驻进程。 */
  daemons: FakeDaemonDeclaration[];
  /** 交给 `createTestHost({ async })` 的桩：`daemon.*` 八个、`systemProxy.*` 三个与 `tunnel.*` 八个（SDK 2.10）。 */
  readonly stubs: Record<string, AsyncStub>;
  /** 每一次调用（含被拒的），按先后。 */
  readonly calls: FakeDaemonCall[];
  /** 每个 id 最近一次**起来了的** `start`（或 2.10 的 `reload`）交来的配置正文（没带为 `undefined`）：断言生成的配置就看它。 */
  readonly configs: Record<string, string | undefined>;
  /** SDK 2.10：每个 id 被 `daemon.reload` 过几次。 */
  readonly reloads: Record<string, number>;
  /** 每一次放行到控制口的 `daemon.request` 与 `tunnel.request`（被拒的不在这里；TUN 的没有 `id`）。 */
  readonly requests: (DaemonRequest | TunnelRequest)[];
  /** 控制口的应答（常驻进程与 TUN 内核共用）。省略时一律 `404`、空正文。 */
  respond: (request: DaemonRequest | TunnelRequest) => DaemonResponse | Promise<DaemonResponse>;
  /** 一个常驻进程此刻的状态（与 `daemon.status` 不带 `executable` 时答的一样）。 */
  status(id: string): DaemonStatus;
  /** 它此刻有几个订阅者。 */
  observers(id: string): number;
  /** 进程打了几行输出：记进日志（至多 500 行），推给订阅者一条 `output`。 */
  output(id: string, lines: string[]): void;
  /**
   * 进程自己死了（`kill -9`、配置热加载失败）：状态 `exited`，推给订阅者一条 `expected: false` 的 `exit`（带最后 20 行），
   * 这个扩展再没有在跑的常驻进程时，照宿主兜底把它接管着的系统代理还原。
   */
  crash(id: string, exit?: { exitCode?: number; signal?: number; lines?: string[] }): void;
  /**
   * 下一次调用这个方法时以 `error` 拒绝：演「1 秒内就退出了」这种启动失败。`times`（SDK 2.10，默认 1）连着拒几次——
   * 扩展遇到端口冲突会先停自己的内核再试一次，演「真被别的程序占着」要连拒两次。
   */
  failNext(method: FakeDaemonMethod, error: JarvisErrorShape, times?: number): void;
  /** 系统代理此刻的状态（与 `systemProxy.status` 答的一样）。 */
  readonly systemProxy: SystemProxyStatus;
  /** 让系统代理被别的工具拦着（Surge 增强模式）；`null` 撤掉。拦着时 `enable` 不写、返回带 `blocker` 的状态。 */
  blockSystemProxy(blocker: SystemProxyBlocker | null): void;
  /** 让另一个扩展接管着系统代理（`enable` 以 `host.failure` 拒绝并写明是谁）；`null` 放手。 */
  claimSystemProxy(otherName: string | null): void;
  /**
   * SDK 2.10：TUN 那一侧可以改的东西。`located` 是用户那份 sing-box（空串 = 没装）；`helper` 是网络助手此刻的样子；
   * `matchesInstalled` 是用户那份与 root 目录里的副本是不是同一版。`start` 遇到没装 / 版本不对 / 副本不对时替身演「当场装好」
   * （`installs` 加一，`helper` 变 `ready`、`matchesInstalled` 变真），除非 `cancelNextInstall()` 过。
   */
  readonly tunnel: { located: string; helper: TunnelHelperState; matchesInstalled: boolean; kernelVersion: string };
  /** TUN 内核此刻的状态（与 `tunnel.status` 不带 `executable` 时答的一样）。 */
  tunnelStatus(): TunnelStatus;
  /** 最近一次起来了的 `tunnel.start` / `tunnel.reload` 的配置正文。 */
  readonly tunnelConfig: string | undefined;
  /** 最近一次起来了的 `tunnel.start` 的入参（配置之外的那几项断言看它）。 */
  readonly tunnelStart: TunnelStartRequest | undefined;
  /** 替身演了几次安装（每次 = 用户输了一次管理员密码）。 */
  readonly installs: number;
  /** `tunnel.reload` 了几次。 */
  readonly tunnelReloads: number;
  /** 下一次需要安装时用户取消了管理员授权：`tunnel.start` 以 `permission.denied` 拒绝，什么都没装。 */
  cancelNextInstall(): void;
  /** 让主网卡被别的 utun 占着（Surge 增强模式）；`null` 撤掉。占着时 `tunnel.start` 不启动、返回带 `blocker` 的 `stopped`。 */
  blockTunnel(blocker: TunnelBlocker | null): void;
  /** TUN 内核打了几行输出。 */
  tunnelOutput(lines: string[]): void;
  /** TUN 内核自己死了：状态 `exited`、推一条 `expected: false` 的 `exit`，再没有在跑的内核时照宿主兜底还原系统代理。 */
  crashTunnel(exit?: { exitCode?: number; signal?: number; lines?: string[] }): void;
}

/** 替身里一个常驻进程的运行状态。 */
interface FakeDaemonRun {
  state: DaemonStatus["state"];
  pid?: number;
  startedAt?: number;
  exitCode?: number;
  signal?: number;
  controlPort?: number;
  executable?: string;
  logs: string[];
}

const daemonRequestMethods = ["GET", "POST", "PUT", "PATCH", "DELETE"];
const daemonRequestHeaders = ["Authorization", "Content-Type", "Accept"];
/** 与 bridge schema `$defs.daemonRequest.path` 同一条：以 / 开头，不含 //、反斜杠、# 与空白。 */
const daemonRequestPath = /^(?!.*\/\/)\/[^\s#\\]*$/;
const maximumDaemonLogLines = 500;
const daemonExitTailLines = 20;
/** 与 bridge schema `$defs.cidr` 同一条。 */
const cidrPattern = /^([0-9]{1,3}(\.[0-9]{1,3}){3}\/[0-9]{1,2}|[0-9A-Fa-f:]+\/[0-9]{1,3})$/;
/** 宿主网络助手的配置守卫里认的顶层键（jarvis-mac T-4）。 */
const tunnelTopLevelKeys = ["log", "dns", "ntp", "inbounds", "outbounds", "route", "experimental", "http_clients"];

/**
 * 替身那一份 TUN 配置守卫：照宿主网络助手那张表演最常见的几条（真守卫在 root 那一侧，见 jarvis-mac T-4）。
 * 返回第一条违规的说明；通过为 `null`。
 */
function tunnelGuardViolation(config: unknown, controlPort: number): string | null {
  if (typeof config !== "object" || config === null || Array.isArray(config)) return "配置要是一个 JSON 对象";
  const root = config as Record<string, unknown>;
  for (const key of Object.keys(root)) if (!tunnelTopLevelKeys.includes(key)) return `顶层键「${key}」不允许`;
  const log = root.log as Record<string, unknown> | undefined;
  if (log && "output" in log) return "log.output 不允许：TUN 模式下 sing-box 以管理员身份运行，不能把日志写到任意路径";
  const visit = (value: unknown, path: string, inTransport: boolean): string | null => {
    if (Array.isArray(value)) {
      for (const [index, item] of value.entries()) {
        const hit = visit(item, `${path}[${index}]`, inTransport);
        if (hit) return hit;
      }
      return null;
    }
    if (typeof value !== "object" || value === null) return null;
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      const here = path ? `${path}.${key}` : key;
      if (key.endsWith("_path") || key === "data_directory" || key === "acme") return `${here} 不允许：以管理员身份读写任意文件`;
      if (key === "path" && !(inTransport && typeof child === "string" && child.startsWith("/"))) return `${here} 不允许：只有 transport 里的 URL 路径可以叫 path`;
      const hit = visit(child, here, key === "transport");
      if (hit) return hit;
    }
    return null;
  };
  const deep = visit(root, "", false);
  if (deep) return deep;
  for (const [index, inbound] of ((root.inbounds as Record<string, unknown>[] | undefined) ?? []).entries()) {
    if (!["mixed", "http", "socks"].includes(String(inbound.type))) return `inbounds[${index}] 的 type「${String(inbound.type)}」不允许：TUN 段由宿主填`;
    if (!["127.0.0.1", "::1"].includes(String(inbound.listen))) return `inbounds[${index}] 只能监听回环地址`;
    if ("set_system_proxy" in inbound) return `inbounds[${index}].set_system_proxy 不允许：系统代理归 system.proxy`;
  }
  for (const [index, set] of ((((root.route as Record<string, unknown> | undefined)?.rule_set) as Record<string, unknown>[] | undefined) ?? []).entries()) {
    if (set.type === "local") return `route.rule_set[${index}] 不能是 local`;
  }
  const experimental = (root.experimental ?? {}) as Record<string, unknown>;
  if ("v2ray_api" in experimental) return "experimental.v2ray_api 不允许";
  const clash = experimental.clash_api as Record<string, unknown> | undefined;
  if (clash && Object.keys(clash).some((key) => key.startsWith("external_ui"))) return "experimental.clash_api.external_ui 不允许";
  if (clash?.external_controller !== `127.0.0.1:${controlPort}`) return `experimental.clash_api.external_controller 必须是 127.0.0.1:${controlPort}`;
  return null;
}

/**
 * 装一套常驻进程与系统代理的替身。规则照宿主（`docs/06-capabilities.md`「常驻进程」「系统代理」，jarvis-mac
 * `specs/20261028-091917-proxy-extension-menubar-daemon` P-3 / P-4 / P-6）：
 *
 * - `daemon.*`：没声明的 id → `capability.undeclared`；`start` 已在跑 → `host.failure`；没装（`located` 为空串、也没给路径）→ `host.failure`；
 *   `config` 该带没带、不该带带了，控制口不在 1024–65535 → `invalid.argument`；
 * - `daemon.request`：没在跑、启动时没报控制口 → `host.failure`；方法、路径、请求头、超时不合规矩 → `invalid.argument`；放行的交给 `respond`；
 * - `daemon.stop`：幂等；在跑的停下并推一条 `expected: true` 的 `exit`；
 * - `systemProxy.enable`：端口越界、例外超过 64 条或带空白 → `invalid.argument`；这个扩展没有在跑的常驻进程、别的扩展接管着 → `host.failure`；
 *   被拦着时什么都不写，返回带 `blocker` 的状态；
 * - 兜底还原：这个扩展的常驻进程全部停下或死掉时，它接管着的系统代理回到没人接管。
 *
 * 它不起任何进程、不碰这台机器的系统代理。
 *
 * @param options.daemons 声明过的常驻进程；省略为一个都没有。
 * @returns 替身：把 `stubs` 摊进 `createTestHost({ async })`。
 */
export function fakeDaemons(options: { daemons?: FakeDaemonDeclaration[] } = {}): FakeDaemons {
  const calls: FakeDaemonCall[] = [];
  const configs: Record<string, string | undefined> = {};
  const requests: (DaemonRequest | TunnelRequest)[] = [];
  const failures = new Map<FakeDaemonMethod, { error: JarvisErrorShape; remaining: number }>();
  const runs = new Map<string, FakeDaemonRun>();
  /** token → 订阅的是哪一个进程。 */
  const observers = new Map<string, string>();
  let attached: TestHost | null = null;
  let nextPid = 4242;
  const proxy: { owner: SystemProxyStatus["owner"]; port?: number; otherName?: string; blocker?: SystemProxyBlocker } = { owner: "none" };
  const reloads: Record<string, number> = {};
  const tunnelSide = { located: "/opt/homebrew/bin/sing-box", helper: "notInstalled" as TunnelHelperState, matchesInstalled: false, kernelVersion: "1.14.4" };
  const tunnelRun: FakeDaemonRun = { state: "stopped", logs: [] };
  const tunnelObservers = new Set<string>();
  let tunnelConfig: string | undefined;
  let tunnelStart: TunnelStartRequest | undefined;
  let tunnelBlocker: TunnelBlocker | undefined;
  let installs = 0;
  let tunnelReloads = 0;
  let cancelInstall = false;

  const invalid = (message: string): JarvisErrorShape => ({ code: "invalid.argument", message });
  const failure = (message: string): JarvisErrorShape => ({ code: "host.failure", message });
  const record = (method: FakeDaemonMethod, params: unknown) => {
    calls.push({ method, params });
    const pending = failures.get(method);
    if (pending) {
      if (pending.remaining <= 1) failures.delete(method);
      else pending.remaining -= 1;
      throw pending.error;
    }
  };
  const declaration = (id: unknown): FakeDaemonDeclaration => {
    const found = fake.daemons.find((candidate) => candidate.id === id);
    if (!found) throw { code: "capability.undeclared", message: `manifest 没有声明常驻进程「${String(id)}」` } satisfies JarvisErrorShape;
    return found;
  };
  const located = (decl: FakeDaemonDeclaration) => decl.located ?? `/opt/homebrew/bin/${decl.id}`;
  const run = (id: string): FakeDaemonRun => {
    let current = runs.get(id);
    if (!current) {
      current = { state: "stopped", logs: [] };
      runs.set(id, current);
    }
    return current;
  };
  const statusOf = (decl: FakeDaemonDeclaration, executable?: string): DaemonStatus => {
    const current = run(decl.id);
    const status: DaemonStatus = {
      id: decl.id,
      state: current.state,
      executable: current.state === "running" ? (current.executable ?? "") : (executable ?? located(decl)),
    };
    if (current.pid !== undefined) status.pid = current.pid;
    if (current.startedAt !== undefined) status.startedAt = current.startedAt;
    if (current.exitCode !== undefined) status.exitCode = current.exitCode;
    if (current.signal !== undefined) status.signal = current.signal;
    if (current.controlPort !== undefined) status.controlPort = current.controlPort;
    return status;
  };
  const appendLogs = (current: FakeDaemonRun, lines: string[]) => {
    current.logs.push(...lines);
    if (current.logs.length > maximumDaemonLogLines) current.logs.splice(0, current.logs.length - maximumDaemonLogLines);
  };
  const push = (id: string, event: DaemonEvent) => {
    if (!attached) return;
    for (const [token, observed] of observers) if (observed === id) attached.emit(token, event);
  };
  const proxyStatus = (): SystemProxyStatus => {
    const status: SystemProxyStatus = { owner: proxy.owner, effective: proxy.owner === "self" && !proxy.blocker };
    if (proxy.owner === "self" && proxy.port !== undefined) status.port = proxy.port;
    if (proxy.owner === "other" && proxy.otherName !== undefined) status.otherName = proxy.otherName;
    if (proxy.blocker) {
      status.current = proxy.blocker.address;
      status.blocker = { ...proxy.blocker };
    } else if (proxy.owner === "self" && proxy.port !== undefined) {
      status.current = `127.0.0.1:${proxy.port}`;
    }
    return status;
  };
  /** 这个扩展此刻有没有在跑的内核：常驻进程或（2.10）TUN 内核。 */
  const anyKernelRunning = () => tunnelRun.state === "running" || [...runs.values()].some((current) => current.state === "running");
  const tunnelStatusOf = (executable?: string): TunnelStatus => {
    const status: TunnelStatus = {
      state: tunnelRun.state,
      helper: { state: tunnelSide.helper },
      kernel: { executable: executable ?? tunnelSide.located, matchesInstalled: tunnelSide.matchesInstalled },
    };
    if (tunnelSide.helper === "ready") {
      status.helper.version = "1";
      status.helper.kernelVersion = tunnelSide.kernelVersion;
    }
    if (tunnelRun.pid !== undefined) status.pid = tunnelRun.pid;
    if (tunnelRun.startedAt !== undefined) status.startedAt = tunnelRun.startedAt;
    if (tunnelRun.exitCode !== undefined) status.exitCode = tunnelRun.exitCode;
    if (tunnelRun.signal !== undefined) status.signal = tunnelRun.signal;
    if (tunnelRun.controlPort !== undefined) status.controlPort = tunnelRun.controlPort;
    if (tunnelBlocker) status.blocker = { ...tunnelBlocker };
    return status;
  };
  const pushTunnel = (event: DaemonEvent) => {
    if (!attached) return;
    for (const token of tunnelObservers) attached.emit(token, event);
  };
  /** 守卫：正文要是 JSON，再过替身那一份表。 */
  const guard = (config: unknown, controlPort: number) => {
    if (typeof config !== "string" || config.length < 2) throw invalid("config 要是非空的配置正文");
    let parsed: unknown;
    try {
      parsed = JSON.parse(config);
    } catch {
      throw invalid("config 不是合法的 JSON");
    }
    const violation = tunnelGuardViolation(parsed, controlPort);
    if (violation) throw invalid(violation);
  };
  /** 宿主兜底：主人的常驻进程（与 TUN 内核）全部停下或死掉，系统代理还原。 */
  const restoreIfOrphaned = () => {
    if (proxy.owner !== "self") return;
    if (anyKernelRunning()) return;
    proxy.owner = "none";
    delete proxy.port;
  };
  const isPort = (value: unknown) => Number.isInteger(value) && (value as number) >= 1024 && (value as number) <= 65535;
  /** 换到一个新状态：清掉上一段的运行期字段与退出方式；停下或死掉时把这一次的退出方式留给 status 读。 */
  const settleExit = (current: FakeDaemonRun, exit: { exitCode?: number; signal?: number }, state: DaemonStatus["state"]) => {
    current.state = state;
    delete current.pid;
    delete current.startedAt;
    delete current.controlPort;
    delete current.executable;
    delete current.exitCode;
    delete current.signal;
    if (exit.exitCode !== undefined) current.exitCode = exit.exitCode;
    if (exit.signal !== undefined) current.signal = exit.signal;
  };

  const stubs: Record<string, AsyncStub> = {
    "daemon.start": async (params) => {
      record("daemon.start", params);
      const { id, config, executable, controlPort } = (params ?? {}) as { id?: unknown; config?: unknown; executable?: unknown; controlPort?: unknown };
      const decl = declaration(id);
      const current = run(decl.id);
      if (current.state === "running") throw failure(`常驻进程「${decl.id}」已经在运行，先 stop`);
      if (decl.config && typeof config !== "string") throw invalid(`常驻进程「${decl.id}」声明了 config，start 必须带配置正文`);
      if (!decl.config && config !== undefined) throw invalid(`常驻进程「${decl.id}」没有声明 config，不收配置正文`);
      if (controlPort !== undefined && !isPort(controlPort)) throw invalid("controlPort 必须是 1024–65535 的整数");
      if (executable !== undefined && (typeof executable !== "string" || executable === "")) throw invalid("executable 必须是非空路径");
      const path = (executable as string | undefined) ?? located(decl);
      if (path === "") throw failure(`找不到常驻进程「${decl.id}」的可执行文件`);
      settleExit(current, {}, "running");
      current.pid = nextPid++;
      current.startedAt = Date.now();
      current.executable = path;
      if (controlPort !== undefined) current.controlPort = controlPort as number;
      current.logs = [];
      configs[decl.id] = config as string | undefined;
      return statusOf(decl);
    },
    "daemon.stop": async (params) => {
      record("daemon.stop", params);
      const decl = declaration((params as { id?: unknown } | undefined)?.id);
      const current = run(decl.id);
      if (current.state === "running") {
        settleExit(current, { exitCode: 0 }, "stopped");
        push(decl.id, { kind: "exit", expected: true, exitCode: 0, lines: current.logs.slice(-daemonExitTailLines) });
        restoreIfOrphaned();
      }
      return statusOf(decl);
    },
    "daemon.status": async (params) => {
      record("daemon.status", params);
      const { id, executable } = (params ?? {}) as { id?: unknown; executable?: unknown };
      return statusOf(declaration(id), typeof executable === "string" ? executable : undefined);
    },
    "daemon.logs": async (params) => {
      record("daemon.logs", params);
      return [...run(declaration((params as { id?: unknown } | undefined)?.id).id).logs];
    },
    "daemon.request": async (params) => {
      record("daemon.request", params);
      const request = (params ?? {}) as DaemonRequest;
      const decl = declaration(request.id);
      if (!daemonRequestMethods.includes(request.method)) throw invalid(`不认识的方法：${String(request.method)}`);
      if (typeof request.path !== "string" || !daemonRequestPath.test(request.path)) throw invalid(`路径不合规矩：${String(request.path)}`);
      for (const name of Object.keys(request.headers ?? {})) {
        if (!daemonRequestHeaders.includes(name)) throw invalid(`请求头「${name}」不放行：只认 ${daemonRequestHeaders.join(" / ")}`);
      }
      if (request.timeout !== undefined && (!Number.isInteger(request.timeout) || request.timeout < 1 || request.timeout > 30)) {
        throw invalid("timeout 是 1–30 秒的整数");
      }
      const current = run(decl.id);
      if (current.state !== "running") throw failure(`常驻进程「${decl.id}」没有在运行`);
      if (current.controlPort === undefined) throw failure(`常驻进程「${decl.id}」启动时没有报控制口`);
      requests.push(request);
      return fake.respond(request);
    },
    "daemon.observe": async (params, host) => {
      record("daemon.observe", params);
      const { id, token } = (params ?? {}) as { id?: unknown; token?: unknown };
      const decl = declaration(id);
      if (typeof token !== "string" || token === "") throw invalid("token 不能为空");
      attached = host;
      observers.set(token, decl.id);
      return null;
    },
    "daemon.unsubscribe": async (params) => {
      record("daemon.unsubscribe", params);
      const { token } = (params ?? {}) as { token?: unknown };
      if (typeof token === "string") observers.delete(token);
      return null;
    },
    "systemProxy.status": async (params) => {
      record("systemProxy.status", params);
      return proxyStatus();
    },
    "systemProxy.enable": async (params) => {
      record("systemProxy.enable", params);
      const { port, bypass } = (params ?? {}) as { port?: unknown; bypass?: unknown };
      if (!isPort(port)) throw invalid("port 必须是 1024–65535 的整数");
      if (bypass !== undefined && (!Array.isArray(bypass) || bypass.length > 64 || bypass.some((entry) => typeof entry !== "string" || !/^\S+$/.test(entry)))) {
        throw invalid("bypass 至多 64 条、每条不带空白");
      }
      if (!anyKernelRunning()) {
        throw failure("这个扩展没有在运行的常驻进程或 TUN 内核：系统代理指着一个没人监听的端口，等于整机断网");
      }
      if (proxy.owner === "other") throw failure(`系统代理已由「${proxy.otherName ?? "另一个扩展"}」接管`);
      if (proxy.blocker) return proxyStatus();
      proxy.owner = "self";
      proxy.port = port as number;
      return proxyStatus();
    },
    "systemProxy.disable": async (params) => {
      record("systemProxy.disable", params);
      if (proxy.owner === "self") {
        proxy.owner = "none";
        delete proxy.port;
      }
      return proxyStatus();
    },
    "daemon.reload": async (params) => {
      record("daemon.reload", params);
      const { id, config } = (params ?? {}) as { id?: unknown; config?: unknown };
      const decl = declaration(id);
      if (!decl.reload) throw { code: "capability.undeclared", message: `常驻进程「${decl.id}」没有声明 reload` } satisfies JarvisErrorShape;
      const current = run(decl.id);
      if (current.state !== "running") throw failure(`常驻进程「${decl.id}」没有在运行`);
      if (decl.config && typeof config !== "string") throw invalid(`常驻进程「${decl.id}」声明了 config，reload 必须带配置正文`);
      if (!decl.config && config !== undefined) throw invalid(`常驻进程「${decl.id}」没有声明 config，不收配置正文`);
      configs[decl.id] = config as string | undefined;
      reloads[decl.id] = (reloads[decl.id] ?? 0) + 1;
      return statusOf(decl);
    },
    "tunnel.status": async (params) => {
      record("tunnel.status", params);
      const { executable } = (params ?? {}) as { executable?: unknown };
      return tunnelStatusOf(typeof executable === "string" ? executable : undefined);
    },
    "tunnel.start": async (params) => {
      record("tunnel.start", params);
      const request = (params ?? {}) as TunnelStartRequest;
      if (tunnelRun.state === "running") throw failure("TUN 内核已经在运行，先 stop");
      if (!isPort(request.controlPort)) throw invalid("controlPort 必须是 1024–65535 的整数");
      if (request.excludeRoutes !== undefined) {
        if (!Array.isArray(request.excludeRoutes) || request.excludeRoutes.length > 256) throw invalid("excludeRoutes 至多 256 条");
        for (const route of request.excludeRoutes) if (typeof route !== "string" || !cidrPattern.test(route)) throw invalid(`不是 CIDR：${String(route)}`);
      }
      if (request.stack !== undefined && !["mixed", "system", "gvisor"].includes(request.stack)) throw invalid(`不认识的协议栈：${String(request.stack)}`);
      guard(request.config, request.controlPort);
      const path = request.executable ?? tunnelSide.located;
      if (path === "") throw failure("找不到 sing-box：先装上它");
      if (tunnelBlocker) return tunnelStatusOf();
      if (tunnelSide.helper !== "ready" || !tunnelSide.matchesInstalled) {
        if (cancelInstall) {
          cancelInstall = false;
          throw { code: "permission.denied", message: "没有装上网络助手：管理员授权被取消" } satisfies JarvisErrorShape;
        }
        installs += 1;
        tunnelSide.helper = "ready";
        tunnelSide.matchesInstalled = true;
      }
      settleExit(tunnelRun, {}, "running");
      tunnelRun.pid = nextPid++;
      tunnelRun.startedAt = Date.now();
      tunnelRun.controlPort = request.controlPort;
      tunnelRun.logs = [];
      tunnelConfig = request.config;
      tunnelStart = { ...request };
      return tunnelStatusOf();
    },
    "tunnel.reload": async (params) => {
      record("tunnel.reload", params);
      const { config } = (params ?? {}) as { config?: unknown };
      if (tunnelRun.state !== "running" || tunnelRun.controlPort === undefined) throw failure("TUN 内核没有在运行");
      guard(config, tunnelRun.controlPort);
      tunnelConfig = config as string;
      tunnelReloads += 1;
      return tunnelStatusOf();
    },
    "tunnel.stop": async (params) => {
      record("tunnel.stop", params);
      if (tunnelRun.state === "running") {
        settleExit(tunnelRun, { exitCode: 0 }, "stopped");
        pushTunnel({ kind: "exit", expected: true, exitCode: 0, lines: tunnelRun.logs.slice(-daemonExitTailLines) });
        restoreIfOrphaned();
      }
      return tunnelStatusOf();
    },
    "tunnel.logs": async (params) => {
      record("tunnel.logs", params);
      return [...tunnelRun.logs];
    },
    "tunnel.request": async (params) => {
      record("tunnel.request", params);
      if (typeof params === "object" && params !== null && "id" in params) throw invalid("tunnel.request 不带 id");
      const request = (params ?? {}) as TunnelRequest;
      if (!daemonRequestMethods.includes(request.method)) throw invalid(`不认识的方法：${String(request.method)}`);
      if (typeof request.path !== "string" || !daemonRequestPath.test(request.path)) throw invalid(`路径不合规矩：${String(request.path)}`);
      for (const name of Object.keys(request.headers ?? {})) {
        if (!daemonRequestHeaders.includes(name)) throw invalid(`请求头「${name}」不放行：只认 ${daemonRequestHeaders.join(" / ")}`);
      }
      if (tunnelRun.state !== "running") throw failure("TUN 内核没有在运行");
      requests.push(request);
      return fake.respond(request);
    },
    "tunnel.observe": async (params, host) => {
      record("tunnel.observe", params);
      const { token } = (params ?? {}) as { token?: unknown };
      if (typeof token !== "string" || token === "") throw invalid("token 不能为空");
      attached = host;
      tunnelObservers.add(token);
      return null;
    },
    "tunnel.unsubscribe": async (params) => {
      record("tunnel.unsubscribe", params);
      const { token } = (params ?? {}) as { token?: unknown };
      if (typeof token === "string") tunnelObservers.delete(token);
      return null;
    },
  };

  const fake: FakeDaemons = {
    daemons: options.daemons ?? [],
    stubs,
    calls,
    configs,
    reloads,
    requests,
    respond: () => ({ status: 404, headers: {}, text: "" }),
    status(id) {
      return statusOf(declaration(id));
    },
    observers(id) {
      return [...observers.values()].filter((observed) => observed === id).length;
    },
    output(id, lines) {
      const current = run(declaration(id).id);
      appendLogs(current, lines);
      push(id, { kind: "output", lines: [...lines] });
    },
    crash(id, exit = {}) {
      const current = run(declaration(id).id);
      if (exit.lines) appendLogs(current, exit.lines);
      const how = exit.signal !== undefined ? { signal: exit.signal, ...(exit.exitCode !== undefined ? { exitCode: exit.exitCode } : {}) } : { exitCode: exit.exitCode ?? 1 };
      settleExit(current, how, "exited");
      push(id, { kind: "exit", expected: false, ...how, lines: current.logs.slice(-daemonExitTailLines) });
      restoreIfOrphaned();
    },
    failNext(method, error, times = 1) {
      failures.set(method, { error, remaining: Math.max(1, Math.floor(times)) });
    },
    get systemProxy() {
      return proxyStatus();
    },
    blockSystemProxy(blocker) {
      if (blocker) proxy.blocker = { ...blocker };
      else delete proxy.blocker;
    },
    claimSystemProxy(otherName) {
      if (otherName === null) {
        if (proxy.owner === "other") proxy.owner = "none";
        delete proxy.otherName;
        return;
      }
      proxy.owner = "other";
      proxy.otherName = otherName;
      delete proxy.port;
    },
    tunnel: tunnelSide,
    tunnelStatus() {
      return tunnelStatusOf();
    },
    get tunnelConfig() {
      return tunnelConfig;
    },
    get tunnelStart() {
      return tunnelStart;
    },
    get installs() {
      return installs;
    },
    get tunnelReloads() {
      return tunnelReloads;
    },
    cancelNextInstall() {
      cancelInstall = true;
    },
    blockTunnel(blocker) {
      tunnelBlocker = blocker ? { ...blocker } : undefined;
    },
    tunnelOutput(lines) {
      appendLogs(tunnelRun, lines);
      pushTunnel({ kind: "output", lines: [...lines] });
    },
    crashTunnel(exit = {}) {
      if (exit.lines) appendLogs(tunnelRun, exit.lines);
      const how = exit.signal !== undefined ? { signal: exit.signal, ...(exit.exitCode !== undefined ? { exitCode: exit.exitCode } : {}) } : { exitCode: exit.exitCode ?? 1 };
      settleExit(tunnelRun, how, "exited");
      pushTunnel({ kind: "exit", expected: false, ...how, lines: tunnelRun.logs.slice(-daemonExitTailLines) });
      restoreIfOrphaned();
    },
  };
  return fake;
}
