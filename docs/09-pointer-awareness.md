# 鼠标感知系统

## Overview

Jarvis 的浮窗对指针有一整套反应：指针靠近贴边的细条，整颗球弹出来；指针压在球上，
球里的光开始流动；指针压在面板上，15 秒倒计时挂起；指针压在一颗按钮上，一圈炫彩光绕着它转。
这些反应有**一份**实现、**一套**数值，扩展页面上的每一颗控件与内置工具的控件逐帧同一种光。

扩展不实现任何一层——它只需要知道每一层什么时候会发生、自己能触发什么、不能做什么。

## Architecture & Logic

```text
层 0  浮窗级   指针 ↔ 圆球 / 细条 / 面板            FloatingPanelController.handleHover
              （弹出、水晶球光、倒计时挂起）             ↓ 单点写入
层 1  面板级   isPointerFocused · isHeldOpen ·         FloatingPanelInteractionState
              isPinned · isDraggingPanel → holdsPanelOpen
层 2  控件级   悬停光 / 选中光                        controlFocusHighlight / selectionChroma
层 3  停留级   320ms 悬停摘要卡                        Calendar.Hover 那条规则
层 4  手势级   header 拖动 · dropzone 悬停 · editor 手柄
```

扩展只在**层 1**（举旗）与**层 3**（`hoverCard`）有接口；层 2 由宿主对每个可交互节点自动施加；
层 0 与层 4 扩展碰不到。

## Concepts

### 层 0 · 浮窗级（扩展碰不到，但要知道）

| 现象 | 规则 | 对扩展意味着 |
| --- | --- | --- |
| 贴边细条 → 指针进入 40pt 热区 → 整颗球弹出 | 弹出即时，指针离开即时收回，不用计时器 | 你的页面只在面板展开后存在，弹出与收回与你无关 |
| 指针压在球 / 面板上 | `isPointerFocused = true`，**15 秒倒计时挂起**；离开后重新给满一个周期 | 用户读你的页面时不会被收走；指针离开 15 秒后会 |
| 面板外按下 / 切走应用 / 15 秒到点 | 三条自动收回路径，都只读 `holdsPanelOpen` | 见层 1 |
| Esc / 点球 | 用户**明确**要收回，不读 `holdsPanelOpen` | 你举的旗挡不住用户自己的手 |
| 面板收回 | `background: false` 的扩展被 `deactivate` 并销毁上下文 | 没保存的状态就没了——用 `storage` 存该记住的 |

### 层 1 · 面板级：举旗

三面旗子汇成 `holdsPanelOpen`，三条自动收回路径只认这一位：

| 旗 | 谁举 | 谁放 |
| --- | --- | --- |
| `isHeldOpen` | **内容侧**：一件跨越指针离开的事正在做 | 事情做完自己放 |
| `isPinned` | 用户按下 header 上的「常驻」 | 用户再按一次 |
| `isDraggingPanel` | 用户按着 header 搬面板 | 松手 |

扩展只能举第一面，两条路：

- **自动**：`field` / `editor` / `search` 有焦点时宿主替你举；`files.pick` 与 `screenshot.capture` 期间宿主替你举。
- **手动**：`jarvis.panel.hold(reason)` → `release()`。判据是"这件事跨越指针离开"——文件在读、
  传输在跑、用户在盯一条进度。内置的哈希（读文件）、APK 扫描（拉几百 MB）、快传（有传输在跑）就是这三种。

**不要为了"别收回"而 hold。** 一个从进入就 hold 到离开的扩展等于把常驻开关从用户手里拿走；审核不通过。
宿主对超过 10 分钟的 hold 记警告，开发者模式里可见。

### 层 2 · 控件级：悬停光与选中光

每一颗可交互节点由宿主挂 `controlFocusHighlight(shape:)`，它就是 header 那排按钮、工具箱那一行、
日历那一格、设置页那颗开关用的同一圈光：

| 层 | 值 | 语义 |
| --- | --- | --- |
| 提亮底 | 白 10%（Increase Contrast 18%），`plusLighter` 混合 | "指针在我身上" |
| 炫彩描边 | 1.5pt，角向渐变 蓝 → 青 → 紫 → 靛 → 蓝，绕行 4s 一周 | "我是可以按的" |
| 外扩柔光 | 3.5pt 宽、模糊 5、外扩 1.5pt、50%（Increase Contrast 70%） | 光照 |
| 进出 | 0.12s ease-out（Reduce Motion 0.08s，不取消） | 指针扫过一排图标时慢过渡会让好几颗同时亮着 |
| Reduce Motion | 描边停转，色带保留 | — |

三条规则宿主替你守：

1. **只有可点的东西才亮。** 没有 `onPress` / `onChange` 的节点不亮；`disabled` 的不亮——亮起来等于承诺"点我有反应"。
2. **光贴着控件自己的轮廓画。** 圆片按钮是圆、行是圆角 12、开关是胶囊；用统一的圆角矩形去套，光会从边上漏出去。
3. **一处只有一种光。** `selected` 走 `selectionChroma`——同一圈光、由 `selected` 而不是指针触发；
   选中与悬停同时成立时只画一圈。

扩展**不能**画自己的悬停态：没有 `hover` 事件、没有 `hovered` 状态、没有能在指针压上时换掉的颜色。
需要"指针在这一行上"这个信息的唯一合法用途是层 3。

### 层 3 · 停留级：悬停摘要卡

`row.hoverCard` 给一棵节点树（通常一个 `card` 里几行 `text`），宿主按日历那条规则画：

| 项 | 值 | 为什么 |
| --- | --- | --- |
| 延时 | 指针停 **320ms** 才出 | 太短会在划过清单时连弹七八张 |
| 尺寸 | 宽 208、圆角 10 | 日历悬停卡 |
| 落点 | 内容区前半部的行朝下挂，后半部朝上挂；横向夹在内容宽里 | 从底部往下挂会掉出面板，从顶部往上挂会盖住 header |
| 覆盖 | 盖在清单上，**不挤开**它 | 挤开的话指针一进布局就动，"动了"本身会让指针落到另一格 |
| Reduce Motion | 直接出现，不淡入 | — |
| 键盘 | 焦点停在行上按 `Space` 同样出卡 | 只靠悬停才出现的信息必须有一条键盘路径 |

### 层 4 · 手势级（扩展碰不到）

- header 是展开态面板**唯一**的拖动把手（4pt 起手，低优先级手势）；正文里的文本选择、滚动、`editor` 手柄不被吃掉。
- `dropzone` 的悬停态（底青 5% + 虚线 1.5pt + 外发光）由宿主按 `DropDelegate` 画，并把"检测到几个文件"写在屏幕上。
- `editor` 的高度手柄：拖拽途中连续、松手对齐整行、hover 换上下箭头光标。
- 光标形状全部由宿主决定；扩展没有 cursor API。

### 与工具箱那枚加号的关系

「添加扩展」那一行常态 0.55 不透明度、虚线井——它是层 2 的一个特例：悬停时**同时**亮光并把不透明度升到 1.0。
虚线在悬停时不变：它仍然不是一件工具。

## Usage

扩展要做的只有三件：

```ts
// 1. 跨越指针离开的事：举旗、放旗
const hold = jarvis.panel.hold("正在把文件推到手机");
try { await jarvis.quickTransfer.sendFile(file); } finally { hold.release(); }

// 2. 想让一行"可点"：给 onPress。宿主自动挂光；不给就不亮
ui.row({ key: r.id, title: r.name, onPress: () => open(r) });

// 3. 想在指针停留时多给一点信息：hoverCard
ui.row({ key: r.id, title: r.name, hoverCard: ui.card({ children: [ui.text({ text: r.detail, style: "subtle" })] }) });
```

## Gotchas

- `disabled: true` 的按钮**不亮**也**不隐藏**——这是同一条规则的两半。
- `hold` 忘了 `release` 会在离开扩展时被宿主兜底释放，但页面停留期间面板永不收回；
  开发者模式的日志会写「hold 已持续 N 分钟」。
- 面板收起再展开，你的页面是新的一次 `activate`；上一次的 hoverCard、两步确认态、聚焦全部不跨越一次收回。

## Related Links

- [07 · UI 组件目录](07-ui-components.md)
- `jarvis-mac/Sources/Jarvis/UI/ControlFocusHighlight.swift`、`FloatingPanelController.swift`
  （`FloatingPanelInteractionState`、`FloatingPanelAutoCollapsePolicy`、`FloatingPanelOutsideDismissPolicy`）
- `jarvis-mac/docs/uiux/floating-status/floating-panel.md`「跨越指针离开的事」「Pointer focus」
