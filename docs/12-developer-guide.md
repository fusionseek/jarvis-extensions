# 开发手册：从零到上架

## Overview

一个扩展从空目录到出现在别人的工具箱里，要走六步：脚手架 → 写 manifest（回答四个部分）→
写 `src/index.ts` → 构建并校验 → 在 Jarvis 的开发者模式里跑 → 提 PR。本文按这个顺序写，
每一步给命令与判据。

## 前提

| 项 | 要求 |
| --- | --- |
| Node | ≥ 20（`node --version`） |
| Jarvis | ≥ manifest 里写的 `minimumJarvisVersion`，且是开着「开发者模式」的一份 |
| 编辑器 | 任何；SDK 带完整的 `.d.ts`，TypeScript 是推荐路线但不是必需 |
| 仓库 | `git clone git@github.com:fusionseek/jarvis-extensions.git && cd jarvis-extensions && npm install` |

`npm install` 装的是本仓库的开发工具（TypeScript、esbuild、Ajv）；扩展本身在运行时**零依赖**——
bundle 里只有你的代码与 SDK 的运行时桥。

## 第一步：脚手架

```bash
cp -R templates/hello-extension extensions/<你的-id>
cd extensions/<你的-id>
```

目录长这样：

```text
extensions/<id>/
├── extension.json      manifest（四个部分）
├── package.json        名字、版本、构建脚本
├── tsconfig.json
├── src/index.ts        入口：defineExtension(...)
├── dist/extension.js   构建产物（提交进仓库）
└── README.md           给用户看的：它做什么、要哪些授权、怎么用
```

`id` 的规则：`^[a-z][a-z0-9]*(-[a-z0-9]+)*$`，3–40 字，等于目录名，不与保留 id 撞名
（见 [03](03-manifest.md)）。

## 第二步：回答四个部分

打开 `extension.json`，逐项填：

1. **工具箱条目**：`toolbox.symbol`（SF Symbol 名——用 macOS 的 SF Symbols 应用查）、`name`（≤ 6 个汉字最稳）、
   `subtitle`、`keywords`（英文名放这里）。
2. **能力**：把你会调用的每一个 `jarvis.*` 命名空间对应到 [06](06-capabilities.md) 里的 `CapabilityID`，
   写进 `capabilities[]`，每项一句 `reason`。用到 `net.fetch` 就把主机名写进 `network.hosts`。
3. **设置**：需要用户调的东西写进 `settings.preferences`；不需要就写 `false`。
4. **Inbox**：做完一件事之后用户关了面板还该看得见结果的，写 `{ cards: true, notifications: … }`；
   否则 `false`。

写完跑一次校验：

```bash
node scripts/validate.mjs extensions/<id>
```

## 第三步：写代码

```ts
import { defineExtension, jarvis, ui, JarvisError } from "@fusionseek/jarvis-extension-sdk";

let text = "";
let granted = new Set<string>();

defineExtension({
  async activate(context) {
    granted = new Set(context.granted);
  },
  render() {
    return ui.scroll({
      children: [
        ui.section({
          title: "输入 · INPUT",
          trailing: `${text.length} 字符`,
          children: [ui.editor({ key: "input", value: text, rows: 3, label: "要处理的文本", onChange: (v) => (text = v) })],
        }),
        ui.section({
          title: "输出 · OUTPUT",
          children: [ui.result({ text: text.toUpperCase(), mono: true, copy: true, empty: "结果会实时出现在这里" })],
        }),
      ],
    });
  },
});
```

三条心智模型：

- **`render()` 是纯的**：只读你自己的变量，返回一棵树。宿主在每次 `ui` 事件回调之后自动重画；
  异步回来的数据（能力调用的结果）要自己调 `jarvis.ui.update()`。
- **状态在模块变量里**：不需要 store、不需要 React。想跨越一次面板收回记住的东西用 `jarvis.storage`。
- **每一项能力都有拒绝态**：`permission.denied` 与 `permission.unavailable` 是状态不是错误，
  页面要画得出它们（[05](05-permissions.md)「扩展该怎么对待拒绝」）。

节点目录见 [07](07-ui-components.md)；能力接口见 [06](06-capabilities.md)。

## 第四步：构建与校验

```bash
node scripts/build-extension.mjs extensions/<id>          # → dist/extension.js
node scripts/build-extension.mjs extensions/<id> --watch  # 改动即重建
node scripts/validate.mjs extensions/<id>                 # schema + 跨字段 + bundle 检查
```

构建是 esbuild 的一次 `bundle`（IIFE、ES2020、不压缩、把 SDK 内联进去）。**产物提交进仓库**：
宿主只认 `dist/extension.js`，CI 会重新构建一遍并比对哈希——手改产物或忘了重建都会在 PR 里红。

校验脚本查什么见 [03 · 校验](03-manifest.md#校验)。SF Symbol 是否存在脚本查不了，由下一步的宿主报。

## 第五步：在 Jarvis 里跑

1. Jarvis → 设置（`⌘,`）→ 「扩展」区段 → 打开「从本地目录加载」→ 「选择…」指向 `extensions/<id>`。
2. 工具箱目录末尾出现你的那一行（带一枚 `hammer` 角标，表示来自本地）。点它——第一次进入弹授权。
3. 宿主监视 `dist/extension.js`：文件一变就重新加载并回到你离开时的那一屏（状态不保留——它跑的是新代码）。
4. 设置页该扩展面板页脚的「日志」抽屉里是 `jarvis.log` 的输出与宿主的警告：
   符号不存在、节点树超限、`hold` 超时、未声明的能力、同步预算超时。

本地加载的扩展**与已安装的扩展走同一条路**：同一个闸门、同一扇授权弹窗、同一张表。
差别只有来源标记与热重载。

### 走查清单（提 PR 前自己过一遍）

| 项 | 怎么看 |
| --- | --- |
| 四个部分 | 工具箱有那一行、点进去是你的页面、设置页有（或没有）你的面板、Inbox 卡（如果有） |
| 授权弹窗 | 每一项的 `reason` 读起来像人话；全部关掉再进，页面画得出拒绝态 |
| 三档辅助功能 | 系统设置里分别打开 Reduce Motion / Reduce Transparency / Increase Contrast 各看一遍 |
| VoiceOver | `⌘F5`，Tab 走一遍：每颗按钮读得出名字，输入框读得出标签 |
| 15 秒 | 指针离开面板 15 秒，它收回；你的页面重新进入是干净的（或从 `storage` 恢复） |
| 面板尺寸 | 内容装不下时滚动，header 那条 62pt 没有被压扁 |
| 错误屏 | 故意在 `render()` 里抛一次错，看到「这个扩展出了问题」+「重新加载」 |

## 第六步：提 PR

1. `npm run registry` 重新生成 `registry.json`（**不手改**）。
2. 一个扩展一个 PR，标题 `feat(<id>): <一句话>`，正文英文 bullets 在前、等量中文 bullets 在后
   （与 `jarvis-mac` 同一套 Conventional Commits）。
3. PR 模板会让你逐条勾 [13 · 审核清单](13-review-checklist.md)。
4. CI：schema、跨字段、重建产物比对哈希、`version` 相对主干递增、保留 id、bundle 大小与禁用 token。
5. 审核通过合并后，用户的 Jarvis 下一次打开扩展库（≥ 30 分钟自动同步或手动刷新）就看得到。

### 更新一个已上架的扩展

- 改代码就得 **`version` +1**（patch 位起步）；不升版本 CI 拒绝。
- 新增了 `capabilities` 的版本，用户更新后下一次进入会**只对新增项**再弹一次授权。
- 删掉的偏好 key，用户那边留着不读；改 `id` 等于新扩展。

## 常见问题

| 现象 | 原因 |
| --- | --- |
| 进入扩展直接是错误屏「找不到 __jarvisHost」 | bundle 在宿主之外被执行了（比如你在 node 里 `import` 了它）；它只能在 Jarvis 里跑 |
| 调 `jarvis.clipboard.read()` 得到 `capability.undeclared` | manifest 没声明 `clipboard.read` |
| 得到 `permission.denied` | 用户没点头；画拒绝态，给一颗 `permissions.request` 按钮 |
| `panel.collapse()` 得到 `invalid.argument` | 不在用户动作 1 秒内 |
| 列表增删时输入框丢焦点 | 行没有 `key` |
| 工具箱那一行图标是拼图 | `toolbox.symbol` 不是有效的 SF Symbol 名，日志里有一条 |
| 面板顶上那条变矮了 | 根节点不是 `scroll` 而内容超高；换成 `ui.scroll` |

## Related Links

- [03 · manifest 规范](03-manifest.md)
- [13 · 审核清单](13-review-checklist.md)
- [`templates/hello-extension`](../templates/hello-extension)、[`extensions/send-to-phone`](../extensions/send-to-phone)（示例）
