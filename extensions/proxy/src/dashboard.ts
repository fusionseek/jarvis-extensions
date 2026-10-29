/**
 * 窗口：左边栏「活动 / 进程 / 策略 / 规则」四页（jarvis-mac `specs/20261028-191224-git-push-error-proxy-dashboard-issue-links` P-3，
 * 版式按 `specs/20261029-082059-proxy-window-desktop-layout` D-7 重做）。
 *
 * 仓库主人要的是 Surge 那种仪表盘：活动页一眼看到开没开、走哪条线、此刻多快、今天走了多少、谁在用；进程页看每个程序；
 * 策略页一张卡一个节点、点一下选它并测它；规则页一张表看每条规则被用了多少次。版式全是宿主画的节点（`layout.*`），这里只给数据。
 *
 * 第二轮（2026-10-29）仓库主人：「都不像是一个桌面端应用，像是一个手机应用拉长了」。面板的拼法原样铺进窗口就是那个样子，于是每一页改成桌面的排法：
 * 一条页头（标题、状态行、右边几颗控件）；段落是带框的面板，切换「看哪一份」的分段在面板头上而不是通栏；
 * 进程页是撑满窗口的主从两栏（左程序、右它的连接），策略页左边策略组、右边那一组的节点卡。
 *
 * 一次 render 至多 500 个节点：表格的行是 props、不算节点；节点卡一张三个节点，策略页按 {@link maximumCards} 截。
 */
import { layout, ui, type NetworkStatus, type Tint, type UINode } from "@fusionseek/jarvis-extension-sdk";
import { formatBytes, formatDelay, formatRate } from "./clash.js";
import type { Snapshot } from "./core.js";
import { DIRECT_TAG, SELECTOR_TAG, URLTEST_TAG } from "./nodes.js";
import {
  builtinRulesSection,
  currentPageSection,
  delayTint,
  failuresSection,
  notes,
  pageRulesSection,
  subscriptionsSection,
  surgeSection,
} from "./page.js";
import { ruleRows } from "./rule-table.js";
import type { Session, TrafficScope, WindowView } from "./session.js";
import { terminalProxyCommand, type ProxyMode } from "./singbox-config.js";
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

/** 页头状态行的上限（宿主 `headerNodeProps.subtitle` ≤ 120 字）。 */
const subtitleLimit = 120;

/** 「连接」表至多几行（表格的行上限 300）。 */
const connectionRows = 200;

/** 进程表至多几行。 */
const processRows = 300;

/** 规则表至多几行（含最后一行兜底）。 */
const ruleTableRows = 300;

/** 日志面板画多少行（最新的在上）：面板定高约七行，再多也是往下滚着看。 */
const logPanelRows = 200;

/** 24 个小时的横轴。 */
const hourLabels = Array.from({ length: 24 }, (_, hour) => String(hour));
/** 关着时统计卡里那条曲线：一分钟（每秒一个点）全零，画出来是贴底的一条平线。 */
const idleCurve: number[] = new Array(60).fill(0);

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
  switch (session.view) {
    case "processes":
      // 不整页滚（D-7）：主从两栏撑满窗口、表在自己里面滚，日志面板钉在底下。
      return ui.stack({ key: "page:processes", spacing: "loose", children: processesPage(session, snapshot) });
    case "policies":
      return ui.scroll({ key: "page:policies", children: policiesPage(session, snapshot) });
    case "rules":
      return ui.scroll({ key: "page:rules", children: rulesPage(session, snapshot) });
    default:
      return ui.scroll({ key: "page:activity", children: activityPage(session, snapshot) });
  }
}

/** 截到 `limit` 字（页头状态行有上限，出错的原话可能很长）。 */
function clip(text: string, limit = subtitleLimit): string {
  return text.length <= limit ? text : `${text.slice(0, limit - 1)}…`;
}

/**
 * 页头（D-2）：上一个动作的结果（导入、加规则、选节点）在哪一页按的就写在哪一页的状态行里（成功的停几秒，见 `Session.headerMessage`）；没有结果时写这一页的状态。
 * @param session 状态。
 * @param key 节点身份。
 * @param title 页名。
 * @param status 这一页的状态行与点的颜色。
 * @param controls 右边的控件。
 */
function pageHeader(session: Session, key: string, title: string, status: { text: string; tint?: Tint }, controls: UINode[] = []): UINode {
  const message = session.headerMessage(Date.now());
  const line = message ? { text: message.message, tint: (message.ok ? "live" : "alert") as Tint } : status;
  return layout.header({ key, title, subtitle: clip(line.text), ...(line.tint ? { tint: line.tint } : {}), children: controls });
}

/**
 * 段标题在窗口里的写法：去掉面板里那段大写英文（「订阅 · SUBSCRIPTIONS」→「订阅」）。
 * 窗口里段落是一块带框的面板，标题 14pt——面板那种「中文 · 大写英文」是给 376pt 窄条做层级的，进了窗口只是噪声。
 * @param node `page.ts` 里与工具箱共用的那几段。
 * @param title 换一个标题（面板里那段是大写的「SURGE 配置」，窗口里写「Surge 配置」）。
 */
function asPanel(node: UINode, title?: string): UINode {
  if (node.kind !== "section") return node;
  return { ...node, title: title ?? node.title.replace(/ · [A-Z][A-Z0-9 -]*$/, "") };
}

/** 代理此刻的状态（活动页状态行；其余页在没有自己的读数时用它）。 */
function proxyStatus(snapshot: Snapshot): { text: string; tint: Tint } {
  switch (snapshot.phase) {
    case "running": {
      const port = snapshot.control?.mixedPort ?? snapshot.preferences.mixedPort;
      const parts = ["已开启", `127.0.0.1:${port}`, dashboardModeTitles[snapshot.selection.mode]];
      if (snapshot.kernel === "tunnel") parts.push("增强模式");
      return { text: parts.join(" · "), tint: "live" };
    }
    case "failed":
      return { text: "没开起来：看「进程」页的日志", tint: "alert" };
    case "notGranted":
      return { text: "还没有授权", tint: "alert" };
    case "notInstalled":
      return { text: "没有找到 sing-box", tint: "alert" };
    case "noNodes":
      return { text: "还没有节点：在「策略」页下面填订阅地址", tint: "alert" };
    default:
      return { text: `已关闭 · ${dashboardModeTitles[snapshot.selection.mode]}`, tint: "neutral" };
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
  const children: UINode[] = [
    pageHeader(session, "activity-header", "活动", busy ? { text: session.core.busy ?? "", tint: "accent" } : proxyStatus(snapshot), [
      ui.toggle({
        key: "activity-system-proxy",
        title: "系统代理",
        subtitle: running ? (condition.kind === "active" ? `127.0.0.1:${snapshot.control?.mixedPort ?? snapshot.preferences.mixedPort}` : condition.kind === "off" ? "没有接管" : condition.kind === "notGranted" ? "没有授权" : "被拦着") : "代理关着：打开它 = 开启代理",
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
    ]),
  ];
  children.push(...notes(session, snapshot));
  children.push(factsStrip(session, snapshot), layout.grid({ key: "activity-cards", minimum: 180, spacing: "regular", children: activityCards(session, snapshot) }));
  // 两块并排（放得下两块各 420 时），窄了上下排；一行里两块等高，柱子长到面板底。
  // `fill`：窗口比内容高时这一行吃掉剩下的高（宿主 R-2）——稿子按 772 高画，1024 高的窗口里下面不再空一截。
  children.push(layout.grid({ key: "activity-panels", minimum: 420, spacing: "regular", fill: true, children: [trafficSection(session), topSection(session)] }));
  return children;
}

/**
 * 概况条（D-7）：一张卡里一行四格，不再是四个各自带框的读数——四个框加下面四张统计卡，一屏两排框，读起来是一堆格子。
 * @param session 状态。
 * @param snapshot 快照。
 */
function factsStrip(session: Session, snapshot: Snapshot): UINode {
  const running = snapshot.phase === "running";
  const ip = session.externalIP?.ip ?? null;
  const fact = (key: string, label: string, value: string, tint?: Tint, extra: UINode[] = []) => {
    const valueText = ui.text({ key: `${key}:value`, style: "body", text: value, lines: 1, ...(tint ? { tint } : {}) });
    return ui.stack({
      key,
      spacing: "tight",
      children: [
        ui.text({ key: `${key}:label`, style: "footnote", text: label }),
        extra.length > 0 ? ui.stack({ key: `${key}:line`, axis: "horizontal", spacing: "tight", alignment: "center", children: [valueText, ...extra] }) : valueText,
      ],
    });
  };
  return ui.card({
    key: "activity-facts",
    children: [
      layout.grid({
        key: "activity-facts-grid",
        minimum: 160,
        spacing: "loose",
        children: [
          fact("fact-network", "网络", networkText(session.network)),
          fact("fact-profile", "当前配置", profileText(snapshot)),
          fact("fact-mode", "出站模式", dashboardModeTitles[snapshot.selection.mode], running ? "live" : undefined),
          fact("fact-ip", "外部 IP", ip ?? "—", undefined, ip ? [ui.copy({ key: "fact-ip:copy", text: ip, label: "复制外部 IP", variant: "icon" })] : []),
        ],
      }),
    ],
  });
}

function activityCards(session: Session, snapshot: Snapshot): UINode[] {
  const running = snapshot.phase === "running";
  const delay = session.internetDelay;
  const delayTintValue: Tint = delay === undefined ? "neutral" : delay === null ? "danger" : delay < 150 ? "live" : delay < 400 ? "amber" : "alert";
  const latest = (values: number[]) => (values.length > 0 ? values[values.length - 1] : 0);
  const upload = session.reading?.upload ?? latest(session.history.upload);
  const download = session.reading?.download ?? latest(session.history.download);
  // 一张卡：标签、大数字、末一行（说明或一分钟曲线）。`spacer` 把末一行推到卡底：一行四张卡等高，末一行落在同一条线上。
  const card = (key: string, title: string, value: string, tint: Tint, footer: UINode) =>
    ui.card({
      key,
      children: [ui.text({ key: `${key}:title`, style: "footnote", text: title }), ui.text({ key: `${key}:value`, style: "metric", tint, text: value, lines: 1 }), ui.spacer(), footer],
    });
  const caption = (key: string, text: string) => ui.text({ key, style: "footnote", text, lines: 1 });
  // 曲线区一直在（第二轮 R-5）：关着时是一分钟全零的平线——此前换成一行字，四张卡跟着塌矮，和开着时不是一个样子。
  const chart = (key: string, tone: "upload" | "download", values: number[]) => {
    const live = running && values.length > 1;
    const what = tone === "upload" ? "上行" : "下行";
    return ui.chart({ key, series: [{ tone, values: live ? values.slice(-120) : idleCurve }], label: live ? `最近一分钟的${what}` : `代理关着，没有${what}` });
  };
  const processCount = new Set((session.connections?.connections ?? []).map((connection) => processName(connection.process))).size;
  return [
    card("card-latency", "Internet 延迟", running ? (delay === undefined ? "测量中" : delay === null ? "不通" : `${delay} ms`) : "—", running ? delayTintValue : "neutral", caption("card-latency:caption", running ? "经过节点访问 apple.com，每 30 秒测一次" : "代理开着时测")),
    card("card-connections", "活动连接", running && session.connections ? String(session.connections.connections.length) : "—", running ? "accent" : "neutral", caption("card-connections:caption", running && session.connections ? `${processCount} 个程序` : "代理开着时数")),
    card("card-upload", "上行", running ? formatRate(upload) : "—", running ? "amber" : "neutral", chart("card-upload:chart", "upload", session.history.upload)),
    card("card-download", "下行", running ? formatRate(download) : "—", running ? "blue" : "neutral", chart("card-download:chart", "download", session.history.download)),
  ];
}

function trafficSection(session: Session): UINode {
  const stats = session.stats;
  const buckets = stats ? (session.trafficScope === "proxy" ? stats.proxy : stats.all) : null;
  const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);
  const caption = buckets ? `今天${session.trafficScope === "proxy" ? "经过节点" : "一共"} ↓ ${formatBytes(sum(buckets.download))}  ↑ ${formatBytes(sum(buckets.upload))}` : "还没有统计";
  return ui.section({
    key: "traffic",
    title: "今日流量",
    trailing: stats ? `更新于${formatAge(stats.updatedAt, Date.now())}` : undefined,
    segments: [
      { value: "all", title: "全部" },
      { value: "proxy", title: "仅代理", help: "只算出站不是直连的连接" },
    ],
    segment: session.trafficScope,
    segmentLabel: "流量看哪一份",
    onSegment: (value) => session.setTrafficScope(value as TrafficScope),
    children: [
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
    title: "Top 10 · 今天",
    segments: [
      { value: "processes", title: "进程" },
      { value: "domains", title: "域名" },
      { value: "policies", title: "策略" },
    ],
    segment: category,
    segmentLabel: "Top 10 看哪一类",
    onSegment: (value) => session.setTopCategory(value as UsageCategory),
    children: [
      layout.table({
        key: `top-table:${category}`,
        label: "今天流量最多的十个",
        columns: [
          { title: category === "processes" ? "进程与设备" : category === "domains" ? "域名" : "策略", width: "fill" },
          { title: "连接", width: "narrow", alignment: "trailing" },
          { title: "↑", width: "narrow", alignment: "trailing" },
          { title: "↓", width: "narrow", alignment: "trailing" },
          { title: "合计", width: "narrow", alignment: "trailing" },
        ],
        rows: rows.map(([name, usage]) => ({
          cells: [category === "policies" ? policyName(name) : name, String(usage.connections), formatBytes(usage.upload), formatBytes(usage.download), formatBytes(usage.upload + usage.download)],
        })),
        // 跟着面板长（第二轮 R-5）：那一行撑满时表也撑满，空着时提示在正中。
        scroll: true,
        emptyText: "代理开着时后台会记今天的流量，每分钟更新一次",
      }),
    ],
  });
}

// MARK: - 进程

/** 一条连接属于哪个程序（与进程表同一种写法）。 */
function processName(path: string): string {
  return path.split("/").pop() || "—";
}

type Connection = NonNullable<Session["connections"]>["connections"][number];

function processesPage(session: Session, snapshot: Snapshot): UINode[] {
  const running = snapshot.phase === "running";
  const query = session.processFilter.trim().toLowerCase();
  const data = session.connections;
  const all = data ? [...data.connections].sort((a, b) => b.start - a.start) : [];
  const matches = (connection: Connection) => !query || connection.host.toLowerCase().includes(query) || processName(connection.process).toLowerCase().includes(query);
  // 搜的是程序名或主机：一个程序只要有一条连接对得上就留下。
  const matchedProcesses = new Set(all.filter(matches).map((connection) => processName(connection.process)));
  const processes = session.processes.filter((row) => !query || row.name.toLowerCase().includes(query) || matchedProcesses.has(row.name)).slice(0, processRows);
  const selected = session.processSelection;
  const connections = all.filter((connection) => matches(connection) && (selected === null || processName(connection.process) === selected)).slice(0, connectionRows);
  const download = session.processes.reduce((total, row) => total + row.download, 0);
  const upload = session.processes.reduce((total, row) => total + row.upload, 0);
  const status: { text: string; tint: Tint } =
    running && data ? { text: `${session.processes.length} 个程序 · ${data.connections.length} 条连接 · ↓ ${formatRate(download)}  ↑ ${formatRate(upload)}`, tint: "live" } : proxyStatus(snapshot);
  const children: UINode[] = [
    pageHeader(session, "processes-header", "进程", status, [
      ui.search({ key: "process-search", value: session.processFilter, placeholder: "搜索程序或主机", label: "搜索程序或主机", onChange: (value) => session.searchProcesses(value) }),
    ]),
  ];
  const failures = failuresSection(session);
  if (failures) children.push(asPanel(failures));
  children.push(
    layout.grid({
      key: "processes-split",
      minimum: 360,
      spacing: "regular",
      weights: [2, 3],
      fill: true,
      children: [
        ui.section({
          key: "processes",
          title: "程序",
          trailing: query ? `${processes.length} / ${session.processes.length}` : `${session.processes.length} 个`,
          children: [
            layout.table({
              key: "process-table",
              label: "每个程序此刻的速率",
              scroll: true,
              ...(selected !== null ? { selection: selected } : {}),
              onSelect: (name) => session.selectProcess(name),
              columns: [
                { title: "程序", width: "fill" },
                { title: "连接", width: "narrow", alignment: "trailing" },
                { title: "↓", width: "narrow", alignment: "trailing" },
                { title: "↑", width: "narrow", alignment: "trailing" },
              ],
              rows: processes.map((row) => ({
                id: row.name,
                cells: [row.name, String(row.connections), formatRate(row.download), formatRate(row.upload)],
                ...(row.upload + row.download === 0 ? { tint: "neutral" as Tint } : {}),
              })),
              emptyText: running ? (query ? "没有对得上的程序" : "此刻没有连接") : "代理没开",
            }),
          ],
        }),
        connectionsSection(session, snapshot, connections, selected),
      ],
    }),
    logsPanel(session),
  );
  return children;
}

function connectionsSection(session: Session, snapshot: Snapshot, list: Connection[], selected: string | null): UINode {
  const data = session.connections;
  const download = list.reduce((total, connection) => total + connection.download, 0);
  const upload = list.reduce((total, connection) => total + connection.upload, 0);
  const chain = (chains: string[]) => (chains.length > 0 ? [...chains].reverse().map(policyName).join(" → ") : "—");
  return ui.section({
    key: "connections-section",
    title: selected === null ? "连接 · 全部程序" : `连接 · ${selected}`,
    ...(data ? { trailing: `${list.length} 条 · ↓ ${formatBytes(download)}  ↑ ${formatBytes(upload)}` } : {}),
    actions: selected !== null ? [{ id: "show-all", title: "全部程序", symbol: "xmark.circle", help: "回到全部程序的连接", onPress: () => session.selectProcess(selected) }] : [],
    children: [
      layout.table({
        key: "connections",
        label: "此刻的连接",
        scroll: true,
        // 全部程序时第二列是程序；选了一个程序时程序是废话，换成规则。
        columns: [{ title: "主机", width: "fill" }, { title: selected === null ? "程序" : "规则" }, { title: "策略" }, { title: "↓", width: "narrow", alignment: "trailing" }, { title: "↑", width: "narrow", alignment: "trailing" }],
        rows: list.map((connection) => ({
          cells: [connection.host || "（没有主机名）", selected === null ? processName(connection.process) : connection.rule || "—", chain(connection.chains), formatBytes(connection.download), formatBytes(connection.upload)],
        })),
        emptyText: snapshot.phase === "running" ? (selected === null ? "此刻没有连接，每秒刷新一次" : `${selected} 此刻没有连接`) : "开启之后，经过代理的每一条连接都会列在这里",
      }),
    ],
  });
}

/** 日志面板：定高、最新的在上（面板只露七行，往下滚是更早的）。 */
function logsPanel(session: Session): UINode {
  const tail = session.logs.slice(-logPanelRows).reverse();
  let text = tail.join("\n");
  if (text.length > 19_000) text = text.slice(0, 19_000);
  return ui.section({
    key: "logs-section",
    title: "日志",
    trailing: `${session.logs.length} 行 · 最新的在上`,
    actions: [{ id: "reload", title: "重读", symbol: "arrow.clockwise", help: "重读 sing-box 最近 500 行输出", onPress: () => void session.showView("processes") }],
    children: [ui.editor({ key: "log-text", value: text, placeholder: "sing-box 还没有输出", label: "sing-box 日志", mono: true, readOnly: true, rows: 7 })],
  });
}

// MARK: - 策略

/** 左栏的一组：节点选择（订阅的全部节点）或导入的一个 Surge 策略组。 */
interface PolicyGroupEntry {
  name: string;
  /** 组员数。 */
  count: number;
  /** 此刻选中的那一个（给人看的名字）。 */
  selected: string;
}

function policyGroups(session: Session, snapshot: Snapshot): PolicyGroupEntry[] {
  const running = snapshot.phase === "running";
  const selectorPick = snapshot.selection.node === URLTEST_TAG && running && session.autoPick ? `${URLTEST_TAG} → ${session.autoPick}` : snapshot.selection.node;
  return [
    { name: SELECTOR_TAG, count: snapshot.nodes.length, selected: selectorPick },
    ...snapshot.groups.map((group) => ({ name: group.name, count: group.members.length, selected: memberTitle(group.selected) })),
  ];
}

function policiesPage(session: Session, snapshot: Snapshot): UINode[] {
  const running = snapshot.phase === "running";
  const mode = snapshot.selection.mode;
  const groups = policyGroups(session, snapshot);
  const current = groups.find((group) => group.name === session.policyGroup) ?? groups[0];
  const status: { text: string; tint: Tint } = {
    text: mode === "direct" ? "直接连接：不经过节点，下面的选择照样记着，换回别的模式时生效" : `${dashboardModeTitles[mode]} · ${SELECTOR_TAG} → ${groups[0].selected}`,
    tint: running ? "live" : "neutral",
  };
  const children: UINode[] = [
    pageHeader(session, "policies-header", "策略", status, [
      ui.segmented({
        key: "policy-mode-picker",
        label: "出站模式",
        layout: "compact",
        value: mode,
        options: (["direct", "global", "rule"] as const).map((value) => ({ value, title: dashboardModeTitles[value], help: modeHelps[value] })),
        onChange: (value) => void session.setMode(value as ProxyMode),
      }),
      ui.button({
        key: "test-all",
        title: "全部测速",
        symbol: "speedometer",
        variant: "secondary",
        size: "bar",
        help: running ? "测一遍全部节点的延迟" : "代理开着才能测速",
        disabled: !running || session.core.busy !== null,
        onPress: () => void session.test(),
      }),
    ]),
  ];
  if (snapshot.nodes.length === 0) {
    children.push(ui.empty({ key: "no-nodes", symbol: "server.rack", title: "还没有节点", hint: "在下面「订阅」里填订阅地址，拉下来就有了。" }));
  } else {
    children.push(
      layout.grid({
        key: "policies-split",
        minimum: 240,
        spacing: "regular",
        weights: [1, 3],
        // 窗口比内容高时这一行吃掉剩下的高（第二轮 R-5）：策略组与节点两块面板长到订阅那一行上面，而不是整页下面空一截。
        fill: true,
        children: [
          ui.section({
            key: "policy-groups",
            title: "策略组",
            trailing: `${groups.length} 个`,
            children: [
              ui.list({
                key: "policy-group-list",
                children: groups.map((group) =>
                  ui.row({
                    key: `policy-group:${group.name}`,
                    symbol: group.name === SELECTOR_TAG ? "point.3.connected.trianglepath.dotted" : "square.stack.3d.up",
                    title: group.name,
                    subtitle: `${group.count} 个 · ${group.selected}`,
                    selected: group.name === current.name,
                    onPress: () => session.showPolicyGroup(group.name),
                  }),
                ),
              }),
            ],
          }),
          current.name === SELECTOR_TAG ? selectorPanel(session, snapshot) : groupPanel(session, snapshot, current.name),
        ],
      }),
    );
  }
  children.push(
    layout.grid({
      key: "policies-bottom",
      minimum: 300,
      spacing: "regular",
      weights: [2, 1],
      children: [asPanel(subscriptionsSection(session, snapshot, true)), terminalPanel(snapshot)],
    }),
  );
  return children;
}

/** 「节点选择」：自动选择 + 订阅的全部节点，一张卡一个。 */
function selectorPanel(session: Session, snapshot: Snapshot): UINode {
  const running = snapshot.phase === "running";
  const query = session.filter.trim().toLowerCase();
  const matched = query ? snapshot.nodes.filter((node) => node.name.toLowerCase().includes(query) || node.protocol.includes(query)) : snapshot.nodes;
  const autoSelected = snapshot.selection.node === URLTEST_TAG;
  const cards: UINode[] = [
    nodeCard(session, `node:${URLTEST_TAG}`, URLTEST_TAG, running && autoSelected && session.autoPick ? `此刻用「${session.autoPick}」` : "按延迟自动挑最快的", undefined, autoSelected, () => void session.pickNode(URLTEST_TAG)),
  ];
  for (const node of matched.slice(0, maximumCards - 1)) {
    const delay = snapshot.latency.values[node.name];
    cards.push(nodeCard(session, `node:${node.name}`, node.name, [protocolTitles[node.protocol], formatDelay(delay)].filter((part) => part).join(" · "), delayTint(delay), snapshot.selection.node === node.name, () => void session.pickNode(node.name)));
  }
  const children: UINode[] = [];
  if (snapshot.nodes.length > 8) {
    children.push(ui.search({ key: "node-search", value: session.filter, placeholder: "搜索节点", label: "搜索节点", onChange: (value) => session.search(value) }));
  }
  children.push(layout.grid({ key: "node-cards", minimum: 200, spacing: "tight", children: cards }));
  if (matched.length > cards.length - 1) children.push(ui.text({ key: "nodes-more", style: "footnote", text: `另有 ${matched.length - (cards.length - 1)} 个没画出来：用搜索找` }));
  return ui.section({
    key: "policy-selector",
    title: `${SELECTOR_TAG} · ${snapshot.nodes.length} 个节点`,
    trailing: snapshot.latency.testedAt ? `测于${formatAge(snapshot.latency.testedAt, Date.now())}` : "还没测过",
    children,
  });
}

/** 导入的一个 Surge 策略组：组员一张卡一个。 */
function groupPanel(session: Session, snapshot: Snapshot, name: string): UINode {
  const group = snapshot.groups.find((candidate) => candidate.name === name);
  if (!group) return selectorPanel(session, snapshot);
  return ui.section({
    key: `policy-group-panel:${group.name}`,
    title: `${group.name} · ${group.members.length} 个`,
    ...(snapshot.surge ? { trailing: `来自 ${snapshot.surge.sourceName}` } : {}),
    children: [
      layout.grid({
        key: `group-cards:${group.name}`,
        minimum: 200,
        spacing: "tight",
        children: group.members.slice(0, maximumCards).map((member) => {
          const delay = snapshot.latency.values[member.tag];
          return nodeCard(session, `group:${group.name}:${member.tag}`, memberTitle(member.title), formatDelay(delay) || (member.tag === DIRECT_TAG ? "直连" : ""), delayTint(delay), group.selected === member.tag, () => void session.pickGroupMember(group, member.tag));
        }),
      }),
    ],
  });
}

/** 一张节点卡：名字一行、读数一行；选中的高亮。点它 = 选它并测它。 */
function nodeCard(session: Session, key: string, title: string, detail: string, tint: Tint | undefined, selected: boolean, onPress: () => void): UINode {
  return ui.card({
    key,
    ...(selected ? { tint: "accent" as Tint } : {}),
    onPress: session.core.busy === null ? onPress : undefined,
    children: [
      ui.text({ key: `${key}:name`, style: "title", text: title, lines: 1 }),
      ui.text({ key: `${key}:detail`, style: "footnote", text: selected ? `已选 · ${detail || "点一下测速"}` : detail || "点一下选它并测速", lines: 1, ...(tint ? { tint } : {}) }),
    ],
  });
}

/** 终端代理：一句说明 + 命令本身 + 复制（工具箱里是同一句，窗口里是一块面板）。 */
function terminalPanel(snapshot: Snapshot): UINode {
  const command = terminalProxyCommand(snapshot.control?.mixedPort ?? snapshot.preferences.mixedPort);
  return ui.section({
    key: "terminal",
    title: "终端代理",
    children: [
      ui.text({ key: "terminal-help", style: "footnote", text: "命令行工具不读系统代理：在终端里粘贴这一行，这个终端里的 curl、git、brew 就会经过代理。" }),
      ui.text({ key: "terminal-command", style: "mono", text: command, selectable: true }),
      ui.copy({ key: "terminal-copy", text: command, label: "复制终端代理命令", variant: "chip" }),
    ],
  });
}

// MARK: - 规则

function rulesPage(session: Session, snapshot: Snapshot): UINode[] {
  const plan = session.routes;
  const children: UINode[] = [];
  if (plan) {
    const titles = new Map((snapshot.surge?.ruleSets ?? []).map((ref) => [ref.tag, ref.url.split("/").pop() || ref.host]));
    const rows = ruleRows(plan, session.ruleHits?.counts ?? {}, titles);
    const shown = rows.length > ruleTableRows ? [...rows.slice(0, ruleTableRows - 1), rows[rows.length - 1]] : rows;
    const total = rows.reduce((sum, row) => sum + row.hits, 0);
    children.push(pageHeader(session, "rules-header", "规则", { text: `${rows.length} 条 · 本次开启以来 ${total} 条连接`, tint: snapshot.phase === "running" ? "live" : "neutral" }));
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
    children.push(ui.section({ key: "rule-table-section", title: "生效的规则", trailing: `${rows.length} 条`, children: tableChildren }));
  } else {
    children.push(pageHeader(session, "rules-header", "规则", { text: "正在读取规则", tint: "neutral" }));
  }
  children.push(
    layout.grid({
      key: "rules-tools",
      minimum: 360,
      spacing: "regular",
      children: [asPanel(currentPageSection(session, snapshot)), asPanel(pageRulesSection(session, snapshot))],
    }),
    asPanel(surgeSection(session, snapshot), "Surge 配置"),
    asPanel(builtinRulesSection(snapshot)),
  );
  return children;
}
