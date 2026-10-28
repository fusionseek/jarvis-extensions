# 开发手册：从零到上架（SDK 2）

## Overview

一个扩展从空目录到出现在别人的 Jarvis 里，要走六步：脚手架 → 写 manifest（选域、声明能力）→
写 `src/index.ts`（按域交实现）→ 在 node 里测 → 构建并校验 → 提 PR。本文按这个顺序写，每一步给命令与判据。

v2 **没有本地加载 / 开发者模式**：扩展只从扩展商店装，商店只读主干的快照。因此"在 Jarvis 里试一下"不是开发循环的一环——
开发循环是 node 里的替身测试，它比真机快，而且审核者能复跑。这个取舍的代价写在 Gotchas 里。

## Concepts

### 前提

| 项 | 要求 |
| --- | --- |
| Node | ≥ 22（仓库根 `package.json` 的 `engines`） |
| Jarvis | ≥ manifest 里写的 `minimumJarvisVersion`（v2 扩展从 `3.0.3` 起） |
| 编辑器 | 任何；SDK 带完整的类型，TypeScript 是推荐路线 |
| 仓库 | `git clone git@github.com:fusionseek/jarvis-extensions.git && cd jarvis-extensions && npm install` |

`npm install` 装的是本仓库的开发工具（TypeScript、esbuild、Ajv）；扩展在运行时**零依赖**——
bundle 里只有你的代码与 SDK 的运行时桥。

### 第一步：脚手架

```bash
cp -R templates/hello-extension extensions/<你的-id>
```

```text
extensions/<id>/
├── extension.json      manifest v2
├── package.json        名字（jarvis-ext-<id>）、版本（与 manifest 同步）、构建脚本
├── tsconfig.json
├── src/index.ts        入口：defineExtension({ toolbox, window, popover, commands, services, menuBar })
├── test/*.test.mjs     node --test（建议）
├── dist/extension.js   构建产物（提交进仓库）
└── README.md           给用户看的：它入驻哪里、要哪些授权、会跑什么命令
```

`id`：`^[a-z][a-z0-9]*(-[a-z0-9]+)*$`，3–40 字，等于目录名，不与保留 id 撞名（[03](03-manifest.md)）。
模板入驻工具箱与指令两个域、不申请任何能力；`/count` 指令词在仓库里要唯一，拷过去先换掉。

### 第二步：写 manifest

必填：`manifestVersion: 2`、`id`、`version`、`name`、`symbol`、`description`、`author`、`main`、`sdk`（`^2.0.0`）、
`minimumJarvisVersion`、`capabilities`、`contributes`、`inbox`。

1. **选域**（`contributes` 至少入驻工具箱、窗口、指令、服务、菜单栏之一）：
   - 有一屏要给用户看 → `toolbox`（面板里一行一页），想在大窗口里看 → 再加 `window`；
   - 有不用打开界面就能做完的一步 → `commands`（`/` 指令、快捷键；落点 `toolbox` / `window` / `popover` / `silent`）；
   - 要扩展一个内置能力（清理引擎）→ `services`，没有界面；
   - 有一件一直在后台的事、要用户随手看一眼或点一下（开关、切换）→ `menuBar`（SDK 2.9，系统菜单栏上自己的一枚图标）；
   - 要让用户调东西 → `settings.preferences`（服务的设置写在服务自己的 `preferences` 里）。
2. **能力**：把你会调用的每一个 `jarvis.*` 对应到 [06](06-capabilities.md) 的 `CapabilityID`，每项一句 `reason`（4–60 字，写"拿它做什么"）。
   用到 `net.fetch` 就把主机写进 `network.hosts`；要访问的是用户自己填的地址（订阅地址）就声明一项 `urlList` 偏好，
   再在 `network.preferenceHosts` 里点名它（SDK 2.9）。
3. **受限执行**（只在真的要跑命令时）：`process.executables` 逐个写可执行文件名与**每一组**参数；
   `files.read` 逐个写文件路径；`process.terminal` 写脚本正文；要一直跑着的（代理内核这类）写 `process.daemons`：一组参数逐字，
   只认 `{config}` / `{workdir}` 两个占位符（SDK 2.9）。**最小、逐字**：审核者会一行一行读它们（[13](13-review-checklist.md)）。
4. **Inbox**：静默命令要交结果的写 `{ messages, notifications }`；否则 `false`。

```bash
node scripts/validate.mjs extensions/<id>
```

### 第三步：写代码

```ts
import { defineExtension, jarvis, ui, JarvisError, type CommandContext } from "@fusionseek/jarvis-extension-sdk";

let text = "";

defineExtension({
  // 工具箱域：面板里那一页。window / popover 没给时退回这一份
  toolbox: {
    async activate(context) { /* context.surface / granted / preferences */ },
    render() {
      return ui.scroll({ children: [/* section → section → section */] });
    },
  },
  // 指令域：manifest commands[] 里同 id 的处理函数。/ 指令、快捷键、页面按钮（jarvis.commands.run）都落到这里
  commands: {
    count: (context: CommandContext) => { if (context.argument) text = context.argument; },
  },
});
```

服务扩展只交 `services`：

```ts
import { defineExtension, type JunkCleanEngine } from "@fusionseek/jarvis-extension-sdk";

const engine: JunkCleanEngine = {
  async status(context) { return { ready: true, summary: "…", actions: [] }; },
  async run(context, progress, signal) { /* progress({...}); signal.onCancel(...) */ return { sections: [], notes: [] }; },
  async action(id) { return { watchStatus: true }; },
};
defineExtension({ services: { mole: engine } });
```

菜单栏扩展交 `menuBar`（SDK 2.9），跑在后台会话；回调里改了状态，自己推一份新模型——宿主只缓存最后一份，不会替你重画：

```ts
import { defineExtension, jarvis, type MenuBarModel } from "@fusionseek/jarvis-extension-sdk";

let running = false;
const model = (): MenuBarModel => ({
  symbol: running ? "network" : "network.slash",
  items: [{ kind: "item", id: "toggle", title: "代理", checked: running }],
});

defineExtension({
  menuBar: {
    async start(context) { /* 启动时恢复：读 storage、看 jarvis.daemon.status */ await jarvis.menuBar.update(model()); },
    async open() { /* 用户点开菜单：刷新读数 */ await jarvis.menuBar.update(model()); },
    async select(context, itemId) {
      if (itemId === "toggle") running = !running;
      await jarvis.menuBar.update(model());
    },
  },
});
```

五条心智模型：

- **域决定入口，命令只有一份实现**：页面里的按钮用 `jarvis.commands.run(id)` 触发同一条命令，不要再写一遍。
- **前台与后台**：有界面的入口跑在前台会话（同一时刻全局一个）；服务、`silent` 命令与菜单栏事件跑在后台会话（每扩展一个、没有界面、闲 60 秒被收走；
  有在跑的常驻进程时不收）。
  后台里调 `panel.*` / `window.open` / `ui.dismissPopover` 得到 `surface.unavailable`。
- **`render()` 是纯的**：只读你自己的变量，返回一棵树。`ui` 事件回调与命令返回之后宿主自动重画；异步回来的数据自己调 `jarvis.ui.update()`。
- **状态在模块变量里**：前台会话换给别的扩展时上下文销毁；该跨越的用 `jarvis.storage`。
- **每一项能力都有拒绝态**：`permission.denied` / `permission.unavailable` 是状态不是错误。有界面的画出来；服务写进 `status`（[05](05-permissions.md)）。

### 第四步：在 node 里测

SDK 对宿主是延迟绑定的：`import` 不会碰 `__jarvisHost`，真的调能力时才找。配合 `@fusionseek/jarvis-extension-sdk/testing`：

```ts
import { createTestHost } from "@fusionseek/jarvis-extension-sdk/testing";
const host = createTestHost({ async: { "clipboard.read": async () => "hello" } });
await import("../dist/extension.js");            // 或直接 import 源码里的 defineExtension(...)

// 有界面的扩展：
host.dispatch({ type: "activate", context: { entry: "toolbox", surface: "toolbox", granted: [], preferences: {}, commands: [] } });
host.dispatch({ type: "command", context: { id: "count", trigger: "slash", scope: "launcher", argument: "你好", granted: [], preferences: {} } });
await host.settle();
host.find((n) => n.kind === "readout");           // 最新一棵树里的节点
await host.fire(host.find((n) => n.key === "input"), "change", "hi");

// 服务扩展：
const { result, progress } = await host.callService({ service: "mole", method: "run", granted: ["process.run", "files.read"] });
```

替身不画界面、不管授权：它证明的只是"逻辑对不对"。授权、拒绝态与受限执行的放行，要靠你在桩里抛
`{ code: "permission.denied", message: "…" }` 自己演一遍。节点目录见 [07](07-ui-components.md)。

用了 Android 操作域的扩展，设备那一侧用 `fakeAndroid()`：它按宿主的规则答 `android.*`（1…8 个包、设备要 ready、工具只认两种），
`failNext()` 演「未找到 adb」「没有 aapt2」，`holdDetails()` 挂住读名字、`maxDetailsInFlight` 断言「一次一批」：

```ts
import { createTestHost, fakeAndroid } from "@fusionseek/jarvis-extension-sdk/testing";
const phone = fakeAndroid({ devices: [{ serial: "R5CX", name: "Pixel 8", apps: [/* … */], details: { /* 包名 → { label, icon } */ } }] });
const host = createTestHost({ async: { ...phone.stubs } });
phone.failNext("appDetails", { code: "host.failure", message: "没有 aapt2，读不出应用名和图标" });
```

菜单栏扩展不用给 `menuBar.update` 写桩：替身自己收下模型（`host.menuBarModels` / `host.latestMenuBar`），`menuBarEvent()` 发事件并等落定；
`select` 只能点到最新一份模型里点得到的那一项（不在、被禁用的直接抛错）：

```ts
await host.menuBarEvent("start", { granted: ["process.daemon"], preferences: { mixedPort: 7890 } });
await host.menuBarEvent("select", { itemId: "toggle" });
assert.equal(host.menuItem("toggle").checked, true);
```

用了常驻进程与系统代理的扩展（SDK 2.9）用 `fakeDaemons()`：它按宿主的规则答 `daemon.*` 与 `systemProxy.*`（配置该带没带、已在运行、控制口路径与请求头、
没有在跑的常驻进程不让接管系统代理……），`configs` 留下每次起进程交来的配置正文，`respond` 演控制口的应答，
`output()` / `crash()` 往订阅者推事件，进程没了就照宿主兜底把系统代理还原，`blockSystemProxy()` 演「被 Surge 拦着」：

```ts
import { createTestHost, fakeDaemons } from "@fusionseek/jarvis-extension-sdk/testing";
const daemons = fakeDaemons({ daemons: [{ id: "sing-box", config: true }] });
const host = createTestHost({ async: { ...daemons.stubs } });
daemons.respond = (request) => ({ status: 200, headers: {}, text: "{}" });
daemons.crash("sing-box", { signal: 9 });          // 订阅者收到 expected: false 的 exit；系统代理回到没人接管
```

### 第五步：构建与校验

```bash
node scripts/build-extension.mjs extensions/<id>          # → dist/extension.js
node scripts/validate.mjs extensions/<id>                 # schema v2 + 跨字段 + bundle 检查
npm run verify                                            # 提 PR 前：SDK、全部扩展的测试 / 类型 / 构建 / 校验 / 索引
```

构建是 esbuild 的一次 `bundle`（IIFE、ES2020、不压缩、把 SDK 内联进去）。**产物提交进仓库**：宿主只认 `dist/extension.js`，
CI 重新构建一遍并比对哈希——手改产物或忘了重建都会在 PR 里红。校验脚本查什么见 [03](03-manifest.md)；SF Symbol 是否存在它查不了。

### 第六步：提 PR

1. `npm run registry` 重新生成 `registry.json`（**不手改**）；升了版本跑一次 `npm install` 让 `package-lock.json` 跟上。
2. 一个扩展一个 PR，标题 `feat(<id>): <一句话>`，正文英文 bullets 在前、等量中文 bullets 在后。
3. PR 模板让你逐条勾 [13 · 审核清单](13-review-checklist.md)。
4. CI：`npm run verify` + `node scripts/check-pr.mjs`（版本相对主干递增、`registry.json` 只动本次的扩展、锁文件跟上）。
5. 合并后，用户的 Jarvis 下一次同步快照（打开商店时自动检查，或「立即同步」）就看得到。

### 更新一个已上架的扩展

- 改代码就得 **`version` +1**；不升版本 CI 拒绝，宿主也不会把它当更新。
- 新增了能力的版本，用户下一次进入（或下一次启用服务）时只问新增的那几项。
- 改了 `process` / `files` 声明对象：授权屏与商店详情会逐字列出新的对象；审核按新增项重读。
- 删掉的偏好 key 用户那边留着不读；改 `id` 等于新扩展。

## Usage

```bash
cp -R templates/hello-extension extensions/word-count && cd extensions/word-count
# 改 extension.json（id、name、指令词）、package.json（name、version）、src/index.ts
cd ../.. && npm install && npm run verify
```

## Gotchas

| 现象 | 原因 |
| --- | --- |
| 进入扩展直接是错误屏「找不到 __jarvisHost」 | bundle 在宿主之外被执行了；在 node 里先 `createTestHost()` 再 import |
| `capability.undeclared` | manifest 没声明那项能力，或受限执行的可执行文件 / 参数 / 路径不是声明过的那一个 |
| `surface.unavailable` | 后台会话里碰了面板或窗口；或调 `window.open()` 却没有入驻窗口域 |
| `capability.unknown` | 调了宿主这一版不认识的方法（多半是 `minimumJarvisVersion` 写低了） |
| `/` 指令没出现 | 撞了内置词或别的扩展（设置 › 扩展 那块面板里有一行红字） |
| 列表增删时输入框丢焦点 | 行没有 `key` |

- 没有本地加载：真机上第一次看到它是合并之后。把逻辑写进可测的模块、把每一种拒绝态在替身里演一遍，就是为了让这一步不出意外。
- `npm run check:extensions` 也查 `templates/`：改了 SDK 类型，模板要跟着能编译。

## Related Links

- [03 · manifest 规范](03-manifest.md)
- [06 · 能力接口目录](06-capabilities.md)
- [13 · 审核清单](13-review-checklist.md)
- [`templates/hello-extension`](../templates/hello-extension)（工具箱 + 指令）、[`extensions/http-status`](../extensions/http-status)（工具箱 + 窗口 + 弹窗 + 设置）、
  [`extensions/mole-clean`](../extensions/mole-clean)（服务 + 受限执行）、[`extensions/proxy`](../extensions/proxy)（菜单栏 + 常驻进程 + 系统代理，SDK 2.9）
- `jarvis-mac/specs/20261028-091917-proxy-extension-menubar-daemon/spec.md`（菜单栏域、常驻进程、系统代理的规则全文）
