# 截屏翻译 · 设计稿与实现对照

> Figma `hZeo5Kw9MxiE48AiOeRz1H` 页面 `9:78`，板子 **`jarvis-extension-screenshot-translate`（`983:2`）**，
> 位于 (2960, 46100)。参照 [Easydict](https://github.com/tisfeng/Easydict) 的截屏 OCR + Google 翻译，
> 只取核心逻辑：框选 → Vision 识字 → 合并段落 → 检测语言 → Google → **译文贴着选区原地弹出**；
> 不做划词、不做多引擎、不做跟随鼠标的浮窗。扩展 id 是 `translation`，板子沿用画稿时的名字。

## Overview

这块板子回答三个问题：

1. **松手之后译文出现在哪**——就在选区旁边（`sec-02`）。这是主路径的落点，和 Easydict 一样不用挪眼睛、不用去找面板。
2. **扩展页面在 400×520 的面板里长什么样**（`sec-01`，五种状态）——从原地弹窗「在面板里打开」或钉住之后落在这里，
   「翻译剪贴板」也落在这里。
3. **页面之外宿主替扩展画的东西**：第一次进入的授权弹窗、静默命令的横幅回执（`sec-03`），以及设置页里它那一块（`sec-04`）。

方向要分清：

- 面板 chrome、原地弹窗的窗体、授权弹窗、截图会话、横幅、设置页——**宿主画，代码是源，稿是镜像**（`jarvis-mac/CLAUDE.md` §0.2）。
  这些落在 `jarvis-mac` 的期 B（[docs/14](../../docs/14-host-integration-plan.md) D-B13…D-B16）。
- 弹窗与页面的内容——**扩展用 SDK 节点拼**，已在 `src/` 里实现：`popover.ts` 是弹窗那棵树，`page.ts` 是五态页面，
  `session.ts` 是它们共用的状态与编排，`google.ts` 是 Google 的两条路。

## 板子与节点号

| 帧 | 节点 | 尺寸 | 内容区 / body | 实现 |
| --- | --- | --- | --- | --- |
| `board-header` | `983:3` | — | — | — |
| `sec-01` 扩展页面 · 五态 | `983:8`（行 `983:15`） | — | — | `page.ts` `renderPage` |
| `translate-01-idle` | `983:34` | 400×520 | `983:66` / `984:2` | `fresh`：`captureSection` + `languageSection` + 脚注 |
| `translate-02-captured` | `983:174` | 400×520 | `983:206` / `984:41` | `phase === "done"`：`sourceSection` + `translationSection` + `actionsRow` + 脚注 |
| `translate-03-translating` | `983:314` | 400×520 | `983:346` / `984:70` | `phase === "translating"`：`progress` + `note`，动作 `disabled` |
| `translate-04-denied` | `983:454` | 400×520 | `983:486` / `984:97` | `!has("screenshot.capture")`：`deniedCaptureSection` + `fallbackSection` |
| `translate-05-error` | `983:594` | 400×520 | `983:626` / `984:124` | `phase === "failed"`：`note`（danger）+ `failureActions` |
| `sec-02` 截图 → 原地结果 | `983:16`（行 `983:23`） | — | — | 主路径 |
| `capture-01-selection` | `985:4` | 560×340 | — | 宿主：`screenshot.capture({ selectionOnly, hint })` |
| `capture-02-result-in-place` | `994:4` | 960×600 | 锚定的弹窗 `994:23` | 宿主：`presentation: "popover"` 的窗体与锚定 |
| `popover-01-translating` | `993:4` | 400×318 | — | `popover.ts`，`phase === "translating"` |
| `popover-02-result` | `993:53` | 400×316 | — | `popover.ts`，`phase === "done"` |
| `sec-03` 入口与授权 | `993:99`（行 `993:106`） | — | — | |
| `consent-01-first-entry` | `986:4` | 420 宽 | 清单 `986:11` | 宿主：按 manifest `capabilities[]` 画 |
| `receipt-01-notification` | `985:29` | 380×74 | — | `capture-copy` → `notifications.post` |
| `sec-04` 设置 | `983:24`（行 `983:31`） | — | — | |
| `settings-01-screenshot-translate` | `989:4` | 1000×950 | 区段 `989:25` | 宿主：按 manifest `settings.preferences` 与 `commands[]` 画 |

## 原地结果弹窗（主路径的落点）

`⌥⌘T` 框选、松手，译文就在选区旁边弹出来；面板不动。这是**宿主的第三类窗口**（面板 400×520 是第一类，授权弹窗是第二类）：

| 项 | 规格 |
| --- | --- |
| 窗体 | 400 宽（与面板同宽，读成同一家的东西）、按内容长高、**最高 520** 再滚；圆角 16、内距 12、底 `#12121F` @96%、白 12% 描边、投影 r40/y16 @50% |
| 锚点 | 选区**左下角**；弹窗顶边距选区下沿 12pt、左边与选区左边对齐；下方放不下就翻到选区上方；任何情况下不出屏幕边 16pt；跟着选区所在的那块屏幕 |
| 出现时机 | 命令里第一次 `screenshot.capture` 返回时——命令还在跑，里面先画 `popover-01-translating` |
| 焦点 | **不拿焦点**：原来的窗口继续能打字；指针进弹窗才亮悬停光；Esc 只在指针在弹窗上或弹窗刚出现的 3 秒内生效 |
| 关闭 | Esc / 点弹窗外面 / 指针离开 15 秒（同面板的倒计时）；翻译中不倒计时（扩展 `panel.hold` 着） |
| 钉住 ⊙ | 常驻，直到手动关；再截一块时钉住的弹窗被新的一次替换 |
| 在面板里打开 ⤢ | 宿主先 `deactivate` 弹窗再 `activate` 页面，扩展的 `Session` 不动，页面画 `translate-02-captured` |
| 头 | 22pt 徽标（`toolbox.symbol`）+ 名 12.5pt semibold + 状态标（小圆点 + 9pt 等宽大写）；右端三颗 22pt 玻璃圆片：钉住 / 进面板 / 关闭 |
| 选区残影 | 弹窗期间原选区留一圈 1pt 青 70% 轮廓 + 青 5% 底，告诉用户「翻的是这一块」；弹窗关闭时一起退 |
| 无障碍 | VoiceOver 出现时播报「截屏翻译 · 结果」并把译文作为 `accessibilityValue`；Reduce Motion 直接出现不滑入；Reduce Transparency 不透明底 |

### 弹窗里的内容 → SDK 节点（`popover.ts`）

| 稿上的区域 | SDK 节点 | 数据来源 |
| --- | --- | --- |
| 原文卡（`source-card`） | `card` › `editor`（`rows: 3`，`maxRows: 6`）——改了 `dirty`，出现「翻译」 | `session.source` |
| 「识别为 英语」「♪ 朗读」「⎘ 复制」+ 右端「3 行 · 724×188」 | `stack`：`badge`（neutral）+ `button`（inline）+ `copy`（chip）+ `spacer` + `text`（footnote） | `detected.name` / `lines` / `imageSize` |
| 「英语 · 自动检测 ▾」⇄「中文 ▾」 | `stack`：`picker`（`layout: "compact"`）+ `symbol`（`arrow.left.arrow.right`）+ `picker`（compact）；改哪一边都 `retranslate()` | `sourceOverride` / `target` |
| 译文卡（`result-card`，青边） | `card`（`tint: "accent"`）› `result`（`copy: false`，青） | `translation.text` |
| 「⎘ 复制译文」「♪ 朗读」「再截一块 ⌥⌘T」+ 右端「Google · 免费端点 · 0.8 s」 | `stack`：`copy`（chip）+ `button` ×2 + `spacer` + `text`（footnote） | `translation.backend` / `elapsedMs` |
| 翻译中（`popover-01-translating`） | 译文卡里 `progress`（不确定）+ `text`（subtle）；动作 `disabled` | `phase === "translating"` |
| 失败 | 译文卡里 `note`（danger）+ `failureActions`：重试 / 填 API key（`system.openExtensionSettings`） | `failure` |
| 脚注「Esc / 点外面关闭 · ⊙ 钉住常驻 · ⤢ 在面板里打开」 | **宿主 chrome**，不由扩展写 | — |

弹窗里**不画缩略图**（选区就在旁边）、不画「翻译成 / 识别语言」偏好行（那些在页面与设置页里）。

## 五张面板帧 → SDK 节点（`page.ts`）

### `translate-01-idle`（`fresh`：`phase === "idle"` 且没有原文与译文）

| 稿上的区域 | SDK 节点 | 数据来源 |
| --- | --- | --- |
| 段「截屏 · CAPTURE」，右端 `⌥⌘T` | `section` + `trailing` | `context.commands` 里 `capture-translate` 的当前快捷键 |
| 虚线占位「框选屏幕上任意一块，松手就翻译」 | `empty`（`symbol: "viewfinder"`） | 只在 `fresh` 画 |
| 主按钮「截屏翻译」+ 键帽 | `stack`：`button`（`primary`，`bar`）+ `keycap` | `jarvis.commands.run("capture-translate")`；整屏唯一一颗实心 accent |
| 「翻译剪贴板」「截屏译文入剪贴板」+ 键帽 | `button`（`secondary`，`inline`）×2 + `keycap` | `commands.run("translate-clipboard")` / `("capture-copy")` |
| 段「语言 · LANGUAGE」，右端 `AUTO-DETECT` | `section` | **只改这一次**：`Session` 里的会话值，从偏好初始化，「清空」回到偏好；不写偏好（[docs/10](../../docs/10-settings.md)：页面里不许再画一份设置） |
| 翻译成 / 原文已是目标语言时 | `stack`：`text` + `spacer` + `picker`（`layout: "compact"`） | `target` / `alternate` |
| 识别语言 | `chip` ×4…5（`selected` = 在 `ocrLanguages` 里；8 种排不进一行，只画默认四种 + 已选的） | `ocrLanguages` |
| 脚注 | `text`（`footnote`） | 静态 |
| Jarvis 没有屏幕录制权限时 | 段首多一张 `note`（neutral）+「打开系统设置」→ `permissions.openSystemSettings("screenRecording")` | `systemPermissionMissing`（`capture` 抛 `permission.unavailable`） |

### `translate-02-captured`（`phase === "done"`）

| 稿上的区域 | SDK 节点 | 数据来源 |
| --- | --- | --- |
| 段「原文 · SOURCE」，右端「英语 · 3 行」，段动作 朗读原文 / 清空 | `section` + `trailing` + `actions` | `detected.name` + `lines` |
| 缩略图，说明「刚截到的那一块 · 724×188」 | `image`（`small`，`label`） | `image` / `imageSize` |
| 原文 | `editor`（`rows: 4`，`maxRows: 10`） | `source`；改动 → `dirty`，动作行换成「翻译」 |
| 段「译文 · TRANSLATION」，右端「GOOGLE · 简体中文」，段动作 朗读译文 | `section` + `trailing` + `actions` | `translation.backend` + `targetTitle` |
| 译文框（带复制钮） | `result`（`copy: true`，`tint: "accent"`） | `translation.text` |
| 「再截一块」+ 键帽 /「复制译文」 | `stack`：`button`（`primary`，`bar`）+ `keycap` + `copy`（chip） | 随状态变：没译文时第三颗是「翻译」，失败时是「复制原文」 |
| 「已自动复制译文 · 0.8 s · translate.googleapis.com」 | `text`（`footnote`） | `autoCopied` / `elapsedMs` / `backend` |

### `translate-03-translating`（`phase === "translating"`）

| 稿上的区域 | SDK 节点 | 数据来源 |
| --- | --- | --- |
| 「翻译中 · Google」 | `progress`（不给 `value` = 不确定；Reduce Motion 换成文字） | — |
| 「翻译期间面板 hold 住，不会自己收回；30 秒没回来算失败」 | `note`（`accent`） | `jarvis.panel.hold("正在翻译")`；30 秒是宿主 `net.fetch` 的超时 |
| 动作 45% | `button`（`disabled`） | `busy` |

### `translate-04-denied`（`granted` 里没有 `screenshot.capture`）

| 稿上的区域 | SDK 节点 | 数据来源 |
| --- | --- | --- |
| 段「截屏 · CAPTURE」，右端「未授权」（alert） | `section`（`tint: "alert"`） | `!has("screenshot.capture")` |
| 「没有截图的授权」+「授权」 | `note`（`alert`，`symbol: "lock"`）+ `permissions.request(["screenshot.capture"])` | — |
| 「Jarvis 还没有屏幕录制权限」+「打开系统设置」 | `note`（neutral）；扩展在 `capture` 抛 `permission.unavailable` 后画 | `systemPermissionMissing` |
| 段「还能做的 · FALLBACK」+「翻译剪贴板」 | `section` + `button`（`secondary`，`inline`）+ `text`（`subtle`） | `commands.run("translate-clipboard")` |

### `translate-05-error`（`phase === "failed"`）

| 稿上的区域 | SDK 节点 | 数据来源 |
| --- | --- | --- |
| 段「译文 · TRANSLATION」，右端「失败」（danger） | `section`（`tint: "danger"`） | `failure` |
| 「翻译失败」+「重试」「填 API key 走官方接口」 | `note`（`danger`）+ `failureActions`：`network` → 重试 + `system.openExtensionSettings()`；`empty` / `clipboard` → 再截一块；`denied` → 授权 | `failure.kind` |
| 「再截一块」「复制原文」 | `button` + `copy` | 原文留着，重试不用再截 |

## 截图会话与授权（宿主画的三处）

- **`capture-01-selection`**：`jarvis.screenshot.capture({ selectionOnly: true, recognizeText: true, ocr, hint: "松手即翻译" })`
  期间宿主画的：四周 45% 黑遮罩、1.5pt accent 选框 + 四角 6pt 手柄、左上角等宽尺寸读数、选框下方提示丸（`hint`）。
  不进标注工具条；Esc → `cancelled`，扩展回到上一状态、什么都不弹。
- **`consent-01-first-entry`**：按 [docs/05](../../docs/05-permissions.md)：420 宽、透明行 + 发丝线、档位标签、玻璃开关、
  「允许并打开」炫彩描边。行顺序 = manifest `capabilities[]`；第二行 = `reason`；高风险行的第三句由宿主写。
- **`receipt-01-notification`**：只属于 `capture-copy`：`notifications.post({ title: "已复制译文", body })`；
  失败时同一条路 `notifications.post({ title: failure.title, body })`，点横幅展开到页面的错误屏。

## 设置页 · `settings-01-screenshot-translate`

宿主按 manifest 渲染：`select` → 值 chip + `▾`；`multiselect` → 一排可多选 chip；`secret` → 遮罩输入框 + 「已设置」+ 「清除」；
`toggle` → 玻璃开关。命令一段每条一行，键帽或「未设置 · 点这里录制」。偏好标题与稿上一致
（翻译成 / 原文已是目标语言时 / 识别语言 / Google API key / 翻译完自动复制）。

## 与稿子不一致处（保留的决定）

1. **通栏主按钮画成 42pt 高**；节点目录里 `bar` 是 26pt。实现按 26 走——不为一颗按钮造节点。
2. **弹窗的「⇄」不是按钮**：稿上是互换，实现里它只是 `symbol`；换语言走两侧的 `picker`（改哪一边都立刻重翻）。
   自动检测下"互换"没有确定的含义。
3. **译文框的复制钮**：页面里用 `result.copy`（宿主的图标钮）+ 动作行的「复制译文」；弹窗里只用动作行那一颗。
4. **快捷键读数**取自 `activate` 带来的 `context.commands[].hotkey`（用户改过的键），命令上下文里没有就沿用上一次的。

## 宿主侧还缺的（期 B）

`presentation: "popover"` 的窗体与锚定（D-B13）、`capture` 的 `hint`（D-B14）、`system.openExtensionSettings`（D-B15）、
`picker.layout: "compact"`（D-B16）——都已写进 [docs/14](../../docs/14-host-integration-plan.md)。manifest / registry 认 `popover`
这一步已先在宿主 2.0.1 落地，否则整份 registry 会被判无效。

## Related Links

- [README](README.md) · [`src/index.ts`](src/index.ts) · [`src/session.ts`](src/session.ts) · [`src/page.ts`](src/page.ts) · [`src/popover.ts`](src/popover.ts) · [`src/google.ts`](src/google.ts) · [`test/translation.test.mjs`](test/translation.test.mjs)
- [docs/03 manifest](../../docs/03-manifest.md) · [docs/05 权限](../../docs/05-permissions.md) · [docs/06 能力](../../docs/06-capabilities.md) · [docs/07 UI 组件](../../docs/07-ui-components.md) · [docs/14 宿主方案](../../docs/14-host-integration-plan.md)
- `jarvis-mac/CLAUDE.md`（Figma ↔ 代码规则）· `jarvis-mac/docs/uiux/floating-status/design-system.md`
