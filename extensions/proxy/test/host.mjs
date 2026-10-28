/**
 * 对着构建产物跑的测试共用的场面（不是测试文件）：宿主替身、SDK 的 `fakeDaemons()`、一份会算 64 KB 上限的存储、
 * 一台按 sing-box 1.14 源码答话的假 Clash API、可拨的定时器。
 *
 * **从不起真的 sing-box、不碰这台机器的系统代理、不联网**：常驻进程与系统代理由 `fakeDaemons()` 按宿主规则扮演，
 * 订阅由测试给的假响应扮演（合成数据，见 support.mjs）。
 *
 * 定时器：扩展里的 `sleep()` 调的是全局 `setTimeout`。这里把 ≥ 100 毫秒的那些接过来，由测试 `advance()` 拨动（`Date.now` 一起拨）——
 * 后台会话的自动更新循环一睡 30 秒、页面每秒一拍，用真定时器测试进程永远退不出去。更短的照常交给真定时器。
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createTestHost, fakeDaemons } from "../../../sdk/dist/testing.js";

const here = dirname(fileURLToPath(import.meta.url));
export const bundlePath = join(here, "..", "dist", "extension.js");

/** manifest 里的全部能力。 */
export const ALL = ["process.daemon", "system.proxy", "network.tunnel", "network.https", "terminal.run", "notifications.post", "clipboard.write", "browser.activeTab", "files.pick"];

/** 让微任务与 setImmediate 排空几轮。 */
export async function flush(rounds = 6) {
  for (let round = 0; round < rounds; round += 1) await new Promise((resolve) => setImmediate(resolve));
}

/** 接管 ≥ 100 毫秒的定时器。 */
function installFakeTimers() {
  const realSetTimeout = globalThis.setTimeout;
  const realClearTimeout = globalThis.clearTimeout;
  const timers = [];
  let clock = 0;
  let nextId = 1;
  // `Date.now` 跟着拨：速率按两次读数的时刻差算、就绪等待有 30 秒的截止，都要与定时器同一只钟。
  const realNow = Date.now.bind(Date);
  const base = realNow();
  Date.now = () => base + clock;
  globalThis.setTimeout = (callback, milliseconds, ...rest) => {
    if (typeof milliseconds === "number" && milliseconds >= 100) {
      const id = nextId++;
      timers.push({ id, at: clock + milliseconds, callback });
      return id;
    }
    return realSetTimeout(callback, milliseconds, ...rest);
  };
  globalThis.clearTimeout = (id) => {
    const index = timers.findIndex((timer) => timer.id === id);
    if (index >= 0) timers.splice(index, 1);
    else realClearTimeout(id);
  };
  return {
    get pending() {
      return timers.length;
    },
    /** 拨快 `milliseconds`：到点的回调按先后一个个跑，每跑一个排空一次。 */
    async advance(milliseconds) {
      const target = clock + milliseconds;
      for (;;) {
        timers.sort((a, b) => a.at - b.at);
        const next = timers[0];
        if (!next || next.at > target) break;
        timers.shift();
        clock = next.at;
        next.callback();
        await flush();
      }
      clock = target;
      await flush();
    },
  };
}

/**
 * 一份 JSON 存储，按宿主的上限拒绝超过 64 KB 的值（节点切块写错时在这里就红）。
 */
function memoryStorage() {
  const map = new Map();
  const limit = 64 * 1024;
  return {
    map,
    stubs: {
      "storage.get": async ({ key }) => (map.has(key) ? JSON.parse(map.get(key)) : undefined),
      "storage.set": async ({ key, value }) => {
        const text = JSON.stringify(value);
        if (Buffer.byteLength(text, "utf8") > limit) throw { code: "rate.limited", message: `存储键 ${key} 超过 64 KB` };
        map.set(key, text);
        return null;
      },
      "storage.delete": async ({ key }) => {
        map.delete(key);
        return null;
      },
      "storage.keys": async () => [...map.keys()],
    },
    get(key) {
      return map.has(key) ? JSON.parse(map.get(key)) : undefined;
    },
  };
}

/**
 * 一台假 Clash API：按 sing-box 1.14.4 `experimental/clashapi` 的形状答话，并核对 `Authorization` 与配置里的 secret 一致。
 * @param daemons `fakeDaemons()`。
 */
function fakeClash(daemons) {
  const state = {
    mode: null,
    selected: null,
    /** 节点名 → 毫秒；不在表里的节点测速超时（504）。 */
    delays: {},
    totals: { upload: 0, download: 0 },
    connections: [],
    /** 每次 `GET /version` 前调一次；返回 `false` 让这一次答 503（演「还在下载规则集」）。 */
    beforeVersion: null,
  };
  const json = (status, body) => ({ status, headers: { "Content-Type": "application/json" }, text: body === undefined ? "" : JSON.stringify(body) });
  daemons.respond = (request) => {
    const config = JSON.parse((request.id === undefined ? daemons.tunnelConfig : daemons.configs["sing-box"]) ?? "{}");
    const secret = config.experimental?.clash_api?.secret;
    if (request.headers?.Authorization !== `Bearer ${secret}`) return json(401, { message: "Unauthorized" });
    const [path, query = ""] = request.path.split("?");
    const params = new URLSearchParams(query);
    if (request.method === "GET" && path === "/version") {
      if (state.beforeVersion && state.beforeVersion() === false) return json(503, { message: "not ready" });
      return json(200, { version: "sing-box 1.14.4", premium: true, meta: true });
    }
    if (request.method === "PATCH" && path === "/configs") {
      state.mode = JSON.parse(request.body).mode;
      return json(204);
    }
    if (request.method === "GET" && path === "/connections") {
      return json(200, { uploadTotal: state.totals.upload, downloadTotal: state.totals.download, connections: state.connections, memory: 0 });
    }
    const proxy = /^\/proxies\/([^/]+)(\/delay)?$/.exec(path);
    if (proxy) {
      const name = decodeURIComponent(proxy[1]);
      const outbounds = config.outbounds ?? [];
      const outbound = outbounds.find((candidate) => candidate.tag === name);
      if (!outbound) return json(404, { message: "Resource not found" });
      if (proxy[2]) {
        if (!params.get("url")?.startsWith("https://") || !/^\d+$/.test(params.get("timeout") ?? "")) return json(400, { message: "Body invalid" });
        const delay = state.delays[name];
        return delay ? json(200, { delay }) : json(504, { message: "Timeout" });
      }
      if (request.method === "PUT") {
        const wanted = JSON.parse(request.body).name;
        if (outbound.type !== "selector") return json(400, { message: "Must be a Selector" });
        if (!outbound.outbounds.includes(wanted)) return json(400, { message: "Selector update error: not found" });
        state.selected = wanted;
        return json(204);
      }
      if (outbound.type === "urltest") return json(200, { type: "URLTest", name, now: outbound.outbounds[0], all: outbound.outbounds, history: [] });
      if (outbound.type === "selector") return json(200, { type: "Selector", name, now: state.selected ?? outbound.default, all: outbound.outbounds, history: [] });
      return json(200, { type: outbound.type, name, history: [] });
    }
    return json(404, { message: "Resource not found" });
  };
  return state;
}

/**
 * 装好全部替身并加载产物。每个测试文件调一次（产物是 IIFE，一个进程里只能 `defineExtension` 一次）。
 * @returns 场面。
 */
export async function createProxyHost() {
  const timers = installFakeTimers();
  const storage = memoryStorage();
  const daemons = fakeDaemons({ daemons: [{ id: "sing-box", config: true, reload: true }] });
  const clash = fakeClash(daemons);
  const scene = {
    timers,
    storage,
    daemons,
    clash,
    granted: [...ALL],
    preferences: {},
    subscriptions: [],
    /** URL → `{ status, headers, text }` 或抛出的错误（`{ throws: {...} }`）。 */
    responses: {},
    fetches: [],
    notifications: [],
    clipboard: [],
    terminal: [],
    opened: [],
    permissionRequests: [],
    /** 宿主认为不存在的那个路径（`daemon.status` 对它答空串）。 */
    badPath: null,
    /** `browser.activeTab()` 答什么（SDK 2.10）；`null` = 从没用过浏览器。 */
    tab: null,
    /** `files.pick()` 答什么；`null` = 用户取消。 */
    picked: null,
    /** 每一次 `files.pick` 的入参。 */
    picks: [],
    /** 每一次 `commands.run` 的 id。 */
    commandsRun: [],
    /** 偏好里的「规则集地址」。 */
    ruleSetURLs: [],
  };
  const host = createTestHost({
    async: {
      ...daemons.stubs,
      // fakeDaemons 把填的路径原样当作找到；宿主遇到不存在的路径答空串。`scene.badPath` 演这一种。
      "daemon.status": async (params, testHost) => {
        const status = await daemons.stubs["daemon.status"](params, testHost);
        return scene.badPath && params.executable === scene.badPath && status.state !== "running" ? { ...status, executable: "" } : status;
      },
      ...storage.stubs,
      "permissions.granted": async () => [...scene.granted],
      "permissions.request": async ({ ids }) => {
        scene.permissionRequests.push(ids);
        scene.granted = [...new Set([...scene.granted, ...ids])];
        return { granted: ids, denied: [] };
      },
      "preferences.all": async () => ({ ...scene.preferences }),
      "preferences.get": async ({ key }) => (key === "subscriptions" ? [...scene.subscriptions] : key === "ruleSets" ? [...scene.ruleSetURLs] : scene.preferences[key]),
      "browser.activeTab": async () => scene.tab,
      "files.pick": async (params) => {
        scene.picks.push(params);
        return scene.picked;
      },
      "commands.run": async ({ id }) => {
        scene.commandsRun.push(id);
        return null;
      },
      "preferences.observe": async () => null,
      "preferences.unsubscribe": async () => null,
      "net.fetch": async (params) => {
        scene.fetches.push(params);
        const response = scene.responses[params.url];
        if (!response) throw { code: "host.failure", message: `连不上 ${params.url}` };
        if (response.throws) throw response.throws;
        return response;
      },
      "notifications.post": async (content) => {
        scene.notifications.push(content);
        return null;
      },
      "clipboard.write": async ({ text }) => {
        scene.clipboard.push(text);
        return null;
      },
      "terminal.run": async ({ id }) => {
        scene.terminal.push(id);
        return null;
      },
      "system.openExtensionSettings": async () => {
        scene.opened.push("settings");
        return null;
      },
      "window.open": async () => {
        scene.opened.push("window");
        return null;
      },
    },
  });
  scene.host = host;
  await import(bundlePath);
  return scene;
}

/**
 * 等扩展真的闲下来：`host.settle()` 只等在途的宿主调用，再多让 16 拍微任务——扩展里一条 `await` 链在两次宿主调用之间
 * 可能隔着更多拍（快照要并发读七八个键），它会提前返回。这里反复 settle + 排空宏任务，直到连续两轮没有新的调用。
 * @param scene 场面。
 */
export async function idle(scene) {
  let quiet = 0;
  let seen = -1;
  while (quiet < 2) {
    await scene.host.settle();
    await flush();
    const count = scene.host.invocations.length + scene.host.menuBarModels.length + scene.host.orbModels.length;
    quiet = count === seen ? quiet + 1 : 0;
    seen = count;
  }
}

/** fakeDaemons 收到的某一类调用。 */
export function callsOf(scene, method) {
  return scene.daemons.calls.filter((call) => call.method === method);
}

/** 放行到控制口的请求，按「方法 路径」写。 */
export function clashCalls(scene) {
  return scene.daemons.requests.map((request) => `${request.method} ${decodeURIComponent(request.path.split("?")[0])}`);
}

/** 最近一次 `daemon.start` / `daemon.reload` 交出去的配置（TUN 在跑时是 `tunnel.start` / `tunnel.reload` 那一份）。 */
export function lastConfig(scene) {
  if (scene.daemons.tunnelStatus().state === "running") return JSON.parse(scene.daemons.tunnelConfig);
  return JSON.parse(scene.daemons.configs["sing-box"]);
}
