/**
 * 宿主能力接口：扩展里那个全局 `jarvis` 对象长什么样。
 *
 * 每个命名空间对应 `docs/06-capabilities.md` 的一节。**需要用户点头的**在 manifest 的
 * `capabilities` 里声明，第一次进入扩展（或第一次在设置里启用它的服务）时由宿主的授权屏一次问完；
 * 没点头就调用，Promise 以 `permission.denied` 拒绝，不会弹窗、不会抛到别处。
 *
 * v2 的目录**只列宿主真的做得到的**：声明得到、调不到的能力会让用户在授权屏上点了头，
 * 扩展却永远走不到那条路，而两边都不会报错。
 */
import type { CapabilityID } from "./manifest.js";
import type { FileHandle } from "./ui.js";

/** 结构化错误码。 */
export type JarvisErrorCode =
  /** 用户没有授予这项能力，或后来在设置里撤销了。 */
  | "permission.denied"
  /** 能力本身依赖的系统权限（屏幕录制 / 辅助功能）没有授予 Jarvis。 */
  | "permission.unavailable"
  /** manifest 没有声明这项能力，或参数超出了声明的对象（没声明的可执行文件、参数组合、路径、脚本）。 */
  | "capability.undeclared"
  | "capability.unknown"
  /** 这一面不存在：后台会话里调了界面类能力（`panel.*`、`ui.*`、`window.open`），或扩展没有入驻那个域。 */
  | "surface.unavailable"
  /** 超过调用频率或体积上限。 */
  | "rate.limited"
  | "invalid.argument"
  /** 宿主侧执行失败（服务没起来、文件不在了、网络不通 …）。`detail` 里是给人读的一句话。 */
  | "host.failure"
  /** 用户在宿主的框选 / 确认里取消了，或宿主取消了这次服务调用。取消不是失败，但调用方仍要收尾。 */
  | "cancelled";

/** 一个结构化错误的形状。 */
export interface JarvisErrorShape {
  code: JarvisErrorCode;
  message: string;
  detail?: string | undefined;
}

/** 宿主拒绝时，Promise 以它拒绝。 */
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

/** 取消订阅。 */
export type Unsubscribe = () => void;

// ---------------------------------------------------------------------------
// 隐式能力（不需要点头）
// ---------------------------------------------------------------------------

/** 宿主版本。 */
export interface HostInfo {
  /** `CFBundleShortVersionString`。 */
  version: string;
  channel: "release" | "development";
}

/** 辅助功能与区域。 */
export interface EnvironmentInfo {
  reduceMotion: boolean;
  reduceTransparency: boolean;
  increaseContrast: boolean;
  /** 形如 `zh-Hans-CN`。 */
  locale: string;
}

/** `panel.hold` 的句柄。 */
export interface HoldHandle {
  release(): void;
}

/** 面板（工具箱域）。后台会话里一律 `surface.unavailable`。 */
export interface PanelAPI {
  /**
   * 告诉容器「此刻别自动收回」。文件正在读、传输正在跑、用户正在输入框里打字——这些事跨越
   * 指针离开，15 秒倒计时到点会把这块内容连同工作一起收走。事情做完必须 `release()`；
   * 离开扩展时宿主兜底释放。原地弹窗同样尊重它。
   */
  hold(reason: string): HoldHandle;
  /** 把面板收成那颗球。只允许在用户动作的回调里调用（1 秒内），否则拒绝。 */
  collapse(): Promise<void>;
  /** 把面板展开到**这个扩展的页面**。只在用户动作（含快捷键与 `/` 指令）之后 1 秒内放行。 */
  present(): Promise<void>;
}

/** 窗口域。后台会话里、或没有入驻窗口域时一律 `surface.unavailable`。 */
export interface WindowAPI {
  /** 在 Jarvis 工作区窗口里打开这个扩展的标签（已经开着就切过去）。前台会话随之 activate 在窗口那一面。 */
  open(): Promise<void>;
}

/** 命令。 */
export interface CommandsAPI {
  /** 运行 manifest 里声明的一条命令，与快捷键触发同一条路（`trigger = "page"`）。 */
  run(id: string, argument?: string): Promise<void>;
}

/** 扩展自己的键值存储（与偏好分开存）。 */
export interface StorageAPI {
  get<T = unknown>(key: string): Promise<T | undefined>;
  /** 值必须可 JSON 序列化，单条 ≤ 64 KB。 */
  set(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<void>;
  keys(): Promise<string[]>;
}

/** 偏好（设置域与服务的设置）。 */
export interface PreferencesAPI {
  /** 读 manifest 里声明的偏好（含服务的 `preferences`）。`secret` 也从这里读。 */
  get<T = unknown>(key: string): Promise<T>;
  /** 全部偏好；`secret` 类型**不在**里面，只能按 key 单独取。 */
  all(): Promise<Record<string, unknown>>;
  onChange(listener: (changes: Record<string, unknown>) => void): Unsubscribe;
}

/** 借来的系统权限。 */
export type SystemPermissionKind = "screenRecording" | "accessibility";

/** `permissions.request` 的结果。 */
export interface GrantResult {
  granted: CapabilityID[];
  denied: CapabilityID[];
}

/** 授权。 */
export interface PermissionsAPI {
  granted(): Promise<CapabilityID[]>;
  /**
   * 再问一次。只允许在用户动作的回调里调用（1 秒内），且只能问 manifest 里声明过的能力；
   * 后台会话里没有授权屏，返回此刻的授权、不弹窗。
   */
  request(ids: CapabilityID[]): Promise<GrantResult>;
  /** 打开系统设置的对应隐私面板并上「把 Jarvis 拖进列表」那扇浮窗。 */
  openSystemSettings(kind: SystemPermissionKind): Promise<void>;
}

/** 日志级别。 */
export type LogLevel = "debug" | "info" | "warn" | "error";

/** 日志。设置页那块扩展面板与开发者能看到。 */
export interface LogAPI {
  debug(message: string, data?: unknown): void;
  info(message: string, data?: unknown): void;
  warn(message: string, data?: unknown): void;
  error(message: string, data?: unknown): void;
}

// 纯函数工具：把工具箱里那几块面板背后的领域函数原样露出来。不需要点头，同步返回。

/** Base64。 */
export interface Base64API {
  encode(text: string, options?: { urlSafe?: boolean; omitPadding?: boolean; wrapAt76?: boolean }): string;
  /** 宽进严出：省略的 `=` 补齐、URL-safe 自动兼容、非法字符报错并给出 1 基位置。 */
  decode(text: string, options?: { ignoreWhitespace?: boolean }): { text: string } | { error: string; position?: number };
}

/** 摘要算法。 */
export type HashAlgorithm = "md5" | "sha1" | "sha256" | "sha512";

/** 哈希。 */
export interface HashAPI {
  digest(algorithm: HashAlgorithm, text: string, options?: { uppercase?: boolean }): string;
}

/** 语言检测结果。 */
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

/**
 * 文本工具：同步纯函数，与工具箱里那几块面板背后的同一份领域函数。
 *
 * **只列宿主真的答得上的**：Base64、摘要与语言检测。JSON / URL / 正则 / 时间 / 颜色那几样曾经写在 SDK 1 的类型里，
 * 宿主从没接上——调用只会拿到 `capability.unknown`。v2 把它们拿掉，等宿主真的接上再加回来。
 */
export interface TextToolsAPI {
  base64: Base64API;
  hash: HashAPI;
  language: LanguageAPI;
}

// ---------------------------------------------------------------------------
// 需要点头的能力
// ---------------------------------------------------------------------------

/** 剪贴板。 */
export interface ClipboardAPI {
  /** `clipboard.read`。密码管理器标记为机密的内容读回 `null`，宿主不放行。 */
  read(): Promise<string | null>;
  /** `clipboard.read`。剪贴板里是一张图时给出它的句柄（宿主落临时文件）；不是图为 `null`。 */
  readImage(): Promise<FileHandle | null>;
  /** `clipboard.write`。 */
  write(text: string): Promise<void>;
}

/** 一台连着快传的设备。 */
export interface QuickTransferPeer {
  label: string;
  address: string;
  paired: boolean;
}

/** 快传此刻的状态。 */
export interface QuickTransferStatus {
  state: "stopped" | "starting" | "running" | "failed";
  /** 运行中才有。 */
  url?: string;
  peers: QuickTransferPeer[];
  activeTransfers: number;
  failureReason?: string;
}

/** 快传。 */
export interface QuickTransferAPI {
  /** `quickTransfer.status`。 */
  status(): Promise<QuickTransferStatus>;
  /** `quickTransfer.status`。状态变化时回调。 */
  observe(listener: (status: QuickTransferStatus) => void): Unsubscribe;
  /** `quickTransfer.control`。开一个对局域网敞开的端口——这是全部能力里最重的一项。 */
  start(): Promise<QuickTransferStatus>;
  /** `quickTransfer.control`。 */
  stop(): Promise<void>;
  /** `quickTransfer.send`。服务没开着时以 `host.failure` 拒绝，不会替用户把服务打开。 */
  sendText(text: string): Promise<void>;
}

/** OCR 认出的一行。 */
export interface OCRLine {
  text: string;
  /** 行墨迹盒，**相对整张图归一化到 0…1**，原点左上。 */
  box: { x: number; y: number; width: number; height: number };
  /** Vision 给的置信度 0…1。宿主不拿它做门（实测 0.5 的行全对），扩展也不该。 */
  confidence: number;
}

/** OCR 结果。 */
export interface OCRResult {
  /** 按行拼好的纯文本（行之间 `\n`，同一行的碎片按空格连），**不合并段落**。要段落用 `ocr.mergeLines`。 */
  text: string;
  lines: OCRLine[];
}

/** OCR 选项。 */
export interface OCROptions {
  /** Vision 的识别语言，如 `["zh-Hans", "en-US"]`；省略用宿主默认的中英。 */
  languages?: string[];
  level?: "accurate" | "fast";
}

/** 截图选项。 */
export interface ScreenshotCaptureOptions {
  mode?: "region" | "longshot";
  /** 只框选、松手即完成，不进标注工具条。截屏翻译 / 识字这类"框一块就走"的场景用它。 */
  selectionOnly?: boolean;
  /** 顺手把 OCR 也做了，结果放在 `ocr` 字段；省略则不识别。 */
  recognizeText?: boolean;
  /** `recognizeText` 时的 OCR 选项。 */
  ocr?: OCROptions;
  /** 框选期间画在选框下方那句提示（≤ 16 字），如「松手即翻译」。只对 `selectionOnly` 有意义。 */
  hint?: string;
  /** 这一次框选长什么样。只对 `selectionOnly` 有意义；省略时与宿主自己的截图一模一样。 */
  appearance?: ScreenshotCaptureAppearance;
}

/** 只框选那次会话的外观。 */
export interface ScreenshotCaptureAppearance {
  /** 背景压暗。默认 `true`。 */
  dim?: boolean;
  /** 整屏网格、十字参照线与放大镜——给构图用的。默认 `true`。`false` 时指针换成短准星。 */
  guides?: boolean;
  /** 跟在光标尾巴上那枚 SF Symbol（仅在 `guides: false` 时生效）。 */
  cursorSymbol?: string;
}

/** 截图结果。 */
export interface ScreenshotResult {
  /** PNG 文件，落在宿主的临时目录，会话结束即清理。 */
  file: FileHandle;
  width: number;
  height: number;
  ocr?: OCRResult;
}

/** 截图。 */
export interface ScreenshotAPI {
  /**
   * `screenshot.capture`。宿主收起面板、盖遮罩、由用户框选；用户按 Esc 时以 `cancelled` 拒绝。
   * 依赖 Jarvis 自己的屏幕录制权限：没有时以 `permission.unavailable` 拒绝。
   */
  capture(options?: ScreenshotCaptureOptions): Promise<ScreenshotResult>;
}

/** 识字。 */
export interface OCRAPI {
  /** `ocr.recognize`。对一个句柄（截图、剪贴板里的图）跑 Vision。图 ≤ 20 MB。 */
  recognize(file: FileHandle, options?: OCROptions): Promise<OCRResult>;
}

/** 朗读。 */
export interface SpeechAPI {
  /** `speech.speak`。系统语音朗读；再次调用打断上一次。`language` 为 BCP-47。 */
  speak(text: string, options?: { language?: string; rate?: number }): Promise<void>;
  stop(): Promise<void>;
}

/** 系统横幅。 */
export interface NotificationsAPI {
  /** `notifications.post`。走通知中心；副标题恒为扩展名。声音由宿主的提示音设置决定。 */
  post(content: { title: string; body: string }): Promise<void>;
}

/** 一条 Inbox 消息。 */
export interface InboxMessage {
  /** ≤ 60 字。 */
  title: string;
  /** ≤ 400 字。 */
  body: string;
  /** 默认 `info`。 */
  level?: "info" | "success" | "warning" | "error";
}

/** Inbox。 */
export interface InboxAPI {
  /** `inbox.post`。投一条消息（与 WebSocket 进来的消息同一张卡，标题前缀扩展名）；10 秒内最多投一次。 */
  post(message: InboxMessage): Promise<void>;
}

/** 一个 HTTPS 响应。 */
export interface NetResponse {
  status: number;
  headers: Record<string, string>;
  /** UTF-8 文本；响应 ≤ 5 MB。 */
  text: string;
}

/** 网络。 */
export interface NetAPI {
  /**
   * `network.https`。只放行 manifest `network.hosts` 里的主机（完全相等）、只走 HTTPS、30 秒超时；
   * 没有 cookie、没有重定向到白名单之外的主机。宿主追加一个 `X-Jarvis-Extension: <id>/<version>`。
   */
  fetch(url: string, init?: { method?: "GET" | "POST" | "PUT" | "DELETE"; headers?: Record<string, string>; body?: string }): Promise<NetResponse>;
}

/** 一次 `process.run` 的结果。 */
export interface ProcessResult {
  /** 退出码；被信号终止时为负的信号值。 */
  exitCode: number;
  /** stderr 的最后 4 KB。 */
  stderr: string;
}

/** 一次 `process.run` 的句柄。 */
export interface ProcessHandle {
  /** 进程结束时兑现；取消后以 `cancelled` 拒绝。 */
  readonly result: Promise<ProcessResult>;
  /** 中断进程（SIGINT）。已经结束时是空操作。 */
  cancel(): void;
}

/**
 * `process.locate` 的结论。找不到不是错误，是「还没装」或「填错了」——各自给用户的出路不一样：
 * 前者装一个，后者去设置里改。
 */
export type ExecutableLocation =
  | { path: string; source: "custom" | "discovered" }
  | {
      path: null;
      /** `notFound` = 按名字在固定位置里没找到；`missing` = 填的路径不存在；`notExecutable` = 填的路径不是可执行文件。 */
      problem: "notFound" | "missing" | "notExecutable";
    };

/** 受限执行（指令域）。 */
export interface ProcessAPI {
  /**
   * `process.run`。按名字（manifest `process.executables[].name`）在 Homebrew、`~/.local/bin`、`~/bin` 与 Nix 的固定位置里找；
   * 带 `/` 或 `~` 的当作用户填的路径——**坏了就报坏，不悄悄回落到自动探测**。路径的文件名必须等于声明的名字，
   * 否则以 `capability.undeclared` 拒绝。
   */
  locate(executable: string): Promise<ExecutableLocation>;
  /**
   * `process.run`。跑一个声明过的可执行文件，参数必须与声明的某一组逐项相等。
   * 不经 shell；stdin 接空设备（非交互）；工作目录是主目录；PATH 补上 Homebrew 与常见工具链目录；`NO_COLOR=1`。
   * 标准输出逐行交给 `onLine`（宿主按 100ms 合批推过来）。**进程继承 Jarvis 的全部系统权限**（含完全磁盘访问）。
   */
  run(options: { executable: string; arguments: string[]; onLine?: (line: string) => void }): ProcessHandle;
}

/** `files.stat` 的结果。 */
export interface FileStat {
  size: number;
  /** inode；换了 inode = 文件被换掉了（例如日志轮转）。 */
  inode: number;
}

/** `files.tail` 的结果。 */
export interface FileTail {
  /** 从 `offset` 起读到的**完整**行（不含换行）。最后一个换行之后的半行不读，留到下一次。 */
  lines: string[];
  /** 下一次从这里读。 */
  offset: number;
  size: number;
  inode: number;
}

/** 读声明过的文件。 */
export interface FilesAPI {
  /** `files.read`。文件不在时为 `null`。 */
  stat(path: string): Promise<FileStat | null>;
  /** `files.read`。从字节偏移 `offset` 起读完整的行，一次 ≤ 1 MB。文件不在时为 `null`。 */
  tail(path: string, offset: number): Promise<FileTail | null>;
}

/** 终端。 */
export interface TerminalAPI {
  /** `terminal.run`。打开一个终端，逐字执行 manifest `process.terminal` 里那段 id 的脚本。打开即返回，不等它跑完。 */
  run(scriptId: string): Promise<void>;
}

/** 系统。 */
export interface SystemAPI {
  /** `system.openURL`。只放行 https。 */
  openURL(url: string): Promise<void>;
  /** 打开设置窗口里这个扩展的那一块（偏好、授权、快捷键都在那里）。隐式能力。 */
  openExtensionSettings(): Promise<void>;
}

/** 界面。 */
export interface UIAPI {
  /** 让宿主再调一次 `render()`。同一拍多次调用会被合并；没有哪一面开着时是空操作。 */
  update(): void;
  /**
   * 撤掉这一轮的原地弹窗：这一轮没什么可给用户看的（比如框到的那块里根本没有文字）。
   * 在命令返回之前 `await` 它，SDK 那次自动提交就不会再开弹窗了。
   */
  dismissPopover(): Promise<void>;
}

/** 扩展里那个全局对象。 */
export interface Jarvis {
  readonly sdk: { version: string };
  readonly host: HostInfo;
  readonly environment: EnvironmentInfo;
  readonly ui: UIAPI;
  readonly panel: PanelAPI;
  readonly window: WindowAPI;
  readonly commands: CommandsAPI;
  readonly storage: StorageAPI;
  readonly preferences: PreferencesAPI;
  readonly permissions: PermissionsAPI;
  readonly log: LogAPI;
  readonly text: TextToolsAPI;
  readonly clipboard: ClipboardAPI;
  readonly quickTransfer: QuickTransferAPI;
  readonly screenshot: ScreenshotAPI;
  readonly ocr: OCRAPI;
  readonly speech: SpeechAPI;
  readonly notifications: NotificationsAPI;
  readonly inbox: InboxAPI;
  readonly net: NetAPI;
  readonly process: ProcessAPI;
  readonly files: FilesAPI;
  readonly terminal: TerminalAPI;
  readonly system: SystemAPI;
}
