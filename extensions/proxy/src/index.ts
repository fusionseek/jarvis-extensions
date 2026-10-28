/**
 * 代理（`proxy`）—— 用你自己装的 sing-box 跑你的订阅：工具箱一页开关与切节点、窗口里看连接、规则与日志、
 * 菜单栏一枚图标随手开关，开着时把系统代理指向它（jarvis-mac `specs/20261028-091917-proxy-extension-menubar-daemon` P-9）；
 * 还有增强模式（TUN）、导入 Surge 配置、当前页面规则、悬浮球上的有效流量与成败（`specs/20261028-111714-proxy-tun-orb-traffic-page-rules`）。
 *
 * 两个会话共用同一份 bundle：
 * - 前台（工具箱、窗口）：`Session`，页面开着时每秒读一次流量；
 * - 后台（菜单栏、`/proxy`）：`Background`，订着内核的退出、按日程更新订阅、推菜单栏模型。
 *
 * 两边的内存不相通：常驻进程与系统代理的状态每次现问宿主，其余经 `jarvis.storage`（见 `store.ts`）。
 */
import { defineExtension } from "@fusionseek/jarvis-extension-sdk";
import { Background } from "./background.js";
import { Session } from "./session.js";

const session = new Session();
const background = new Background();

defineExtension({
  toolbox: session.page,
  window: session.page,
  menuBar: {
    start: (context) => background.start(context),
    open: (context) => background.open(context),
    select: (context, itemId) => background.select(context, itemId),
  },
  commands: {
    toggle: (context) => background.command(context),
    // 菜单栏「导入 Surge 配置」「规则」：窗口命令跑在前台会话——挑文件要用户在场。
    "import-surge": () => session.command("import-surge"),
    rules: () => session.command("rules"),
  },
});
