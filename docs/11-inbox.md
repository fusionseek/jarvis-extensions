# Inbox 通路

## Overview

Inbox 是浮窗展开后的第一屏，装的是"发生了什么"：Agent 任务、消息、图片、速记提醒、更新通告。
扩展不是一个"域"，但有两条往外交结果的通路：**往 Inbox 投一条消息**，以及**弹一条系统横幅**。

它们存在的理由是**静默命令与服务**：后台会话没有任何一面，用户按下快捷键之后、关上面板之后，
结果只能落在这两处（或剪贴板）。有界面的扩展在界面上交结果，很少需要它们。

v2 只保留最小的一种：**一条纯文本消息**。v1 的扩展卡片（带动作、能 `dismiss`、落盘 7 天、点卡片回到扩展页）整套删掉——
一张带按钮的卡等于让第三方在 Inbox 顶部开一扇对话窗，而 Inbox 不是对话。

## Concepts

### 声明

manifest 的 `inbox` 必须显式回答（[03](03-manifest.md)）：

| 写法 | 含义 | 要同时声明 |
| --- | --- | --- |
| `false` | 不碰 Inbox，也不弹横幅 | — |
| `{ "messages": true, "notifications": false }` | 往 Inbox 投消息 | `inbox.post` |
| `{ "messages": false, "notifications": true }` | 只弹横幅（静默命令的回执「已复制译文」） | `notifications.post` |
| 两者都 `true` | 两条都走 | 两项都声明 |

`false` 也是回答：审核时一眼看得出它会不会在用户没看着的时候说话。

### 消息长什么样

`jarvis.inbox.post({ title, body, level })` 由宿主变成一条普通的 Inbox 消息，与 WebSocket 进来的 `message`
走同一条 `AppModel.apply(.message)`：同一种消息卡、同一套未读与角标——屏幕上没有任何新组件。

| 字段 | 宿主怎么处理 | 为什么 |
| --- | --- | --- |
| 标题 | `<扩展名> · <title>`，`title` 截到 60 字 | Inbox 里分得出这一条是谁投的——扩展不能冒充 Jarvis 自己说话 |
| 正文 | 截到 400 字，纯文本 | 卡片上不允许扩展画节点树 |
| `level` | `info`（默认）/ `success` / `warning` / `error`，决定消息卡的语义色 | 与 Agent 消息同一条规则 |
| 横幅 | **不弹**（`notify: false`） | 要横幅另调 `notifications.post`，两条通路各自声明、各自限频 |
| 动作、撤回、id | 没有 | 投出去就是用户的了；要接着交互，让用户回到扩展的界面 |

### 横幅

`jarvis.notifications.post({ title, body })` 弹一条系统横幅：

- 走 Jarvis 的通知通道，声音由用户的提示音设置决定，扩展不能指定；
- **没有按钮、没有点击回调**：`UNNotificationAction` 要按 category 应用级注册，给每个扩展注册一套等于把系统的通知数据库交给第三方；
- 用户在系统设置里关了 Jarvis 的通知时静默不弹，`post` 照常 resolve——横幅本来就是尽力而为。

### 限频

| 通路 | 上限 | 为什么 |
| --- | --- | --- |
| `inbox.post` | 每分钟 6 条 | 一个每秒投一条的扩展会让角标像秒表 |
| `notifications.post` | 每分钟 6 条 | 同上，横幅打断得更狠 |

超出 → `rate.limited`。限频挡的是失控，不是礼貌：同一件事在一分钟里投两次已经多了，审核按这个读。

### 判据：什么值得投

| 该投 | 不该投 |
| --- | --- |
| 静默命令跑完的结果（「已复制译文」「已推到 iPhone」） | 有界面的扩展在界面上已经画出来的东西 |
| 服务后台跑完、用户已经离开面板（清理报告由宿主写，服务不需要自己投） | 进度、心跳、"我还活着" |
| 一件需要用户知道的失败（「快传没有开着，没有发出去」） | 营销、更新提示（更新由商店负责） |

## Usage

```ts
// 静默命令：截屏翻译，译文进剪贴板，再说一声
async function translateSilently() {
  const text = await translateCapture();
  await jarvis.clipboard.write(text);
  await jarvis.notifications.post({ title: "已复制译文", body: text.slice(0, 80) });
}

// 静默命令：发到手机，失败要让用户知道
try {
  await jarvis.quickTransfer.sendText(text);
  await jarvis.inbox.post({ title: "已推到手机", body: text.slice(0, 120), level: "success" });
} catch (e) {
  await jarvis.inbox.post({ title: "没有发出去", body: e instanceof JarvisError ? e.detail ?? e.message : String(e), level: "warning" });
}
```

## Gotchas

- 消息标题前面恒有扩展名；你写的 `title` 是冒号后那一段。
- 没有 `dismiss`、没有卡片 id：同一件事别连投三条，用户会收到三条。
- 横幅没有点击回调；点横幅只是把 Jarvis 叫到前面。
- 没声明 `inbox.messages` 就调 `inbox.post` → `capability.undeclared`；声明了用户没点头 → `permission.denied`。
  后台会话里不会弹授权，静默命令的这两项要靠用户在设置 › 扩展 里打开。

## Related Links

- [03 · manifest 规范](03-manifest.md)（`inbox`）
- [06 · 能力接口目录](06-capabilities.md)（`inbox.post` / `notifications.post`）
- `jarvis-mac/Sources/Jarvis/App/Extensions/ExtensionCapabilityHost.swift`（`inbox.post`）、`Domain/StatusModels.swift`（`DisplayMessage`）
