/**
 * 菜单栏管理（`menubar`）—— 把用不着的菜单栏图标收起来。
 *
 * 全部做法都在这个扩展里，宿主只给了通用的东西（jarvis-mac `specs/20261029-225323-menubar-manager-p1`）：
 * - 菜单栏域的**几枚状态项**，每枚可以定宽、可以只是一块空白、左键可以发事件（N-1）。三段收放就是两枚空白当边界：
 *   收起时撑到 10000 点宽，它左边的图标被挤出屏幕；露出来时缩回一条竖线。宿主不知道什么是「段」。
 * - **菜单栏上的指针**（N-2）：悬停、点空白处、滚动时露出来。只订用得着的那几种监听。
 * - **菜单栏上有哪些项**、**屏幕几何**（N-3 / N-4）：工具箱页列出每一段里有哪些图标、哪些被刘海挡住。
 *
 * 1.1（jarvis-mac `specs/20261030-081832-menubar-manager-p2`）又用上了三样通用的东西：
 * - **截菜单栏上的项**（N-1）：图标露着时截一张，宿主按窗口留着，藏起来之后副栏里照样画得出它的样子；
 * - **点开菜单栏上的项**（N-2）：副栏里点一颗，先露出它所在的段、等它挪进屏幕、点开，菜单一关就收回；
 * - **弹窗锚到状态项、宽度随内容**（N-3 / N-4）：副栏就是一条挂在「‹」下面的 `popover` 命令。
 *
 * 后台会话（菜单栏域）管收放与点开；工具箱页与副栏跑在前台会话，只读、不存状态，按钮经 `toggle` / `reveal-item` 命令交给后台。
 */
import { defineExtension, type PageDefinition } from "@fusionseek/jarvis-extension-sdk";
import { BarSession, renderBar } from "./bar.js";
import { Controller } from "./controller.js";
import { TOGGLE } from "./model.js";
import { PageSession, renderPage } from "./page.js";

const controller = new Controller();
const page = new PageSession();
const bar = new BarSession();

const toolbox: PageDefinition = {
  activate: (context) => page.activate(context),
  deactivate: () => page.deactivate(),
  render: () => renderPage(page),
};

const popover: PageDefinition = {
  activate: () => bar.activate(),
  render: () => renderBar(bar),
};

defineExtension({
  toolbox,
  popover,
  commands: {
    toggle: () => controller.toggle(),
    bar: (context) => bar.open(context),
    "reveal-item": (context) => controller.revealItem(context.argument ?? "", context.granted),
  },
  menuBar: {
    start: (context) => controller.start(context.preferences, context.granted),
    select: (_context, itemId) => controller.select(itemId),
    press: (_context, statusItem, modifiers) => {
      if (statusItem === TOGGLE) return controller.press(modifiers);
    },
  },
});
