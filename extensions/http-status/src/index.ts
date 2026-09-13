/**
 * HTTP 状态码（`http-status`）—— 一张离线的表加一个搜索框。
 *
 * 两条命令：
 * - `lookup`（⌥⌘H，panel）：把面板展开到这个扩展的页面，并回到干净的一屏；
 * - `explain-clipboard`（⌥⌘/，popover）：读一次剪贴板，抓出里面的状态码，结果贴着指针弹出来。
 *
 * 它刻意**不申请 network.https**：62 个标准码与 12 个常见非标准码都编在 `dist/extension.js` 里，
 * 跟着扩展的版本走。一个查手册的工具没有理由拿到出网的权力——这条也是它作为示例存在的理由。
 */
import { defineExtension, type CommandContext } from "@fusionseek/jarvis-extension-sdk";
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

defineExtension({
  page: {
    activate: (context) => {
      session.adopt(context);
      session.watchPreferences();
    },
    deactivate: () => session.stopWatchingPreferences(),
    render: () => renderPage(session),
  },
  popover: {
    activate: (context) => session.adopt(context),
    render: () => renderPopover(session),
  },
  commands: {
    lookup,
    "explain-clipboard": explainClipboard,
  },
});
