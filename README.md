# jarvis-extensions

Jarvis 的开放平台：这个仓库就是**扩展商店**。Jarvis 工具箱末尾那枚虚化的加号点进去，罗列的正是这里
`extensions/` 下的每一个目录。v2 的扩展按**域**入驻 Jarvis：

| 域 | manifest | 用户看到 |
| --- | --- | --- |
| 悬浮球 | — | 不开放；只能经它驱动的内置能力间接体现（清理引擎跑起来，球照旧画清理状态） |
| 工具箱 | `contributes.toolbox` | 工具箱里一行，点开是 400×520 面板里的一屏——与内置工具同一套 header、字阶、色板与悬停光 |
| 窗口 | `contributes.window` | 工作区窗口里一枚标签 |
| 指令 | `contributes.commands` | 全局搜索与速记里的 `/` 指令、全局快捷键；受限执行（跑声明过的命令）归这个域 |
| 设置 | `contributes.settings` | 设置 › 扩展 里它那块面板，控件由宿主画 |
| 服务 | `contributes.services` | 没有界面；扩展一个内置能力（`junkClean.engine`：设置 › 清理 里多一个清理引擎；`project.engine`：Jarvis「项目」的数据来源） |
| Git | `contributes.git` | 不是入口；Git 设置对应托管服务下它的「关联」区段，Git 操作域的能力（`git.*`）只给入驻了它的扩展 |
| Inbox（通道） | `inbox` | 一条 Inbox 消息 / 一条系统横幅 |

```text
jarvis-extensions/
├── docs/                      平台文档（从 docs/README.md 开始）
├── schemas/                   extension.v2 与 registry.v2 的 JSON Schema（真源）
├── sdk/                       @fusionseek/jarvis-extension-sdk 2.x（TypeScript）
├── templates/hello-extension/ 脚手架（工具箱 + 指令）
├── extensions/<id>/           每个扩展一个目录：extension.json + src/ + test/ + dist/extension.js + README
├── scripts/                   build-extension / validate / build-registry / check-pr
└── registry.json              扩展商店索引 v2（生成物，每条带整份 manifest；宿主只读它）
```

## 写一个扩展

```bash
git clone git@github.com:fusionseek/jarvis-extensions.git && cd jarvis-extensions
npm install
cp -R templates/hello-extension extensions/my-tool
# 改 extensions/my-tool/extension.json（域、能力、指令词）、package.json 与 src/index.ts
node scripts/build-extension.mjs extensions/my-tool
node scripts/validate.mjs extensions/my-tool
npm run verify && npm run registry
```

`extension.json` 必填：`manifestVersion: 2`、`id`、`version`、`name`、`symbol`、`description`、`author`、`main`、
`sdk`（`^2.0.0`）、`minimumJarvisVersion`、`capabilities`、`contributes`（至少入驻工具箱、窗口、指令、服务之一）、
`inbox`（`false` 也要写出来）。要跑命令或读文件的扩展，再逐字声明 `process` / `files`。

代码按域交实现：`defineExtension({ toolbox, window, popover, commands, services })`。参考实现：
[`extensions/http-status`](extensions/http-status)（工具箱 + 窗口 + 弹窗 + 设置）、
[`extensions/mole-clean`](extensions/mole-clean)（服务扩展 + 受限执行）。

v2 没有本地加载：开发循环是 node 里的宿主替身（`@fusionseek/jarvis-extension-sdk/testing`），合并进主干后用户的 Jarvis 同步到它。
完整手册：[docs/12-developer-guide.md](docs/12-developer-guide.md)。审核清单：[docs/13-review-checklist.md](docs/13-review-checklist.md)。

## 扩展怎么跑

扩展的代码跑在 Jarvis 进程里的 JavaScriptCore（系统框架，零第三方依赖）；界面是一棵声明式节点树，由 Jarvis 用 SwiftUI 画出来。
有界面的入口跑在**前台会话**（全局一个），服务与静默命令跑在**后台会话**（每扩展一个、没有界面）。
扩展不画像素、不能任意联网或读写文件，能碰到的每一项宿主能力（剪贴板、快传、截图、通知、Inbox、白名单网络、受限执行……）都要用户逐条点头。

**受限执行**（`process.run` / `files.read` / `terminal.run`）只放行 manifest 里逐字声明的可执行文件与参数、文件路径、脚本；
跑起来的命令**继承 Jarvis 的全部系统权限，含完全磁盘访问**——授权屏与商店详情都会逐字列出它们。
为什么是这条路线见 [docs/01-overview.md](docs/01-overview.md)。

## 宿主侧

Jarvis 这一侧（`jarvis-mac`）承载运行时、渲染器、能力闸门、商店与清理引擎注册表。v2 在 `jarvis-mac` 的 Speckit feature
`20261011-193606-extension-domains-service-engines` 里落地，宿主的类型与文件见 [docs/14-host-integration-plan.md](docs/14-host-integration-plan.md)。
v1 的扩展、索引与 SDK 1.x 一律不读：升级后本机已装的 v1 扩展会被整批卸掉，从商店重新装 v2 的。

## 规范

见 [AGENTS.md](AGENTS.md)。中文写需求与文档，英文写代码与协议字段；schema 先于实现；产物提交进仓库并按哈希校验；一个扩展一个 PR。
