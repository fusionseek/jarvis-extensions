/**
 * HTTP 状态码（`http-status`）—— 一张离线的表加一个搜索框。
 *
 * 入驻四个域：工具箱（页面与原地弹窗）、窗口（工作区里一枚标签，画同一屏）、指令、设置。三条命令：
 * - `lookup`（⌥⌘H，toolbox）：把面板展开到这个扩展的页面，并回到干净的一屏；
 * - `explain-clipboard`（⌥⌘/，popover）：读一次剪贴板，抓出里面的状态码，结果贴着指针弹出来；
 * - `explain`（`/http` · `/状态码`，popover）：查 `/` 后面那个码或关键词，结果同样贴着指针弹出来。
 *
 * 它刻意**不申请 network.https**：62 个标准码与 12 个常见非标准码都编在 `dist/extension.js` 里，
 * 跟着扩展的版本走。一个查手册的工具没有理由拿到出网的权力——这条也是它作为示例存在的理由。
 */
import { defineExtension, type CommandContext, type PageDefinition } from "@fusionseek/jarvis-extension-sdk";
import { renderPage } from "./page.js";
import { renderPopover } from "./popover.js";
import { Session } from "./session.js";

const session = new Session();

/** ⌥⌘H：回到干净的一屏。按快捷键的人要的是"重新查一个"，不是接着看上一个。 */
function lookup(context: CommandContext): void {
  session.adopt(context);
  session.clear();
}

/** ⌥⌘/：读一次剪贴板。命令还在跑时弹窗就已经开着，里面先画这一轮的结果。 */
async function explainClipboard(context: CommandContext): Promise<void> {
  session.adopt(context);
  await session.readClipboard();
}

/**
 * `/http <码或关键词>`：与页面搜索框同一套查法，结果画在原地弹窗里。
 *
 * 落在弹窗而不是面板：敲 `/http 502` 的人正盯着日志，要的是"看一眼就走"；
 * 想细看就用弹窗 chrome 上的「在面板里打开」，`query` 已经是这个码了，页面接着画同一条。
 */
function explain(context: CommandContext): void {
  session.adopt(context);
  session.explain(context.argument);
}

/**
 * 工具箱与窗口画同一屏（理由见 `page.ts` 开头）。窗口那一面也要订阅偏好：
 * 标签可以开着很久，用户在设置里改了「复制格式」，窗口里那颗复制钮得跟着变。
 */
const page: PageDefinition = {
  activate: (context) => {
    session.adopt(context);
    session.watchPreferences();
  },
  deactivate: () => session.stopWatchingPreferences(),
  render: () => renderPage(session),
};

defineExtension({
  toolbox: page,
  window: page,
  popover: {
    activate: (context) => session.adopt(context),
    render: () => renderPopover(session),
  },
  commands: {
    lookup,
    "explain-clipboard": explainClipboard,
    explain,
  },
});
