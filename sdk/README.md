# @fusionseek/jarvis-extension-sdk

Jarvis 扩展的 SDK：manifest 类型、声明式 UI 节点、宿主能力接口，以及跑在 JavaScriptCore 里的那条桥。

```ts
import { defineExtension, jarvis, ui } from "@fusionseek/jarvis-extension-sdk";

let text = "";

defineExtension({
  render() {
    return ui.stack({
      spacing: "loose",
      children: [
        ui.section({
          title: "输入 · INPUT",
          children: [ui.field({ value: text, label: "要发送的文字", onChange: (v) => (text = v) })],
        }),
        ui.button({
          title: "发到手机",
          variant: "primary",
          disabled: text.trim() === "",
          onPress: () => void jarvis.quickTransfer.sendText(text),
        }),
      ],
    });
  },
});
```

| 文件 | 管什么 |
| --- | --- |
| `src/manifest.ts` | `extension.json` 的类型与能力风险档位 |
| `src/ui.ts` | 30 种节点与 `ui.*` 构造器 |
| `src/capabilities.ts` | 全局 `jarvis` 的接口与错误码 |
| `src/bridge.ts` | 宿主 ⇄ 扩展的线缆协议与节点序列化 |
| `src/index.ts` | `defineExtension`、`jarvis` 实现、运行时 |

真源与手册在仓库根的 `docs/`；schema 在 `schemas/`。SDK 主版本与宿主运行时主版本必须一致。
