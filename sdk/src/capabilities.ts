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
  /** SDK 2.7：`output: "text"` 时的整份标准输出（按 UTF-8 解码，≤ 4 MiB）；逐行推送时没有。 */
  stdout?: string;
}

/** `process.run` 的选项。 */
export interface ProcessRunOptions {
  executable: string;
  arguments: string[];
  /** 逐行推送的标准输出（不收整份时）。 */
  onLine?: (line: string) => void;
  /**
   * SDK 2.7：写进标准输入的文字（≤ 1 MiB）。只对 manifest 里声明了 `stdin: true` 的可执行文件放行，
   * 否则以 `capability.undeclared` 拒绝。省略时 stdin 接空设备（原来的样子）。
   */
  stdin?: string;
  /**
   * SDK 2.7：工作目录的句柄——只认宿主在这一次服务调用里给的那一个（`code.format · format` 的 `request.directory`），
   * 别的一律 `capability.undeclared`。格式化工具据此按文件所在目录找 `.clang-format` / `.editorconfig` / `pyproject.toml`。
   * 省略时工作目录是主目录。
   */
  directory?: string;
  /**
   * SDK 2.7：`"text"` = 不逐行推，进程结束后在结果的 `stdout` 里交回整份输出（逐行推会吞掉空行，交回一份源码必须是整份）。
   */
  output?: "text";
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
   * 不经 shell；stdin 接空设备（非交互，SDK 2.7 起声明了 `stdin` 的可以写入一段文字）；工作目录是主目录（或宿主给的目录句柄）；
   * PATH 补上 Homebrew 与常见工具链目录；`NO_COLOR=1`。
   * 标准输出逐行交给 `onLine`（宿主按 100ms 合批推过来），或 `output: "text"` 时整份放在结果里。**进程继承 Jarvis 的全部系统权限**（含完全磁盘访问）。
   */
  run(options: ProcessRunOptions): ProcessHandle;
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

// ---------------------------------------------------------------------------
// Git 操作域（要入驻 Git 域：manifest `contributes.git`）
// ---------------------------------------------------------------------------

/** Jarvis 最近打开过的一个仓库。**不给本机路径**：扩展要的是「它是谁」，不是「它在哪」。 */
export interface GitRepositorySummary {
  /** 仓库目录名。 */
  name: string;
  /** 远端主机，如 `github.com`；`origin` 读不出主机时省略。 */
  host?: string;
  /** 远端身份 `owner/name`；`origin` 读不出时省略。 */
  repository?: string;
}

/**
 * token 对 Projects 的权限，由宿主从 classic token 的 scope 推断：
 * `readWrite` = 有 `project`；`readOnly` = 只有 `read:project`；`none` = 两个都没有；
 * `unknown` = fine-grained token 不报 scope，只能试了才知道。
 */
export type GitProjectAccess = "readWrite" | "readOnly" | "none" | "unknown";

/** `git.hosting.viewer` 的结果：此刻那把 token 是谁、能做什么。 */
export interface GitHostingViewer {
  /** token 的登录名；读不出时省略。 */
  login?: string;
  /** classic token 的 scope；fine-grained token 没有，省略。 */
  scopes?: string[];
  projectAccess: GitProjectAccess;
}

/** 一次 GraphQL 请求。 */
export interface GitGraphQLRequest {
  /** 托管服务标识，必须在 `contributes.git.hosting` 里。只声明了一个时可以省略；声明了多个就显式传。 */
  hosting?: string;
  /** 一份 GraphQL 文档：**恰好一个操作**，可以带具名片段；≤ 64 KB。用户给的值一律放 `variables`，不要拼进文档。 */
  query: string;
  /** 变量，任意 JSON 对象。 */
  variables?: Record<string, unknown>;
}

/** GraphQL 响应里的一条错误（GitHub 的形状）。 */
export interface GitGraphQLError {
  message: string;
  /** GitHub 的错误类型，如 `NOT_FOUND`、`FORBIDDEN`、`INSUFFICIENT_SCOPES`。 */
  type?: string;
  path?: (string | number)[];
  locations?: { line: number; column: number }[];
  extensions?: Record<string, unknown>;
}

/**
 * GraphQL 响应原样：`data` 与 `errors` 可以同时出现（部分成功）——**宿主不把部分成功当失败**，
 * 是否接受由扩展决定。整次失败（服务没开、没 token、`gh` 没装、超时）才以 `host.failure` 拒绝。
 */
export interface GitGraphQLResponse<T = unknown> {
  data?: T | null;
  errors?: GitGraphQLError[];
}

/** 托管服务的读写（经宿主的 Git 服务执行；token 只在宿主的钥匙串里）。 */
export interface GitHostingAPI {
  /** `git.hosting.read`。此刻那把 token 的身份与 Projects 权限。服务没开、没添加、缺 token 时以 `host.failure` 拒绝。 */
  viewer(options?: { hosting?: string }): Promise<GitHostingViewer>;
  /**
   * `git.hosting.read`。执行一份**查询**；文档里出现 `mutation` / `subscription` 以 `invalid.argument` 拒绝。
   * 每分钟 ≤ 240 次。
   */
  query<T = unknown>(request: GitGraphQLRequest): Promise<GitGraphQLResponse<T>>;
  /**
   * `git.hosting.write`。执行一份变更（查询也放行）：顶层字段名必须都在 manifest `git.mutations` 里，
   * 否则以 `capability.undeclared` 拒绝；顶层不能用片段展开（不让变更字段藏进片段里）。每分钟 ≤ 60 次。
   */
  mutate<T = unknown>(request: GitGraphQLRequest): Promise<GitGraphQLResponse<T>>;
}

/** Git 操作域。没有入驻 Git 域的扩展声明不了这几项能力。 */
export interface GitAPI {
  /** `git.repository.read`。Jarvis 最近打开过的仓库（至多 20 个，读不出 `origin` 的跳过）。每分钟 ≤ 60 次。 */
  repositories(): Promise<GitRepositorySummary[]>;
  hosting: GitHostingAPI;
}

// ---------------------------------------------------------------------------
// Android 操作域（SDK 2.4）
// ---------------------------------------------------------------------------

/**
 * 一台经 adb 看得见的设备。
 *
 * `state` 是 `adb devices` 那一列的归类：`device` = 连着且允许了调试；`unauthorized` = 手机上还没点「允许 USB 调试」；
 * `offline` = adb 认得它但此刻说不上话（多半是线松了或刚重启）；其余一律 `other`（`recovery`、`sideload` 之类，读不了应用）。
 * 只有 `ready` 为真的设备能拿去 `apps` / `appDetails`——它就是 `state === "device"`，单列出来是为了让扩展不必自己记这条规则。
 */
export interface AndroidDevice {
  /** adb 的序列号；`apps` / `appDetails` 按它点名设备。 */
  serial: string;
  /** 给人看的名字：读得出型号就是型号，读不出就是序列号。 */
  name: string;
  state: "device" | "unauthorized" | "offline" | "other";
  ready: boolean;
}

/** 列哪些应用：`user` = 只列用户自己装的（第三方）应用；`all` = 连同系统应用一起列。 */
export type AndroidAppScope = "user" | "all";

/**
 * 设备上装着的一个应用：列表那一步就拿得到的事实（不拉安装包）。
 *
 * 三个大小是**彼此不重叠**的三块，加起来是这个应用在手机上占的地方；设备不报（老系统、没有权限读 `diskstats`）时为 `null`——
 * `null` 是「不知道」，不是 0，汇总时跳过它，不要当 0 加。
 */
export interface AndroidApp {
  /** 包名，例如 `com.tencent.mm`。 */
  package: string;
  /** 系统应用（预装、在 system 分区）。`scope: "user"` 时恒为 `false`。 */
  system: boolean;
  /** 安装包（APK 与拆分包）的字节数。 */
  apkBytes: number | null;
  /** 应用数据的字节数（不含缓存）。 */
  dataBytes: number | null;
  /** 缓存的字节数。 */
  cacheBytes: number | null;
}

/** `android.apps` 的结果。 */
export interface AndroidAppList {
  apps: AndroidApp[];
}

/**
 * 一个应用读安装包才拿得到的东西：应用名、版本、图标。
 *
 * 宿主为它把 APK 拉到本机临时目录、用 aapt2 读、读完即删——**每个包要几百毫秒到几秒**，因此单列成一个调用，
 * 由扩展按屏、按批去要。某一个包读不出来时不让整批失败：那一项 `problem` 写一句人话，其余照常。
 */
export interface AndroidAppDetail {
  package: string;
  /** 应用名（按系统语言挑的那一个）；读不出为 `null`。 */
  label: string | null;
  /** `versionName`，例如 `8.0.50`；读不出为 `null`。 */
  versionName: string | null;
  /** 应用图标：宿主颁发的图片句柄（与截图、剪贴板里的图同一种），只在本次会话内有效；读不出为 `null`。 */
  icon: FileHandle | null;
  /** 这一个包为什么读不出来（例如「安装包拉不下来」）；读出来了为 `null`。 */
  problem: string | null;
}

/** 内置的哪一个工具：`apkScan` = 工具箱「APK 扫描」；`dataExport` = 工具箱「数据导出」。 */
export type AndroidTool = "apkScan" | "dataExport";

/**
 * 一次 `appDetails` 至多问几个包。
 *
 * 每个包都要拉一次安装包、跑一次 aapt2，8 个是「一屏露出来的那几行」的量级：再多，一次调用就要十几秒，
 * 这期间页面上什么都不变，用户会以为它卡住了。宿主对超出的调用以 `invalid.argument` 拒绝。
 */
export const maximumAndroidAppDetailsPerCall = 8;

/**
 * Android 操作域。宿主经**它自己的** adb 执行写死的那几条命令（列设备、列应用、读安装包），扩展只给设备序列号与包名——
 * 因此不需要 `process.run`，也没有声明对象。找不到 adb、没有 aapt2、设备中途拔掉、adb 超时，一律以 `host.failure` 拒绝，
 * `message` 是一句可以原样显示的人话（「未找到 adb」「没有 aapt2，读不出应用名和图标」）。
 */
export interface AndroidAPI {
  /** `android.apps.read`。此刻 adb 看得见的设备（含没授权调试、离线的）。每分钟与另两个读方法共 ≤ 120 次。 */
  devices(): Promise<AndroidDevice[]>;
  /**
   * `android.apps.read`。一台设备上装了哪些应用与它们的大小。`scope` 省略为 `user`。
   * 设备不在、不是 `ready` → `host.failure`；`serial` 为空、`scope` 不认识 → `invalid.argument`。
   */
  apps(options: { serial: string; scope?: AndroidAppScope }): Promise<AndroidAppList>;
  /**
   * `android.apps.read`。读几个包的应用名、版本与图标：每个包交回一项，按 `package` 对上（不要靠顺序）。
   * `packages` 必须是 1…{@link maximumAndroidAppDetailsPerCall} 个，否则 `invalid.argument`。
   * **慢**（每个包几百毫秒到几秒）：按屏分批、一次只让一批在途，不要一进页面就把整张表都要一遍。
   */
  appDetails(options: { serial: string; packages: string[] }): Promise<AndroidAppDetail[]>;
  /**
   * `android.tools.open`。在面板里打开内置的「APK 扫描」或「数据导出」，包名预填好；开始仍由用户在那里按。
   * 打开之后这一页随之离开（前台会话 deactivate）。只该在用户按下的回调里调。每分钟 ≤ 30 次。
   */
  openTool(options: { tool: AndroidTool; package: string }): Promise<void>;
}

/** 应用在哪一处应用目录：`applications` = `/Applications`（含子目录）；`system` = `/System/Applications`；`user` = `~/Applications`；`other` = 别处。 */
export type MacAppLocation = "applications" | "system" | "user" | "other";

/**
 * 这台 Mac 上装着的一个应用（`apps.read`，SDK 2.5）。宿主扫三处应用目录得到，结果在宿主里缓存 5 分钟。
 *
 * `id` 就是路径：同一个 Bundle ID 装了两份是两个应用。时刻是 Unix 毫秒，Spotlight 没记为 `null`。
 */
export interface MacApp {
  /** 应用 id（标准化之后的路径）；交回 `launcher.apps · catalog` 的组里用的就是它。 */
  id: string;
  /** 访达里显示的名字（本地化、不带 `.app`）。 */
  name: string;
  bundleId: string | null;
  path: string;
  /** App Store 分类（`public.app-category.developer-tools`；游戏子类归到 `public.app-category.games`）；没有 / 认不出为 `null`。 */
  category: string | null;
  /** 分类的中文名（没有为「其他」）。 */
  categoryTitle: string;
  version: string | null;
  location: MacAppLocation;
  /** 位置的中文名（「应用程序」「系统」「我的应用」「其他位置」）。 */
  locationTitle: string;
  /** 最近一次打开。 */
  lastUsedAt: number | null;
  /** 放进应用目录的时刻。 */
  addedAt: number | null;
  /** 系统自带（`/System` 下）。 */
  system: boolean;
  /** 所在目录可写、不是系统应用：全局搜索的编辑态里出不出 ✕（真删之前宿主还会查它是不是正开着）。 */
  deletable: boolean;
}

/** 本机应用（SDK 2.5）。读不出时以 `host.failure` 拒绝。 */
export interface AppsAPI {
  /** `apps.read`。这台 Mac 装了哪些应用，按名字排。每分钟 ≤ 60 次（宿主缓存 5 分钟，不必自己再缓存）。 */
  list(): Promise<MacApp[]>;
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
  readonly git: GitAPI;
  readonly android: AndroidAPI;
  readonly apps: AppsAPI;
  readonly system: SystemAPI;
}
