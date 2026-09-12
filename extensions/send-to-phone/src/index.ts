/**
 * 发到手机 —— 用户点名的那个例子：一个要借用快传的扩展。
 *
 * 它示范三件事：
 * 1. 每一项能力都有拒绝态（`permission.denied` 是状态，不是错误）；
 * 2. 不替用户悄悄开快传——服务没开时给一颗按钮让用户按；
 * 3. 做完一件事之后往 Inbox 留一张卡，面板收起了也看得见结果。
 */
import {
  defineExtension,
  jarvis,
  ui,
  JarvisError,
  type CapabilityID,
  type QuickTransferStatus,
  type UINode,
  type Unsubscribe,
} from "@fusionseek/jarvis-extension-sdk";

let text = "";
let granted = new Set<CapabilityID>();
let status: QuickTransferStatus | null = null;
let statusProblem: string | null = null;
let sending = false;
let lastSentAt: string | null = null;
let failure: string | null = null;
let prefs: { trimWhitespace: boolean; confirmBeforeSend: boolean } = { trimWhitespace: true, confirmBeforeSend: false };
let unsubscribe: Unsubscribe | null = null;

function has(id: CapabilityID): boolean {
  return granted.has(id);
}

async function refreshStatus(): Promise<void> {
  if (!has("quickTransfer.status")) return;
  try {
    status = await jarvis.quickTransfer.status();
    statusProblem = null;
  } catch (e) {
    statusProblem = e instanceof JarvisError ? e.detail ?? e.message : String(e);
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

async function send(): Promise<void> {
  const payload = prefs.trimWhitespace ? text.trim() : text;
  if (payload === "" || sending) return;
  sending = true;
  failure = null;
  jarvis.ui.update();
  // 传输跨越指针离开：用户按下之后多半会去拿手机，15 秒倒计时不该在这期间收走这一屏。
  const hold = jarvis.panel.hold("正在把文字推到手机");
  try {
    await jarvis.quickTransfer.sendText(payload);
    lastSentAt = new Date().toISOString();
    if (has("inbox.post")) {
      await jarvis.inbox.post({
        id: "sent",
        title: peerLabel() ? `已推到 ${peerLabel()}` : "已推到手机",
        body: payload.slice(0, 60),
        tint: "live",
        actions: [{ id: "again", title: "再发一次" }],
      });
    }
  } catch (e) {
    failure = describe(e);
  } finally {
    hold.release();
    sending = false;
    jarvis.ui.update();
  }
}

function describe(e: unknown): string {
  if (e instanceof JarvisError) return e.detail ?? e.message;
  return e instanceof Error ? e.message : String(e);
}

function peerLabel(): string | null {
  const paired = status?.peers.filter((p) => p.paired) ?? [];
  if (paired.length === 1) return paired[0]?.label ?? null;
  if (paired.length > 1) return `${paired.length} 台设备`;
  return null;
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
      title: "快传 · TRANSFER",
      children: [deniedNote("quickTransfer.status", "看不到快传的状态", "没有这项授权时无法知道服务开没开、手机连没连。")],
    });
  }
  if (statusProblem) {
    return ui.section({
      title: "快传 · TRANSFER",
      children: [ui.note({ tint: "danger", symbol: "exclamationmark.triangle", title: "读不到快传状态", body: statusProblem })],
    });
  }
  if (!status || status.state === "stopped" || status.state === "failed") {
    const canStart = has("quickTransfer.control");
    return ui.section({
      title: "快传 · TRANSFER",
      trailing: "未开启",
      children: [
        ui.note({
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
  const peer = peerLabel();
  return ui.section({
    title: "快传 · TRANSFER",
    trailing: status.state === "starting" ? "启动中" : "服务中",
    children: [
      ui.readout({ label: "地址", value: status.url ?? "—", tint: "accent", copy: true }),
      ui.readout({ label: "已接入", value: peer ?? "还没有手机接入 · 在快传里扫码", tint: peer ? "live" : "neutral" }),
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
    children.push(ui.note({ tint: "danger", symbol: "exclamationmark.triangle", body: failure }));
  }
  if (lastSentAt && !failure) {
    children.push(ui.text({ text: `上次发送 ${new Date(lastSentAt).toLocaleTimeString()}`, style: "footnote" }));
  }
  const button = ui.button({
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
  return ui.section({ title: "发送 · SEND", children });
}

defineExtension({
  async activate(context) {
    granted = new Set(context.granted as CapabilityID[]);
    prefs = {
      trimWhitespace: Boolean(context.preferences["trimWhitespace"] ?? true),
      confirmBeforeSend: Boolean(context.preferences["confirmBeforeSend"] ?? false),
    };
    await refreshStatus();
    if (has("quickTransfer.status")) {
      unsubscribe = jarvis.quickTransfer.observe((next) => {
        status = next;
        jarvis.ui.update();
      });
    }
    jarvis.preferences.onChange((changes) => {
      if ("trimWhitespace" in changes) prefs.trimWhitespace = Boolean(changes["trimWhitespace"]);
      if ("confirmBeforeSend" in changes) prefs.confirmBeforeSend = Boolean(changes["confirmBeforeSend"]);
    });
  },

  render() {
    return ui.scroll({ children: [contentSection(), transferSection(), actionSection()] });
  },

  deactivate() {
    unsubscribe?.();
    unsubscribe = null;
  },

  async onInboxAction(cardId, actionId) {
    if (cardId === "sent" && actionId === "again") {
      await send();
    }
  },
});
