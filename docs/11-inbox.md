# Inbox 接入（第四部分）

## Overview

Inbox 是浮窗展开后的第一屏，装的是"发生了什么"：Agent 任务、消息卡、图片、速记提醒、更新通告。
扩展可以往它顶部那一段投**一张卡**——与速记提醒卡、更新通告卡同一种东西：一件需要用户
看一眼或做点什么的事，带一两颗按钮，处理完就走。

它不是通知流、不是日志、不是营销位。判据只有一条：**这张卡上有没有一件用户此刻要做的事**。

## Concepts

### 卡片长什么样

借速记提醒卡（Figma `689:23`、`JarvisDesign.Memo.InboxCard`）的解剖，一个像素都不新造：

```text
┌ 卡片（tint 10% 底 / 16% 边，圆角 12，内距 12）───────────────────┐
│ [符号 15pt, 18pt 列]  发到手机                          12:41   │  ← 15 semibold rowTitle · 时刻 12 等宽
│                       已推到 iPhone · Safari                    │  ← 正文 15 titleText，≤ 2 行
│                       「会议 3 点改到 4 点」                     │  ← 说明 13 subtleText，1 行
│                       [ 撤回 ]  [ 知道了 ]                      │  ← 动作 28 高，主次两档
└──────────────────────────────────────────────────────────────────┘
```

| 字段 | 来源 | 限制 |
| --- | --- | --- |
| 行首符号 | `card.symbol`，没有时用 `toolbox.symbol` | SF Symbol |
| 标题 | **恒为扩展名**（`toolbox.name`） | 扩展改不了：用户要一眼知道这张卡是谁投的 |
| 时刻 | `posted_at` | 宿主 |
| 正文 | `card.title` | ≤ 60 字，2 行尾截断 |
| 说明 | `card.body` | ≤ 240 字，1 行尾截断；点卡片展开到 4 行 |
| 语义色 | `card.tint`：`accent` / `live` / `alert` / `danger` / `violet`；默认 `alert` | 与更新通告（橙）、消息卡（按等级）同一条规则：带语义色 = 这不是一条任务记录 |
| 动作 | `card.actions` ≤ 3 颗；`primary: true` 那颗青底；最右恒为宿主加的「×」 | 按下后宿主先收卡再调 `onInboxAction` |
| 来源徽标 | 无 | 标题已经是扩展名，再挂一枚胶囊是同一件事说两遍 |

### 位置与顺序

Inbox 顶部那一段（"需要你做点什么"）的顺序：

```text
更新通告（置顶态） → 速记提醒卡 → 扩展卡（按 posted_at 倒序） → 消息卡 → 图片 → 最近记录
```

扩展卡排在速记之后：更新通告是全局的，速记提醒是用户自己排的，扩展卡是第三方说的话——
三者都要用户做点什么，但可信度递减，位置随之靠后。

**扩展卡不进「最近记录」列表。** 那一列装的是 Agent 任务与降级后的更新通告，处理完的扩展卡直接消失，
不留一行历史——扩展想留历史用 `storage`，自己在页面里画。

### 未读与已读

投递即标未读：`UnreadItemKey.extension("<id>:<cardId>")`，球上的角标 +1、贴边细条上的红点亮起、
贴边时浮窗弹出 2.8 秒——与任务、消息、速记提醒**同一套**，屏幕上没有任何新角标。

已读走同一条可见性判定（`reportsFeedFrame`）：卡片露出行高的 60% 且不少于 12pt 即算看过；
处理或撤走时未读键同批回收，角标不会停在一个清不掉的数字上。

### 规则

| 规则 | 值 | 为什么 |
| --- | --- | --- |
| 每扩展同一时刻**一张**活动卡 | 同 `card.id` 再投 = 替换；不同 `id` 再投 = 替换掉旧的 | Inbox 顶部那一段是用户每次展开的第一眼；一个扩展叠三张卡等于把 Agent 的任务挤出面板 |
| 频率 | 10 秒内最多一次 `post` | 一个每秒投一张的扩展会让角标像秒表 |
| 存活 | 用户点「×」、点任一动作、扩展 `dismiss(id)`，或 **7 天**后由宿主撤走 | 一张永远不走的卡与更新通告那次"常驻在上面"是同一个错 |
| 落盘 | `extension_inbox_cards`，重启还在 | 与更新通告同一条理由：用户下次打开面板、下次启动时它还该在原地 |
| 禁用 / 卸载 | 卡撤走、未读回收 | — |
| 内容 | 纯文本；宿主转义 | 卡片上不允许扩展画节点树 |

### 动作回调

按钮按下：宿主先把卡收走、回收未读，再 `dispatch({ type: "inboxAction", cardId, actionId })`。
扩展没在运行时（`background: false` 且页面没开）宿主会**为这一次回调加载上下文**、执行、
再销毁；回调里可以调它已授权的能力。回调**不能**再投一张卡来"接着问"——那是一次对话，Inbox 不是对话。

点卡片本体（不点按钮）= 展开面板到该扩展页面（`activate(context.entry = "inboxCard")`），卡**不收**。

### 系统横幅

`inbox.notifications: true` 且声明了 `notifications.post` 时，`post({ …, notify: true })` 同时弹一条
系统横幅：标题 = `card.title`、副标题 = 扩展名、正文 = `card.body`。点横幅 = 展开面板到该扩展页面
（`entry = "notification"`，并调 `onNotificationActivated`），与点卡片本体同一条路。

横幅**没有按钮**：`UNNotificationAction` 要注册 category，而 category 是应用级注册的；
给每个扩展注册一套等于把系统的通知数据库交给第三方。要按钮的动作放在卡片上。

声音由用户的提示音设置决定（`AlertCue` 那四类里没有扩展这一类，因此走"消息"那一档）；
扩展不能指定声音。通知权限被拒时横幅静默不弹，`post` 照常 resolve——横幅本来就是尽力而为。

`jarvis.notifications.post` 单独调用（不带卡）也可以，同样的限制：60 秒内 ≤ 3 条、副标题恒为扩展名。

## Usage

```ts
// 一次发送成功之后
await jarvis.inbox.post({
  id: "sent",                    // 同一类事同一个 id：连发三次只会有一张卡，正文换成最新那次
  title: "已推到 iPhone · Safari",
  body: text.slice(0, 60),
  tint: "live",
  actions: [{ id: "undo", title: "撤回" }, { id: "ok", title: "知道了", primary: true }],
});

defineExtension({
  render,
  async onInboxAction(cardId, actionId) {
    if (cardId === "sent" && actionId === "undo") await jarvis.quickTransfer.sendText("（已撤回上一条）");
  },
});
```

## Gotchas

- 「知道了」这种只关卡的动作**不需要**——宿主已经给了「×」。给它是为了主次两颗按钮排版对称时才有意义。
- 卡上的标题是扩展名，不是你写的 `title`；你写的 `title` 是正文那一行。
- `background: false` 的扩展在后台投不了卡（没有上下文在跑）；它只能在页面开着时投，
  典型场景是"用户做了一件事、关掉面板之后还该看得见结果"。

## Related Links

- [03 · manifest 规范](03-manifest.md)（第四部分）
- [06 · 能力接口目录](06-capabilities.md)（`inbox.post` / `notifications.post`）
- `jarvis-mac/Sources/Jarvis/UI/FloatingStatusView.swift`（`memoReminderCard`、`updateNoticeCard`）、
  `Domain/UnreadState.swift`、`App/MemoReminderBridge.swift`
