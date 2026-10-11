# 审核清单

## Overview

上架靠 PR 审核，审核靠这份清单。它是 PR 模板里那些勾选框的真源；CI 能查的标了「CI」，其余由审核者读源码、
跑 node 测试、对着 manifest 逐字核对。

一条不过就不合并——没有"先合了下个版本再补"。扩展一旦出现在扩展商店里就在别人的机器上跑；
声明了受限执行的扩展，跑起来的命令拥有 Jarvis 的全部系统权限，**含完全磁盘访问**。

## Concepts

### manifest

- [ ] CI · `extension.json` 过 `schemas/extension.v2.schema.json`（`manifestVersion: 2`，`additionalProperties: false`）
- [ ] CI · `id` 等于目录名、不与保留 id 撞名、全仓唯一
- [ ] CI · `version` 相对主干递增（新扩展从 `0.1.0` 或 `1.0.0` 起）；`package-lock.json` 跟上
- [ ] CI · `contributes` 至少入驻工具箱、窗口、指令、服务之一
- [ ] CI · 跨字段：`network.https` ⇔ `network.hosts`；`process.run` ⇔ `process.executables`；`terminal.run` ⇔ `process.terminal`；
      `files.read` 能力 ⇔ `files.read` 路径；`inbox.messages` ⇔ `inbox.post`；`inbox.notifications` ⇔ `notifications.post`
- [ ] CI · 命令：id 唯一、快捷键不重复、带快捷键 ⇔ 声明 `hotkeys.register`；落点 `toolbox` / `popover` 要有工具箱域、`window` 要有窗口域；
      `silent` 至少有 `clipboard.write` / `notifications.post` / `inbox.post` 之一
- [ ] CI · `/` 指令词不撞内置保留词、不撞仓库里别的扩展
- [ ] CI · 偏好 key 在设置与各服务之间不重复；`keywords` 不重复名字与说明里已有的词
- [ ] 每一项 `reason` 写的是**拿它做什么**，不是"为了更好的体验"
- [ ] 声明的能力与代码里调用的一致：多声明的问一句，少声明的运行时会报 `capability.undeclared`
- [ ] `name` ≤ 6 个汉字最稳（header 与目录两处都不截）；`toolbox.subtitle` 一句话说清它替我做什么
- [ ] `minimumJarvisVersion` 是用到的能力最早出现的那一版

### 受限执行（声明了 `process.run` / `files.read` / `terminal.run` 的扩展）

审核者**必须逐字读**下面每一个对象，不是看一眼数量。授权屏与商店详情会把它们原样列给用户——
审核者是用户之前最后一个读它们的人。

- [ ] `process.executables[].name`：每一个都是一个说得出名字的第三方工具（`mo`），不是通用解释器或系统工具
      （`sh`、`bash`、`zsh`、`python3`、`node`、`osascript`、`rm`、`curl`、`sudo` 一律不过）
- [ ] `process.executables[].arguments`：**每一组**逐项读完，问一句"这一组会删什么、写什么、发什么"；
      没有任何一组让外部工具执行用户以外的输入（`-c`、`--eval`、`--exec`、把一个参数当脚本的那类）
- [ ] 参数组合是**最小**的：只有代码里真的会传的那几组；`--dry-run` 与真跑分开声明
- [ ] 代码里 `jarvis.process.run` 的每一处调用，`arguments` 都能在 manifest 里逐字找到（宿主会拦，但审核要先看见）
- [ ] `process.locate` 失败时扩展报"找不到"，不去猜别的路径；用户在偏好里填的路径只当路径用
- [ ] `files.read`：每一个路径都写出它是谁的文件、为什么要读；没有 `~/Library/Keychains`、`~/.ssh`、浏览器配置、Mail、Messages 这类目录；
      只读日志类、工具自己写的状态文件
- [ ] `process.terminal[].script`：**整段读完**；它只做标题说的那一件事（例如"用 Homebrew 装 Mole"）；
      不从网络拉脚本再执行，除非那就是工具官方的安装方式、且脚本里写明出处 URL（`mole-clean` 的「安装 Mole」是这一种）；没有 `sudo`
- [ ] README 的授权一节逐项写出会运行的命令与参数、会读取的路径、终端脚本做什么，与 manifest 逐字一致，
      并写明「运行起来的命令拥有 Jarvis 的全部系统权限（含完全磁盘访问）」

### 服务（`contributes.services`）

- [ ] `point` 是宿主开放的扩展点（这一版只有 `junkClean.engine`）
- [ ] `title` / `subtitle` / `notes` 写的是它比内置的**多做了什么**、以及会永久删除什么
- [ ] `status()` 快：不跑清理、不联网、不弹终端；只 `locate` 与读版本
- [ ] `status()` 在缺授权、找不到工具、工具版本不对时给 `ready: false` 与一句人话，以及能修好它的动作
- [ ] `run()` 不抛错：失败写进 `failure`，部分成功照常报告；`progress` 不刷屏（宿主会合批，但别每行一次）
- [ ] `run()` 响应取消：`signal.onCancel` 里 `cancel()` 掉在跑的进程
- [ ] `action()` 只做它那颗按钮说的事；需要宿主盯住结果时回 `watchStatus: true`
- [ ] 没有在服务里碰面板、窗口、弹窗（后台会话里一律 `surface.unavailable`）

### 产物

- [ ] CI · `dist/extension.js` 存在、≤ 512 KB、用 `scripts/build-extension.mjs` 重建后哈希一致
- [ ] CI · bundle 里没有 `XMLHttpRequest` / `WebSocket` / `require(` / `importScripts` / `eval(` / `new Function(`
- [ ] CI · `registry.json`（v2，每条带整份 manifest）由脚本生成、与各 manifest 一致，且只动本次的扩展
- [ ] `src/` 与 `dist/` 同一次改动里一起变；没有"只改产物"的提交

### 界面（工具箱 / 窗口 / 弹窗）

- [ ] 页面：进入即可读——不是空白、不是转圈超过 220ms 才有内容；根节点是 `scroll` 或内容确定装得下
- [ ] 窗口那一面（若入驻）：在 720 宽的正文列里读得顺，没有只在 368 宽里成立的折行假设
- [ ] `popover` 命令给了 `defineExtension({ popover })`，或 `toolbox` 那棵树在 400 宽、最高 520 的弹窗里读得顺
- [ ] 授权：把授权屏上每一项都关掉再进（在替身里抛 `permission.denied`），页面画得出**每一项**的拒绝态，有一颗 `request` 按钮或一句说明
- [ ] 只用节点目录里的东西；没有为了某个效果拼出来的"伪控件"
- [ ] 一块面板上只有一颗 `primary` 按钮；破坏性动作走 `button.confirm`；失效的控件 `disabled` 而不是不渲染
- [ ] 空态 / 拒绝态 / 错误态各是一屏说明（`empty` / `note`），不是一句红字
- [ ] 中文文案；英文名进 `keywords`；列表行都有 `key`；图标按钮与带符号的动作都有 `label` / `help`

### 指令

- [ ] `defineExtension({ commands })` 里每条 manifest 命令都有处理函数
- [ ] `/` 指令带参数的，处理函数处理了"没带参数"那一种
- [ ] `silent` 命令一定交结果（剪贴板 / 横幅 / Inbox），失败也说一声；不在后台悄悄做用户看不见的事
- [ ] 快捷键不占常用系统组合；不与内置截图、全局搜索那几组撞

### 行为

- [ ] 没有"从进入 hold 到离开"；`hold` 都有对应的 `release`
- [ ] 快传：不在 `sendText` 前悄悄 `start()`；服务没开时给用户一颗按钮
- [ ] 剪贴板：只在用户动作里读
- [ ] 网络：只访问 `network.hosts` 里的主机；请求里没有用户没同意的数据
- [ ] 存储：只存该记住的小东西；`secret` 偏好没有被写进 `storage`、日志或白名单之外的请求
- [ ] `permissions.request` 与 `panel.collapse` 只在用户动作的回调里调（宿主这一版没有硬拦）

### 安全与文档

- [ ] 源码可读、没有混淆、没有从网络加载代码的路径
- [ ] 没有硬编码的密钥、token、私有地址
- [ ] `net.fetch` 的目标主机是作者能说明用途的（不是一个中转 / 上报地址）
- [ ] `README.md`：一句话、入驻哪里、要哪些授权及为什么、会运行 / 读取什么（若有）、已知边界；改动了能力 / 偏好 / 声明对象时同步

## Usage

审核者的四个动作：

1. 逐字读 manifest：能力、`reason`、受限执行的每一个对象（本清单「受限执行」一节）。
2. 读一遍 `src/`：每一个 `jarvis.*` 调用对应 manifest 里的一项；每一处 `process.run` 的参数在声明里逐字找得到；每一项 `permission.denied` 有分支。
3. `npm run verify`，并读扩展自己的 `test/`：拒绝态、取消、失败路径有没有被演到。
4. 看 `registry.json` 的 diff 只多（或只改）这一个扩展。

## Gotchas

- v2 没有本地加载：审核时看不到真机效果。替身测试与逐字阅读是审核的全部依据——测试薄的 PR 要求补测试，而不是"合了再看"。
- 宿主会硬拦未声明的可执行文件、参数与路径；它拦不住的是**声明本身太宽**。这一关只有审核者能守。

## Related Links

- [12 · 开发手册](12-developer-guide.md)
- [03 · manifest 规范](03-manifest.md)
- [05 · 能力授权模型](05-permissions.md)
- [AGENTS.md](../AGENTS.md)
