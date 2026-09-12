# jarvis-extensions

Jarvis 的开放平台：这个仓库就是**扩展库**。Jarvis 工具箱末尾那枚虚化的加号点进去，
罗列的正是这里 `extensions/` 下的每一个目录；装上之后它是工具箱里的一行，点开是
400×520 那块面板里的一屏——与内置工具同一套 header、字阶、色板与那圈悬停时流动的炫彩光。

```text
jarvis-extensions/
├── docs/                      平台文档（从 docs/README.md 开始）
├── schemas/                   extension.json 与 registry.json 的 JSON Schema（真源）
├── sdk/                       @fusionseek/jarvis-extension-sdk（TypeScript）
├── templates/hello-extension/ 脚手架
├── extensions/<id>/           每个扩展一个目录：extension.json + src/ + dist/extension.js + README
├── scripts/                   build-extension / validate / build-registry
└── registry.json              扩展库索引（生成物，宿主只读它）
```

## 写一个扩展

```bash
git clone git@github.com:fusionseek/jarvis-extensions.git && cd jarvis-extensions
npm install
cp -R templates/hello-extension extensions/my-tool
# 改 extensions/my-tool/extension.json（四个部分）与 src/index.ts
node scripts/build-extension.mjs extensions/my-tool
node scripts/validate.mjs extensions/my-tool
# Jarvis → 设置 › 扩展 › 「从本地目录加载」→ 指向 extensions/my-tool
npm run registry
```

开发者要显式回答的四件事，全在 `extension.json` 里：

| # | 部分 | 字段 |
| --- | --- | --- |
| 一 | 工具箱里的图标与名字 | `toolbox.symbol` / `name` / `subtitle` |
| 二 | 点进去的功能，以及它要向用户申请的宿主能力 | `main` + `capabilities[]`（第一次进入弹统一授权弹窗） |
| 三 | 要不要出现在设置页 | `settings: false \| { preferences }` |
| 四 | 要不要往 Inbox 投递 | `inbox: false \| { cards, notifications }` |

完整手册：[docs/12-developer-guide.md](docs/12-developer-guide.md)。审核清单：[docs/13-review-checklist.md](docs/13-review-checklist.md)。

## 扩展怎么跑

扩展的代码跑在 Jarvis 进程里的 JavaScriptCore（系统框架，零第三方依赖）；界面是一棵声明式节点树，
由 Jarvis 用 SwiftUI 画出来。扩展不画像素、没有网络与文件系统，能碰到的每一项宿主能力
（剪贴板、快传、截图、通知、Inbox、速记、日历、白名单网络……）都要用户逐条点头。
为什么是这条路线见 [docs/01-overview.md](docs/01-overview.md)。

## 宿主侧

Jarvis 这一侧（`jarvis-mac`）承载扩展的运行时、渲染器、能力闸门与扩展库页面。
那些改动不在本仓库，按 [docs/14-host-integration-plan.md](docs/14-host-integration-plan.md)
分四期各走一个 Speckit feature。

## 规范

见 [AGENTS.md](AGENTS.md)。中文写需求与文档，英文写代码与协议字段；schema 先于实现；
产物提交进仓库并按哈希校验；一个扩展一个 PR。
