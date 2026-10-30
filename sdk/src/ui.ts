/**
 * 声明式 UI 节点。
 *
 * 扩展**不画像素**：`render()` 返回一棵节点树，宿主用 SwiftUI 把它画成与内置工具逐像素同源的
 * 控件——字体走 `Font.jarvis`，色板走 `JarvisDesign.SettingsChrome.Palette`，每一颗可点的东西
 * 自动挂上 `controlFocusHighlight`（指针悬停时那圈流动的炫彩光）。因此这里没有颜色值、没有
 * 像素尺寸、没有 CSS：能选的只有**语义**（tint / style / variant / size）。
 *
 * 组件与宿主实现的逐项对应表见 `docs/07-ui-components.md`。
 */

/** 语义色。逐个对应面板已有的色停，扩展不得引入新色。 */
export type Tint = "accent" | "live" | "alert" | "danger" | "violet" | "blue" | "amber" | "neutral";

/** 文字档位。对应面板工具那一档字阶（标题 13 / 说明 11 / 脚注 10 …）。 */
/** `metric`：统计卡上的大数字（面板 18pt、窗口 26pt；jarvis-mac `specs/20261029-082059-proxy-window-desktop-layout` D-4，宿主 ≥ 3.3.1）。 */
export type TextStyle = "sectionTitle" | "title" | "body" | "subtle" | "footnote" | "mono" | "readout" | "metric";

/** 栈的节奏。tight = 6（清单）、regular = 10（工具段内）、loose = 14（段与段）。 */
export type StackSpacing = "none" | "tight" | "regular" | "loose";

export type ButtonVariant = "primary" | "secondary" | "link" | "danger";

/** 栏级 26pt / 行内 22pt。判据是它统辖多大一块，不是重要与否。 */
export type ControlSize = "bar" | "inline";

/** 事件回调。SDK 在提交树时把函数换成句柄，宿主回传事件时再找回来。 */
export type Handler<Payload = void> = (payload: Payload) => void;

export interface FileHandle {
  /** 宿主颁发的临时句柄，只在本次会话内有效。 */
  id: string;
  name: string;
  byteCount: number;
  /** 小写扩展名，没有则为空串。 */
  extension: string;
}

/** 段标题右端或行末的一颗小动作。 */
export interface ActionSpec {
  id: string;
  title: string;
  symbol?: string;
  tint?: Tint;
  disabled?: boolean;
  /** 悬停 tooltip，同时给 VoiceOver 用。图标按钮必填。 */
  help?: string;
  onPress: Handler;
}

interface Keyed {
  /**
   * 稳定身份。列表里的行、会增删的段必须给：宿主按它做 diff，没有它的节点在增删时会被整块重建，
   * 正在输入的框会丢焦点。
   */
  key?: string;
}

export interface StackNode extends Keyed {
  kind: "stack";
  axis?: "vertical" | "horizontal";
  spacing?: StackSpacing;
  alignment?: "leading" | "center" | "trailing";
  children: UINode[];
}

/** 整块内容装不下时的滚动。只允许出现在根上。 */
export interface ScrollNode extends Keyed {
  kind: "scroll";
  children: UINode[];
}

/** 段标题右端（窗口里是面板头）的一段。 */
export interface SectionSegment {
  /** 1–40 字，一组里不重复。 */
  value: string;
  /** 1–12 字。 */
  title: string;
  /** ≤ 80 字，悬停说明。 */
  help?: string;
}

export interface SectionNode extends Keyed {
  kind: "section";
  /** 段标题，形如「输入 · INPUT」；面板里按 10pt bold、字距 1 画。窗口里整段画成一块带框的面板，标题 14pt semibold（宿主 ≥ 3.3.1）。 */
  title: string;
  /** 段标题右端的读数（如 `26 字符 · 36 字节`）。 */
  trailing?: string;
  tint?: Tint;
  actions?: ActionSpec[];
  /**
   * 段标题右端（窗口里是面板头）的紧凑分段，2–5 项（jarvis-mac `specs/20261029-082059-proxy-window-desktop-layout` D-3，宿主 ≥ 3.3.1）。
   * 切换「这一块看哪一份」用它，不用通栏 `segmented`——通栏分段放进窗口就是手机的顶部 Tab。
   * `segments` / `segment` / `segmentLabel` / `onSegment` 要一起给。
   */
  segments?: SectionSegment[];
  /** 选中的那一段（必须是 `segments` 里的一个）。 */
  segment?: string;
  /** 1–40 字。VoiceOver。 */
  segmentLabel?: string;
  /** 点了另一段，回传它的 `value`。 */
  onSegment?: Handler<string>;
  children: UINode[];
}

export interface HairlineNode extends Keyed {
  kind: "hairline";
}

export interface SpacerNode extends Keyed {
  kind: "spacer";
}

export interface TextNode extends Keyed {
  kind: "text";
  text: string;
  style?: TextStyle;
  tint?: Tint;
  /** 行数上限；省略不限。 */
  lines?: number;
  selectable?: boolean;
}

export interface RowNode extends Keyed {
  kind: "row";
  symbol?: string;
  /**
   * 行首图标换成宿主颁发的一张图（例如 `android.appDetails` 读出来的应用图标）；有它就不画 `symbol`。SDK 2.4 起。
   *
   * 只认宿主颁发的句柄，与 `image` 节点同一条：扩展手里没有像素，也就画不出一枚冒充别的应用的图标。
   * 宿主把它裁进同一口 32pt 图标井里，因此一列里有图的行与没图（回落 `symbol`）的行对得齐。
   */
  image?: FileHandle;
  title: string;
  subtitle?: string;
  tint?: Tint;
  /** 选中态：图标底片与标题点亮、行末换成青点、整行托起一层外发光。 */
  selected?: boolean;
  accessory?: "chevron" | "dot" | "none";
  /** 行内 22pt 动作。 */
  actions?: ActionSpec[];
  onPress?: Handler;
  /** 指针停留 320ms 后浮出的摘要卡；宿主负责延时、落点与 Reduce Motion。 */
  hoverCard?: UINode;
  /** VoiceOver 读的整行标签；省略时由标题与说明拼出。 */
  label?: string;
}

/** 带左侧色条的读数行（时间转换器那四行的形态）。 */
export interface ReadoutNode extends Keyed {
  kind: "readout";
  label: string;
  value: string;
  tint?: Tint;
  /** 右端给一颗复制钮。 */
  copy?: boolean;
}

/**
 * 输入类节点（`field` / `editor` / `search`）的文本**由宿主持有**。
 *
 * 用户每敲一个字，宿主先更新自己的文本框，再把 `onChange` 送给 JS；JS 下一次 `render()` 里的
 * `value` 只在**与宿主此刻持有的文本不同**时才覆写回去。因此打字不经 JS 往返，中文输入法的
 * 拼音组合态也不会被一次异步回写打断；扩展想"改掉用户输入"（清空、粘贴）照常改 `value` 即可。
 */
export interface FieldNode extends Keyed {
  kind: "field";
  value: string;
  placeholder?: string;
  mono?: boolean;
  /** VoiceOver 标签。必填：一个没有名字的输入框读不出它要什么。 */
  label: string;
  autoFocus?: boolean;
  disabled?: boolean;
  onChange: Handler<string>;
  onSubmit?: Handler<string>;
}

export interface EditorNode extends Keyed {
  kind: "editor";
  value: string;
  placeholder?: string;
  /** 默认行数；宿主给一枚可拖的高度手柄，范围 minRows…maxRows。 */
  rows?: number;
  minRows?: number;
  maxRows?: number;
  mono?: boolean;
  label: string;
  /** 报错时描边与左侧竖条转红。 */
  error?: boolean;
  readOnly?: boolean;
  onChange?: Handler<string>;
}

export interface SearchNode extends Keyed {
  kind: "search";
  value: string;
  placeholder?: string;
  label: string;
  onChange: Handler<string>;
}

export interface SegmentedNode extends Keyed {
  kind: "segmented";
  options: { value: string; title: string; help?: string }[];
  value: string;
  label: string;
  /** compact = 挤在段标题右端的迷你分段（ms/s）；full = 通栏两段（文本 / 文件 TAB）。 */
  layout?: "compact" | "full";
  disabled?: boolean;
  onChange: Handler<string>;
}

export interface ToggleNode extends Keyed {
  kind: "toggle";
  title: string;
  subtitle?: string;
  value: boolean;
  disabled?: boolean;
  onChange: Handler<boolean>;
}

export interface ChipNode extends Keyed {
  kind: "chip";
  title: string;
  symbol?: string;
  /** 宿主颁的一张图（SDK 2.12）：画在标题前、高 14；有它就不画 `symbol`，句柄失效时退回 `symbol`。 */
  image?: FileHandle;
  selected?: boolean;
  tint?: Tint;
  disabled?: boolean;
  help?: string;
  onPress?: Handler;
}

export interface PickerNode extends Keyed {
  kind: "picker";
  options: { value: string; title: string; detail?: string }[];
  value: string;
  label: string;
  /** 选项多于 8 个时宿主自动给搜索框。 */
  searchable?: boolean;
  /**
   * `full`（默认）= 320 宽的通栏下拉；`compact` = 一枚「值 ▾」chip，挤在段标题右端或一行的两侧
   * （原地弹窗的语言行、页面上「翻译成 · 中文 ▾」那种标签 + 值的行）。点开的是同一份下拉。
   */
  layout?: "full" | "compact";
  disabled?: boolean;
  onChange: Handler<string>;
}

export interface ButtonNode extends Keyed {
  kind: "button";
  title: string;
  symbol?: string;
  variant?: ButtonVariant;
  size?: ControlSize;
  disabled?: boolean;
  help?: string;
  /**
   * 就地两步确认：第一次按下把标题换成 `confirm.title`，`timeoutSeconds`（默认 4）内再按一次才真的触发。
   * 面板 15 秒会自动收回，弹 modal 会被收回动作截断，因此破坏性动作一律走这条。
   */
  confirm?: { title: string; timeoutSeconds?: number };
  onPress: Handler;
}

export interface IconButtonNode extends Keyed {
  kind: "iconButton";
  /** 没给 `image`、或句柄失效时画它。 */
  symbol: string;
  /**
   * 宿主颁的一张图（SDK 2.12：`menuBarExtras.capture` 的截图、`list()` 的应用图标）：按比例放进按钮，按钮随图变宽、至少是正方形——
   * 菜单栏上的读数类图标是横长的，不会被压扁。
   */
  image?: FileHandle;
  /** VoiceOver 与 tooltip 都读它。必填。 */
  label: string;
  size?: ControlSize;
  /** 开关式按钮的「开着」态：整片点亮成青色。 */
  active?: boolean;
  disabled?: boolean;
  onPress: Handler;
}

/** 复制钮。宿主负责写入系统剪贴板与「已复制」那一秒的对勾，不需要 clipboard.write 能力。 */
export interface CopyNode extends Keyed {
  kind: "copy";
  text: string;
  label?: string;
  variant?: "chip" | "icon";
  disabled?: boolean;
}

export interface ResultNode extends Keyed {
  kind: "result";
  text: string;
  mono?: boolean;
  lines?: number;
  copy?: boolean;
  tint?: Tint;
  /** 没有结果时那一句（如「结果会实时出现在这里」）。 */
  empty?: string;
  /** 报错态：描边与左侧竖条转红，文字用报错色。 */
  error?: boolean;
}

export interface ProgressNode extends Keyed {
  kind: "progress";
  /** 0…1；省略 = 不确定进度。 */
  value?: number;
  tint?: Tint;
  label?: string;
}

export interface BadgeNode extends Keyed {
  kind: "badge";
  title: string;
  tint: Tint;
}

/** 带语义色的说明卡（信息 / 警告 / 失败）。 */
export interface NoteNode extends Keyed {
  kind: "note";
  tint: Tint;
  symbol?: string;
  title?: string;
  body: string;
  actions?: ActionSpec[];
}

export interface EmptyNode extends Keyed {
  kind: "empty";
  symbol?: string;
  title: string;
  hint?: string;
  action?: ActionSpec;
}

export interface ListNode extends Keyed {
  kind: "list";
  children: UINode[];
  /** 滚到底时宿主调用；返回后宿主等下一次 render。有它才画底部哨兵行。 */
  onLoadMore?: Handler;
  emptyState?: EmptyNode;
}

export interface CardNode extends Keyed {
  kind: "card";
  tint?: Tint;
  children: UINode[];
  onPress?: Handler;
}

export interface SymbolNode extends Keyed {
  kind: "symbol";
  name: string;
  size?: "small" | "medium" | "large";
  tint?: Tint;
}

export interface QRCodeNode extends Keyed {
  kind: "qrcode";
  text: string;
}

export interface SwatchNode extends Keyed {
  kind: "swatch";
  /** `#RRGGBB`。 */
  hex: string;
  label?: string;
}

export interface DropZoneNode extends Keyed {
  kind: "dropzone";
  title: string;
  hint?: string;
  /** 小写扩展名白名单；省略接受任何文件。文件夹一律拒绝。 */
  accepts?: string[];
  multiple?: boolean;
  onDrop: Handler<FileHandle[]>;
}

export interface KeycapNode extends Keyed {
  kind: "keycap";
  text: string;
}

/**
 * 一张图：只能是宿主颁发的句柄（截图、剪贴板里的图、用户拖进来的图），宿主画成缩略图。
 * 它是给用户核对"截到的是哪一块"用的，不是相册——`large` 也只有内容宽 × 160pt。
 */
export interface ImageNode extends Keyed {
  kind: "image";
  file: FileHandle;
  /** VoiceOver 读的说明。必填。 */
  label: string;
  size?: "small" | "medium" | "large";
}

/** 一条流量曲线（SDK 2.10）：`upload` 与 `download` 各至多一条，颜色宿主定（下行青、上行橙）。 */
export interface ChartSeries {
  tone: "upload" | "download";
  /** ≤ 120 个非负数（旧的在前）。每条按自己的最大值归一。 */
  values: number[];
}

/**
 * 一块流量曲线（SDK 2.10，jarvis-mac `specs/20261028-130540-proxy-walkthrough-fixes` W-3）：与菜单栏菜单里那块同一种画法，
 * 在面板里满宽、高约 56pt。不可点、没有子节点。
 */
export interface ChartNode extends Keyed {
  kind: "chart";
  /** 1–2 条。 */
  series: ChartSeries[];
  /** ≤ 80 字。画在曲线下面的一行读数。 */
  caption?: string;
  /** ≤ 80 字。VoiceOver 读的说明；省略时读 `caption`，都没有读「流量曲线」。 */
  label?: string;
}

// ---------------------------------------------------------------------------
// 版式与读数（jarvis-mac `specs/20261028-191224-git-push-error-proxy-dashboard-issue-links` P-2 / P-3）：侧栏、自适应网格、表格、堆叠柱、宿主画的偏好控件。
// 构造器不在 `ui` 上，在 `layout` 上（`layout.ts`）：没用到它们的扩展重建之后产物逐字节不变。
// ---------------------------------------------------------------------------

/** 侧栏里的一项。 */
export interface SidebarItem {
  /** 1–40 字，同一个侧栏里不重。`onChange` 交回的就是它。 */
  value: string;
  /** 1–24 字。 */
  title: string;
  /** SF Symbol。 */
  symbol: string;
}

/**
 * 侧栏导航：**只许做根**。左侧一列 2–8 项，右侧恰好一个子节点（这一页的内容，可以是 `scroll`）。
 * 窗口里以它为根时正文不受 720pt 上限、铺满整扇窗。宿主借「项目」左栏那一行画每一项。
 */
export interface SidebarNode extends Keyed {
  kind: "sidebar";
  items: SidebarItem[];
  /** 选中的那一项（必须是 `items` 里的一个）。 */
  value: string;
  /** ≤ 80 字。VoiceOver 读的那一列的名字。 */
  label?: string;
  /** 点了另一项。扩展记下它、重画右侧那一页。 */
  onChange: Handler<string>;
  /** 恰好一个。 */
  children: [UINode];
}

/** 自适应网格：子节点按宽度排成若干列，每列至少 `minimum` pt（80–480 的整数，省略 160）。统计卡、节点卡一行放几张由宽度决定。 */
export interface GridNode extends Keyed {
  kind: "grid";
  minimum?: number;
  spacing?: StackSpacing;
  /**
   * 2–4 个 1–4 的整数，个数必须等于子节点数：一行放得下全部子节点时按比例分宽，折行时照旧等分
   * （主从两栏：进程 2 : 连接 3；jarvis-mac `specs/20261029-082059-proxy-window-desktop-layout` D-5，宿主 ≥ 3.3.1）。
   */
  weights?: number[];
  /**
   * 这个网格吃掉这一页剩下的高度、最后一行撑满：页的根是 `stack`（不滚动）时由竖排给；窗口里页的根是 `scroll` 时，
   * 内容比一窗矮才给、比一窗高照内容高整页滚（jarvis-mac 同一个 spec 第二轮 R-2）。一页至多一个（宿主 ≥ 3.3.1）。
   */
  fill?: boolean;
  children: UINode[];
}

/** 表格的一列。 */
export interface TableColumn {
  /** ≤ 24 字。 */
  title: string;
  /** narrow 56 / regular 104 / wide 200 / fill 吃掉剩下的；省略 regular。 */
  width?: "narrow" | "regular" | "wide" | "fill";
  /** 省略 leading。数字列给 trailing。 */
  alignment?: "leading" | "trailing";
  /** 等宽字。 */
  mono?: boolean;
}

/** 表格的一行：`cells` 的个数必须等于列数。 */
export interface TableRow {
  /** 每格 ≤ 200 字；宿主单行截断、悬停看全文、可选中。 */
  cells: string[];
  /** 整行的字着色。 */
  tint?: Tint;
  /** 1–120 字，一张表里不重复。有它的行在表挂了 `onSelect` 时可点（宿主 ≥ 3.3.1）。 */
  id?: string;
}

/** 表格：表头 + 斑马纹行，1–8 列、至多 300 行。挂了 `onSelect` 的表行可点。 */
export interface TableNode extends Keyed {
  kind: "table";
  columns: TableColumn[];
  rows: TableRow[];
  /** ≤ 80 字。没有行时画在表头下面。 */
  emptyText?: string;
  /** ≤ 80 字。VoiceOver。 */
  label?: string;
  /** 选中那一行的 `id`；不在这一次的行里时什么都不高亮（jarvis-mac `specs/20261029-082059-proxy-window-desktop-layout` D-6，宿主 ≥ 3.3.1）。 */
  selection?: string;
  /** 点了带 `id` 的一行，回传它的 `id`。点已选中的那一行同样回传——要不要取消选中由扩展决定。 */
  onSelect?: Handler<string>;
  /** 表头钉住、行在表里滚，表撑满被给的高度（主从两栏里用，配 `grid.fill`）。 */
  scroll?: boolean;
}

/** 柱状图的一条（与 `ChartSeries` 同一对色调）。 */
export interface BarsSeries {
  tone: "upload" | "download";
  /** 个数必须等于 `labels`，≥ 0。 */
  values: number[];
}

/** 一排堆叠柱（下行在下、上行叠在上面），高约 96pt。不可点、没有子节点。 */
export interface BarsNode extends Keyed {
  kind: "bars";
  /** 横轴 1–48 个，每个 ≤ 6 字；放不下时宿主每隔几个画一个。 */
  labels: string[];
  /** 1–2 条，upload / download 各至多一条。 */
  series: BarsSeries[];
  /** ≤ 80 字。画在柱下一行。 */
  caption?: string;
  /** ≤ 80 字。VoiceOver；省略时读 `caption`，都没有读「流量柱状图」。 */
  label?: string;
}

/**
 * 宿主画的偏好控件：manifest `contributes.settings.preferences` 里声明过的那一项，与设置页同一个控件（紧凑排版）。
 * 扩展读不到、写不到控件里的字——`urlList` 的地址仍是用户亲手填的，白名单语义不变。没声明过的宿主拒绝整棵树。
 */
/**
 * 窗口一页的页头（jarvis-mac `specs/20261029-082059-proxy-window-desktop-layout` D-2，宿主 ≥ 3.3.1）：左边标题与一行状态，右边 0–6 颗控件。
 * 页头里的 `toggle` 画紧凑一档（副标题进悬停说明）、`segmented` 一律紧凑、`search` 定宽。不可点。
 */
export interface HeaderNode extends Keyed {
  kind: "header";
  /** 1–24 字。 */
  title: string;
  /** ≤ 120 字。状态行：开没开、走哪条线、一共多少。 */
  subtitle?: string;
  /** 状态行前那颗点；省略不画点。`alert` / `danger` 时状态行的字也着色。 */
  tint?: Tint;
  /** 只能是 toggle / segmented / button / iconButton / search / chip / copy。 */
  children: UINode[];
}

export interface PreferenceNode extends Keyed {
  kind: "preference";
  /**
   * 那一项偏好的 key（线缆上原样是 `props.preference`）。不叫 `key`：`key` 是每个节点的稳定身份，序列化时不进 props。
   */
  preference: string;
}

export type UINode =
  | StackNode
  | ScrollNode
  | SectionNode
  | HairlineNode
  | SpacerNode
  | TextNode
  | RowNode
  | ReadoutNode
  | FieldNode
  | EditorNode
  | SearchNode
  | SegmentedNode
  | ToggleNode
  | ChipNode
  | PickerNode
  | ButtonNode
  | IconButtonNode
  | CopyNode
  | ResultNode
  | ProgressNode
  | BadgeNode
  | NoteNode
  | EmptyNode
  | ListNode
  | CardNode
  | SymbolNode
  | QRCodeNode
  | SwatchNode
  | DropZoneNode
  | KeycapNode
  | ImageNode
  | ChartNode
  | SidebarNode
  | GridNode
  | TableNode
  | BarsNode
  | PreferenceNode
  | HeaderNode;

export type UINodeKind = UINode["kind"];

/** 一次 render 最多提交多少节点。超出宿主拒绝整棵树并进错误屏。 */
export const maximumNodesPerRender = 500;

// ---------------------------------------------------------------------------
// 构造器：只是给对象字面量加上类型推断，不做任何运行时工作。
// ---------------------------------------------------------------------------

type Props<N extends UINode> = Omit<N, "kind">;

function make<N extends UINode>(kind: N["kind"]) {
  return (props: Props<N>): N => ({ kind, ...props }) as N;
}

export const ui = {
  stack: make<StackNode>("stack"),
  scroll: make<ScrollNode>("scroll"),
  section: make<SectionNode>("section"),
  hairline: (): HairlineNode => ({ kind: "hairline" }),
  spacer: (): SpacerNode => ({ kind: "spacer" }),
  text: make<TextNode>("text"),
  row: make<RowNode>("row"),
  readout: make<ReadoutNode>("readout"),
  field: make<FieldNode>("field"),
  editor: make<EditorNode>("editor"),
  search: make<SearchNode>("search"),
  segmented: make<SegmentedNode>("segmented"),
  toggle: make<ToggleNode>("toggle"),
  chip: make<ChipNode>("chip"),
  picker: make<PickerNode>("picker"),
  button: make<ButtonNode>("button"),
  iconButton: make<IconButtonNode>("iconButton"),
  copy: make<CopyNode>("copy"),
  result: make<ResultNode>("result"),
  progress: make<ProgressNode>("progress"),
  badge: make<BadgeNode>("badge"),
  note: make<NoteNode>("note"),
  empty: make<EmptyNode>("empty"),
  list: make<ListNode>("list"),
  card: make<CardNode>("card"),
  symbol: make<SymbolNode>("symbol"),
  qrcode: make<QRCodeNode>("qrcode"),
  swatch: make<SwatchNode>("swatch"),
  dropzone: make<DropZoneNode>("dropzone"),
  keycap: make<KeycapNode>("keycap"),
  image: make<ImageNode>("image"),
  chart: make<ChartNode>("chart"),
} as const;
