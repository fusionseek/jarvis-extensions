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
 */
import type { CommitRequest, HostEvent, InvokeRequest, InvokeResult, SerializedNode, ServiceCall } from "./bridge.js";
import type { AndroidApp, AndroidAppDetail, AndroidAppScope, AndroidDevice, AndroidTool, JarvisErrorShape } from "./capabilities.js";
import { maximumAndroidAppDetailsPerCall } from "./capabilities.js";
import type { ServicePoint } from "./manifest.js";
import type { CodeFormatRequest, ProjectEngineRequest } from "./services.js";

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
    request?: ProjectEngineRequest | CodeFormatRequest;
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
  const invocations: InvokeRequest[] = [];
  const logs: { level: string; message: string; data: unknown }[] = [];
  let inflight: Promise<unknown>[] = [];
  let callCounter = 1;
  const serviceWaiters = new Map<number, { resolve: (outcome: ServiceOutcome) => void; progress: unknown[] }>();
  const asyncStubs = options.async ?? {};
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
          return { ok: true, value: await stub(request.params, host) };
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
