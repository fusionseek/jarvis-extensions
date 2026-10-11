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
 */
import type { CommitRequest, HostEvent, InvokeRequest, InvokeResult, SerializedNode, ServiceCall } from "./bridge.js";
import type { JarvisErrorShape } from "./capabilities.js";
import type { ServicePoint } from "./manifest.js";

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
  /** 调一次服务扩展点的方法，等扩展交回结果。 */
  callService(request: {
    point?: ServicePoint;
    service: string;
    method: ServiceCall["method"];
    preferences?: Record<string, unknown>;
    granted?: string[];
    actionId?: string;
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
