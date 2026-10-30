# @fusionseek/jarvis-extension-sdk（2.x）

Jarvis 扩展的 SDK：manifest v2 类型、按域交实现的 `defineExtension`、声明式 UI 节点、宿主能力接口、
服务扩展点的契约、OCR 段落合并，以及跑在 JavaScriptCore 里的那条桥（协议 2）。

```ts
import { defineExtension, jarvis, ui, type CommandContext } from "@fusionseek/jarvis-extension-sdk";

let text = "";

defineExtension({
  // 工具箱域：面板里那一页（window / popover 没给时也画这一份）
  toolbox: {
    render() {
      return ui.scroll({
        children: [
          ui.section({
            title: "输入 · INPUT",
            children: [ui.field({ key: "text", value: text, label: "要发送的文字", onChange: (v) => (text = v) })],
          }),
          ui.button({ title: "发到手机", variant: "primary", disabled: text.trim() === "", onPress: () => void jarvis.commands.run("send") }),
        ],
      });
    },
  },
  // 指令域：manifest commands[] 里同 id 的那一条；/ 指令的参数在 context.argument
  commands: {
    send: async (context: CommandContext) => jarvis.quickTransfer.sendText(context.argument ?? text),
  },
});
```

服务扩展只交 `services`，按 manifest `contributes.services[].id` 对上：

```ts
import { defineExtension, type JunkCleanEngine } from "@fusionseek/jarvis-extension-sdk";

const engine: JunkCleanEngine = {
  status: async () => ({ ready: true, summary: "mo 1.2.0 · /opt/homebrew/bin/mo", actions: [] }),
  run: async (context, progress, signal) => ({ sections: [], notes: [] }),
};
defineExtension({ services: { mole: engine } });
```

| 文件 | 管什么 |
| --- | --- |
| `src/manifest.ts` | `extension.json` v2 的类型：域（`contributes`，2.9 起含菜单栏 `menuBar`，2.10 起含悬浮球那一层 `orb` 与 `menuBar.preferences`，2.11 起含 `menuBar.items`：几枚状态项与 `placement`）、命令与落点、受限执行的声明对象（2.9 起含常驻进程 `process.daemons`，2.10 起含 `reload` 与 TUN 的 `process.tunnel`）、联网声明（2.9 起含 `network.preferenceHosts`）、偏好（2.9 起含 `urlList`，Jarvis 3.2.8 起含 `executable`：外部程序的位置，宿主画成「路径 · 来源 + 选择 / 清除 + 在终端中安装」）、能力风险档位（2.10 起含 `network.tunnel`、`browser.activeTab`、`files.pick`；2.11 起含 `menuBar.pointer`、`menuBarExtras.read`；2.12 起含 `menuBarExtras.capture`、`menuBarExtras.control` 与命令的 `popoverWidth`；2.13 起含 `inputSources.read`、`inputSources.select`、`system.activity`、`hud.show`、`browser.activeTab.watch`） |
| `src/ui.ts` | 32 种节点与 `ui.*` 构造器；输入框的文本由宿主持有；2.4 起 `row.image`（行首换成宿主颁发的图）；2.10 起 `chart`（流量曲线，与菜单栏菜单里那块同一种画法）；2.12 起 `chip.image`、`iconButton.image`（宿主颁的图，按钮随图变宽） |
| `src/layout.ts` | 版式与读数节点的构造器 `layout.*`（Jarvis 3.2.8 起，jarvis-mac `specs/20261028-191224-git-push-error-proxy-dashboard-issue-links`）：`sidebar`（只许做根的侧栏导航）、`grid`（自适应网格）、`table`（表格，行是 props）、`bars`（堆叠柱）、`preference`（宿主画的偏好控件）；`header`（窗口一页的页头，Jarvis 3.3.1 起，jarvis-mac `specs/20261029-082059-proxy-window-desktop-layout`——同一期 `section` 多了面板头的分段、`table` 多了选中与自滚、`grid` 多了 `weights` / `fill`、文字多了 `metric` 档，都是可选属性）。不在 `ui` 上：没用到的扩展打包时整块摇掉、产物不变。类型在 `ui.ts` 的 `UINode` 里 |
| `src/capabilities.ts` | 全局 `jarvis` 的接口（含 `process` / `files` / `terminal` / `window` / `inbox`，2.1 起含 Git 操作域 `git`，2.4 起含 Android 操作域 `android`：`devices` / `apps` / `appDetails` / `openTool`；2.9 起含 `menuBar.update`、常驻进程 `daemon`：`start` / `stop` / `status` / `logs` / `request` / `observe`、系统代理 `systemProxy`：`status` / `enable` / `disable`；2.10 起含 `daemon.reload`、增强模式 `tunnel`：`status` / `start` / `reload` / `stop` / `logs` / `request` / `observe`、`orb.update`、`browser.activeTab`、`files.pick`、`preferences.set`；2.11 起含 `menuBar.observePointer`、菜单栏上的项 `menuBarExtras`：`list` / `observe`、屏幕几何 `screens`：`list` / `observe`；2.12 起含 `menuBarExtras.capture` / `press`、`commands.run(id, { argument, anchor })`；2.13 起含输入源 `inputSources`：`list` / `current` / `select` / `observe`、前台应用 `frontmostApp`：`current` / `observe`、提示 `hud.show`、`permissions.onChange`、应用图标 `apps.icons`、浏览器当前页的订阅 `browser.watchActiveTab`）与错误码（含 `surface.unavailable`，2.12 起含 `target.unavailable`）。Jarvis 3.2.8 起另有单独导出的 `networkStatus()`（隐式 `network.status`，不挂在 `jarvis` 上） |
| `src/services.ts` | 服务扩展点的契约：`junkClean.engine`（`status` / `run` / `action`，取消信号）；2.1 起 `project.engine`（`describe` / `listProjects` / `readSchema` / `readItems` / `applyEdit` / `createField` / `createOption`；2.2 起加 `createIteration`，2.3 起加 `createItem`，2.6 起 `readItems` 可按 `itemIds` 读、能力 `readItemsById`）；2.5 起 `launcher.apps`（`catalog`）；2.7 起 `code.format`（`describe` / `format`）；2.8 起 `code.highlight`（`describe` / `highlight`） |
| `src/bridge.ts` | 宿主 ⇄ 扩展的线缆协议 2：三面、命令上下文、`service` / `serviceCancel`、节点序列化；2.9 起 `menuBar` 事件与菜单栏模型、常驻进程与系统代理的入参 / 返回；2.10 起 TUN、悬浮球读数、浏览器当前页、挑文件的入参 / 返回与菜单栏 `chart` / `tone`；2.11 起菜单栏模型的 `statusItem` / `length` / `blank` / `primaryClick`、`press` 事件、指针事件、菜单栏上的项与屏幕几何；2.12 起菜单栏项的截图、点开的结果与菜单开关；2.13 起输入源、输入源变化、前台应用与提示的入参 |
| `src/ocr.ts` | 行 → 段落合并、按句分块（纯函数，node 里可测） |
| `src/index.ts` | `defineExtension`、`jarvis` 实现、运行时（对宿主延迟绑定；前台的三面与后台的服务调用、菜单栏事件走同一条桥） |
| `src/testing.ts` | 宿主替身：`createTestHost()`；`dispatch` 宿主事件、`callService` 调一次服务、`find` / `fire` 断言节点树；2.4 起 `fakeAndroid()`：按宿主规则答 `android.*` 的假手机（1…8 个包、设备要 ready、`failNext` / `holdDetails` / 在途计数）；2.9 起 `menuBarModels` / `menuBarEvent()` / `menuItem()` 与 `fakeDaemons()`：按宿主规则答 `daemon.*` / `systemProxy.*`，`output()` / `crash()` 推订阅事件、进程没了还原系统代理；2.10 起 `orbModels` / `latestOrb`，`fakeDaemons()` 多答 `daemon.reload` 与 `tunnel.*`（网络助手装没装、`cancelNextInstall()`、`blockTunnel()`、守卫、`crashTunnel()`），`failNext(method, error, times)` 可以连拒几次；2.11 起 `menuBarEvent("press", { statusItem, modifiers })`、`statusItem(id)`（某一枚状态项最新的模型）、`subscriptionToken(namespace)`（某个命名空间最近一次订阅的 token） |

```bash
npm run check   # tsc --noEmit
npm run build   # → dist/
npm test        # 在仓库根跑：构建 + node --test sdk/test/ + 各扩展测试
```

真源与手册在仓库根的 `docs/`；schema 在 `schemas/`。SDK 主版本与宿主运行时主版本必须一致（2）：
宿主不读 SDK 1.x 的产物，SDK 2 的产物也不在旧宿主上跑。
