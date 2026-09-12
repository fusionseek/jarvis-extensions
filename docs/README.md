# Jarvis 开放平台 · 文档

按顺序读；每篇的形状是 Overview → Concepts → Usage → Gotchas → Related Links。

| # | 篇 | 回答什么 |
| --- | --- | --- |
| 01 | [总览](01-overview.md) | 平台是什么、为什么选这条运行时路线、五条原则、不做什么 |
| 02 | [框架层级设计](02-architecture.md) | 仓库 / 宿主 / 扩展三者的边界，数据流，快照，运行时，闸门，五张表，安全 |
| 03 | [manifest 规范](03-manifest.md) | `extension.json` 逐字段：四个部分怎么写、命令与快捷键、跨字段规则、校验 |
| 04 | [工具箱接入与扩展库](04-toolbox-and-gallery.md) | 目录里的扩展行、那枚虚化的加号、扩展库页面、安装 |
| 05 | [能力授权模型](05-permissions.md) | 三层边界、第一次进入的统一授权弹窗、拒绝态、撤销 |
| 06 | [能力接口目录](06-capabilities.md) | `jarvis.*` 每个命名空间的方法、限制、错误码 |
| 07 | [UI 组件目录](07-ui-components.md) | 31 种节点与宿主实现的逐项对应、全局规则、输入框由宿主持有文本 |
| 08 | [设计体系](08-design-system.md) | 你能选的与你碰不到的、面板解剖、tokens、构造规则、无障碍 |
| 09 | [鼠标感知系统](09-pointer-awareness.md) | 五层：浮窗级 / 面板级 / 控件级 / 停留级 / 手势级 |
| 10 | [设置区段接入](10-settings.md) | 第三部分：「扩展」区段、每扩展一块面板、偏好控件映射 |
| 11 | [Inbox 接入](11-inbox.md) | 第四部分：卡片解剖、顺序、未读、规则、横幅 |
| 12 | [开发手册](12-developer-guide.md) | 六步：脚手架 → manifest → 代码（命令 + 页面）→ 构建校验（含 node 单测）→ 开发者模式 → PR |
| 13 | [审核清单](13-review-checklist.md) | PR 模板的真源 |
| 14 | [jarvis-mac 侧实施方案](14-host-integration-plan.md) | 四期 Speckit feature 的提纲、改动清单、门禁 |

契约：[`schemas/`](../schemas) 是 manifest 与 registry 的真源；[`sdk/src`](../sdk/src) 是节点、能力与线缆的类型真源。
示例：[`templates/hello-extension`](../templates/hello-extension)、[`extensions/send-to-phone`](../extensions/send-to-phone)、
[`extensions/screenshot-translate`](../extensions/screenshot-translate)（命令 + 快捷键 + 截图 OCR + 网络的参考实现）。
