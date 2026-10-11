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
export type TextStyle = "sectionTitle" | "title" | "body" | "subtle" | "footnote" | "mono" | "readout";

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

export interface SectionNode extends Keyed {
  kind: "section";
  /** 段标题，形如「输入 · INPUT」；宿主按 10pt bold、字距 1 画。 */
  title: string;
  /** 段标题右端的读数（如 `26 字符 · 36 字节`）。 */
  trailing?: string;
  tint?: Tint;
  actions?: ActionSpec[];
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
  symbol: string;
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
  | ImageNode;

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
} as const;
