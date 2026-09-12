# 审核清单

## Overview

上架靠 PR 审核，审核靠这份清单。它是 PR 模板里那些勾选框的真源；CI 能查的标了「CI」，
其余由审核者对着 Jarvis 的开发者模式走一遍。

一条不过就不合并——没有"先合了下个版本再补"。扩展一旦出现在扩展库里就在别人的机器上跑。

## manifest

- [ ] CI · `extension.json` 过 `schemas/extension.v1.schema.json`
- [ ] CI · `id` 等于目录名、不与保留 id 撞名、全仓唯一
- [ ] CI · `version` 相对主干递增（新扩展从 `0.1.0` 或 `1.0.0` 起）
- [ ] CI · 跨字段规则：`network.https` ⇔ `network.hosts`；`inbox.cards` ⇒ `inbox.post`；`inbox.notifications` ⇒ `notifications.post`；`background` ⇒ 有后台要做的事
- [ ] CI · `capabilities` 里没有重复 id
- [ ] 每一项 `reason` 写的是**拿它做什么**，不是"为了更好的体验"
- [ ] 声明的能力与代码里调用的一致：多声明的问一句，少声明的运行时会报 `capability.undeclared`
- [ ] `toolbox.name` ≤ 6 个汉字（宫格与 header 两处都不截）；`subtitle` 一句话说清它替我做什么
- [ ] `keywords` 只装标题与说明里没有的词
- [ ] `settings` 与 `inbox` 显式回答了（`false` 也是回答）
- [ ] `minimumJarvisVersion` 是用到的能力最早出现的那一版，不是随手写的

## 产物

- [ ] CI · `dist/extension.js` 存在、≤ 512 KB、用 `scripts/build-extension.mjs` 重建后哈希一致
- [ ] CI · bundle 里没有 `XMLHttpRequest` / `WebSocket` / `require(` / `importScripts` / `eval(` / `new Function(`
- [ ] CI · `registry.json` 由脚本生成且与各 manifest 一致
- [ ] `src/` 与 `dist/` 同一次改动里一起变；没有"只改产物"的提交

## 四个部分

- [ ] 工具箱：那一行的图标是有效 SF Symbol（开发者模式日志无「符号不存在」）；列表与宫格两种排布都看过
- [ ] 页面：进入即可读——不是空白、不是转圈超过 220ms 才有内容；根节点是 `scroll` 或内容确定装得下
- [ ] 授权：把弹窗里每一项都关掉再进，页面画得出**每一项**的拒绝态，且有一颗 `request` 按钮或一句说明
- [ ] 设置：有偏好的，改一次能在页面上看到变化；没有的，面板里只有开关 / 授权 / 卸载
- [ ] Inbox：有卡的，卡上的动作按下去做的事与标题一致；同一件事只投一张卡；没有"营销卡"

## 设计与交互

- [ ] 只用节点目录里的东西；没有为了某个效果拼出来的"伪控件"（比如用 `text` 画一条进度）
- [ ] 一块面板上只有一颗 `primary` 按钮
- [ ] 破坏性动作走 `button.confirm`，不是弹一句"确定吗"
- [ ] 失效的控件 `disabled` 而不是不渲染
- [ ] 空态 / 拒绝态 / 错误态各是一屏说明（`empty` / `note`），不是一句红字
- [ ] 中文文案；英文名进 `keywords`；段标题的英文副标是可选装饰
- [ ] 列表行都有 `key`
- [ ] 图标按钮与带符号的动作都有 `label` / `help`
- [ ] 三档辅助功能各看过一遍；Reduce Motion 下没有依赖动画才能读到的信息
- [ ] VoiceOver 能 Tab 遍历全部可交互节点

## 行为

- [ ] 没有"从进入 hold 到离开"；`hold` 都有对应的 `release`
- [ ] 快传：不在 `sendText` 里悄悄 `start()`；服务没开时给用户一颗按钮
- [ ] 剪贴板：只在用户动作里读；`observe` 只用于页面开着时的联动
- [ ] 网络：只访问 `network.hosts` 里的主机；请求里没有用户没同意的数据（剪贴板内容、速记正文、文件名）
- [ ] 存储：只存该记住的小东西；没有把文件、图片塞进 `storage`
- [ ] 后台：`background: true` 的扩展在后台确实只做它声明的那件事（投卡 / 观察）

## 安全

- [ ] 源码可读、没有混淆、没有从网络加载代码的路径
- [ ] 没有硬编码的密钥、token、私有地址
- [ ] `net.fetch` 的目标主机是作者能说明用途的（不是一个中转 / 上报地址）
- [ ] README 写清它读了什么、发了什么、存了什么

## 文档

- [ ] `README.md`：一句话、要哪些授权及为什么、怎么用、已知边界
- [ ] 改动了能力 / 偏好 / Inbox 行为时 README 同步

## 审核者的三个动作

1. 在开发者模式里装上，按「四个部分」与「设计与交互」逐条过。
2. 读一遍 `src/`：每一个 `jarvis.*` 调用对应 manifest 里的一项，每一项 `permission.denied` 有分支。
3. 看 `registry.json` 的 diff 只多（或只改）这一个扩展。

## Related Links

- [12 · 开发手册](12-developer-guide.md)
- [03 · manifest 规范](03-manifest.md)
- [AGENTS.md](../AGENTS.md)
