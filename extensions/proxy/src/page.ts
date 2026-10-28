/**
 * 工具箱那一页与窗口标签（P-9「界面」）。
 *
 * 工具箱 368pt 宽、一屏：状态与总开关 → 卡住时的那一屏说明 → 模式 → 节点 → 订阅 → 终端代理命令。
 * 窗口在同样的状态段之下多一排「节点 / 连接 / 日志 / 订阅」四页。
 *
 * 卡住的五种情形（没授权、没装 sing-box、没有订阅、内核起不来、系统代理被别的工具拦着）各一张 `note`：
 * 拿不到什么、为什么、还剩哪几条路——不是一句红字。整页至多一颗实心主按钮：卡住时它就是那张说明卡上的出路。
 */
import { ui, type ActionSpec, type Tint, type UINode } from "@fusionseek/jarvis-extension-sdk";
import { formatBytes, formatDelay, formatRate } from "./clash.js";
import type { Snapshot } from "./core.js";
import { URLTEST_TAG, type ProxyNode } from "./nodes.js";
import type { Session, WindowView } from "./session.js";
import { terminalProxyCommand, type ProxyMode } from "./singbox-config.js";
import { modeHelps, modeTitles, protocolTitles, restartReasons, statusLine, systemProxyCondition } from "./status.js";
import { describeUsage, formatAge, nodesDigest } from "./store.js";

/** 工具箱里节点至多列几行：再多就该用搜索或去窗口里看，一屏几百行谁也找不到要的那个。 */
const toolboxNodeRows = 60;
/** 窗口里节点至多列几行（一次 render ≤ 500 个节点，留出其余的位置）。 */
const windowNodeRows = 300;
/** 「连接」那一页至多列几条。 */
const connectionRows = 200;
/** 「日志」那一页给多少行。 */
const logRows = 200;

/**
 * 整页。
 * @param session 状态。
 * @returns 根节点。
 */
export function renderPage(session: Session): UINode {
  const snapshot = session.snapshot;
  if (!snapshot) return ui.scroll({ children: [ui.text({ key: "loading", style: "footnote", text: "正在读取状态" })] });
  const children: UINode[] = [statusSection(session, snapshot), ...notes(session, snapshot)];
  if (session.surface === "window") {
    children.push(
      ui.segmented({
        key: "view",
        label: "窗口里看哪一页",
        layout: "full",
        value: session.view,
        options: [
          { value: "nodes", title: "节点" },
          { value: "connections", title: "连接" },
          { value: "logs", title: "日志" },
          { value: "subscriptions", title: "订阅" },
        ],
        onChange: (value) => void session.showView(value as WindowView),
      }),
    );
    children.push(...windowView(session, snapshot));
  } else {
    if (snapshot.nodes.length > 0) children.push(modeSection(session, snapshot), nodesSection(session, snapshot, toolboxNodeRows));
    children.push(subscriptionsSection(session, snapshot, false), commandSection(snapshot));
  }
  return ui.scroll({ children });
}

// MARK: - 状态

function statusSection(session: Session, snapshot: Snapshot): UINode {
  const running = snapshot.phase === "running";
  const busy = session.core.busy;
  const canToggle = busy === null && (running || snapshot.phase === "stopped" || snapshot.phase === "failed");
  const children: UINode[] = [
    ui.toggle({
      key: "power",
      title: running ? "代理已开启" : "代理",
      subtitle: statusLine({ ...snapshot, busy }),
      value: running,
      disabled: !canToggle,
      onChange: (on) => void session.toggle(on),
    }),
  ];
  if (running) {
    const condition = systemProxyCondition(snapshot.proxy, snapshot.granted);
    const subtitle =
      condition.kind === "active"
        ? `系统代理指向 127.0.0.1:${snapshot.control?.mixedPort ?? snapshot.preferences.mixedPort}`
        : condition.kind === "notGranted"
          ? "没有授权修改系统代理"
          : condition.kind === "off"
            ? "浏览器与大部分应用此刻不经过代理"
            : condition.message;
    children.push(
      ui.toggle({
        key: "system-proxy",
        title: "设为系统代理",
        subtitle,
        value: condition.kind === "active",
        disabled: busy !== null || condition.kind === "notGranted" || condition.kind === "other",
        onChange: (on) => void session.setSystemProxy(on),
      }),
    );
  }
  if (session.message) {
    children.push(ui.text({ key: "message", style: "footnote", tint: session.message.ok ? "live" : "alert", text: session.message.message }));
  }
  const trailing = running && session.rate ? `↓ ${formatRate(session.rate.down)}  ↑ ${formatRate(session.rate.up)}` : undefined;
  return ui.section({ key: "status", title: "代理 · PROXY", ...(trailing ? { trailing } : {}), tint: running ? "live" : "neutral", children });
}

/** 卡住时那一屏，以及开着时要提醒的几件事。 */
function notes(session: Session, snapshot: Snapshot): UINode[] {
  const out: UINode[] = [];
  const action = (id: string, title: string, onPress: () => void, extra: Partial<ActionSpec> = {}): ActionSpec => ({ id, title, onPress, ...extra });
  switch (snapshot.phase) {
    case "notGranted":
      out.push(
        ui.note({
          key: "not-granted",
          tint: "alert",
          symbol: "lock",
          title: "还没有授权",
          body: "「代理」要在后台常驻运行 sing-box、开着时把系统代理指向它、拉取你填的订阅地址。没有「后台运行 sing-box」这一项，它什么都做不了；其余几项可以只给一部分。",
          actions: [action("grant", "授权", () => void session.grant())],
        }),
      );
      break;
    case "notInstalled":
      out.push(
        snapshot.preferences.singBoxPath
          ? ui.note({
              key: "bad-path",
              tint: "alert",
              symbol: "questionmark.folder",
              title: "设置里填的 sing-box 路径不可用",
              body: `${snapshot.preferences.singBoxPath} 不存在或不是可执行文件，文件名必须是 sing-box。改对路径，或者清空它让 Jarvis 自己找（Homebrew 装的会自动找到）。`,
              actions: [action("settings", "打开设置", () => session.openSettings())],
            })
          : ui.note({
              key: "not-installed",
              tint: "alert",
              symbol: "shippingbox",
              title: "没有找到 sing-box",
              body:
                session.installingSince !== null
                  ? "终端里正在安装；装好之后这里会自己换掉（每 2 秒查一次）。终端里写着没装成的话，按它说的做完再回来。"
                  : "「代理」用你自己装的 sing-box 做内核。点「在终端中安装」会在终端里执行 brew install sing-box；这台 Mac 没有 Homebrew 时，终端里会写明还剩哪几条路。",
              actions: [action("install", "在终端中安装", () => void session.install(), { disabled: session.installingSince !== null })],
            }),
      );
      break;
    case "noNodes": {
      const errors = snapshot.subscriptions.filter((record) => record.error).map((record) => `${record.host}：${record.error}`);
      out.push(
        snapshot.subscriptionCount === 0
          ? ui.note({
              key: "no-subscription",
              tint: "alert",
              symbol: "link.badge.plus",
              title: "还没有订阅",
              body: "在设置里填订阅地址（机场给的那一串 https 链接，可以填几条），再回来点「更新订阅」。认分享链接（整段 base64 或逐行）与 sing-box JSON；Clash YAML 本期不认。",
              actions: [action("settings", "打开设置", () => session.openSettings())],
            })
          : ui.note({
              key: "no-nodes",
              tint: "alert",
              symbol: "exclamationmark.magnifyingglass",
              title: "订阅里没有认出节点",
              body: errors.length > 0 ? errors.join("\n") : "填了订阅地址，但还没有拉过。点「更新订阅」拉一次。",
              actions: [
                action("update", "更新订阅", () => void session.update(), { disabled: session.core.busy !== null }),
                action("settings", "打开设置", () => session.openSettings()),
              ],
            }),
      );
      break;
    }
    case "failed": {
      const failure = snapshot.failure;
      const upgrade = failure?.hint.includes("brew upgrade") === true;
      out.push(
        ui.note({
          key: "failed",
          tint: "danger",
          symbol: "exclamationmark.triangle",
          title: failure?.message ?? "sing-box 退出了",
          body: failure?.hint || "下面是 sing-box 最后的输出。改了设置之后点「重试」；看不懂就打开日志。",
          actions: [
            action("retry", "重试", () => void session.toggle(true), { disabled: session.core.busy !== null }),
            ...(upgrade ? [action("upgrade", "在终端中更新 sing-box", () => void session.install())] : []),
            action("logs", "查看日志", () => session.openWindow("logs")),
          ],
        }),
      );
      if (failure && failure.lines.length > 0) {
        out.push(ui.result({ key: "failed-lines", mono: true, lines: 8, copy: true, error: true, text: failure.lines.slice(-8).join("\n") }));
      }
      break;
    }
    case "running": {
      const condition = systemProxyCondition(snapshot.proxy, snapshot.granted);
      const port = snapshot.control?.mixedPort ?? snapshot.preferences.mixedPort;
      if (snapshot.preferences.systemProxy && (condition.kind === "blocked" || condition.kind === "other")) {
        out.push(
          ui.note({
            key: "blocked",
            tint: "alert",
            symbol: "hand.raised",
            title: "系统代理被别的代理工具拦着",
            body: `${condition.message}\n「代理」照常在 127.0.0.1:${port} 上运行，只是系统代理没有改：要让浏览器经过它，先关掉那个工具的增强模式 / 系统代理，再打开上面的「设为系统代理」。命令行工具可以直接用下面这条命令。`,
          }),
        );
        out.push(ui.copy({ key: "blocked-copy", text: terminalProxyCommand(port), label: "复制终端代理命令", variant: "chip" }));
      }
      if (snapshot.control?.ruleSetFallback) {
        out.push(
          ui.note({
            key: "rule-set-fallback",
            tint: "amber",
            symbol: "arrow.triangle.branch",
            title: "这一次没有分流",
            body: "中国大陆规则集没下载下来，所有流量（局域网除外）都走节点。网络好了之后重新开启一次就会分流。",
          }),
        );
      }
      const reasons = restartReasons(snapshot.control, snapshot.preferences, nodesDigest(snapshot.nodes));
      if (reasons.length > 0) {
        out.push(
          ui.note({
            key: "restart",
            tint: "blue",
            symbol: "arrow.triangle.2.circlepath",
            title: "重新开启之后生效",
            body: `${reasons.join("、")}；在跑的这一份还是旧的。重新开启会断开现有连接一下。`,
            actions: [action("restart", "重新开启", () => void session.restart(), { disabled: session.core.busy !== null })],
          }),
        );
      }
      break;
    }
  }
  return out;
}

// MARK: - 模式与节点

function modeSection(session: Session, snapshot: Snapshot): UINode {
  const mode = snapshot.selection.mode;
  return ui.section({
    key: "mode",
    title: "模式 · MODE",
    children: [
      ui.segmented({
        key: "mode-picker",
        label: "出站模式",
        layout: "full",
        value: mode,
        options: (Object.keys(modeTitles) as ProxyMode[]).map((value) => ({ value, title: modeTitles[value], help: modeHelps[value] })),
        onChange: (value) => void session.setMode(value as ProxyMode),
      }),
      ui.text({ key: "mode-help", style: "footnote", text: modeHelps[mode] }),
    ],
  });
}

/**
 * 延迟对应的颜色：快的亮绿、慢的琥珀、超时红；没测过不上色。
 * @param delay 毫秒、`null`（超时）或 `undefined`（没测）。
 */
function delayTint(delay: number | null | undefined): Tint | undefined {
  if (delay === undefined) return undefined;
  if (delay === null) return "danger";
  return delay < 300 ? "live" : delay < 800 ? "amber" : "alert";
}

function nodeRow(session: Session, snapshot: Snapshot, node: ProxyNode): UINode {
  const delay = snapshot.latency.values[node.name];
  const parts = [protocolTitles[node.protocol]];
  const reading = formatDelay(delay);
  if (reading) parts.push(reading);
  if (session.autoPick === node.name && snapshot.selection.node === URLTEST_TAG) parts.push("自动选择此刻用它");
  const tint = delayTint(delay);
  return ui.row({
    key: `node:${node.name}`,
    symbol: "server.rack",
    title: node.name,
    subtitle: parts.join(" · "),
    ...(tint ? { tint } : {}),
    selected: snapshot.selection.node === node.name,
    onPress: () => void session.selectNode(node.name),
  });
}

function nodesSection(session: Session, snapshot: Snapshot, limit: number): UINode {
  const running = snapshot.phase === "running";
  const query = session.filter.trim().toLowerCase();
  const matched = query ? snapshot.nodes.filter((node) => node.name.toLowerCase().includes(query) || node.protocol.includes(query)) : snapshot.nodes;
  const shown = matched.slice(0, limit);
  const autoSubtitle = running && session.autoPick && snapshot.selection.node === URLTEST_TAG ? `此刻用「${session.autoPick}」` : "按延迟自动挑最快的那个";
  const rows: UINode[] = [
    ui.row({
      key: "node:auto",
      symbol: "bolt.horizontal",
      title: URLTEST_TAG,
      subtitle: autoSubtitle,
      selected: snapshot.selection.node === URLTEST_TAG,
      onPress: () => void session.selectNode(URLTEST_TAG),
    }),
    ...shown.map((node) => nodeRow(session, snapshot, node)),
  ];
  const children: UINode[] = [];
  if (snapshot.nodes.length > 8) {
    children.push(ui.search({ key: "node-search", value: session.filter, placeholder: "搜索节点", label: "搜索节点", onChange: (value) => session.search(value) }));
  }
  children.push(ui.list({ key: "nodes", children: rows }));
  if (matched.length > shown.length) {
    children.push(ui.text({ key: "nodes-more", style: "footnote", text: `另有 ${matched.length - shown.length} 个没列出来：用搜索找，或在窗口里看全部` }));
  }
  const tested = snapshot.latency.testedAt ? ` · 测于${formatAge(snapshot.latency.testedAt, Date.now())}` : "";
  return ui.section({
    key: "nodes-section",
    title: "节点 · NODES",
    trailing: `${snapshot.nodes.length} 个${tested}`,
    actions: [
      {
        id: "test",
        title: "测速",
        symbol: "speedometer",
        help: running ? "测一遍全部节点的延迟" : "代理开着才能测速",
        disabled: !running || session.core.busy !== null,
        onPress: () => void session.test(),
      },
    ],
    children,
  });
}

// MARK: - 订阅

function subscriptionsSection(session: Session, snapshot: Snapshot, detailed: boolean): UINode {
  const now = Date.now();
  const latest = snapshot.subscriptions.reduce<number | null>((max, record) => (record.fetchedAt !== null && (max === null || record.fetchedAt > max) ? record.fetchedAt : max), null);
  const rows: UINode[] = snapshot.subscriptions.map((record) => {
    const parts: string[] = [];
    if (record.error) parts.push(`上次没更新上：${record.error}`);
    parts.push(`${record.nodeCount} 个节点`);
    if (record.fetchedAt !== null) parts.push(`更新于${formatAge(record.fetchedAt, now)}`);
    if (record.usage) parts.push(describeUsage(record.usage));
    if (record.skippedTotal > 0) parts.push(`${record.skippedTotal} 行认不出`);
    return ui.row({
      key: `sub:${record.id}`,
      symbol: record.error ? "exclamationmark.triangle" : "link",
      title: `${record.position}. ${record.host}`,
      subtitle: parts.join(" · "),
      ...(record.error ? { tint: "alert" as Tint } : {}),
      ...(detailed ? {} : { accessory: "chevron" as const, onPress: () => session.openWindow("subscriptions") }),
    });
  });
  const children: UINode[] = [
    ui.list({
      key: "subscriptions",
      children: rows,
      emptyState: ui.empty({
        key: "no-subscriptions",
        symbol: "link.badge.plus",
        title: snapshot.subscriptionCount > 0 ? "还没有拉过订阅" : "设置里还没有订阅地址",
        hint: snapshot.subscriptionCount > 0 ? "点右上角「更新」拉一次。" : "在设置 · 扩展 · 代理里填订阅地址。",
      }),
    }),
  ];
  if (detailed) {
    for (const record of snapshot.subscriptions) {
      if (record.skipped.length === 0) continue;
      children.push(
        ui.section({
          key: `skipped:${record.id}`,
          title: `认不出的行 · ${record.host}`,
          trailing: record.skippedTotal > record.skipped.length ? `前 ${record.skipped.length} / ${record.skippedTotal} 行` : `${record.skippedTotal} 行`,
          tint: "alert",
          children: [
            ui.list({
              key: `skipped-list:${record.id}`,
              children: record.skipped.map((line, index) =>
                ui.row({ key: `skipped:${record.id}:${index}`, symbol: "questionmark.circle", title: line.reason, subtitle: line.line }),
              ),
            }),
          ],
        }),
      );
    }
  }
  return ui.section({
    key: "subscriptions-section",
    title: "订阅 · SUBSCRIPTIONS",
    ...(latest !== null ? { trailing: `更新于${formatAge(latest, now)}` } : {}),
    actions: [
      {
        id: "update",
        title: "更新订阅",
        symbol: "arrow.clockwise",
        help: snapshot.granted.includes("network.https") ? "重新拉一遍全部订阅" : "还没有授权拉取订阅地址",
        disabled: session.core.busy !== null || snapshot.subscriptionCount === 0,
        onPress: () => void session.update(),
      },
    ],
    children,
  });
}

function commandSection(snapshot: Snapshot): UINode {
  const command = terminalProxyCommand(snapshot.control?.mixedPort ?? snapshot.preferences.mixedPort);
  return ui.section({
    key: "terminal",
    title: "终端 · TERMINAL",
    children: [
      ui.text({ key: "terminal-help", style: "footnote", text: "命令行工具不读系统代理：在终端里粘贴这一行，这个终端里的 curl、git、brew 就会经过代理。" }),
      ui.copy({ key: "terminal-copy", text: command, label: "复制终端代理命令", variant: "chip" }),
    ],
  });
}

// MARK: - 窗口

function windowView(session: Session, snapshot: Snapshot): UINode[] {
  switch (session.view) {
    case "connections":
      return [connectionsSection(session, snapshot)];
    case "logs":
      return [logsSection(session)];
    case "subscriptions":
      return [subscriptionsSection(session, snapshot, true), commandSection(snapshot)];
    default:
      return snapshot.nodes.length > 0 ? [modeSection(session, snapshot), nodesSection(session, snapshot, windowNodeRows)] : [];
  }
}

function connectionsSection(session: Session, snapshot: Snapshot): UINode {
  const data = session.connections;
  const list = data ? [...data.connections].sort((a, b) => b.start - a.start).slice(0, connectionRows) : [];
  const trailing = data ? `${data.connections.length} 条 · ↓ ${formatBytes(data.downloadTotal)}  ↑ ${formatBytes(data.uploadTotal)}` : undefined;
  return ui.section({
    key: "connections-section",
    title: "连接 · CONNECTIONS",
    ...(trailing ? { trailing } : {}),
    children: [
      ui.list({
        key: "connections",
        children: list.map((connection) =>
          ui.row({
            key: `conn:${connection.id}`,
            symbol: connection.chains.includes("direct") ? "arrow.right" : "point.3.connected.trianglepath.dotted",
            title: connection.host || "（没有主机名）",
            subtitle: [connection.chains[0] ?? "", connection.network, `↓ ${formatBytes(connection.download)} ↑ ${formatBytes(connection.upload)}`, connection.rule]
              .filter((part) => part.length > 0)
              .join(" · "),
          }),
        ),
        emptyState: ui.empty({
          key: "no-connections",
          symbol: "point.3.connected.trianglepath.dotted",
          title: snapshot.phase === "running" ? "此刻没有连接" : "代理没开",
          hint: snapshot.phase === "running" ? "每秒刷新一次。" : "开启之后，经过代理的每一条连接都会列在这里。",
        }),
      }),
    ],
  });
}

function logsSection(session: Session): UINode {
  const tail = session.logs.slice(-logRows);
  let text = tail.join("\n");
  if (text.length > 19_000) text = text.slice(text.length - 19_000);
  return ui.section({
    key: "logs-section",
    title: "日志 · LOGS",
    trailing: `${session.logs.length} 行`,
    actions: [{ id: "reload", title: "重读", symbol: "arrow.clockwise", help: "重读 sing-box 最近 500 行输出", onPress: () => void session.showView("logs") }],
    children: [ui.result({ key: "log-text", mono: true, copy: true, text, empty: "sing-box 还没有输出" })],
  });
}
