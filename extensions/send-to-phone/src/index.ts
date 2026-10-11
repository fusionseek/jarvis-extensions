/**
 * 发到手机 —— 用户点名的那个例子：一个要借用快传的扩展。
 *
 * 入驻三个域：工具箱（页面）、指令（`/phone` · `/发到手机`，静默）、设置。
 *
 * 它示范四件事：
 * 1. 每一项能力都有拒绝态（`permission.denied` 是状态，不是错误）；
 * 2. 不替用户悄悄开快传——服务没开时页面给一颗按钮让用户按，静默指令只在 Inbox 说一声；
 * 3. 做完一件事之后往 Inbox 投一条消息，面板收起了也看得见结果；
 * 4. 静默命令跑在后台会话：不读页面的状态、不碰任何界面，每一条路都以一条 Inbox 消息收尾。
 */
import {
  defineExtension,
  jarvis,
  ui,
  JarvisError,
  type CapabilityID,
  type CommandContext,
  type InboxMessage,
  type QuickTransferStatus,
  type UINode,
  type Unsubscribe,
} from "@fusionseek/jarvis-extension-sdk";

/** 设置域里的两项偏好。 */
interface Prefs {
  trimWhitespace: boolean;
  confirmBeforeSend: boolean;
}

let text = "";
let granted = new Set<CapabilityID>();
let status: QuickTransferStatus | null = null;
let statusProblem: string | null = null;
let sending = false;
let lastSentAt: string | null = null;
let failure: string | null = null;
let prefs: Prefs = { trimWhitespace: true, confirmBeforeSend: false };
let unsubscribeStatus: Unsubscribe | null = null;
let unsubscribePrefs: Unsubscribe | null = null;

function has(id: CapabilityID): boolean {
  return granted.has(id);
}

/** 宿主给的偏好 → `Prefs`。缺的键回到 manifest 里的默认值。 */
function readPrefs(raw: Record<string, unknown>): Prefs {
  return {
    trimWhitespace: Boolean(raw["trimWhitespace"] ?? true),
    confirmBeforeSend: Boolean(raw["confirmBeforeSend"] ?? false),
  };
}

function describe(e: unknown): string {
  if (e instanceof JarvisError) return e.detail ?? e.message;
  return e instanceof Error ? e.message : String(e);
}

/** 已配对的手机怎么称呼：一台写它的名字，多台写台数，没有为 `null`。 */
function peerLabel(current: QuickTransferStatus | null): string | null {
  const paired = current?.peers.filter((p) => p.paired) ?? [];
  if (paired.length === 1) return paired[0]?.label ?? null;
  if (paired.length > 1) return `${paired.length} 台设备`;
  return null;
}

/** Inbox 正文里那一段：压成一行、按字符（不是 UTF-16 单元）截断，免得把一个 emoji 劈成两半。 */
function excerpt(value: string, limit: number): string {
  const flat = Array.from(value.replace(/\s+/g, " ").trim());
  return flat.length > limit ? `${flat.slice(0, limit).join("")}…` : flat.join("");
}

// ---------------------------------------------------------------------------
// 页面那一侧（前台会话）
// ---------------------------------------------------------------------------

async function refreshStatus(): Promise<void> {
  if (!has("quickTransfer.status")) return;
  try {
    status = await jarvis.quickTransfer.status();
    statusProblem = null;
  } catch (e) {
    statusProblem = describe(e);
  }
  jarvis.ui.update();
}

async function requestCapabilities(ids: CapabilityID[]): Promise<void> {
  const result = await jarvis.permissions.request(ids);
  granted = new Set([...granted, ...result.granted]);
  await refreshStatus();
}

async function readClipboard(): Promise<void> {
  try {
    const clip = await jarvis.clipboard.read();
    text = clip ?? "";
    failure = clip === null ? "剪贴板里是被密码管理器标记为机密的内容，Jarvis 不放行。" : null;
  } catch (e) {
    failure = e instanceof JarvisError && e.code === "permission.denied" ? null : describe(e);
  }
  jarvis.ui.update();
}

async function startTransfer(): Promise<void> {
  try {
    status = await jarvis.quickTransfer.start();
    failure = null;
  } catch (e) {
    failure = describe(e);
  }
  jarvis.ui.update();
}

/**
 * 投一条 Inbox 消息。投不出去（没授权、10 秒内投过、宿主失败）只记日志：
 * 它是回执，不是这件事本身——推到手机已经成了，回执没投出去不能把这一次说成失败。
 */
async function postToInbox(message: InboxMessage, can: (id: CapabilityID) => boolean): Promise<void> {
  if (!can("inbox.post")) {
    jarvis.log.warn("没有 Inbox 授权，这条回执没投", message);
    return;
  }
  try {
    await jarvis.inbox.post(message);
  } catch (e) {
    jarvis.log.warn("Inbox 回执没投出去", describe(e));
  }
}

async function send(): Promise<void> {
  const payload = prefs.trimWhitespace ? text.trim() : text;
  if (payload.trim() === "" || sending) return;
  sending = true;
  failure = null;
  jarvis.ui.update();
  // 传输跨越指针离开：用户按下之后多半会去拿手机，15 秒倒计时不该在这期间收走这一屏。
  const hold = jarvis.panel.hold("正在把文字推到手机");
  let sent = false;
  try {
    await jarvis.quickTransfer.sendText(payload);
    lastSentAt = new Date().toISOString();
    sent = true;
  } catch (e) {
    failure = describe(e);
  } finally {
    hold.release();
    sending = false;
    jarvis.ui.update();
  }
  if (sent) {
    const peer = peerLabel(status);
    await postToInbox({ title: peer ? `已推到 ${peer}` : "已推到手机", body: excerpt(payload, 120), level: "success" }, has);
  }
}

// ---------------------------------------------------------------------------
// `/phone <文字>`（静默命令，后台会话）
// ---------------------------------------------------------------------------

/** 静默指令没发出去时，「怎么把快传打开」那一句。指令自己不开——那是一个对局域网敞开的端口。 */
const HOW_TO_START = "这条指令不会替你打开快传：在工具箱里打开「发到手机」按「开启快传」，或在快传面板里开启，手机扫码接入之后再发一次。";

/**
 * 快传不在服务中时那一条消息。`starting` 也算没发出去：服务还没监听，发了也是 `host.failure`。
 * - Parameter current: 此刻的快传状态（`state !== "running"`）。
 * - Parameter payload: 没发出去的那段字（放进正文末尾，用户知道是哪一条没走）。
 * - Returns: 一条 `warning` 级别的 Inbox 消息。
 */
function notRunningMessage(current: QuickTransferStatus, payload: string): InboxMessage {
  const title =
    current.state === "starting" ? "快传还在启动，没有发出去" : current.state === "failed" ? "快传没起来，没有发出去" : "快传没开，没有发出去";
  const reason = current.state === "failed" && current.failureReason ? `${current.failureReason}。` : "";
  return { title, body: `${reason}${HOW_TO_START}没发出去的是：「${excerpt(payload, 60)}」`, level: "warning" };
}

/**
 * `/phone <文字>`：把那段字经快传推到手机，结果投进 Inbox。
 *
 * 跑在**后台会话**里：页面里那份 `text` / `status` 在这里不存在（另一个 JSContext），
 * 所以这里一个模块级变量都不读——授权、偏好全取自这一次的 `context`，快传状态当场问。
 * 没有界面可以承载"要不要替你开快传"这个问题，因此快传没开时**不开**，只说一声。
 *
 * 文字从哪来：`/` 后面跟的那段；没跟字就读一次剪贴板。两者都按「去掉首尾空白」偏好处理
 * （宿主给的 `argument` 已经去过一次，偏好真正管到的是剪贴板那条路）。
 */
async function sendTextSilently(context: CommandContext): Promise<void> {
  const allowed = new Set(context.granted as CapabilityID[]);
  const can = (id: CapabilityID) => allowed.has(id);
  const { trimWhitespace } = readPrefs(context.preferences);

  if (!can("quickTransfer.send")) {
    await postToInbox(
      { title: "没有经快传发送的授权", body: "这条指令要把文字经快传推到手机。在 设置 › 扩展 › 发到手机 里打开「经快传发送」。", level: "warning" },
      can,
    );
    return;
  }

  let raw = context.argument ?? "";
  if (raw.trim() === "") {
    if (!can("clipboard.read")) {
      await postToInbox(
        { title: "没有要发送的文字", body: "/phone 后面没跟字，而读剪贴板的授权关着。在 / 后面跟上要发的字，或在 设置 › 扩展 › 发到手机 里打开「读取剪贴板」。", level: "warning" },
        can,
      );
      return;
    }
    try {
      const clip = await jarvis.clipboard.read();
      if (clip === null) {
        await postToInbox({ title: "剪贴板里是机密内容", body: "密码管理器标记为机密的内容 Jarvis 不放行。在 /phone 后面直接跟上要发的字。", level: "warning" }, can);
        return;
      }
      raw = clip;
    } catch (e) {
      await postToInbox({ title: "没读到剪贴板", body: describe(e), level: "error" }, can);
      return;
    }
  }
  const payload = trimWhitespace ? raw.trim() : raw;
  if (payload.trim() === "") {
    await postToInbox({ title: "没有要发送的文字", body: "/phone 后面没跟字，剪贴板里也是空的。", level: "warning" }, can);
    return;
  }

  // 先问快传开没开：开着才发。没有「查看快传状态」的授权就直接发，没开的话宿主以 host.failure 拒绝，下面接着说。
  let current: QuickTransferStatus | null = null;
  if (can("quickTransfer.status")) {
    try {
      current = await jarvis.quickTransfer.status();
    } catch {
      current = null;
    }
    if (current && current.state !== "running") {
      await postToInbox(notRunningMessage(current, payload), can);
      return;
    }
  }

  try {
    await jarvis.quickTransfer.sendText(payload);
  } catch (e) {
    const body =
      e instanceof JarvisError && e.code === "host.failure" && current === null
        ? `${describe(e)}。快传多半没开：${HOW_TO_START}`
        : describe(e);
    await postToInbox({ title: "没有发出去", body, level: "error" }, can);
    return;
  }
  const peer = peerLabel(current);
  await postToInbox({ title: peer ? `已推到 ${peer}` : "已推到手机", body: excerpt(payload, 120), level: "success" }, can);
}

// ---------------------------------------------------------------------------
// 渲染：每一段自己回答"我现在是什么状态"
// ---------------------------------------------------------------------------

function deniedNote(id: CapabilityID, title: string, body: string): UINode {
  return ui.note({
    tint: "alert",
    symbol: "lock",
    title,
    body,
    actions: [{ id: `grant-${id}`, title: "授权", onPress: () => void requestCapabilities([id]) }],
  });
}

function contentSection(): UINode {
  const children: UINode[] = [
    ui.editor({
      key: "text",
      value: text,
      rows: 3,
      maxRows: 8,
      placeholder: "从剪贴板读，或直接在这里写…",
      label: "要发送的文字",
      onChange: (value) => {
        text = value;
      },
    }),
  ];
  if (!has("clipboard.read")) {
    children.unshift(deniedNote("clipboard.read", "没有读取剪贴板的授权", "授权之后「读剪贴板」那颗按钮才有用；你也可以直接在下面输入。"));
  }
  return ui.section({
    key: "content",
    title: "内容 · CONTENT",
    trailing: text === "" ? undefined : `${Array.from(text).length} 字符`,
    actions: [
      {
        id: "paste",
        title: "读剪贴板",
        symbol: "doc.on.clipboard",
        help: "把系统剪贴板的内容放进来",
        disabled: !has("clipboard.read"),
        onPress: () => void readClipboard(),
      },
      {
        id: "clear",
        title: "清空",
        symbol: "xmark.circle",
        help: "清空",
        disabled: text === "",
        onPress: () => {
          text = "";
        },
      },
    ],
    children,
  });
}

function transferSection(): UINode {
  if (!has("quickTransfer.status")) {
    return ui.section({
      key: "transfer",
      title: "快传 · TRANSFER",
      children: [deniedNote("quickTransfer.status", "看不到快传的状态", "没有这项授权时无法知道服务开没开、手机连没连。")],
    });
  }
  if (statusProblem) {
    return ui.section({
      key: "transfer",
      title: "快传 · TRANSFER",
      children: [ui.note({ tint: "danger", symbol: "exclamationmark.triangle", title: "读不到快传状态", body: statusProblem })],
    });
  }
  if (!status || status.state === "stopped" || status.state === "failed") {
    const canStart = has("quickTransfer.control");
    return ui.section({
      key: "transfer",
      title: "快传 · TRANSFER",
      trailing: "未开启",
      children: [
        ui.note({
          key: "not-running",
          tint: "alert",
          symbol: "antenna.radiowaves.left.and.right",
          title: status?.state === "failed" ? "快传没起来" : "快传还没开",
          body: status?.failureReason ?? "发送要先把快传开起来，手机扫码接入之后才收得到。",
          actions: canStart
            ? [{ id: "start", title: "开启快传", onPress: () => void startTransfer() }]
            : [{ id: "grant-control", title: "授权开启", onPress: () => void requestCapabilities(["quickTransfer.control"]) }],
        }),
      ],
    });
  }
  const peer = peerLabel(status);
  return ui.section({
    key: "transfer",
    title: "快传 · TRANSFER",
    trailing: status.state === "starting" ? "启动中" : "服务中",
    children: [
      ui.readout({ key: "address", label: "地址", value: status.url ?? "—", tint: "accent", copy: true }),
      ui.readout({ key: "peer", label: "已接入", value: peer ?? "还没有手机接入 · 在快传里扫码", tint: peer ? "live" : "neutral" }),
    ],
  });
}

function actionSection(): UINode {
  const ready = status?.state === "running" && has("quickTransfer.send") && text.trim() !== "" && !sending;
  const children: UINode[] = [];
  if (!has("quickTransfer.send")) {
    children.push(deniedNote("quickTransfer.send", "没有经快传发送的授权", "这是这个扩展唯一要做的事。"));
  }
  if (failure) {
    children.push(ui.note({ key: "failure", tint: "danger", symbol: "exclamationmark.triangle", body: failure }));
  }
  if (lastSentAt && !failure) {
    children.push(ui.text({ key: "last-sent", text: `上次发送 ${new Date(lastSentAt).toLocaleTimeString()}`, style: "footnote" }));
  }
  const button = ui.button({
    key: "send",
    title: sending ? "发送中…" : "发到手机",
    symbol: "paperplane",
    variant: "primary",
    size: "bar",
    disabled: !ready,
    help: ready ? "经快传把上面的文字推到已接入的手机" : "要先开启快传、有文字、且已授权",
    onPress: () => void send(),
    ...(prefs.confirmBeforeSend ? { confirm: { title: "确认发送", timeoutSeconds: 4 } } : {}),
  });
  children.push(button);
  // `/` 下拉之外没有别的地方会告诉用户这条指令存在。
  children.push(ui.text({ key: "slash-hint", text: "全局搜索或速记里输入 /phone 后面跟一段字，不开面板直接发", style: "footnote" }));
  return ui.section({ key: "send-section", title: "发送 · SEND", children });
}

defineExtension({
  toolbox: {
    async activate(context) {
      granted = new Set(context.granted as CapabilityID[]);
      prefs = readPrefs(context.preferences);
      await refreshStatus();
      if (has("quickTransfer.status") && !unsubscribeStatus) {
        unsubscribeStatus = jarvis.quickTransfer.observe((next) => {
          status = next;
          jarvis.ui.update();
        });
      }
      // 每次 activate 都订阅一次而不退订，面板开合几次之后同一个变化会被处理好几遍。
      if (!unsubscribePrefs) {
        unsubscribePrefs = jarvis.preferences.onChange((changes) => {
          if ("trimWhitespace" in changes) prefs.trimWhitespace = Boolean(changes["trimWhitespace"]);
          if ("confirmBeforeSend" in changes) prefs.confirmBeforeSend = Boolean(changes["confirmBeforeSend"]);
        });
      }
    },

    render() {
      return ui.scroll({ children: [contentSection(), transferSection(), actionSection()] });
    },

    deactivate() {
      unsubscribeStatus?.();
      unsubscribeStatus = null;
      unsubscribePrefs?.();
      unsubscribePrefs = null;
    },
  },
  commands: {
    "send-text": sendTextSilently,
  },
});
