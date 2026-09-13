/**
 * 原地结果弹窗：⌥⌘/ 按下之后贴着指针弹出来的那一扇。
 *
 * 它是页面详情屏的**紧凑版**：读一眼就能走，所以只留"这是什么、要不要重试、
 * 最常见的两个原因"，成因超过两条、相关码、出处都留给面板里那一屏（⤢ 在面板里打开）。
 * 弹窗 400 宽、按内容长高，最高 520——写得下不等于该写。
 *
 * 四种结果各有一屏话：抓到了、读到了但没有码、没有授权、宿主那一侧失败了。
 * 「什么都不弹」不在这四种里：用户刚按过快捷键，静默等于让他怀疑快捷键没生效。
 */
import { jarvis, ui, type Tint, type UINode } from "@fusionseek/jarvis-extension-sdk";
import type { StatusCode } from "./data.js";
import { tintFor } from "./search.js";
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
  const related = (entry.related ?? []).slice(0, 2);
  return [
    sourceCard(session, true),
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
      actions: [
        {
          id: "open-panel",
          title: session.hotkey("lookup") ? `打开面板输入 ${session.hotkey("lookup")}` : "打开面板输入",
          symbol: "magnifyingglass",
          help: "把面板展开到这个扩展的页面",
          onPress: () => void jarvis.commands.run("lookup"),
        },
      ],
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

export function renderPopover(session: Session): UINode {
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
