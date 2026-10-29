/**
 * 菜单栏管理（`menubar`）—— 把用不着的菜单栏图标收起来。
 *
 * 全部做法都在这个扩展里，宿主只给了通用的东西（jarvis-mac `specs/20261029-225323-menubar-manager-p1`）：
 * - 菜单栏域的**几枚状态项**，每枚可以定宽、可以只是一块空白、左键可以发事件（N-1）。三段收放就是两枚空白当边界：
 *   收起时撑到 10000 点宽，它左边的图标被挤出屏幕；露出来时缩回一条竖线。宿主不知道什么是「段」。
 * - **菜单栏上的指针**（N-2）：悬停、点空白处、滚动时露出来。只订用得着的那几种监听。
 * - **菜单栏上有哪些项**、**屏幕几何**（N-3 / N-4）：工具箱页列出每一段里有哪些图标、哪些被刘海挡住。
 *
 * 后台会话（菜单栏域）管收放；工具箱页跑在前台会话，只读、不存状态，按钮经 `toggle` 命令交给后台。
 */
import { defineExtension, type PageDefinition } from "@fusionseek/jarvis-extension-sdk";
import { Controller } from "./controller.js";
import { TOGGLE } from "./model.js";
import { PageSession, renderPage } from "./page.js";

const controller = new Controller();
const page = new PageSession();

const toolbox: PageDefinition = {
  activate: (context) => page.activate(context),
  deactivate: () => page.deactivate(),
  render: () => renderPage(page),
};

defineExtension({
  toolbox,
  commands: {
    toggle: () => controller.toggle(),
  },
  menuBar: {
    start: (context) => controller.start(context.preferences, context.granted),
    select: (_context, itemId) => controller.select(itemId),
    press: (_context, statusItem, modifiers) => {
      if (statusItem === TOGGLE) return controller.press(modifiers);
    },
  },
});
