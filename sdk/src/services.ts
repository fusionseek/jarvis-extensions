/**
 * 服务域：宿主开放的扩展点。
 *
 * 扩展点是**宿主定义的契约**，不是扩展发明的：点名、方法、参数与返回值的形状、它的设置画在哪，
 * 全部在这里与宿主的 `contracts/schemas/extensions/bridge.v2.schema.json` 里写死。扩展只能插到这些点上。
 *
 * 服务跑在宿主为每个扩展单独起的**后台会话**里：没有界面、不弹授权、空闲一分钟收掉。
 * 宿主经 `service` 事件调用，扩展经 `service.resolve` / `service.progress` 回话——这些都由 SDK 代劳，
 * 扩展只需要在 `defineExtension({ services: { <id>: 实现 } })` 里交出一个对象。
 *
 * 现有两个扩展点：`junkClean.engine`（清理引擎）与 `project.engine`（项目引擎）。
 */

/** 宿主每次调服务时带来的东西。 */
export interface ServiceContext {
  /** 此刻的偏好：manifest 默认叠上用户在设置里改过的（含这个服务自己的 `preferences`）。 */
  preferences: Record<string, unknown>;
  /** 此刻已授予的能力。 */
  granted: string[];
}

/** 一次可取消的调用的取消信号。 */
export interface CancelSignal {
  /** 宿主是否已经要求取消。 */
  readonly cancelled: boolean;
  /** 取消时回调（已经取消时立即回调）。 */
  onCancel(listener: () => void): void;
}

// ---------------------------------------------------------------------------
// junkClean.engine：清理引擎
// ---------------------------------------------------------------------------

/** 引擎此刻能不能用。设置「清理」与清理工具的引擎卡画的就是它。 */
export interface JunkCleanStatus {
  /** 能跑。为 false 时宿主这一次用 Jarvis 清理，并在报告里写明 `problem`。 */
  ready: boolean;
  /** 一句话：能用时写「在哪、什么版本」，不能用时写原因。 */
  summary: string;
  /** 不能用的原因（≤ 200 字）。 */
  problem?: string;
  /** 用户此刻可以做的事（≤ 3 个），宿主画成按钮；按下调 `action(id)`。 */
  actions: { id: string; title: string; prominent?: boolean }[];
}

/** 清理进行中的读数。宿主把 `currentItem` 的主目录写成 `~`。 */
export interface JunkCleanProgress {
  sectionTitle?: string;
  freedBytes: number;
  itemCount: number;
  completedSections: number;
  totalSections?: number;
  /** 0…1；不知道时省略。界面不画百分比，留给估算。 */
  fraction?: number;
  /** 正在删的那一项（绝对路径）。 */
  currentItem?: string;
}

/** 某一类没有清的原因。 */
export interface JunkCleanSkip {
  reason: "requiresAdmin" | "appRunning" | "whitelisted" | "notPresent" | "other";
  /** `appRunning` 时是应用名；`other` 时是原文。 */
  detail?: string;
}

/** 一类清理目标的结果。 */
export interface JunkCleanSection {
  id: string;
  title: string;
  freedBytes: number;
  itemCount: number;
  skipped?: JunkCleanSkip;
  /** 删除失败的条目（路径 · 原因），≤ 8 条。 */
  failures?: string[];
  notes?: string[];
}

/** 一次清理的报告。开始 / 结束时刻由宿主记。 */
export interface JunkCleanReport {
  sections: JunkCleanSection[];
  /** 整次运行层面的说明（≤ 12 条）。 */
  notes: string[];
  /** 整次失败的原因；部分成功不算失败。 */
  failure?: string;
}

/** 一个动作的结果。 */
export interface JunkCleanActionResult {
  message?: string;
  /** 为 true 时宿主每 2 秒重查一次 `status`，最多 10 分钟，`ready` 即停（「在终端中安装」之后用）。 */
  watchStatus?: boolean;
}

/**
 * 清理引擎（`junkClean.engine`）。开着时晃球、`/clean` 与工具箱清理都走它；悬浮球照旧读 Jarvis 的通用清理状态。
 *
 * **永久删除由你负责**：宿主的路径校验、运行中应用保护只覆盖 Jarvis 自己的清理，管不到你调用的外部工具。
 */
export interface JunkCleanEngine {
  /** 此刻能不能用。要快（宿主在打开设置、工具页时都会问）。 */
  status(context: ServiceContext): JunkCleanStatus | Promise<JunkCleanStatus>;
  /** 跑一次清理。不要抛错：失败写进 `failure`，部分成功照常报告。 */
  run(context: ServiceContext, progress: (progress: JunkCleanProgress) => void, signal: CancelSignal): Promise<JunkCleanReport>;
  /** 用户按了 `status.actions` 里的某一颗。 */
  action?(id: string, context: ServiceContext): JunkCleanActionResult | Promise<JunkCleanActionResult>;
}

// ---------------------------------------------------------------------------
// project.engine：项目引擎
// ---------------------------------------------------------------------------
//
// 形状真源是 jarvis-mac `contracts/schemas/extensions/bridge.v2.schema.json` 的 `$defs.projectEngine*` /
// `projectItem*` / `projectField*` / `projectSummary`，这里是它的投影。宿主只认「原始字段值」：
// 翻译成通用字段、工作流校验、漂移守卫全在宿主——所有引擎同一套规则，引擎只管读写托管服务。
//
// 宿主那边**宽进严出**：字符串过长、条目过多一律截到上限之内；一个条目读不出必填项就丢掉这一个（不丢整页）。
// 引擎仍应自己守住上限——被截掉的东西用户看不见原因。

/** 契约版本：宿主认得的最高版本。引擎在 `describe` 里报自己实现的版本，宿主按它降级。 */
export const projectEngineContractVersion = 1 as const;

/**
 * 引擎声明的可选能力。宿主按它降级：没声明的那一项，对应入口置灰并说明。
 *
 * - `nativeHierarchy`：原生父子（子 Issue）；
 * - `nativeDependencies`：原生依赖（blocked by）；
 * - `issueTypes`：组织级 Issue Type；
 * - `createFields`：能在 Project 里建字段与选项（`createField` / `createOption`）；
 * - `draftIssues`：草稿条目；
 * - `createIterations`：能在迭代字段末尾加一个迭代（`createIteration`）。没声明时宿主迭代页的「新增迭代」置灰、提示更新扩展；
 * - `createItems`（SDK 2.3）：能在仓库里建一条 Issue 并加进 Project（`createItem`）。没声明时宿主的「新建」置灰、提示更新扩展。
 */
export type ProjectEngineFeature = "nativeHierarchy" | "nativeDependencies" | "issueTypes" | "createFields" | "draftIssues" | "createIterations" | "createItems";

/** `describe` 的返回：契约版本、此刻能不能用、托管服务、可选能力。要快（宿主给 15 秒）。 */
export interface ProjectEngineDescription {
  /** 引擎实现的契约版本（≥ 1）。 */
  contractVersion: number;
  ready: boolean;
  /** ≤ 200 字。能用时写「接上了谁」，不能用时写原因。 */
  summary: string;
  /** ≤ 200 字。不能用的原因，或「能用但受限」的那一句。 */
  problem?: string;
  /** 托管服务标识（`github`），与 Jarvis Git 服务的服务标识、manifest `contributes.git.hosting` 一致。 */
  hosting: string;
  features: ProjectEngineFeature[];
}

/** 一条 Issue 的身份（跨仓库唯一）：父子、依赖都用它。 */
export interface ProjectItemRef {
  /** `owner/name`。 */
  repository: string;
  /** ≥ 1。 */
  number: number;
}

/**
 * 一个字段在一个条目上的原始值：六种形状**恰好一种**。日期是 UTC 日历日 `YYYY-MM-DD`。
 * `text` ≤ 2000 字；`optionIds` ≤ 50 个。
 */
export type ProjectFieldValue =
  | { text: string }
  | { number: number }
  | { date: string }
  | { optionId: string }
  | { optionIds: string[] }
  | { iterationId: string };

/**
 * `applyEdit` 的一步。**宿主已经按工作流、必填与漂移守卫校验过**，引擎只执行、不再判断该不该改。
 *
 * - `setLabels` 的 `add` / `remove` 是标签名（各 ≤ 20 个）；
 * - `setMilestone` 的 `title` 为 `null` = 清掉里程碑；
 * - `setAssignees` 是**整组替换**后的登录名（≤ 20 个）；
 * - `setParent` 的 `parent` 为 `null` = 脱离当前父 Issue。
 */
export type ProjectEngineChange =
  | { op: "setFieldValue"; fieldId: string; value: ProjectFieldValue }
  | { op: "clearFieldValue"; fieldId: string }
  | { op: "setIssueState"; open: boolean; reason?: "completed" | "notPlanned" }
  | { op: "setIssueType"; name: string }
  | { op: "setLabels"; add: string[]; remove: string[] }
  | { op: "setMilestone"; title: string | null }
  | { op: "setAssignees"; logins: string[] }
  | { op: "setParent"; parent: ProjectItemRef | null }
  | { op: "addBlockedBy"; ref: ProjectItemRef }
  | { op: "removeBlockedBy"; ref: ProjectItemRef };

/** 能在 Project 里建的字段类型（`createField`）。 */
export type ProjectCreatableFieldType = "text" | "number" | "date" | "singleSelect" | "multiSelect" | "iteration";

/**
 * 字段类型。前六种是可建的，其余是托管服务的内置字段；认不出的写 `other`——宿主按 `other` 处理、不丢字段。
 */
export type ProjectFieldDataType =
  | ProjectCreatableFieldType
  | "title"
  | "assignees"
  | "labels"
  | "milestone"
  | "repository"
  | "issueType"
  | "parentIssue"
  | "subIssuesProgress"
  | "linkedPullRequests"
  | "reviewers"
  | "other";

/** 一个 Project（`listProjects` 的一项、`readSchema` 的 `project`）。 */
export interface ProjectSummary {
  /** ≤ 200 字，非空。 */
  id: string;
  number: number;
  /** ≤ 200 字，非空。 */
  title: string;
  /** 所有者登录名，≤ 100 字。 */
  owner: string;
  /** ≤ 500 字。 */
  url: string;
  itemCount?: number;
  /** ISO 8601 时间戳。 */
  updatedAt?: string;
  closed?: boolean;
}

/** 单选 / 多选 / Issue Type 的一个选项。宿主的映射**按 id 认**，不按名字。 */
export interface ProjectFieldOption {
  /** ≤ 200 字，非空。 */
  id: string;
  /** ≤ 100 字，非空。 */
  name: string;
  /** 颜色名或六位十六进制，≤ 20 字。 */
  color?: string;
}

/** 迭代字段的一个迭代。 */
export interface ProjectIteration {
  id: string;
  /** ≤ 100 字，非空。 */
  title: string;
  /** `YYYY-MM-DD`（UTC）。 */
  startDate: string;
  /** 1–365。 */
  durationDays: number;
  /** 已经结束的迭代。 */
  completed?: boolean;
}

/** 一个 Project 字段。 */
export interface ProjectField {
  id: string;
  /** ≤ 100 字，非空。 */
  name: string;
  dataType: ProjectFieldDataType;
  /** ≤ 200 个。 */
  options?: ProjectFieldOption[];
  /** ≤ 200 个。 */
  iterations?: ProjectIteration[];
  /** 迭代字段的默认周期（天，1–365）。 */
  iterationDurationDays?: number;
}

/** 条目装的内容。Issue / PR 必须带 `repository` 与 `number`；草稿没有。 */
export interface ProjectItemContent {
  /** ≤ 500 字。 */
  title: string;
  /** `owner/name`。 */
  repository?: string;
  number?: number;
  url?: string;
  isOpen?: boolean;
  author?: string;
  /** ≤ 20 个登录名。 */
  assignees?: string[];
  /** ≤ 50 个标签名。 */
  labels?: string[];
  milestone?: string;
  /** `YYYY-MM-DD`（UTC）。 */
  milestoneDueOn?: string;
  issueType?: string;
  /** ISO 8601 时间戳。 */
  createdAt?: string;
  closedAt?: string;
}

/** 条目的原生关系（只有 Issue 有）。 */
export interface ProjectItemRelations {
  parent?: ProjectItemRef;
  /** ≤ 50 个。 */
  blockedBy?: ProjectItemRef[];
  subIssueTotal?: number;
  subIssueDone?: number;
}

/** 一个 Project 条目的原始形状。 */
export interface ProjectItem {
  id: string;
  contentType: "issue" | "draftIssue" | "pullRequest";
  /** ISO 8601 时间戳。 */
  updatedAt: string;
  archived?: boolean;
  content: ProjectItemContent;
  /** 键是字段 id（≤ 100 个）。 */
  values?: Record<string, ProjectFieldValue>;
  relations?: ProjectItemRelations;
}

/** `listProjects` 的入参：带 `repository` = 这个仓库关联的；带 `owner` = 这个账号或组织的；都不带 = token 自己的。 */
export interface ProjectListRequest {
  owner?: string;
  /** `owner/name`。 */
  repository?: string;
}

/** `readSchema` 的入参。 */
export interface ProjectSchemaRequest {
  projectId: string;
}

/** `readItems` 的入参。 */
export interface ProjectItemsRequest {
  projectId: string;
  /** 上一页交回的 `nextCursor`，原样带回。 */
  cursor?: string;
  /** ISO 8601 时间戳：只要这之后改过的（增量同步）。引擎可以多给，不能少给。 */
  since?: string;
}

/** `applyEdit` 的入参。 */
export interface ProjectEditRequest {
  projectId: string;
  itemId: string;
  /** 条目装的 Issue / PR 的身份；草稿没有。 */
  contentRef?: ProjectItemRef;
  /** 1–16 步，按顺序执行。 */
  changes: ProjectEngineChange[];
}

/** `createField` 的入参。 */
export interface ProjectCreateFieldRequest {
  projectId: string;
  /** ≤ 100 字。 */
  name: string;
  dataType: ProjectCreatableFieldType;
  /** 单选 / 多选的选项名（≤ 50 个）。 */
  options?: string[];
  /** 迭代字段的周期（天，1–365）。 */
  iterationDurationDays?: number;
}

/** `createOption` 的入参：给单选 / 多选字段加一个选项。 */
export interface ProjectCreateOptionRequest {
  projectId: string;
  fieldId: string;
  /** ≤ 100 字。 */
  name: string;
}

/** `createIteration` 的入参：在迭代字段末尾加一个迭代。已有迭代（含已结束的）必须原样保留——宿主按迭代 id 认。 */
export interface ProjectCreateIterationRequest {
  projectId: string;
  fieldId: string;
  /** 迭代名，≤ 100 字。 */
  name: string;
  /** 开始那一天，UTC 日历日 `YYYY-MM-DD`。 */
  startDate: string;
  /** 周期（天，1–365）。 */
  iterationDurationDays: number;
}

/**
 * `createItem` 的入参（SDK 2.3）：在 `repository` 里建一条 Issue，再把它加进 `projectId` 这个 Project。
 *
 * 标题宿主已经校验过（非空、≤ 256 字）——引擎照写（顶多去掉首尾空白），不改写、不补前缀。
 * 返回时这一条**必须已经在 Project 里**：
 * 宿主拿返回的条目并进镜像，随后经 `applyEdit` 写预填的字段，条目不在 Project 里那几步就无处可写。
 */
export interface ProjectCreateItemRequest {
  projectId: string;
  /** 建 Issue 的仓库，`owner/name`。 */
  repository: string;
  /** Issue 标题，1–256 字（GitHub 的上限）。 */
  title: string;
  /** Issue 正文（Markdown，≤ 65,536 字）；省略 = 空正文。 */
  body?: string;
}

/**
 * 线缆上 `params.request` 的全集（`$defs.projectEngineRequest`）：每个方法只用到其中几项。
 * SDK 不替你检查哪几项该在——宿主按 schema 发，引擎按自己方法的入参读。
 */
export type ProjectEngineRequest = ProjectListRequest &
  Partial<
    ProjectSchemaRequest &
      ProjectItemsRequest &
      ProjectEditRequest &
      ProjectCreateFieldRequest &
      ProjectCreateOptionRequest &
      ProjectCreateIterationRequest &
      ProjectCreateItemRequest
  >;

/** `listProjects` 的返回（≤ 200 个）。 */
export interface ProjectList {
  projects: ProjectSummary[];
}

/** `readSchema` 的返回（字段 ≤ 100 个）。 */
export interface ProjectSchema {
  project: ProjectSummary;
  fields: ProjectField[];
}

/** `readItems` 的返回：一页至多 100 条；`nextCursor` 为空或省略 = 最后一页。 */
export interface ProjectItemsPage {
  items: ProjectItem[];
  /** ≤ 500 字，对宿主不透明。 */
  nextCursor?: string;
  totalCount?: number;
}

/** `applyEdit` 的返回：可选地带回读回的那一条；失败就抛错（宿主收到结构化错误）。 */
export interface ProjectEditResult {
  /** 读回的条目；省略时宿主保留乐观更新的值，下次同步校正。 */
  item?: ProjectItem;
}

/** `createField` / `createOption` / `createIteration` 的返回：建好（或改好）的字段。 */
export interface ProjectFieldResult {
  field: ProjectField;
}

/** `createItem` 的返回（SDK 2.3）：建好、已经加进 Project 的那一条（与 `readItems` 同一个形状），必填。 */
export interface ProjectCreatedItem {
  item: ProjectItem;
}

/**
 * 项目引擎（`project.engine`）：Jarvis「项目」（需求 / 迭代 / 缺陷的表格与甘特）的数据来源。
 * 界面、映射配置、工作流、漂移守卫都在宿主；引擎只读写托管服务，通常经 `jarvis.git.hosting.*`。
 *
 * 跑在后台会话里，宿主给每个方法定了超时：`describe` 15 秒、`readItems` 60 秒、其余 45 秒；
 * 超时或用户离开时宿主发取消（`signal`）。**失败就抛错**：抛 `JarvisError` 原样交回，抛别的变成 `host.failure`，
 * `message` 是宿主显示给用户的那一句——写人话。
 */
export interface ProjectEngine {
  /** 此刻能不能用、支持哪些可选能力。要快：不读条目。不要抛错——用不了写进 `ready: false` 与 `problem`。 */
  describe(context: ServiceContext): ProjectEngineDescription | Promise<ProjectEngineDescription>;
  /** 列出可选的 Project（≤ 200 个）。 */
  listProjects(request: ProjectListRequest, context: ServiceContext, signal: CancelSignal): Promise<ProjectList>;
  /** 一个 Project 的字段结构（≤ 100 个字段）。 */
  readSchema(request: ProjectSchemaRequest, context: ServiceContext, signal: CancelSignal): Promise<ProjectSchema>;
  /** 一页条目（≤ 100 条）。 */
  readItems(request: ProjectItemsRequest, context: ServiceContext, signal: CancelSignal): Promise<ProjectItemsPage>;
  /** 按顺序执行宿主校验过的编辑步骤；做完最好读回那一条交回去。 */
  applyEdit(request: ProjectEditRequest, context: ServiceContext, signal: CancelSignal): Promise<ProjectEditResult>;
  /** 建一个字段（声明了 `createFields` 才会被调）。没实现时宿主收到 `capability.unknown`。 */
  createField?(request: ProjectCreateFieldRequest, context: ServiceContext, signal: CancelSignal): Promise<ProjectFieldResult>;
  /** 给单选 / 多选字段加一个选项，**已有选项的 id 必须保持不变**（宿主的映射按 id 认）。 */
  createOption?(request: ProjectCreateOptionRequest, context: ServiceContext, signal: CancelSignal): Promise<ProjectFieldResult>;
  /** 在迭代字段末尾加一个迭代（声明了 `createIterations` 才会被调），**已有迭代的 id 必须保持不变**。 */
  createIteration?(request: ProjectCreateIterationRequest, context: ServiceContext, signal: CancelSignal): Promise<ProjectFieldResult>;
  /**
   * 在仓库里建一条 Issue 并加进 Project（SDK 2.3；声明了 `createItems` 才会被调）。交回的条目必须已经在 Project 里；
   * 字段值不在这里写——宿主随后经 `applyEdit` 写预填的字段。
   */
  createItem?(request: ProjectCreateItemRequest, context: ServiceContext, signal: CancelSignal): Promise<ProjectCreatedItem>;
}

/** 项目引擎的方法名（线缆上 `service` 事件的 `method`）。 */
export type ProjectEngineMethod = "describe" | "listProjects" | "readSchema" | "readItems" | "applyEdit" | "createField" | "createOption" | "createIteration" | "createItem";

/** 清理引擎的方法名（线缆上 `service` 事件的 `method`）。 */
export type JunkCleanMethod = "status" | "run" | "action";

/** 某个扩展点的实现。按 manifest `contributes.services[].point` 对上。 */
export interface ServiceImplementations {
  "junkClean.engine": JunkCleanEngine;
  "project.engine": ProjectEngine;
}

/** 任一扩展点的实现。 */
export type ServiceImplementation = ServiceImplementations[keyof ServiceImplementations];
