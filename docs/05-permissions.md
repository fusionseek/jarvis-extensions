# 能力授权模型与统一授权弹窗

## Overview

内置工具是 Jarvis 的一部分，用户装 Jarvis 时把权限给了它；扩展是别人写的。
因此**扩展能碰到的每一项宿主能力都要用户点一次头**，点头之前调用得到的是一个结构化的拒绝。

三条边界叠在一起：

| 层 | 谁说了算 | 扩展看到什么 |
| --- | --- | --- |
| 声明 | manifest `capabilities[]` | 没声明就调 → `capability.undeclared` |
| 用户授权 | `extension_grants` 表 | 没点头就调 → `permission.denied` |
| 系统权限 | macOS TCC（屏幕录制 / 辅助功能），属于 Jarvis | Jarvis 自己没拿到 → `permission.unavailable` |

"已获权的能力"这句话在这里的含义是：**Jarvis 已经向系统要到的权限，扩展可以借用，但要经过前两层**。
扩展永远不直接面对系统的授权弹窗——那是 Jarvis 与用户之间的事。

## Concepts

### 什么时候问

**第一次进入扩展页面时问一次，把 manifest 里声明的能力一次列完。** 用户的原话：
「在第一次进入时，需要向用户发起授权操作，得到用户认可后，才可以使用对应的快传功能」。

不在安装时问：装了没用过的扩展不该拿着任何能力。不在每次调用时问：一个每按一下就弹一次的工具
教会用户闭着眼点允许。

之后再问只有三种情形：

| 情形 | 弹窗范围 |
| --- | --- |
| 更新后的版本**新增**了能力 | 只列新增的那几项，标题写「新版本多要了 N 项能力」 |
| 扩展调用 `jarvis.permissions.request(ids)` | 只列传进来的、且 manifest 声明过的那几项；必须发生在用户动作 1 秒内 |
| 用户在设置页撤销后扩展再次进入 | 不自动问；扩展调用时得到 `permission.denied`，它可以在用户动作里 `request` |

### 弹窗长什么样

它是宿主的第二类窗口（先例：恢复会话确认弹窗 `ResumeSessionDialog`、更新弹窗），
不受 400×520 约束；用户主动点进扩展才出现，因此**拿焦点**（`Esc` = 暂不、`Return` = 允许）。
面板在弹窗期间 `holdsPanelOpen`（同文件选择器那条规则），不会在用户读清单时被 15 秒倒计时收走。

```text
┌──────────────────────────────── 420 ────────────────────────────────┐
│ [井 32] 发到手机                                          v1.0.0    │
│         fusionseek · 4 项能力                                       │
│                                                                    │
│ 这个扩展想使用：                                                    │
│ ┌──────────────────────────────────────────────────────────────┐   │
│ │ [doc.on.clipboard] 读取剪贴板               中风险   [开关] │   │
│ │   读取要发送的文字或链接                                       │   │
│ ├──────────────────────────────────────────────────────────────┤   │
│ │ [antenna…] 查看快传状态                      中风险   [开关] │   │
│ │   知道快传开没开、有没有手机连着                                │   │
│ ├──────────────────────────────────────────────────────────────┤   │
│ │ [antenna…] 开启 / 停止快传                   高风险   [开关] │   │
│ │   快传没开时替你打开 · 会对局域网开一个端口                     │   │
│ ├──────────────────────────────────────────────────────────────┤   │
│ │ [antenna…] 经快传发送                        高风险   [开关] │   │
│ │   把内容推到手机                                               │   │
│ └──────────────────────────────────────────────────────────────┘   │
│ 随时可以在 设置 › 扩展 里撤销。扩展来自 github.com/fusionseek/…      │
│                                                                    │
│                                   [ 暂不 ]  [ 允许并打开 ]         │
└────────────────────────────────────────────────────────────────────┘
```

| 元素 | 规格 | 为什么 |
| --- | --- | --- |
| 窗 | 宽 420、圆角 18、内距 24、底 `#12121F` @ **98%**、白 10% 描边、背景模糊 32、投影 r48/y20 @55% | 与 `ResumeDialog` 逐值相同：它是模态，压在任意内容之上，93% 会让底下的字穿上来 |
| 头 | 32pt 图标井（`toolbox.symbol`）+ 名 17pt SemiBold + 版本 11pt footnote；第二行 作者 · N 项能力 | 与恢复会话弹窗的目录标题同构 |
| 能力行 | 44pt 高、行距 0、行间发丝线；左 18pt 符号列、标题 13pt semibold、`reason` 11pt `subtleText`、右端档位标签 + 玻璃开关（`SettingsGlassToggleStyle`） | 借 `HostSoundTakeoverSheet`「逐条确认」的形态：默认全开、每条可单独关。这道逐条不是礼貌，是"把别人的代码放进来"这件事能成立的前提 |
| 档位标签 | `SettingsStatusBadge`：低风险 `footnoteText` 灰 / 中风险 `accent` 青 / 高风险 `alert` 橙 | 三档只换色不换形；橙是这套体系里既有的"需要你注意" |
| 高风险行的第三句 | 宿主追加，不由扩展写：`network.https` → 「会访问：api.example.com, …」；`quickTransfer.control` → 「会对局域网开一个端口」；`screenshot.capture` → 「会看到你的屏幕」；`clipboard.history` → 「包括你之前复制过的内容」 | `reason` 是扩展说的话，这一句是宿主说的话；用户要同时听到两边 |
| 脚注 | 11pt footnote：撤销的位置 + 源码地址 | 一个能撤销的授权才敢给 |
| 按钮 | 34pt 高、圆角 9；「允许并打开」accent 底 16% / 边 45% + 常驻炫彩描边（它是这扇窗里唯一要用户做决定的地方）；「暂不」白 5% / 10% | 与 `ResumeDialog.Button` 逐值相同 |
| 全部关掉时 | 主按钮文案变成「不授权，仍然打开」 | 用户关掉全部开关仍然可以进去看看；扩展要自己画出受限态 |
| Reduce Motion | 炫彩描边停转；Reduce Transparency 不透明底；Increase Contrast 描边 1.5pt | 三档必有 |
| VoiceOver | 窗标签「授权扩展 发到手机」；每行 `accessibilityValue` 读开关状态与档位 | — |

**弹窗上不允许出现扩展自己写的任何富文本**：`reason` 是 4–60 字的纯文本，宿主转义显示。
扩展没有办法在这里画一个"允许"按钮骗用户。

### 点了之后

- 「允许并打开」：按开关状态逐项写 `extension_grants`（`granted = 1 / 0`，`decided_at = now`），
  然后 `activate`，`context.granted` 里是拿到的那几项。
- 「暂不」：**什么都不写**，扩展照常 `activate`，`context.granted` 为空；下一次进入**再问一次**——
  「暂不」是"这次不想看"，不是"不要"。
- 关掉某一项再「允许并打开」：那一项写 `granted = 0`，下次进入**不再问它**；扩展调用时 `permission.denied`。
  用户改主意去设置页拨开关。

### 撤销与查看

设置页「扩展」区段里，每个扩展的面板有一列「已授权」：每项一颗玻璃开关，关掉即撤销，
下一次调用即刻拒绝（运行中的扩展收到 `permissionsChanged`）。旁边写 `decided_at`。
没有"一键全部允许"——那正是逐条确认要避免的东西。

### 扩展该怎么对待拒绝

`permission.denied` 与 `permission.unavailable` 是**状态，不是错误**。扩展页面必须能在没有任何授权的
情况下画出一屏说得清楚的东西（数据导出的「访问受限」那一屏是范式）：

```ts
try {
  text = await jarvis.clipboard.read();
} catch (e) {
  if (e instanceof JarvisError && e.code === "permission.denied") {
    // 画一张 note：「没有读取剪贴板的授权」+ 一颗按钮 → jarvis.permissions.request(["clipboard.read"])
    // 那颗按钮的 onPress 里调用 request：它在用户动作 1 秒内，宿主放行
  }
  if (e instanceof JarvisError && e.code === "permission.unavailable") {
    // 画一张 note：「Jarvis 还没有屏幕录制权限」+ 一颗按钮 → jarvis.permissions.openSystemSettings("screenRecording")
  }
}
```

审核清单里有一条：**每一项声明的能力都有对应的拒绝态界面**。

### 能力风险档位

档位是宿主对用户的承诺，写在 SDK 的 `capabilityTiers` 里，扩展改不了：

| 档 | 能力 | 判据 |
| --- | --- | --- |
| 低 | `tasks.read`、`calendar.read`、`system.openURL`、`files.pick` | 只读汇总数据，或每次都经用户之手（选文件、开浏览器） |
| 中 | `clipboard.read`、`clipboard.write`、`memo.read`、`memo.write`、`notifications.post`、`inbox.post`、`quickTransfer.status`、`quickTransfer.records` | 读或写用户自己的数据，但不出本机、不看历史 |
| 高 | `clipboard.history`、`quickTransfer.control`、`quickTransfer.send`、`screenshot.capture`、`network.https` | 看得到历史、出得了本机、开得了端口、看得见屏幕 |

### 系统权限的借用

| 能力 | 依赖的系统权限 | Jarvis 没拿到时 |
| --- | --- | --- |
| `screenshot.capture` | 屏幕录制 | `permission.unavailable`；`openSystemSettings("screenRecording")` 走 `PermissionHandoffCoordinator.begin(.screenRecording)`——打开隐私面板并上「把 Jarvis 拖进列表」那扇浮窗 |
| `notifications.post` | 通知 | 宿主照常请求一次系统通知授权（既有路径）；被拒时静默不弹，**不算失败**，Promise 正常 resolve——横幅本来就是"尽力而为" |

辅助功能（常用词那条）在 v1 没有对应能力。

## Gotchas

- 弹窗只在**面板展开着**时出现；扩展在后台（`background: true`）被 Inbox 动作唤醒时不弹，
  没授权的调用直接拒绝。
- 更新后新增的能力在下次进入时问；撤销过的不重问。
- `panel.*`、`storage.*`、`preferences.*`、`text.*`、`time.*`、`color.*` 不进弹窗——它们碰不到用户的数据。
  `copy` 节点写剪贴板也不需要 `clipboard.write`：那是用户按下复制钮的那一下，与内置工具的复制钮同一种事。

## Related Links

- [03 · manifest 规范](03-manifest.md)
- [06 · 能力接口目录](06-capabilities.md)
- `jarvis-mac/Sources/Jarvis/UI/ResumeSessionDialog.swift`、`HostSoundTakeoverSheet.swift`、
  `App/PermissionHandoffCoordinator.swift`
