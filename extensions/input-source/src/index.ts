/**
 * 输入法切换（`input-source`）—— 切到哪个应用，就自动换成你给它定的输入法。
 *
 * 全部做法都在这个扩展里，宿主只给了通用的东西（jarvis-mac `specs/20261030-170731-input-source-switch-p1`）：
 * - **输入源**（N-1）：列出启用的、此刻是哪个、切过去，以及变化通知——带一位 `bySelf`，分得清是你手动换的还是这里刚切的；
 * - **前台应用**（N-2）：换了前台就推一条；
 * - **一闪而过的提示**（N-3）：宿主在文字光标旁画一枚小牌子，位置由宿主读、不交给这里；
 * - **持有订阅即常驻**（N-4）：关掉菜单栏图标，后台照样在切。
 *
 * 宿主不知道什么是「规则」「记住上次」「默认输入法」，它们都在 `model.ts`。
 * 后台会话（菜单栏域）管切换与菜单；工具箱页跑在前台会话，只读写规则。
 */
import { defineExtension } from "@fusionseek/jarvis-extension-sdk";
import { Controller } from "./controller.js";
import { PageSession, renderPage } from "./page.js";

const controller = new Controller();
const page = new PageSession();

defineExtension({
  toolbox: {
    activate: (context) => page.activate(context),
    deactivate: () => page.deactivate(),
    render: () => renderPage(page),
  },
  commands: {
    previous: (context) => controller.previous(context),
    "remember-here": (context) => controller.rememberHere(context),
    pause: (context) => controller.pause(context),
  },
  menuBar: {
    start: (context) => controller.start(context.preferences, context.granted),
    open: (context) => controller.open(context),
    select: (context, itemId) => controller.select(itemId, context),
  },
});
