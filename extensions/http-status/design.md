# HTTP 状态码 · 设计稿与实现对照

> Figma `hZeo5Kw9MxiE48AiOeRz1H` 页面 `9:78`，板子 **`jarvis-extension-http-status`（`1027:2`）**，
> 位于 (2960, 56600)，2320×3252。**代码是源，稿是镜像**（`jarvis-mac/CLAUDE.md` §0.2）：
> 下面每一行都能在 `src/` 里指出"它就是那个东西"，对不上的地方在最后一节逐条记着为什么。

## Overview

这块板子回答四个问题：

1. **一屏之内怎么答完"这个码是什么"**（`sec-01`，五态）——搜索框 + 五种结果，全由输入框里那串字决定。
2. **不想离开日志时结果落在哪**（`sec-02`）——⌥⌘/ 读一次剪贴板，弹窗贴着指针出现，面板不动。
3. **装上之后它在工具箱里长什么样、第一次进入问什么**（`sec-03`）——两张都由宿主按 manifest 画。
4. **设置页里它那一块**（`sec-04`）——三项偏好、两条命令，没有 secret。

方向要分清：

- 面板 chrome、原地弹窗的窗体、授权弹窗、设置页——**宿主画**，落在 `jarvis-mac`
  （[docs/14](../../docs/14-host-integration-plan.md) 的期 B：`presentation: "popover"` 的窗体与锚定 D-B13）。
- 页面与弹窗里的内容——**扩展用 SDK 节点拼**，已在 `src/` 里实现：`page.ts` 是五态页面，
  `popover.ts` 是弹窗那棵树，`session.ts` 是它们共用的状态，`search.ts` 是查找，`data.ts` 是那张表。

## 板子与节点号

| 帧 | 节点 | 尺寸 | 实现 |
| --- | --- | --- | --- |
| `board-header` | `1027:3` | — | — |
| `sec-01` 扩展页面 · 五态 | `1028:2`（行 `1028:9`） | — | `page.ts` `renderPage` |
| `http-status-01-browse` | `1028:12` | 400×520 | `outcome.kind === "browse"` → `browse()` |
| `http-status-02-detail` | `1028:85` | 400×520 | `"exact"` → `detail()` |
| `http-status-03-results` | `1028:148` | 400×520 | `"list"` → `results()`，悬停卡 `1033:2` = `hoverCard()` |
| `http-status-04-notfound` | `1028:209` | 400×520 | `"empty"` → `emptyScreen()` |
| `http-status-05-denied` | `1028:270` | 400×520 | `clipboard.kind === "denied"` → `deniedSection()` + `compactBrowse()` |
| `sec-02` 剪贴板 → 原地弹窗 | `1038:2`（行 `1038:9`） | — | — |
| `clipboard-01-in-place` | `1041:4` | 900×664 | 宿主：弹窗窗体与锚定；里头那扇是 `1038:12` 的克隆 |
| `popover-01-result` | `1038:12` | 400×334 | `popover.ts` `hit()` |
| `popover-02-nomatch` | `1038:57` | 400×255 | `popover.ts` `nothingFound()` |
| `sec-03` 入口与授权 | `1044:2`（行 `1044:9`） | — | — |
| `toolbox-01-entry` | `1046:4` | 400×462 | 宿主：按 `toolbox.{symbol,name,subtitle}` 画 |
| `consent-01-first-entry` | `1044:12` | 420×416 | 宿主：按 `capabilities[]` 画（[docs/05](../../docs/05-permissions.md)） |
| `sec-04` 设置 | `1049:2`（行 `1049:9`） | — | — |
| `settings-01-http-status` | `1049:12` | 1000×809 | 宿主：按 `settings.preferences` 与 `commands[]` 画 |

## 一个真源：输入框里那串字

五张面板帧不是五个状态机，而是同一个函数对不同输入的回答（`session.query` → `search()`）：

| 那串字 | `SearchOutcome` | 画哪一屏 |
| --- | --- | --- |
| 空 | `browse` | 分类五行 |
| `404`、`< HTTP/1.1 502 Bad Gateway` | `exact` | 详情 |
| `超时`、`timeout`、`4xx`、`40` | `list` | 清单 |
| `999`、`450`、`茶壶壶` | `empty`（三种理由） | 查不到 |

因此"点清单里的一行"与"点详情里的相关码"做的是同一件事：把 `query` 改成那个码
（`session.openCode`）。「⤢ 在面板里打开」从弹窗切到页面时也不用同步任何东西——两棵树读同一个 `Session`。

## 五张面板帧 → SDK 节点（`page.ts`）

### `http-status-01-browse`

| 稿上的区域 | SDK 节点 | 数据来源 |
| --- | --- | --- |
| 段「查询 · LOOKUP」，右端 `⌥⌘H` | `section` + `trailing` | `context.commands` 里 `lookup` 的**当前**快捷键（用户改过的那个） |
| 搜索框 + `⌘F` 键帽 | `search` | 宿主持有文本；`Esc` 有内容时清空，空时放行给面板收起 |
| 段「分类 · CLASSES」，右端「62 个标准码」 | `section` + `trailing` | `standardCount` |
| 五行：`1xx · 信息` / `4 个 · 100 101 102 103` | `row`（`symbol` + `tint` + `accessory: "chevron"`） | `classSummaries()`；点一行 → `query = "4xx"` |
| 脚注 | `text`（`footnote`） | `${standardCount} + ${unofficialCount}` |

### `http-status-02-detail`（404）

| 稿上的区域 | SDK 节点 | 数据来源 |
| --- | --- | --- |
| 读数：「未找到 · 客户端错误」/「404 Not Found」+ 复制钮 | `readout`（`tint` 按类，`copy: true`） | `entry.zh` + 类名 / `session.copyText(entry)`——**读数就是复制出去的那串**，跟着 `copyFormat` 变 |
| 三枚徽标：客户端错误 / 默认可缓存 / 重试没用 | `badge` ×3（非标准码多一枚 amber） | `classOf` / `entry.cacheable` / `entry.retriable` |
| 一句话语义 | `text`（`body`，`selectable`） | `entry.summary` |
| 段「常见成因 · CAUSES」三条 | `section` + `text`（`subtle`）×n，前缀 `·` | `entry.causes` |
| 段「怎么处理 · FIX」三条 | 同上 | `entry.fix` |
| 段「相关 · RELATED」，右端 `RFC 9110 §15.5.5` | `section` + `trailing` | `entry.spec` |
| 三枚相关码 chip | `chip` ×3（`help` 里是英文名 + 中文名） | `entry.related` 前三个；点一枚 → `openCode` |
| 「打开 RFC 9110」「MDN」+ 复制 chip | `button`（`link`/`inline`）×2 + `copy`（`chip`） | `session.links(entry)` 按 `specSource` 排序；非标准码只给厂商文档 |
| （稿上没画）「← 回到「超时」」 | `button`（`link`） | 只在从清单点进来时出现（`session.previousQuery`） |

### `http-status-03-results`（搜「超时」）

| 稿上的区域 | SDK 节点 | 数据来源 |
| --- | --- | --- |
| 段「结果 · RESULTS」，右端「5 个」 | `section` + `trailing` | `SearchOutcome.label` |
| 五行 `408 / 440 / 504 / 522 / 524` | `list` › `row`（`key` = 码） | 命中按码升序；副标：标准码给中文名 + 语义第一句，非标准码给「非标准 · 来源」 |
| 悬停卡（`1033:2`） | `row.hoverCard` = `card` › `stack`（码 + 「可以重试」）+ `summary` + 提示 | 指针停 320ms 出，宿主管延时与落点 |
| 「✓ 含非标准码」「只看 5xx」+「74 个码在表里」 | `chip` ×2（`selected`）+ `spacer` + `text` | **会话值**：从偏好初始化，清空搜索回到偏好 |
| 脚注 | `text`（`footnote`） | 静态 |

### `http-status-04-notfound`（999）

| 稿上的区域 | SDK 节点 | 数据来源 |
| --- | --- | --- |
| 井 + 「没有 999 这个码」+ 一段说明 + 「清空搜索」 | `empty`（`symbol` + `hint` + `action`） | 三种理由各一句：越界 / 在区间里但没人定义过 / 关键词没命中 |
| 「这里只收状态码」 | `note`（`neutral`） | 静态边界声明：响应头、方法、MIME 都不在表里 |
| 脚注 | `text`（`footnote`） | — |

### `http-status-05-denied`（没有 clipboard.read）

| 稿上的区域 | SDK 节点 | 数据来源 |
| --- | --- | --- |
| 段「剪贴板 · CLIPBOARD」，右端「未授权」 | `section`（`tint: "alert"`） | `clipboard.kind === "denied"`——**按下过 ⌥⌘/ 才出现**，不是一进来就挂着 |
| 「没有读剪贴板的授权」+「授权」 | `note`（`alert`，`symbol: "lock"`）+ 动作 → `permissions.request` | 授权成功立刻把这一轮补上（`requestClipboard`） |
| 发丝线 | `hairline` | — |
| 段「查询 · LOOKUP」+ 搜索框 + 五枚常用码 chip | `section` + `search` + `chip` ×5 | `compactBrowse()`：这一屏已经多了一段说明，分类五行让位 |
| 脚注 | `text`（`footnote`） | — |

## 原地弹窗（`popover.ts`）

| 项 | 规格 |
| --- | --- |
| 触发 | `explain-clipboard`（⌥⌘/，`presentation: "popover"`）；命令里第一次提交时弹窗就开在指针旁 |
| 窗体 | 400 宽、按内容长高（最高 520 再滚）；圆角 16、内距 12、底 `#12121F` @96%、白 12% 描边 |
| 锚点 | 指针右下 16pt；下方放不下翻到上方；任何情况下不出屏幕边 16pt（稿上 `1041:4` 左下角那三条） |
| 焦点 | 不拿焦点：终端继续能打字；Esc / 点外面 / 指针离开 15 秒关 |
| 四种结果 | 抓到 / 读到了但没有码 / 没授权 / 宿主失败——**都弹**，按过快捷键就得有回音 |

| 稿上的区域 | SDK 节点 | 数据来源 |
| --- | --- | --- |
| 原文卡「剪贴板 · 47 字符」「命中 1 个码」+ 那一行 | `card` › `stack`（两条 `footnote`）+ `text`（`mono`，2 行） | `clipboardLength()` / `clipboardExcerpt()` |
| 读数 + 三枚徽标 + 一句话 + 两条成因 | 与详情屏同一套节点 | `entry` |
| 复制 chip + 「相关 503 · 504」 | `copy`（`chip`）+ `text`（`footnote`） | `related` 前两个 |
| 脚注「Esc / 点外面关闭 · ⊙ 钉住常驻 · ⤢ 在面板里打开」 | **宿主 chrome**，不由扩展写 | — |

## 与稿子不一致处（保留的决定）

1. **弹窗 / 面板 header 的徽标画成 `#`**；manifest 里 `toolbox.symbol` 是 `number.circle`（SF Symbol）。
   稿上画的是那个符号的意思，不是它的字形。
2. **稿子第一版在分类行右端画了计数**（`4` `10` `28` …）。`row` 的骨架里没有这一格
   （图标井 + 标题 + 说明 + 记号），所以计数并进了副标：`28 个 · 400 401 402 403 404 405 …`。
   要那一格就得给 [docs/07](../../docs/07-ui-components.md) 提 PR，不是在扩展里拼。
3. **稿子第一版给清单第一行画了选中态与「↑↓ 选择」**。宿主的 `list` 没有方向键选中
   （[docs/07](../../docs/07-ui-components.md) 的键盘一节只有 Tab / 空格 / Esc），说了就是骗人——
   两处都删掉了，脚注改成真的成立的那三句。
4. **相关码 chip 最多三枚，中文名超过 6 个字就只留码**。`stack` 是一行，装不下不会换行；
   英文名与中文名都进 `help`（tooltip 与 VoiceOver 都读它），省掉的信息没有丢。
5. **搜「超时」是 5 条不是 4 条**：440 Login Time-out 的中文名就是「登录超时」。
   稿子跟着实测结果改，不为了对称改译名。
6. **读数的标题与读数对调**：稿上是「HTTP 404 · NOT FOUND」/「未找到」，实现里是
   「未找到 · 客户端错误」/「404 Not Found」——因为 `readout` 的复制钮复制的是**读数**，
   而该被复制的是 `404 Not Found`（还要跟着 `copyFormat` 变）。
7. **非标准码在清单里没有徽标**，那句话在副标里（`登录超时 · 非标准 · IIS`）。同第 2 条：`row` 上没有徽标位。
8. **header 那行状态标（`READY · ⌥⌘H`、`404 · NOT FOUND`、`5 MATCHES · 超时` …）稿上画着，SDK 里没有对应的东西。**
   [docs/08](../../docs/08-design-system.md) 把 header 整块列在「你碰不到的（容器）」里，那一行是宿主的
   Server 状态行；扩展的节点树从 header 下面才开始。参考板 `jarvis-extension-screenshot-translate` 画了同样的
   东西（`EN → ZH · GOOGLE`），两块板一起说明这是一个**平台缺口**，不是这个扩展少实现了什么：
   要让扩展说出"此刻停在哪一条码"，得先给 [docs/07](../../docs/07-ui-components.md) 与宿主提一条
   （比如 `defineExtension({ status })`，一行 ≤ 16 字的等宽读数）。在那之前，这七处状态标只是稿上的注解。
9. **页面与弹窗的三枚徽标顺序不同**：页面是 类 → 可缓存 → 重试，弹窗是 类 → 重试 → 可缓存。
   两处都照着各自那一帧画；弹窗把「要不要重试」提前，是因为它是"读一眼就走"的那一面。
10. **稿上的「剪贴板 · N 字符」跟着实测改**：字数是代码数出来的（`clipboardExcerpt` 那一段的真实长度），
    稿子第一版写的 47 与它自己画的那一行对不上，已改成 26 / 42。
11. **`⌥⌘H` 的说明是「打开面板，落在这个扩展的页面上」**，不是稿子第一版的「光标落进搜索框」：
   `search` 节点没有 `autoFocus`（只有 `field` 有），承诺不了焦点落在哪。

## 宿主侧要的东西

`minimumJarvisVersion` 写的是 **2.0.1**，不是 2.0.0：`presentation: "popover"` 这个值从 2.0.1 起才被
manifest / registry 认（[docs/14](../../docs/14-host-integration-plan.md) 期 A.1），更早的宿主会把整份
registry 判为无效而回落到上一份快照。

运行时那一半只有一件，已经写进 [docs/14](../../docs/14-host-integration-plan.md) 的期 B：
`presentation: "popover"` 的窗体与锚定（D-B13）。锚点这里是**指针**而不是选区——
这条命令里没有截图，`docs/03-manifest.md` 的 `CommandPresentation` 已经写了这个退路。
其余（`search` / `row.hoverCard` / `readout` / `note` / `empty` / `chip`）都是目录里现成的节点。

## Related Links

- [README](README.md) · [`src/data.ts`](src/data.ts) · [`src/search.ts`](src/search.ts) · [`src/session.ts`](src/session.ts) · [`src/page.ts`](src/page.ts) · [`src/popover.ts`](src/popover.ts) · [`test/http-status.test.mjs`](test/http-status.test.mjs)
- [docs/03 manifest](../../docs/03-manifest.md) · [docs/05 权限](../../docs/05-permissions.md) · [docs/07 UI 组件](../../docs/07-ui-components.md) · [docs/08 设计体系](../../docs/08-design-system.md) · [docs/09 鼠标感知](../../docs/09-pointer-awareness.md) · [docs/14 宿主方案](../../docs/14-host-integration-plan.md)
- `jarvis-mac/CLAUDE.md`（Figma ↔ 代码规则）· `jarvis-mac/docs/uiux/floating-status/design-system.md`
