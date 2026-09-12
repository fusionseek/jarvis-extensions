/**
 * 宿主能力接口：扩展里那个全局 `jarvis` 对象长什么样。
 *
 * 每个命名空间对应 `docs/06-capabilities.md` 的一节。**需要用户点头的**在 manifest 的
 * `capabilities` 里声明，第一次进入扩展时由宿主的统一授权弹窗一次问完；没点头就调用，
 * Promise 以 `permission.denied` 拒绝，不会弹窗、不会抛到别处。
 */
import type { CapabilityID } from "./manifest.js";
import type { FileHandle } from "./ui.js";

export type JarvisErrorCode =
  /** 用户没有授予这项能力，或后来在设置里撤销了。 */
  | "permission.denied"
  /** 能力本身依赖的系统权限（屏幕录制 / 辅助功能）没有授予 Jarvis。 */
  | "permission.unavailable"
  /** manifest 没有声明这项能力。 */
  | "capability.undeclared"
  | "capability.unknown"
  /** 超过调用频率或体积上限。 */
  | "rate.limited"
  | "invalid.argument"
  /** 宿主侧执行失败（服务没起来、文件不在了、网络不通 …）。`detail` 里是给人读的一句话。 */
  | "host.failure"
  /** 用户在宿主的选择器 / 确认 / 框选里取消了。取消不是失败，但调用方仍要收尾。 */
  | "cancelled";

export interface JarvisErrorShape {
  code: JarvisErrorCode;
  message: string;
  detail?: string | undefined;
}

export class JarvisError extends Error implements JarvisErrorShape {
  readonly code: JarvisErrorCode;
  readonly detail: string | undefined;

  constructor(shape: JarvisErrorShape) {
    super(shape.message);
    this.name = "JarvisError";
    this.code = shape.code;
    this.detail = shape.detail;
  }
}

export type Unsubscribe = () => void;

// ---------------------------------------------------------------------------
// 隐式能力（不需要点头）
// ---------------------------------------------------------------------------

export interface HostInfo {
  /** 宿主版本，`CFBundleShortVersionString`。 */
  version: string;
  channel: "release" | "development";
}

export interface EnvironmentInfo {
  reduceMotion: boolean;
  reduceTransparency: boolean;
  increaseContrast: boolean;
  /** 形如 `zh-Hans-CN`。 */
  locale: string;
}

export interface HoldHandle {
  release(): void;
}

export interface PanelAPI {
  /**
   * 告诉容器「此刻别自动收回」。文件正在读、传输正在跑、用户正在输入框里打字——这些事跨越
   * 指针离开，15 秒倒计时到点会把这块内容连同工作一起收走。事情做完必须 `release()`；
   * 离开扩展时宿主兜底释放。
   */
  hold(reason: string): HoldHandle;
  /** 把面板收成那颗球。只允许在用户动作的回调里调用（1 秒内），否则拒绝。 */
  collapse(): Promise<void>;
  /**
   * 把面板展开到**这个扩展的页面**：没展开就展开、贴边就弹出、不在这一屏就切过来。
   * 典型用法是 `silent` 命令中途决定要给用户看结果。只在用户动作（含快捷键）之后 1 秒内放行。
   */
  present(): Promise<void>;
}

export interface CommandsAPI {
  /** 运行 manifest 里声明的一条命令，与快捷键触发同一条路（`trigger = "page"`）。 */
  run(id: string): Promise<void>;
}

export interface StorageAPI {
  get<T = unknown>(key: string): Promise<T | undefined>;
  /** 值必须可 JSON 序列化，单条 ≤ 64 KB，每个扩展合计 ≤ 2 MB / 2000 条；超出拒绝写入。 */
  set(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<void>;
  keys(): Promise<string[]>;
}

export interface PreferencesAPI {
  /** 读 manifest 里声明的偏好；没声明的 key 以 `invalid.argument` 拒绝。`secret` 类型同样从这里读。 */
  get<T = unknown>(key: string): Promise<T>;
  /** 全部偏好；`secret` 类型**不在**里面，只能按 key 单独取。 */
  all(): Promise<Record<string, unknown>>;
  onChange(listener: (changes: Record<string, unknown>) => void): Unsubscribe;
}

export type SystemPermissionKind = "screenRecording" | "accessibility";

export interface GrantResult {
  granted: CapabilityID[];
  denied: CapabilityID[];
}

export interface PermissionsAPI {
  granted(): Promise<CapabilityID[]>;
  /**
   * 再问一次。只允许在用户动作的回调里调用（1 秒内），且只能问 manifest 里声明过的能力；
   * 宿主用同一扇授权弹窗，范围收窄到这几项。
   */
  request(ids: CapabilityID[]): Promise<GrantResult>;
  /** 打开系统设置的对应隐私面板并上「把 Jarvis 拖进列表」那扇浮窗。 */
  openSystemSettings(kind: SystemPermissionKind): Promise<void>;
}

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogAPI {
  debug(message: string, data?: unknown): void;
  info(message: string, data?: unknown): void;
  warn(message: string, data?: unknown): void;
  error(message: string, data?: unknown): void;
}

// 纯函数工具：把工具箱里那几块面板背后的领域函数原样露出来。不需要点头，同步返回。

export interface Base64API {
  encode(text: string, options?: { urlSafe?: boolean; omitPadding?: boolean; wrapAt76?: boolean }): string;
  /** 宽进严出：省略的 `=` 补齐、URL-safe 自动兼容、非法字符报错并给出 1 基位置。 */
  decode(text: string, options?: { ignoreWhitespace?: boolean }): { text: string } | { error: string; position?: number };
}

export type HashAlgorithm = "md5" | "sha1" | "sha256" | "sha512";

export interface HashAPI {
  digest(algorithm: HashAlgorithm, text: string, options?: { uppercase?: boolean }): string;
}

export interface JSONToolAPI {
  format(text: string, options?: { indent?: 2 | 4 | "tab"; sortKeys?: boolean }): { text: string } | { error: string; line: number; column: number };
  minify(text: string, options?: { sortKeys?: boolean }): { text: string } | { error: string; line: number; column: number };
}

export interface URLToolAPI {
  parse(text: string): { scheme: string; host: string; path: string; fragment: string; query: { name: string; value: string | null }[] };
  build(parts: { scheme?: string; host: string; path?: string; fragment?: string; query?: { name: string; value: string | null }[] }): string;
}

export interface RegexToolAPI {
  test(pattern: string, text: string, flags?: string): { matches: { range: [number, number]; text: string; groups: string[] }[] } | { error: string };
}

export interface LanguageDetection {
  /** BCP-47，如 `zh-Hans`、`en`、`ja`；判不出为 `null`。 */
  code: string | null;
  /** 0…1。 */
  confidence: number;
  candidates: { code: string; confidence: number }[];
}

/** 语言检测与本地化语言名，走系统 `NaturalLanguage` 与 `Locale`。 */
export interface LanguageAPI {
  detect(text: string, options?: { hints?: string[] }): LanguageDetection;
  /** 按当前区域给出语言名，如 `zh-Hans` → 「简体中文」；认不出时原样返回 code。 */
  displayName(code: string): string;
}

export interface TextToolsAPI {
  base64: Base64API;
  hash: HashAPI;
  json: JSONToolAPI;
  url: URLToolAPI;
  regex: RegexToolAPI;
  language: LanguageAPI;
}

export interface TimeAPI {
  /** 解析时间戳（自动识别秒 / 毫秒，容忍千位逗号与下划线）。 */
  parse(text: string, unit?: "auto" | "seconds" | "milliseconds"): { epochMilliseconds: number } | { error: string };
  format(epochMilliseconds: number, pattern: string, timeZone?: string): { text: string } | { error: string };
  timeZones(): { identifier: string; city: string; offsetMinutes: number }[];
}

export interface ColorAPI {
  convert(hex: string): { hex: string; rgb: [number, number, number]; hsl: [number, number, number]; hsv: [number, number, number]; cmyk: [number, number, number, number] } | { error: string };
}

// ---------------------------------------------------------------------------
// 需要点头的能力
// ---------------------------------------------------------------------------

export interface ClipboardEntry {
  id: string;
  preview: string;
  kind: "text" | "code" | "url" | "color";
  copiedAt: string;
}

export interface ClipboardAPI {
  /** `clipboard.read`。密码管理器标记为机密的内容读回 `null`，宿主不放行。 */
  read(): Promise<string | null>;
  /** `clipboard.read`。剪贴板里是一张图时给出它的句柄（宿主落临时文件）；不是图为 `null`。 */
  readImage(): Promise<FileHandle | null>;
  /** `clipboard.write`。 */
  write(text: string): Promise<void>;
  /** `clipboard.history`。只给摘要，不给正文；正文要 `entryText(id)` 逐条取。 */
  history(options?: { limit?: number }): Promise<ClipboardEntry[]>;
  entryText(id: string): Promise<string | null>;
  /** `clipboard.read`。系统剪贴板换了内容时回调（宿主 0.6s 轮询一拍）。 */
  observe(listener: () => void): Unsubscribe;
}

export interface QuickTransferPeer {
  label: string;
  address: string;
  paired: boolean;
}

export interface QuickTransferStatus {
  state: "stopped" | "starting" | "running" | "failed";
  /** 运行中才有。 */
  url?: string;
  /** 只有 `quickTransfer.control` 才拿得到配对码——它是接入凭据，不是状态。 */
  pairingCode?: string;
  peers: QuickTransferPeer[];
  activeTransfers: number;
  inboxDirectory: string;
  failureReason?: string;
}

export interface TransferRecord {
  id: string;
  direction: "inbound" | "outbound";
  kind: "file" | "message";
  name: string;
  byteCount: number;
  peer: string;
  createdAt: string;
}

export interface QuickTransferAPI {
  /** `quickTransfer.status`。 */
  status(): Promise<QuickTransferStatus>;
  observe(listener: (status: QuickTransferStatus) => void): Unsubscribe;
  /** `quickTransfer.control`。开一个对局域网敞开的端口——这是全部能力里最重的一项。 */
  start(): Promise<QuickTransferStatus>;
  stop(): Promise<void>;
  /** `quickTransfer.send`。服务没开着时以 `host.failure` 拒绝，不会替用户把服务打开。 */
  sendText(text: string): Promise<void>;
  sendFile(file: FileHandle): Promise<void>;
  /** `quickTransfer.records`。 */
  records(options?: { limit?: number }): Promise<TransferRecord[]>;
}

/** OCR 认出的一行。 */
export interface OCRLine {
  text: string;
  /** 行墨迹盒，**相对整张图归一化到 0…1**，原点左上。 */
  box: { x: number; y: number; width: number; height: number };
  /** Vision 给的置信度 0…1。宿主不拿它做门（实测 0.5 的行全对），扩展也不该 */
  confidence: number;
}

export interface OCRResult {
  /** 按行拼好的纯文本（行之间 `\n`，同一行的碎片按空格连），**不合并段落**。要段落用 `ocr.mergeLines`。 */
  text: string;
  lines: OCRLine[];
}

export interface OCROptions {
  /** Vision 的识别语言，如 `["zh-Hans", "en-US"]`；省略用宿主默认的中英。 */
  languages?: string[];
  level?: "accurate" | "fast";
}

export interface ScreenshotCaptureOptions {
  mode?: "region" | "longshot";
  /**
   * 只框选、松手即完成，不进标注工具条。截屏翻译 / 识字这类"框一块就走"的场景用它；
   * 省略时走完整的截图会话（用户可以标注，按 ⏎ 完成）。
   */
  selectionOnly?: boolean;
  /** 顺手把 OCR 也做了，结果放在 `ocr` 字段；省略则不识别。 */
  recognizeText?: boolean;
  /** `recognizeText` 时的 OCR 选项。 */
  ocr?: OCROptions;
}

export interface ScreenshotResult {
  /** PNG 文件，落在宿主的临时目录，会话结束即清理。 */
  file: FileHandle;
  width: number;
  height: number;
  ocr?: OCRResult;
}

export interface ScreenshotAPI {
  /**
   * `screenshot.capture`。宿主收起面板、盖遮罩、由用户框选；用户按 Esc 时以 `cancelled` 拒绝。
   * 完成后由命令的 `presentation` 决定面板怎么办（页面里按按钮触发的按 `panel` 处理）。
   * 依赖 Jarvis 自己的屏幕录制权限：没有时以 `permission.unavailable` 拒绝，
   * 扩展应给一颗按钮走 `permissions.openSystemSettings("screenRecording")`。
   */
  capture(options?: ScreenshotCaptureOptions): Promise<ScreenshotResult>;
}

export interface OCRAPI {
  /** `ocr.recognize`。对一个句柄（截图、剪贴板里的图、用户拖进来的图）跑 Vision。图 ≤ 20 MB。 */
  recognize(file: FileHandle, options?: OCROptions): Promise<OCRResult>;
}

export interface SpeechAPI {
  /** `speech.speak`。系统语音朗读；再次调用打断上一次。`language` 为 BCP-47。 */
  speak(text: string, options?: { language?: string; rate?: number }): Promise<void>;
  stop(): Promise<void>;
}

export interface NotificationsAPI {
  /** `notifications.post`。走通知中心；副标题恒为扩展名；点横幅展开面板到这个扩展。声音由宿主的提示音设置决定。 */
  post(content: { title: string; body: string }): Promise<void>;
}

export interface InboxCardAction {
  id: string;
  title: string;
  primary?: boolean;
}

export interface InboxCard {
  /** 扩展内唯一。同 id 再投递 = 替换，不是第二张卡。 */
  id: string;
  title: string;
  body: string;
  tint?: "accent" | "live" | "alert" | "danger" | "violet";
  symbol?: string;
  /** 至多 3 颗；按下后宿主调用 `onInboxAction(cardId, actionId)`。 */
  actions?: InboxCardAction[];
  /** 同时弹系统横幅。需要 manifest `inbox.notifications: true` 与 `notifications.post`。 */
  notify?: boolean;
}

export interface InboxAPI {
  /** `inbox.post`。每个扩展同一时刻只有一张活动卡；10 秒内最多投一次。 */
  post(card: InboxCard): Promise<void>;
  dismiss(cardId: string): Promise<void>;
}

export interface MemoEntry {
  id: number;
  body: string;
  kind: "note" | "todo" | "mind";
  isDone: boolean;
  priority: 0 | 1 | 2 | 3;
  dueAt?: string;
  tags: string[];
  createdAt: string;
}

export interface MemoAPI {
  /** `memo.read`。 */
  list(options?: { filter?: "all" | "todo" | "today"; limit?: number }): Promise<MemoEntry[]>;
  /** `memo.write`。正文里的语法记号（`- ` / `!` / `#` / `@`）与用户手打时同样生效。 */
  create(body: string): Promise<{ id: number }>;
  complete(id: number): Promise<void>;
}

export interface CalendarRunSummary {
  day: string;
  codex: number;
  claude: number;
  memos: number;
}

export interface CalendarAPI {
  /** `calendar.read`。按天汇总的轮次数，区间最长 93 天。 */
  runs(range: { from: string; to: string }): Promise<CalendarRunSummary[]>;
}

export interface TaskSnapshot {
  id: string;
  title: string;
  state: "queued" | "running" | "waiting" | "succeeded" | "failed" | "cancelled";
  detail?: string | undefined;
  progress?: number;
  updatedAt: string;
  source: { id: string; kind: string; displayName?: string };
}

export interface TasksAPI {
  /** `tasks.read`。 */
  recent(): Promise<TaskSnapshot[]>;
  observe(listener: (task: TaskSnapshot) => void): Unsubscribe;
}

export interface NetResponse {
  status: number;
  headers: Record<string, string>;
  /** UTF-8 文本；响应 ≤ 5 MB。 */
  text: string;
}

export interface NetAPI {
  /**
   * `network.https`。只放行 manifest `network.hosts` 里的主机、只走 HTTPS、30 秒超时；
   * 没有 cookie、没有重定向到白名单之外的主机。请求头由扩展决定（含 `User-Agent`），
   * 宿主只追加一个 `X-Jarvis-Extension: <id>/<version>` 做标识。
   */
  fetch(url: string, init?: { method?: "GET" | "POST" | "PUT" | "DELETE"; headers?: Record<string, string>; body?: string }): Promise<NetResponse>;
}

export interface FilesAPI {
  /** `files.pick`。宿主开系统文件选择器（面板在此期间不自动收回）。取消以 `cancelled` 拒绝。 */
  pick(options?: { accepts?: string[]; multiple?: boolean }): Promise<FileHandle[]>;
  /** 只能读句柄指向的文件；文本 ≤ 20 MB。 */
  readText(file: FileHandle): Promise<string>;
  /** Base64 编码的字节；≤ 20 MB。 */
  readBytes(file: FileHandle): Promise<string>;
  reveal(file: FileHandle): Promise<void>;
}

export interface SystemAPI {
  /** `system.openURL`。只放行 https。 */
  openURL(url: string): Promise<void>;
}

export interface UIAPI {
  /** 让宿主再调一次 `render()`。同一拍多次调用会被合并；页面没开着时是空操作，状态留到下次 `activate`。 */
  update(): void;
}

/** 扩展里那个全局对象。 */
export interface Jarvis {
  readonly sdk: { version: string };
  readonly host: HostInfo;
  readonly environment: EnvironmentInfo;
  readonly ui: UIAPI;
  readonly panel: PanelAPI;
  readonly commands: CommandsAPI;
  readonly storage: StorageAPI;
  readonly preferences: PreferencesAPI;
  readonly permissions: PermissionsAPI;
  readonly log: LogAPI;
  readonly text: TextToolsAPI;
  readonly time: TimeAPI;
  readonly color: ColorAPI;
  readonly clipboard: ClipboardAPI;
  readonly quickTransfer: QuickTransferAPI;
  readonly screenshot: ScreenshotAPI;
  readonly ocr: OCRAPI;
  readonly speech: SpeechAPI;
  readonly notifications: NotificationsAPI;
  readonly inbox: InboxAPI;
  readonly memo: MemoAPI;
  readonly calendar: CalendarAPI;
  readonly tasks: TasksAPI;
  readonly net: NetAPI;
  readonly files: FilesAPI;
  readonly system: SystemAPI;
}
