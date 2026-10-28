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
| `src/manifest.ts` | `extension.json` v2 的类型：域（`contributes`，2.9 起含菜单栏 `menuBar`）、命令与落点、受限执行的声明对象（2.9 起含常驻进程 `process.daemons`）、联网声明（2.9 起含 `network.preferenceHosts`）、偏好（2.9 起含 `urlList`）、能力风险档位 |
| `src/ui.ts` | 31 种节点与 `ui.*` 构造器；输入框的文本由宿主持有；2.4 起 `row.image`（行首换成宿主颁发的图） |
| `src/capabilities.ts` | 全局 `jarvis` 的接口（含 `process` / `files` / `terminal` / `window` / `inbox`，2.1 起含 Git 操作域 `git`，2.4 起含 Android 操作域 `android`：`devices` / `apps` / `appDetails` / `openTool`；2.9 起含 `menuBar.update`、常驻进程 `daemon`：`start` / `stop` / `status` / `logs` / `request` / `observe`、系统代理 `systemProxy`：`status` / `enable` / `disable`）与错误码（含 `surface.unavailable`） |
| `src/services.ts` | 服务扩展点的契约：`junkClean.engine`（`status` / `run` / `action`，取消信号）；2.1 起 `project.engine`（`describe` / `listProjects` / `readSchema` / `readItems` / `applyEdit` / `createField` / `createOption`；2.2 起加 `createIteration`，2.3 起加 `createItem`，2.6 起 `readItems` 可按 `itemIds` 读、能力 `readItemsById`）；2.5 起 `launcher.apps`（`catalog`）；2.7 起 `code.format`（`describe` / `format`）；2.8 起 `code.highlight`（`describe` / `highlight`） |
| `src/bridge.ts` | 宿主 ⇄ 扩展的线缆协议 2：三面、命令上下文、`service` / `serviceCancel`、节点序列化；2.9 起 `menuBar` 事件与菜单栏模型、常驻进程与系统代理的入参 / 返回 |
| `src/ocr.ts` | 行 → 段落合并、按句分块（纯函数，node 里可测） |
| `src/index.ts` | `defineExtension`、`jarvis` 实现、运行时（对宿主延迟绑定；前台的三面与后台的服务调用、菜单栏事件走同一条桥） |
| `src/testing.ts` | 宿主替身：`createTestHost()`；`dispatch` 宿主事件、`callService` 调一次服务、`find` / `fire` 断言节点树；2.4 起 `fakeAndroid()`：按宿主规则答 `android.*` 的假手机（1…8 个包、设备要 ready、`failNext` / `holdDetails` / 在途计数）；2.9 起 `menuBarModels` / `menuBarEvent()` / `menuItem()` 与 `fakeDaemons()`：按宿主规则答 `daemon.*` / `systemProxy.*`，`output()` / `crash()` 推订阅事件、进程没了还原系统代理 |

```bash
npm run check   # tsc --noEmit
npm run build   # → dist/
npm test        # 在仓库根跑：构建 + node --test sdk/test/ + 各扩展测试
```

真源与手册在仓库根的 `docs/`；schema 在 `schemas/`。SDK 主版本与宿主运行时主版本必须一致（2）：
宿主不读 SDK 1.x 的产物，SDK 2 的产物也不在旧宿主上跑。
