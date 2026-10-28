/**
 * 工具箱那一页与窗口标签（P-9「界面」；增强模式、策略组、规则页见 jarvis-mac `specs/20261028-111714-proxy-tun-orb-traffic-page-rules` T-10）。
 *
 * 工具箱 368pt 宽、一屏：状态与总开关（含增强模式）→ 卡住时的那一屏说明 → 模式 → 节点 → 策略组 → 规则 → 订阅 → 终端代理命令。
 * 窗口在同样的状态段之下多一排「节点 / 连接 / 规则 / 日志 / 订阅」五页。
 *
 * 卡住的五种情形（没授权、没装 sing-box、没有订阅、内核起不来、系统代理被别的工具拦着）各一张 `note`：
 * 拿不到什么、为什么、还剩哪几条路——不是一句红字。整页至多一颗实心主按钮：卡住时它就是那张说明卡上的出路。
 */
import { ui, type ActionSpec, type Tint, type UINode } from "@fusionseek/jarvis-extension-sdk";
import { formatBytes, formatDelay, formatRate } from "./clash.js";
import type { Snapshot } from "./core.js";
import { URLTEST_TAG, type ProxyNode } from "./nodes.js";
import { pageRuleFor, policyTitle, registrableDomain, type PolicyRef } from "./rules.js";
import type { Session, WindowView } from "./session.js";
import { terminalProxyCommand, type ProxyMode } from "./singbox-config.js";
import {
  memberTitle,
  modeHelps,
  modeTitles,
  protocolTitles,
  reloadReasons,
  restartReasons,
  statusLine,
  systemProxyCondition,
  tunSubtitle,
  wantsTunnel,
} from "./status.js";
import { describeUsage, formatAge, nodesDigest } from "./store.js";
import { convertedCount } from "./surge.js";
import { shortRate } from "./traffic.js";

/** 工具箱里节点至多列几行：再多就该用搜索或去窗口里看，一屏几百行谁也找不到要的那个。 */
const toolboxNodeRows = 60;
/** 窗口里节点至多列几行（一次 render ≤ 500 个节点，留出其余的位置）。 */
const windowNodeRows = 300;
/** 「连接」那一页至多列几条。 */
const connectionRows = 200;
/** 「日志」那一页给多少行。 */
const logRows = 200;
/** 「规则」页列多少条页面规则（一次 render ≤ 500 个节点）。 */
const pageRuleRows = 120;
/** 「连接」页顶上列多少条失败的请求。 */
const failedRows = 20;

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
          { value: "rules", title: "规则" },
          { value: "logs", title: "日志" },
          { value: "subscriptions", title: "订阅" },
        ],
        onChange: (value) => void session.showView(value as WindowView),
      }),
    );
    children.push(...windowView(session, snapshot));
  } else {
    if (snapshot.nodes.length > 0) children.push(modeSection(session, snapshot), nodesSection(session, snapshot, toolboxNodeRows));
    if (snapshot.groups.length > 0) children.push(groupsSection(session, snapshot));
    children.push(rulesSummarySection(session, snapshot), subscriptionsSection(session, snapshot, false), commandSection(snapshot));
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
      subtitle: statusLine({ ...snapshot, busy, kernel: snapshot.kernel }),
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
  if (snapshot.phase !== "notGranted") {
    const tunActive = snapshot.kernel === "tunnel";
    const subtitle = tunSubtitle({ ...snapshot.tun, active: tunActive }) ?? "开着时整机网络经过 sing-box，命令行工具与不认系统代理的应用也管得到";
    children.push(
      ui.toggle({
        key: "tun",
        title: "增强模式（TUN）",
        subtitle,
        value: running ? tunActive : snapshot.tun.wanted,
        disabled: busy !== null || !snapshot.tun.granted || snapshot.phase === "notInstalled",
        onChange: (on) => void session.setTun(on),
      }),
    );
  }
  if (running && session.reading) {
    children.push(
      ui.text({
        key: "reading",
        style: "footnote",
        tint: session.reading.failed > 0 && session.reading.failed >= session.reading.succeeded ? "alert" : "neutral",
        text: `有效 ↓ ${shortRate(session.reading.download)}B/s  ↑ ${shortRate(session.reading.upload)}B/s · 10 秒内成功 ${session.reading.succeeded}、失败 ${session.reading.failed}`,
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
      const wantedKernel = wantsTunnel(snapshot.selection, snapshot.preferences) ? "tunnel" : "daemon";
      const restart = restartReasons(snapshot.control, snapshot.preferences, wantedKernel);
      const reload = reloadReasons(snapshot.control, snapshot.preferences, nodesDigest(snapshot.nodes), snapshot.rulesDigest);
      if (restart.length > 0) {
        out.push(
          ui.note({
            key: "restart",
            tint: "blue",
            symbol: "arrow.triangle.2.circlepath",
            title: "重新开启之后生效",
            body: `${restart.join("、")}；在跑的这一份还是旧的。重新开启会断开现有连接一下。`,
            actions: [action("restart", "重新开启", () => void session.restart(), { disabled: session.core.busy !== null })],
          }),
        );
      } else if (reload.length > 0) {
        out.push(
          ui.note({
            key: "reload",
            tint: "blue",
            symbol: "arrow.clockwise",
            title: "重新载入之后生效",
            body: `${reload.join("、")}；在跑的这一份还是旧的。重新载入不断开连接、不动系统代理。`,
            actions: [action("reload", "重新载入", () => void session.reload(), { disabled: session.core.busy !== null })],
          }),
        );
      }
      break;
    }
  }
  out.push(...tunNotes(session, snapshot));
  return out;
}

/** 增强模式要说的几件事：没授权、被别的 VPN 拦着、要输管理员密码。 */
function tunNotes(session: Session, snapshot: Snapshot): UINode[] {
  if (snapshot.phase === "notGranted" || snapshot.phase === "notInstalled") return [];
  const wanted = wantsTunnel(snapshot.selection, snapshot.preferences);
  if (!wanted || snapshot.kernel === "tunnel") return [];
  if (!snapshot.tun.granted) {
    return [
      ui.note({
        key: "tun-not-granted",
        tint: "alert",
        symbol: "lock.shield",
        title: "增强模式还没有授权",
        body: "增强模式以管理员身份运行 sing-box、接管整机网络：命令行工具和不认系统代理的应用也会经过它。第一次打开时还要你输一次管理员密码，装上 Jarvis 的网络助手。",
        actions: [
          { id: "grant-tun", title: "授权", onPress: () => void session.grantTunnel() },
          { id: "tun-off", title: "改用系统代理模式", onPress: () => void session.setTun(false) },
        ],
      }),
    ];
  }
  if (snapshot.tun.blocker) {
    return [
      ui.note({
        key: "tun-blocked",
        tint: "alert",
        symbol: "hand.raised",
        title: "增强模式被别的 VPN 拦着",
        body: `${snapshot.tun.blocker}\n两个 TUN 同时接管网络会互相抢路由。先关掉它，再打开这里的增强模式；或者改用系统代理模式。`,
        actions: [{ id: "tun-off", title: "改用系统代理模式", onPress: () => void session.setTun(false) }],
      }),
    ];
  }
  const subtitle = tunSubtitle({ ...snapshot.tun, active: false });
  if (subtitle && snapshot.phase !== "running") {
    return [ui.note({ key: "tun-password", tint: "blue", symbol: "key", title: "增强模式要一次管理员授权", body: `${subtitle}。系统会弹出密码框，那是 macOS 自己的窗口。网络助手可以在 设置 · 扩展 ·「代理」里卸掉。` })];
  }
  return [];
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

// MARK: - 策略组

function groupsSection(session: Session, snapshot: Snapshot): UINode {
  return ui.section({
    key: "groups",
    title: "策略组 · GROUPS",
    trailing: snapshot.surge ? `来自 ${snapshot.surge.sourceName}` : undefined,
    children: snapshot.groups.map((group) =>
      ui.picker({
        key: `group:${group.name}`,
        label: group.name,
        value: group.selected,
        layout: "full",
        options: group.members.map((member) => ({ value: member.tag, title: memberTitle(member.title) })),
        onChange: (value) => void session.selectGroupMember(group, value),
      }),
    ),
  });
}

// MARK: - 规则

/** 工具箱里那一段：数字与两个入口（完整的在窗口「规则」页）。 */
function rulesSummarySection(session: Session, snapshot: Snapshot): UINode {
  const parts = [`${snapshot.pageRules.length} 条页面规则`];
  if (snapshot.surge) parts.push(snapshot.preferences.useSurgeRules ? `Surge 配置「${snapshot.surge.sourceName}」` : `导入了 Surge 配置（设置里关着）`);
  else parts.push(snapshot.preferences.chinaRules ? "内置：局域网与中国大陆直连" : "内置：只有局域网直连");
  return ui.section({
    key: "rules-summary",
    title: "规则 · RULES",
    actions: [
      { id: "import", title: "导入 Surge 配置", symbol: "square.and.arrow.down", help: "挑一份 Surge 的 .conf，把规则、策略组与 TUN 相关的设置转成 sing-box", onPress: () => void session.importSurge() },
    ],
    children: [
      ui.row({ key: "rules-open", symbol: "list.bullet.rectangle", title: "规则与当前页面", subtitle: parts.join(" · "), accessory: "chevron", onPress: () => session.openWindow("rules") }),
    ],
  });
}

/** 一个域名可选的策略（chip 一排）。 */
function policyChips(session: Session, snapshot: Snapshot, keyPrefix: string, domain: string): UINode {
  const rule = pageRuleFor(snapshot.pageRules, domain);
  const policies: PolicyRef[] = ["proxy", "direct", "reject", ...snapshot.groups.map((group) => `group:${group.name}` as PolicyRef)];
  const chips: UINode[] = policies.map((policy) =>
    ui.chip({
      key: `${keyPrefix}:${policy}`,
      title: policyTitle(policy),
      selected: rule?.policy === policy,
      disabled: session.core.busy !== null,
      onPress: () => void session.setPageRule(domain, rule?.policy === policy ? null : policy),
    }),
  );
  return ui.stack({ key: `${keyPrefix}:chips`, axis: "horizontal", spacing: "tight", children: chips });
}

function currentPageSection(session: Session, snapshot: Snapshot): UINode {
  const page = session.currentPage;
  const children: UINode[] = [];
  if (!page) {
    children.push(ui.text({ key: "page-hint", style: "footnote", text: "读前台浏览器（Safari、Chrome、Edge、Arc、Brave）当前标签的地址，再加上它最近 30 秒连过的域名，一键给它们定「走代理 / 直连 / 拒绝」。第一次读某个浏览器时系统会问一次「自动化」授权。" }));
  } else {
    if (page.status !== "ok") children.push(ui.text({ key: "page-status", style: "footnote", tint: "alert", text: page.message || "读不到地址" }));
    else children.push(ui.text({ key: "page-where", style: "footnote", text: `${page.browser ?? "浏览器"} · ${page.host}` }));
    for (const [index, domain] of page.domains.entries()) {
      const parts = [`${domain.connections} 条连接`];
      if (domain.failed > 0) parts.push(`${domain.failed} 失败`);
      if (domain.route) parts.push(`此刻 ${memberTitle(domain.route)}`);
      if (domain.hosts.length > 0) parts.push(domain.hosts.join("、"));
      children.push(
        ui.row({ key: `page-domain:${index}`, symbol: domain.isPage ? "globe" : "link", title: domain.domain, subtitle: parts.join(" · "), ...(domain.failed > 0 ? { tint: "alert" as Tint } : {}) }),
        policyChips(session, snapshot, `page-policy:${index}`, domain.domain),
      );
    }
    if (page.domains.length === 0 && page.status === "ok") children.push(ui.text({ key: "page-empty", style: "footnote", text: "这一页还没有经过代理的连接：代理开着时刷新一下页面再读。" }));
  }
  return ui.section({
    key: "current-page",
    title: "当前页面 · PAGE",
    actions: [{ id: "read-page", title: page ? "重读" : "读取当前页面", symbol: "safari", disabled: session.core.busy !== null, onPress: () => void session.readPage() }],
    children,
  });
}

function pageRulesSection(session: Session, snapshot: Snapshot): UINode {
  const shown = snapshot.pageRules.slice(0, pageRuleRows);
  const now = Date.now();
  const children: UINode[] = [
    ui.list({
      key: "page-rules",
      children: shown.map((rule) =>
        ui.row({
          key: `page-rule:${rule.id}`,
          symbol: rule.policy === "reject" ? "nosign" : rule.policy === "direct" ? "arrow.right" : "point.3.connected.trianglepath.dotted",
          title: rule.value,
          subtitle: `${rule.kind === "domain_suffix" ? "含子域名" : "只这一个"} · ${policyTitle(rule.policy)}${rule.createdAt ? ` · ${formatAge(rule.createdAt, now)}` : ""}`,
          actions: [
            ...(["proxy", "direct", "reject"] as const)
              .filter((policy) => policy !== rule.policy)
              .map((policy) => ({ id: policy, title: policyTitle(policy), onPress: () => void session.setPageRule(rule.value, policy) })),
            { id: "delete", title: "删除", symbol: "trash", tint: "danger" as Tint, onPress: () => void session.removePageRule(rule.id) },
          ],
        }),
      ),
      emptyState: ui.empty({ key: "no-page-rules", symbol: "list.bullet.rectangle", title: "还没有页面规则", hint: "在菜单栏「当前页面」「最近请求」里，或上面那一段，给网站定走代理还是直连。" }),
    }),
  ];
  if (snapshot.pageRules.length > shown.length) children.push(ui.text({ key: "page-rules-more", style: "footnote", text: `另有 ${snapshot.pageRules.length - shown.length} 条没列出来` }));
  return ui.section({ key: "page-rules-section", title: "页面规则 · PAGE RULES", trailing: `${snapshot.pageRules.length} 条 · 排在所有规则之前`, children });
}

function surgeSection(session: Session, snapshot: Snapshot): UINode {
  const surge = snapshot.surge;
  const busy = session.core.busy !== null;
  const actions: ActionSpec[] = [{ id: "import", title: surge ? "重新导入" : "导入 Surge 配置", symbol: "square.and.arrow.down", disabled: busy, onPress: () => void session.importSurge() }];
  if (!surge) {
    return ui.section({
      key: "surge",
      title: "SURGE 配置 · IMPORT",
      actions,
      children: [
        ui.text({
          key: "surge-hint",
          style: "footnote",
          text: "挑一份 Surge 的 .conf：[Rule] 里的域名、IP、GEOIP、进程、逻辑规则与外部规则集，[Proxy Group] 的策略组，[General] 里 TUN 相关的几项（tun-excluded-routes、bypass-tun、always-real-ip、dns-server、skip-proxy）与 [Host] 都会转成 sing-box。USER-AGENT、URL Rewrite、MITM、Script 转不了，导入后逐类列出来。节点仍然来自订阅。",
        }),
      ],
    });
  }
  actions.push({ id: "clear", title: "撤掉", symbol: "trash", tint: "danger", disabled: busy, onPress: () => void session.clearSurge() });
  const report = surge.report;
  const children: UINode[] = [
    ui.readout({ key: "surge-rules", label: "规则", value: `${convertedCount(report)} / ${report.ruleLines} 条转成 sing-box（合并成 ${report.compiledRules} 条）` }),
    ui.readout({ key: "surge-groups", label: "策略组", value: surge.groups.length > 0 ? surge.groups.map((group) => group.name).join("、") : "没有" }),
    ui.readout({
      key: "surge-tun",
      label: "TUN",
      value: `不进 TUN 的路由 ${surge.general.tunExcludedRoutes.length + surge.general.bypassTun.length} 条 · 真实 IP 域名 ${surge.general.alwaysRealIP.length} 个 · DNS ${surge.general.dnsServers.join("、") || "默认"}`,
    }),
  ];
  if (!snapshot.preferences.useSurgeRules) {
    children.push(ui.text({ key: "surge-off", style: "footnote", tint: "alert", text: "设置里「使用导入的 Surge 规则」关着：此刻用的是内置规则。" }));
  }
  if (surge.ruleSets.length > 0) {
    const records = new Map(snapshot.ruleSetRecords.map((record) => [record.tag, record]));
    const allowed = new Set(snapshot.ruleSetURLs);
    const missing = surge.ruleSets.filter((ref) => !allowed.has(ref.url)).map((ref) => ref.url);
    children.push(
      ui.list({
        key: "rule-sets",
        children: surge.ruleSets.map((ref) => {
          const record = records.get(ref.tag);
          const name = ref.url.split("/").pop() || ref.host;
          const subtitle = !allowed.has(ref.url)
            ? "没贴进「规则集地址」：这一组规则暂时跳过"
            : record?.error
              ? `没拉到：${record.error}`
              : record?.fetchedAt
                ? `${record.total} 条 · 拉于${formatAge(record.fetchedAt, Date.now())}${record.skipped > 0 ? ` · ${record.skipped} 条转不了` : ""}`
                : "还没拉";
          return ui.row({ key: `rule-set:${ref.tag}`, symbol: record?.fetchedAt ? "checklist" : "exclamationmark.triangle", title: name, subtitle, ...(record?.fetchedAt ? {} : { tint: "amber" as Tint }) });
        }),
      }),
    );
    if (missing.length > 0) {
      children.push(
        ui.text({ key: "rule-sets-help", style: "footnote", text: `${missing.length} 个外部规则集要联网拉，地址来自你挑的文件——Jarvis 只放行你亲手填进设置的地址。复制下面这些，贴进 设置 · 扩展 ·「代理」·「规则集地址」（一次贴多行会拆成多条）。` }),
        ui.copy({ key: "rule-sets-copy", text: missing.join("\n"), label: "复制这些地址", variant: "chip" }),
      );
    }
    actions.push({ id: "update-sets", title: "拉规则集", symbol: "arrow.clockwise", disabled: busy || missing.length === surge.ruleSets.length, onPress: () => void session.updateRuleSets() });
  }
  if (report.unsupported.length > 0) {
    children.push(
      ui.list({
        key: "surge-unsupported",
        children: report.unsupported.map((kind) =>
          ui.row({
            key: `unsupported:${kind.kind}`,
            symbol: "xmark.circle",
            title: `${kind.kind} · ${kind.count} 项`,
            subtitle: kind.samples.length > 0 ? `${kind.reason}：${kind.samples.slice(0, 2).join("；")}` : kind.reason,
          }),
        ),
      }),
    );
  }
  return ui.section({ key: "surge", title: "SURGE 配置 · IMPORT", trailing: `${surge.sourceName} · 导入于${formatAge(surge.importedAt, Date.now())}`, actions, children });
}

function builtinRulesSection(snapshot: Snapshot): UINode {
  const lines = ["局域网（私有地址、localhost、.local）一律直连", "出站模式「全局」「直连」排在页面规则之前"];
  if (!snapshot.surge || !snapshot.preferences.useSurgeRules) lines.push(snapshot.preferences.chinaRules ? "中国大陆的域名与 IP 直连（geosite-cn、geoip-cn）" : "「中国大陆直连」关着：除局域网外都走节点");
  lines.push(snapshot.kernel === "tunnel" ? "增强模式：DNS 由 sing-box 答（fake-ip / 真实 IP 见设置），always-real-ip 的域名给真实地址" : "其余走「节点选择」");
  return ui.section({ key: "builtin-rules", title: "内置 · BUILT-IN", children: lines.map((line, index) => ui.text({ key: `builtin:${index}`, style: "footnote", text: `· ${line}` })) });
}

function rulesView(session: Session, snapshot: Snapshot): UINode[] {
  return [currentPageSection(session, snapshot), pageRulesSection(session, snapshot), surgeSection(session, snapshot), builtinRulesSection(snapshot)];
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
    case "rules":
      return rulesView(session, snapshot);
    case "logs":
      return [logsSection(session)];
    case "subscriptions":
      return [subscriptionsSection(session, snapshot, true), commandSection(snapshot)];
    default:
      return snapshot.nodes.length > 0
        ? [modeSection(session, snapshot), nodesSection(session, snapshot, windowNodeRows), ...(snapshot.groups.length > 0 ? [groupsSection(session, snapshot)] : [])]
        : [];
  }
}

/** 一条连接 / 请求上的「加规则」那几个动作（按可注册域名）。 */
function ruleActions(session: Session, host: string): ActionSpec[] {
  const domain = registrableDomain(host.replace(/:\d+$/, ""));
  if (!domain) return [];
  return (["proxy", "direct", "reject"] as const).map((policy) => ({ id: policy, title: `${domain} ${policyTitle(policy)}`, onPress: () => void session.setPageRule(domain, policy) }));
}

function connectionsSection(session: Session, snapshot: Snapshot): UINode {
  const failures = session.meter.recent(Date.now(), 200).filter((attempt) => attempt.outcome === "failed").slice(0, failedRows);
  const failedSection =
    failures.length > 0
      ? ui.section({
          key: "failed-section",
          title: "失败 · FAILED",
          tint: "alert",
          trailing: `最近 ${failures.length} 条`,
          children: [
            ui.list({
              key: "failed",
              children: failures.map((attempt) =>
                ui.row({
                  key: `failed:${attempt.id}`,
                  symbol: "xmark.octagon",
                  tint: "alert",
                  title: attempt.port ? `${attempt.host}:${attempt.port}` : attempt.host,
                  subtitle: [attempt.reason, attempt.process.split("/").pop() ?? ""].filter((part) => part.length > 0).join(" · "),
                  actions: ruleActions(session, attempt.host),
                }),
              ),
            }),
          ],
        })
      : null;
  const live = connectionsList(session, snapshot);
  return failedSection ? ui.stack({ key: "connections-stack", children: [failedSection, live] }) : live;
}

function connectionsList(session: Session, snapshot: Snapshot): UINode {
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
            subtitle: [connection.chains[0] ?? "", connection.network, `↓ ${formatBytes(connection.download)} ↑ ${formatBytes(connection.upload)}`, connection.rule, connection.process.split("/").pop() ?? ""]
              .filter((part) => part.length > 0)
              .join(" · "),
            actions: ruleActions(session, connection.host),
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
