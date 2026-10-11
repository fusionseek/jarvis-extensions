/**
 * 原地结果弹窗：⌥⌘/ 或 `/http <码或关键词>` 之后贴着指针弹出来的那一扇。
 * 这两条命令里都没有截图，宿主因此把它锚在指针旁。
 *
 * 它是页面详情屏的**紧凑版**：读一眼就能走，所以只留"这是什么、要不要重试、
 * 最常见的两个原因"，成因超过两条、相关码、出处都留给面板里那一屏（⤢ 在面板里打开）。
 * 弹窗 400 宽、按内容长高，最高 520——写得下不等于该写。
 *
 * 两条命令各画一种（`session.popoverMode`）：
 * - ⌥⌘/（`clipboard`）四种结果各有一屏话：抓到了、读到了但没有码、没有授权、宿主那一侧失败了；
 * - `/http`（`query`）按页面搜索框同一套查法：一条码、一张清单、查不到、没跟字。
 * 「什么都不弹」不在这些里：用户刚按过快捷键或回车，静默等于让他怀疑指令没生效。
 */
import { jarvis, ui, type ActionSpec, type Tint, type UINode } from "@fusionseek/jarvis-extension-sdk";
import type { StatusCode } from "./data.js";
import { emptyCopy, rowSubtitle } from "./page.js";
import { symbolFor, tintFor } from "./search.js";
import type { Session } from "./session.js";

const CLASS_TITLE: Record<number, string> = { 1: "信息", 2: "成功", 3: "重定向", 4: "客户端错误", 5: "服务端错误" };

/** 读到的那一段：给人核对"抓的是哪一行"。 */
function sourceCard(session: Session, hit: boolean): UINode {
  return ui.card({
    key: "source",
    children: [
      ui.stack({
        key: "meta",
        axis: "horizontal",
        spacing: "tight",
        alignment: "center",
        children: [
          ui.text({ key: "length", text: `剪贴板 · ${session.clipboardLength()} 字符`, style: "footnote" }),
          ui.spacer(),
          ui.text({ key: "hit", text: hit ? "命中 1 个码" : "没有 100–599", style: "footnote", tint: hit ? "accent" : "neutral" }),
        ],
      }),
      ui.text({ key: "excerpt", text: session.clipboardExcerpt(), style: "mono", lines: 2, selectable: true }),
    ],
  });
}

function facts(entry: StatusCode): UINode {
  const retry = { yes: { title: "可以重试", tint: "live" }, maybe: { title: "看 Retry-After", tint: "amber" }, no: { title: "重试没用", tint: "neutral" } }[entry.retriable];
  const children: UINode[] = [
    ui.badge({ key: "class", title: CLASS_TITLE[Math.floor(entry.code / 100)] ?? "未知", tint: tintFor(entry.code) as Tint }),
    ui.badge({ key: "retry", title: retry.title, tint: retry.tint as Tint }),
    ui.badge({ key: "cache", title: entry.cacheable ? "默认可缓存" : "不可缓存", tint: "neutral" }),
  ];
  if (entry.unofficial) children.push(ui.badge({ key: "unofficial", title: `非标准 · ${entry.unofficial}`, tint: "amber" }));
  return ui.stack({ key: "facts", axis: "horizontal", spacing: "tight", children });
}

function hit(session: Session, entry: StatusCode): UINode[] {
  return [sourceCard(session, true), ...entryBody(session, entry)];
}

/** 一条码的紧凑说明：读数、徽标、一句话、两条成因、复制。⌥⌘/ 与 `/http` 共用。 */
function entryBody(session: Session, entry: StatusCode): UINode[] {
  const related = (entry.related ?? []).slice(0, 2);
  return [
    ui.readout({
      key: "readout",
      label: `${entry.zh} · ${CLASS_TITLE[Math.floor(entry.code / 100)] ?? ""}`,
      value: session.copyText(entry),
      tint: tintFor(entry.code) as Tint,
      copy: true,
    }),
    facts(entry),
    ui.text({ key: "summary", text: entry.summary, style: "body" }),
    ...(entry.causes ?? []).slice(0, 2).map((cause, index) => ui.text({ key: `cause-${index}`, text: `· ${cause}`, style: "subtle" })),
    ui.stack({
      key: "actions",
      axis: "horizontal",
      spacing: "tight",
      alignment: "center",
      children: [
        ui.copy({ key: "copy", text: session.copyText(entry), variant: "chip", label: `复制 ${session.copyText(entry)}` }),
        ui.spacer(),
        ...(related.length ? [ui.text({ key: "related", text: `相关 ${related.join(" · ")}`, style: "footnote" })] : []),
      ],
    }),
  ];
}

function nothingFound(session: Session): UINode[] {
  return [
    sourceCard(session, false),
    ui.note({
      key: "empty",
      tint: "neutral",
      symbol: "info.circle",
      title: "剪贴板里没有状态码",
      body: `读到的这一段里没有 100–599 的整数。复制响应行、日志行或单独的数字再跑一次 ${session.commandRef("explain-clipboard", "解释剪贴板里的码")}；也可以打开面板手输。`,
      actions: [openPanelAction(session)],
    }),
  ];
}

function denied(session: Session): UINode[] {
  return [
    ui.note({
      key: "denied",
      tint: "alert",
      symbol: "lock",
      title: "没有读剪贴板的授权",
      body: "这条命令要读一次剪贴板才能找到里面的状态码。授权之后它只在你按快捷键的那一刻读一次，不会在后台盯着剪贴板。",
      actions: [{ id: "grant", title: "授权", symbol: "lock.open", help: "再问一次读剪贴板的授权", onPress: () => void session.requestClipboard() }],
    }),
  ];
}

function failed(message: string): UINode[] {
  return [
    ui.note({
      key: "failed",
      tint: "danger",
      symbol: "exclamationmark.triangle",
      title: "没读到剪贴板",
      body: message,
    }),
  ];
}

// ── /http：查一段敲进来的字 ──────────────────────────────────────────────

/** 从 `/http 超时` 的清单点进一条之后，回得去的那条路（与页面详情屏同一颗）。 */
function backLink(session: Session): UINode[] {
  if (session.previousQuery === null) return [];
  return [
    ui.button({
      key: "back",
      title: `← 回到「${session.previousQuery}」`,
      variant: "link",
      size: "inline",
      onPress: () => session.back(),
    }),
  ];
}

/**
 * 命中多条：一张紧凑清单，点一行就在弹窗里换成那一条的说明。
 *
 * 不画页面上那两枚筛选 chip 与悬停卡：弹窗是"读一眼就走"的那一面，要筛就「在面板里打开」。
 * 4xx 有 35 行，弹窗到 520 高就自己滚——不截断，截掉的那几行恰恰可能是用户要找的。
 */
function queryList(session: Session, entries: StatusCode[], label: string): UINode[] {
  const from = session.query;
  return [
    ui.section({
      key: "results",
      title: "结果 · RESULTS",
      trailing: label,
      children: [
        ui.list({
          key: "result-list",
          children: entries.map((entry) =>
            ui.row({
              key: String(entry.code),
              symbol: symbolFor(entry.code),
              tint: tintFor(entry.code),
              title: `${entry.code} · ${entry.name}`,
              subtitle: rowSubtitle(entry),
              accessory: "chevron",
              label: `${entry.code} ${entry.name} · ${entry.zh}`,
              onPress: () => session.openCode(entry.code, from),
            }),
          ),
        }),
      ],
    }),
  ];
}

/** 进面板的那一颗：`lookup` 回到干净的一屏，搜索框就在最上面。⌥⌘/ 抓不到码与 `/http` 查不到时共用。 */
function openPanelAction(session: Session): ActionSpec {
  const key = session.hotkey("lookup");
  return {
    id: "open-panel",
    title: key ? `打开面板输入 ${key}` : "打开面板输入",
    symbol: "magnifyingglass",
    help: "把面板展开到这个扩展的页面",
    onPress: () => void jarvis.commands.run("lookup"),
  };
}

/** `/http` 那一种弹窗。查法与页面搜索框一字不差（`session.outcome()`）。 */
function renderQuery(session: Session): UINode[] {
  const outcome = session.outcome();
  switch (outcome.kind) {
    case "exact":
      return [...backLink(session), ...entryBody(session, outcome.entry)];
    case "list":
      return queryList(session, outcome.entries, outcome.label);
    case "empty": {
      const { title, hint } = emptyCopy(session, outcome.reason);
      return [ui.note({ key: "empty", tint: "neutral", symbol: "questionmark.circle", title, body: hint, actions: [openPanelAction(session)] })];
    }
    case "browse":
      // `/http` 回车但没跟字：宿主按 manifest 的 `argument` 提示过要参数，真走到这里时说清怎么写，而不是弹一个空框。
      return [
        ui.note({
          key: "prompt",
          tint: "neutral",
          symbol: "number.circle",
          title: "给一个码或关键词",
          body: "在 /http 后面跟上状态码或关键词，如 /http 404、/http 超时、/http 5xx。",
          actions: [openPanelAction(session)],
        }),
      ];
  }
}

/**
 * 弹窗那一面。
 * - Parameter session: 会话；`popoverMode` 决定画 ⌥⌘/ 那一种还是 `/http` 那一种。
 * - Returns: 根节点（`scroll`）。
 */
export function renderPopover(session: Session): UINode {
  if (session.popoverMode === "query") return ui.scroll({ children: renderQuery(session) });
  const state = session.clipboard;
  const children =
    state.kind === "hit"
      ? hit(session, state.entry)
      : state.kind === "empty"
        ? nothingFound(session)
        : state.kind === "denied"
          ? denied(session)
          : state.kind === "failed"
            ? failed(state.message)
            : failed("这一轮没有读到任何内容。");
  return ui.scroll({ children });
}
