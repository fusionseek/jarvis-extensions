# @fusionseek/jarvis-extension-sdk

Jarvis 扩展的 SDK：manifest 类型、命令与页面、声明式 UI 节点、宿主能力接口、OCR 段落合并，
以及跑在 JavaScriptCore 里的那条桥。

```ts
import { defineExtension, jarvis, ui } from "@fusionseek/jarvis-extension-sdk";

let text = "";

defineExtension({
  page: {
    render() {
      return ui.stack({
        spacing: "loose",
        children: [
          ui.section({
            title: "输入 · INPUT",
            children: [ui.field({ value: text, label: "要发送的文字", onChange: (v) => (text = v) })],
          }),
          ui.button({ title: "发到手机", variant: "primary", disabled: text.trim() === "", onPress: () => void jarvis.commands.run("send") }),
        ],
      });
    },
  },
  commands: {
    send: async () => jarvis.quickTransfer.sendText(text),   // manifest commands[] 里 id 为 send 的那一条，可带快捷键
  },
});
```

| 文件 | 管什么 |
| --- | --- |
| `src/manifest.ts` | `extension.json` 的类型、命令与快捷键、能力风险档位 |
| `src/ui.ts` | 31 种节点与 `ui.*` 构造器；输入框的文本由宿主持有 |
| `src/capabilities.ts` | 全局 `jarvis` 的接口与错误码 |
| `src/bridge.ts` | 宿主 ⇄ 扩展的线缆协议、节点序列化、事件类型 |
| `src/ocr.ts` | 行 → 段落合并、按句分块（纯函数，node 里可测） |
| `src/index.ts` | `defineExtension`（页面、命令、原地弹窗）、`jarvis` 实现、运行时（对宿主延迟绑定；`activate` 的 `surface` 决定画页面还是弹窗） |
| `src/testing.ts` | 宿主替身：`createTestHost()`，让扩展逻辑在 node 里跑单测 |

```bash
npm run check   # tsc --noEmit
npm run build   # → dist/
npm test        # 在仓库根跑：构建 + node --test sdk/test/
```

真源与手册在仓库根的 `docs/`；schema 在 `schemas/`。SDK 主版本与宿主运行时主版本必须一致。
