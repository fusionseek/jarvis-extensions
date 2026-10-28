/**
 * 窗口：左边栏「活动 / 进程 / 策略 / 规则」四页（jarvis-mac `specs/20261028-191224-git-push-error-proxy-dashboard-issue-links` P-3）。
 *
 * 仓库主人要的是 Surge 那种仪表盘：活动页一眼看到开没开、走哪条线、此刻多快、今天走了多少、谁在用；进程页看每个程序；
 * 策略页一张卡一个节点、点一下选它并测它；规则页一张表看每条规则被用了多少次。版式全是宿主画的节点（`layout.*`），这里只给数据。
 *
 * 一次 render 至多 500 个节点：表格的行是 props、不算节点；节点卡一张三个节点，策略页按 {@link maximumCards} 截。
 */
import { layout, ui, type NetworkStatus, type Tint, type UINode } from "@fusionseek/jarvis-extension-sdk";
import { formatBytes, formatDelay, formatRate } from "./clash.js";
import type { Snapshot } from "./core.js";
import { DIRECT_TAG, SELECTOR_TAG, URLTEST_TAG } from "./nodes.js";
import {
  builtinRulesSection,
  commandSection,
  currentPageSection,
  delayTint,
  failuresSection,
  logsSection,
  notes,
  pageRulesSection,
  subscriptionsSection,
  surgeSection,
} from "./page.js";
import { ruleRows } from "./rule-table.js";
import type { Session, TrafficScope, WindowView } from "./session.js";
import type { ProxyMode } from "./singbox-config.js";
import { topUsages, type UsageCategory } from "./stats.js";
import { memberTitle, modeHelps, protocolTitles, systemProxyCondition, tunSubtitle, wantsTunnel } from "./status.js";
import { formatAge } from "./store.js";

/** 左边栏。 */
export const sidebarItems: readonly { value: WindowView; title: string; symbol: string }[] = [
  { value: "activity", title: "活动", symbol: "waveform.path.ecg" },
  { value: "processes", title: "进程", symbol: "cpu" },
  { value: "policies", title: "策略", symbol: "point.3.connected.trianglepath.dotted" },
  { value: "rules", title: "规则", symbol: "list.bullet.rectangle" },
];

/** 出站模式在窗口里的叫法（仓库主人原话：直接连接、全局代理、规则代理），先后按「越来越多地经过节点」排。 */
export const dashboardModeTitles: Readonly<Record<ProxyMode, string>> = { direct: "直接连接", global: "全局代理", rule: "规则判定" };

/** 策略页至多画几张节点卡（一张卡 3 个节点：卡、名字、读数）。 */
export const maximumCards = 120;

/** 「连接」表至多几行（表格的行上限 300）。 */
const connectionRows = 200;

/** 规则表至多几行（含最后一行兜底）。 */
const ruleTableRows = 300;

/** 24 个小时的横轴。 */
const hourLabels = Array.from({ length: 24 }, (_, hour) => String(hour));

/**
 * 整个窗口。
 * @param session 状态。
 * @param snapshot 快照；还没读到为 `null`（右边画 `loading`）。
 * @param loading 还没读到时右边那一页。
 * @returns 根节点（`sidebar`）。
 */
export function renderDashboard(session: Session, snapshot: Snapshot | null, loading?: UINode): UINode {
  const page = snapshot ? pageOf(session, snapshot) : (loading ?? ui.scroll({ children: [] }));
  return layout.sidebar({
    key: "dashboard",
    label: "代理",
    value: session.view,
    items: sidebarItems.map((item) => ({ ...item })),
    onChange: (value) => void session.showView(value as WindowView),
    children: [page],
  });
}

function pageOf(session: Session, snapshot: Snapshot): UINode {
  // 上一个动作的结果（导入、加规则、选节点）在哪一页按的就画在哪一页的顶上；活动页画在标题行下面。
  const message = session.message ? [ui.text({ key: "message", style: "footnote", tint: session.message.ok ? "live" : "alert", text: session.message.message })] : [];
  switch (session.view) {
    case "processes":
      return ui.scroll({ key: "page:processes", children: [...message, ...processesPage(session, snapshot)] });
    case "policies":
      return ui.scroll({ key: "page:policies", children: [...message, ...policiesPage(session, snapshot)] });
    case "rules":
      return ui.scroll({ key: "page:rules", children: [...message, ...rulesPage(session, snapshot)] });
    default:
      return ui.scroll({ key: "page:activity", children: activityPage(session, snapshot) });
  }
}

// MARK: - 活动

/**
 * 网络那一格：「Wi-Fi · en0」；没有网络、没读到写明。
 * @param network 网络接口。
 */
export function networkText(network: NetworkStatus | null): string {
  if (!network) return "—";
  if (network.kind === "none") return "没有网络";
  return `${network.name} · ${network.interface}`;
}

/**
 * 当前配置那一格：用着导入的 Surge 配置写它的文件名；否则写订阅的主机与节点数。
 * @param snapshot 快照。
 */
export function profileText(snapshot: Snapshot): string {
  if (snapshot.surge && snapshot.preferences.useSurgeRules) return `Surge · ${snapshot.surge.sourceName}`;
  if (snapshot.subscriptions.length === 0) return snapshot.subscriptionCount > 0 ? "订阅还没拉过" : "还没有订阅";
  const hosts = snapshot.subscriptions.map((record) => record.host);
  const head = hosts.length > 2 ? `${hosts.slice(0, 2).join("、")} 等 ${hosts.length} 个` : hosts.join("、");
  return `${head} · ${snapshot.nodes.length} 个节点`;
}

function activityPage(session: Session, snapshot: Snapshot): UINode[] {
  const running = snapshot.phase === "running";
  const busy = session.core.busy !== null;
  const condition = systemProxyCondition(snapshot.proxy, snapshot.granted);
  const tunActive = snapshot.kernel === "tunnel";
  const canStart = snapshot.phase === "stopped" || snapshot.phase === "failed";
  const children: UINode[] = [];
  children.push(
    ui.stack({
      key: "activity-title",
      axis: "horizontal",
      spacing: "loose",
      alignment: "center",
      children: [
        ui.text({ key: "activity-heading", style: "title", text: "活动" }),
        ui.toggle({
          key: "activity-system-proxy",
          title: "系统代理",
          subtitle: running ? (condition.kind === "active" ? `127.0.0.1:${snapshot.control?.mixedPort ?? snapshot.preferences.mixedPort}` : condition.kind === "off" ? "没有接管" : condition.kind === "notGranted" ? "没有授权" : "被拦着") : "代理关着",
          value: running && condition.kind === "active",
          disabled: busy || condition.kind === "notGranted" || (!running && !canStart),
          onChange: (on) => void session.activitySystemProxy(on),
        }),
        ui.toggle({
          key: "activity-tun",
          title: "增强模式",
          subtitle: running ? (tunActive ? "整机网络经过 sing-box" : "没有接管") : (tunSubtitle({ ...snapshot.tun, active: false }) ?? (snapshot.tun.wanted ? "开启代理时用" : "代理关着")),
          value: running ? tunActive : wantsTunnel(snapshot.preferences),
          disabled: busy || !snapshot.tun.granted || snapshot.phase === "notInstalled" || snapshot.phase === "notGranted",
          onChange: (on) => void session.activityTun(on),
        }),
        ui.iconButton({
          key: "activity-power",
          symbol: "power",
          label: running ? "关闭代理" : "开启代理",
          active: running,
          disabled: busy || !(running || canStart),
          onPress: () => void session.toggle(!running),
        }),
      ],
    }),
  );
  children.push(...notes(session, snapshot));
  if (session.message) children.push(ui.text({ key: "message", style: "footnote", tint: session.message.ok ? "live" : "alert", text: session.message.message }));
  const ip = session.externalIP;
  children.push(
    layout.grid({
      key: "activity-facts",
      minimum: 150,
      spacing: "tight",
      children: [
        ui.readout({ key: "fact-network", label: "网络", value: networkText(session.network) }),
        ui.readout({ key: "fact-profile", label: "当前配置", value: profileText(snapshot) }),
        ui.readout({ key: "fact-mode", label: "出站模式", value: dashboardModeTitles[snapshot.selection.mode], tint: running ? "live" : "neutral" }),
        ui.readout({ key: "fact-ip", label: "外部 IP", value: ip?.ip ?? "—", ...(ip?.ip ? { copy: true } : {}) }),
      ],
    }),
  );
  children.push(layout.grid({ key: "activity-cards", minimum: 160, spacing: "regular", children: activityCards(session, snapshot) }));
  children.push(trafficSection(session), topSection(session));
  return children;
}

function activityCards(session: Session, snapshot: Snapshot): UINode[] {
  const running = snapshot.phase === "running";
  const delay = session.internetDelay;
  const delayTintValue: Tint = delay === undefined ? "neutral" : delay === null ? "danger" : delay < 150 ? "live" : delay < 400 ? "amber" : "alert";
  const latest = (values: number[]) => (values.length > 0 ? values[values.length - 1] : 0);
  const upload = session.reading?.upload ?? latest(session.history.upload);
  const download = session.reading?.download ?? latest(session.history.download);
  const card = (key: string, title: string, value: string, tint: Tint, extra: UINode[] = []) =>
    ui.card({
      key,
      children: [ui.text({ key: `${key}:title`, style: "footnote", text: title }), ui.text({ key: `${key}:value`, style: "readout", tint, text: value }), ...extra],
    });
  const chart = (key: string, tone: "upload" | "download", values: number[]) =>
    values.length > 1 ? [ui.chart({ key, series: [{ tone, values: values.slice(-120) }], label: tone === "upload" ? "最近一分钟的上行" : "最近一分钟的下行" })] : [];
  return [
    card("card-latency", "Internet 延迟", running ? (delay === undefined ? "测量中" : delay === null ? "不通" : `${delay} ms`) : "—", running ? delayTintValue : "neutral"),
    card("card-connections", "活动连接", running && session.connections ? String(session.connections.connections.length) : "—", running ? "accent" : "neutral"),
    card("card-upload", "上行", running ? formatRate(upload) : "—", running ? "amber" : "neutral", running ? chart("card-upload:chart", "upload", session.history.upload) : []),
    card("card-download", "下行", running ? formatRate(download) : "—", running ? "blue" : "neutral", running ? chart("card-download:chart", "download", session.history.download) : []),
  ];
}

function trafficSection(session: Session): UINode {
  const stats = session.stats;
  const buckets = stats ? (session.trafficScope === "proxy" ? stats.proxy : stats.all) : null;
  const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);
  const caption = buckets ? `今天${session.trafficScope === "proxy" ? "经过节点" : "一共"} ↓ ${formatBytes(sum(buckets.download))}  ↑ ${formatBytes(sum(buckets.upload))}` : "还没有统计";
  return ui.section({
    key: "traffic",
    title: "流量 · TRAFFIC",
    trailing: stats ? `更新于${formatAge(stats.updatedAt, Date.now())}` : undefined,
    children: [
      ui.segmented({
        key: "traffic-scope",
        label: "流量看哪一份",
        layout: "full",
        value: session.trafficScope,
        options: [
          { value: "all", title: "全部" },
          { value: "proxy", title: "仅代理", help: "只算出站不是直连的连接" },
        ],
        onChange: (value) => session.setTrafficScope(value as TrafficScope),
      }),
      layout.bars({
        key: "traffic-hours",
        labels: hourLabels,
        series: [
          { tone: "download", values: buckets ? buckets.download.slice(0, 24) : new Array(24).fill(0) },
          { tone: "upload", values: buckets ? buckets.upload.slice(0, 24) : new Array(24).fill(0) },
        ],
        caption,
        label: `今天每小时的流量，${caption}`,
      }),
    ],
  });
}

/** 策略名在表里的写法：直连写中文，别的照原样。 */
function policyName(tag: string): string {
  return tag === DIRECT_TAG ? "直连" : tag;
}

function topSection(session: Session): UINode {
  const stats = session.stats;
  const category = session.topCategory;
  const rows = stats ? topUsages(stats, category, 10) : [];
  return ui.section({
    key: "top",
    title: "TOP 10 · 今天",
    children: [
      ui.segmented({
        key: "top-category",
        label: "Top 10 看哪一类",
        layout: "full",
        value: category,
        options: [
          { value: "processes", title: "进程与设备" },
          { value: "domains", title: "域名" },
          { value: "policies", title: "策略" },
        ],
        onChange: (value) => session.setTopCategory(value as UsageCategory),
      }),
      layout.table({
        key: `top-table:${category}`,
        label: "今天流量最多的十个",
        columns: [
          { title: category === "processes" ? "进程" : category === "domains" ? "域名" : "策略", width: "fill" },
          { title: "连接", width: "narrow", alignment: "trailing" },
          { title: "↑", alignment: "trailing" },
          { title: "↓", alignment: "trailing" },
          { title: "合计", alignment: "trailing" },
        ],
        rows: rows.map(([name, usage]) => ({
          cells: [category === "policies" ? policyName(name) : name, String(usage.connections), formatBytes(usage.upload), formatBytes(usage.download), formatBytes(usage.upload + usage.download)],
        })),
        emptyText: "代理开着时后台会记今天的流量，每分钟更新一次",
      }),
    ],
  });
}

// MARK: - 进程

function processesPage(session: Session, snapshot: Snapshot): UINode[] {
  const running = snapshot.phase === "running";
  const today = session.stats?.processes ?? {};
  const rows = session.processes.slice(0, 300).map((row) => {
    const usage = today[row.name];
    return {
      cells: [row.name, String(row.connections), formatRate(row.upload), formatRate(row.download), usage ? formatBytes(usage.upload + usage.download) : "—"],
      ...(row.upload + row.download === 0 ? { tint: "neutral" as Tint } : {}),
    };
  });
  const children: UINode[] = [
    ui.section({
      key: "processes",
      title: "进程 · PROCESSES",
      trailing: running && session.connections ? `${session.processes.length} 个程序 · ${session.connections.connections.length} 条连接` : undefined,
      children: [
        layout.table({
          key: "process-table",
          label: "每个程序此刻的速率",
          columns: [
            { title: "程序", width: "fill" },
            { title: "连接", width: "narrow", alignment: "trailing" },
            { title: "上行", alignment: "trailing" },
            { title: "下行", alignment: "trailing" },
            { title: "今天", alignment: "trailing" },
          ],
          rows,
          emptyText: running ? "此刻没有连接" : "代理没开",
        }),
      ],
    }),
  ];
  const failures = failuresSection(session);
  if (failures) children.push(failures);
  children.push(connectionsSection(session, snapshot), logsSection(session));
  return children;
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
      layout.table({
        key: "connections",
        label: "此刻的连接",
        columns: [
          { title: "主机", width: "fill" },
          { title: "程序" },
          { title: "策略" },
          { title: "规则", width: "wide" },
          { title: "↓", alignment: "trailing" },
          { title: "↑", alignment: "trailing" },
        ],
        rows: list.map((connection) => ({
          cells: [
            connection.host || "（没有主机名）",
            connection.process.split("/").pop() || "—",
            connection.chains.length > 0 ? [...connection.chains].reverse().map(policyName).join(" → ") : "—",
            connection.rule || "—",
            formatBytes(connection.download),
            formatBytes(connection.upload),
          ],
        })),
        emptyText: snapshot.phase === "running" ? "此刻没有连接，每秒刷新一次" : "开启之后，经过代理的每一条连接都会列在这里",
      }),
    ],
  });
}

// MARK: - 策略

function policiesPage(session: Session, snapshot: Snapshot): UINode[] {
  const running = snapshot.phase === "running";
  const mode = snapshot.selection.mode;
  const children: UINode[] = [
    ui.section({
      key: "policy-mode",
      title: "出站模式 · MODE",
      children: [
        ui.segmented({
          key: "policy-mode-picker",
          label: "出站模式",
          layout: "full",
          value: mode,
          options: (["direct", "global", "rule"] as const).map((value) => ({ value, title: dashboardModeTitles[value], help: modeHelps[value] })),
          onChange: (value) => void session.setMode(value as ProxyMode),
        }),
        ui.text({ key: "policy-mode-help", style: "footnote", text: mode === "direct" ? "直接连接模式下不经过节点：下面的选择照样记着，换回别的模式时生效。" : modeHelps[mode] }),
      ],
    }),
  ];
  if (snapshot.nodes.length === 0) {
    children.push(ui.empty({ key: "no-nodes", symbol: "server.rack", title: "还没有节点", hint: "在下面「订阅」里填订阅地址，拉下来就有了。" }));
  } else {
    let budget = maximumCards;
    const query = session.filter.trim().toLowerCase();
    const matched = query ? snapshot.nodes.filter((node) => node.name.toLowerCase().includes(query) || node.protocol.includes(query)) : snapshot.nodes;
    const cards: UINode[] = [];
    const autoSelected = snapshot.selection.node === URLTEST_TAG;
    cards.push(nodeCard(session, `node:${URLTEST_TAG}`, URLTEST_TAG, running && autoSelected && session.autoPick ? `此刻用「${session.autoPick}」` : "按延迟自动挑最快的", undefined, autoSelected, () => void session.pickNode(URLTEST_TAG)));
    budget -= 1;
    for (const node of matched.slice(0, Math.max(0, budget))) {
      const delay = snapshot.latency.values[node.name];
      cards.push(nodeCard(session, `node:${node.name}`, node.name, [protocolTitles[node.protocol], formatDelay(delay)].filter((part) => part).join(" · "), delayTint(delay), snapshot.selection.node === node.name, () => void session.pickNode(node.name)));
    }
    budget -= Math.min(matched.length, budget);
    const selectorChildren: UINode[] = [];
    if (snapshot.nodes.length > 8) {
      selectorChildren.push(ui.search({ key: "node-search", value: session.filter, placeholder: "搜索节点", label: "搜索节点", onChange: (value) => session.search(value) }));
    }
    selectorChildren.push(layout.grid({ key: "node-cards", minimum: 150, spacing: "tight", children: cards }));
    if (matched.length > cards.length - 1) selectorChildren.push(ui.text({ key: "nodes-more", style: "footnote", text: `另有 ${matched.length - (cards.length - 1)} 个没画出来：用搜索找` }));
    const tested = snapshot.latency.testedAt ? ` · 测于${formatAge(snapshot.latency.testedAt, Date.now())}` : "";
    children.push(
      ui.section({
        key: "policy-selector",
        title: `${SELECTOR_TAG} · ${snapshot.nodes.length} 个节点${tested}`,
        tint: mode === "direct" ? "neutral" : "accent",
        actions: [
          {
            id: "test-all",
            title: "全部测速",
            symbol: "speedometer",
            help: running ? "测一遍全部节点的延迟" : "代理开着才能测速",
            disabled: !running || session.core.busy !== null,
            onPress: () => void session.test(),
          },
        ],
        children: selectorChildren,
      }),
    );
    for (const group of snapshot.groups) {
      if (budget <= 0) break;
      const members = group.members.slice(0, budget);
      budget -= members.length;
      children.push(
        ui.section({
          key: `policy-group:${group.name}`,
          title: group.name,
          trailing: snapshot.surge ? `来自 ${snapshot.surge.sourceName}` : undefined,
          children: [
            layout.grid({
              key: `group-cards:${group.name}`,
              minimum: 150,
              spacing: "tight",
              children: members.map((member) => {
                const delay = snapshot.latency.values[member.tag];
                return nodeCard(session, `group:${group.name}:${member.tag}`, memberTitle(member.title), formatDelay(delay) || (member.tag === DIRECT_TAG ? "直连" : ""), delayTint(delay), group.selected === member.tag, () => void session.pickGroupMember(group, member.tag));
              }),
            }),
          ],
        }),
      );
    }
  }
  children.push(subscriptionsSection(session, snapshot, true), commandSection(snapshot));
  return children;
}

/** 一张节点卡：名字一行、读数一行；选中的高亮。点它 = 选它并测它。 */
function nodeCard(session: Session, key: string, title: string, detail: string, tint: Tint | undefined, selected: boolean, onPress: () => void): UINode {
  return ui.card({
    key,
    ...(selected ? { tint: "accent" as Tint } : {}),
    onPress: session.core.busy === null ? onPress : undefined,
    children: [
      ui.text({ key: `${key}:name`, style: selected ? "title" : "body", text: title, lines: 1 }),
      ui.text({ key: `${key}:detail`, style: "footnote", text: selected ? `已选 · ${detail || "点一下测速"}` : detail || "点一下选它并测速", lines: 1, ...(tint ? { tint } : {}) }),
    ],
  });
}

// MARK: - 规则

function rulesPage(session: Session, snapshot: Snapshot): UINode[] {
  const children: UINode[] = [];
  const plan = session.routes;
  if (plan) {
    const titles = new Map((snapshot.surge?.ruleSets ?? []).map((ref) => [ref.tag, ref.url.split("/").pop() || ref.host]));
    const rows = ruleRows(plan, session.ruleHits?.counts ?? {}, titles);
    const shown = rows.length > ruleTableRows ? [...rows.slice(0, ruleTableRows - 1), rows[rows.length - 1]] : rows;
    const total = rows.reduce((sum, row) => sum + row.hits, 0);
    const tableChildren: UINode[] = [
      layout.table({
        key: "rule-table",
        label: "此刻生效的规则",
        columns: [
          { title: "ID", width: "narrow", alignment: "trailing", mono: true },
          { title: "类型" },
          { title: "目标", width: "fill" },
          { title: "策略" },
          { title: "使用计数", width: "narrow", alignment: "trailing" },
          { title: "注释", width: "wide" },
        ],
        rows: shown.map((row) => ({
          cells: [String(row.id), row.type, row.target, row.policy, String(row.hits), row.note],
          ...(row.hits === 0 ? { tint: "neutral" as Tint } : {}),
        })),
      }),
    ];
    if (rows.length > shown.length) tableChildren.push(ui.text({ key: "rule-table-more", style: "footnote", text: `另有 ${rows.length - shown.length} 条没列出来（表里至多 ${ruleTableRows} 行）` }));
    children.push(
      ui.section({
        key: "rule-table-section",
        title: "规则 · RULES",
        trailing: `${rows.length} 条 · 本次开启以来 ${total} 条连接`,
        children: tableChildren,
      }),
    );
  } else {
    children.push(ui.text({ key: "rule-table-loading", style: "footnote", text: "正在读取规则" }));
  }
  children.push(currentPageSection(session, snapshot), pageRulesSection(session, snapshot), surgeSection(session, snapshot), builtinRulesSection(snapshot));
  return children;
}
