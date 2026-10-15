# Jarvis 开放平台 · 文档（v2）

按顺序读；每篇的形状是 Overview → Concepts → Usage → Gotchas → Related Links。
v2 按**域**组织扩展（悬浮球不开放；工具箱、窗口、指令、设置、服务；Inbox 是通道），与 v1 一刀切断、不兼容。

| # | 篇 | 回答什么 |
| --- | --- | --- |
| 01 | [总览](01-overview.md) | 域模型、服务扩展、运行时路线、六条原则、不做什么、术语 |
| 02 | [框架层级设计](02-architecture.md) | 仓库 / 宿主 / 扩展的边界，快照与索引 v2，前台与后台会话，协议 2，闸门，存储，安全 |
| 03 | [manifest 规范](03-manifest.md) | `extension.json` v2 逐字段：域、命令与落点、受限执行的声明对象、服务、设置、跨字段规则 |
| 04 | [工具箱域、窗口域与扩展商店](04-toolbox-and-gallery.md) | 目录里的扩展行、扩展页面宿主态、工作区标签、商店与回执 |
| 05 | [能力授权模型](05-permissions.md) | 三层边界、什么时候问（第一次进入 / 第一次启用）、授权屏、拒绝态、档位、完全磁盘访问 |
| 06 | [能力接口目录](06-capabilities.md) | v2 的 `jarvis.*`：隐式能力、需要点头的能力、受限执行、限频、错误码 |
| 07 | [UI 组件目录](07-ui-components.md) | 31 种节点与宿主实现的对应、三面的宽度、全局规则 |
| 08 | [设计体系](08-design-system.md) | 你能选的与你碰不到的、面板 / 窗口 / 弹窗的容器、tokens、构造规则、无障碍 |
| 09 | [鼠标感知系统](09-pointer-awareness.md) | 五层：浮窗级 / 面板级 / 控件级 / 停留级 / 手势级 |
| 10 | [设置域与服务扩展点](10-settings.md) | 设置 › 扩展、设置 › 清理 · 清理引擎（`junkClean.engine`）、设置 › Git · 项目引擎（`project.engine`）、偏好控件 |
| 11 | [Inbox 通路](11-inbox.md) | `inbox.post` 消息与 `notifications.post` 横幅：声明、形状、限频、该投什么 |
| 12 | [开发手册](12-developer-guide.md) | 六步：脚手架 → manifest → 代码 → node 测试 → 构建校验 → PR |
| 13 | [审核清单](13-review-checklist.md) | PR 模板的真源；服务与受限执行的逐字审核 |
| 14 | [jarvis-mac 侧落地记录](14-host-integration-plan.md) | spec `20261011-193606` 的决策、宿主类型与文件、契约、存储；spec `20261015-123126` 的 Git 域与项目引擎 |

契约：[`schemas/`](../schemas)（`extension.v2.schema.json`、`registry.v2.schema.json`）是 manifest 与索引的真源；
[`sdk/src`](../sdk/src) 是节点、能力、服务扩展点与线缆的类型真源。
示例：[`templates/hello-extension`](../templates/hello-extension)（工具箱 + 指令）、[`extensions/http-status`](../extensions/http-status)（工具箱 + 窗口 + 弹窗 + 设置）、
[`extensions/translation`](../extensions/translation)（截图 OCR + 网络 + 快捷键 + 静默命令）、[`extensions/send-to-phone`](../extensions/send-to-phone)（快传 + Inbox）、
[`extensions/mole-clean`](../extensions/mole-clean)（服务扩展 + 受限执行）。
