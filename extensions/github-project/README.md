# GitHub 项目

给 Jarvis 的「项目」接上 **GitHub Projects v2**：读一个 Project 的字段、条目、迭代，以及条目里 Issue 的父子与依赖关系；
你在需求、迭代、缺陷页上做的修改，经它写回 GitHub。

它**没有自己的界面**，不出现在工具箱目录里——它是一个服务扩展，实现 Jarvis 开放的 `project.engine` 扩展点。
表格、甘特、映射配置、工作流约束、漂移守卫全是 Jarvis 自己的那一套；扩展只负责「把 GitHub 的数据原样读回来、
把 Jarvis 校验过的修改发出去」。换一家托管服务（GitLab、Jira）是换一个引擎扩展，规则不变。

## 入驻哪里

| 域 | 声明 | 你看到什么 |
| --- | --- | --- |
| 服务 | `contributes.services`：`project.engine` · `github`（「GitHub Project」） | 工作区出现「项目」；Git 左栏出现 Projects 分组；Issue 预览页出现 Project 行 |
| Git | `contributes.git`：`hosting: ["github"]` | 设置 · Git · GitHub 下出现「Project 关联」（仓库 ↔ Project 绑定、分支命名、提交追加 `Refs #id` 等，控件由 Jarvis 画） |

只入驻 GitHub 这一个托管服务：Git 操作域的能力只对它放行。

## 要哪些授权，为什么

两项。第一次打开「项目」或「Project 关联」之前 Jarvis 弹一次授权屏；之后可以在 `设置 · 扩展` 里它那块面板上逐项撤销。

| 能力 | 档位 | 拿来做什么 | 宿主替你拦住的 |
| --- | --- | --- | --- |
| `git.hosting.read` | 中 | 读 Project 列表、字段结构、条目（含 Issue 的标签、指派人、里程碑、类型、父子、依赖）；改之前先把名字换成 id；改完读回那一条 | 只放行**查询**；token 不交给扩展 |
| `git.hosting.write` | 高 | 把你在「项目」里的修改写回 Project 与 Issue | 只放行下面 16 个变更（按顶层字段名逐个比对），别的一律拒绝 |

**token 从不经过扩展。** 它用的是你在 `设置 · Git · Git 服务 · GitHub` 里填的那一把，留在 Jarvis 的钥匙串里；
扩展交一份 GraphQL，Jarvis 替它执行、把 JSON 交回来。扩展**不联网**（没有 `network.https`）、**不跑命令**、**不读文件**。

只授予 `git.hosting.read`、不授予 `git.hosting.write`：照样能看，「项目」里的编辑入口置灰（只读浏览）。

### token 的权限

| token 的 scope | 结果 |
| --- | --- |
| 有 `project` | 能读能写 |
| 只有 `read:project` | 只能读；引擎卡写「只能读」 |
| 两个都没有 | 用不了；引擎卡写「token 缺少 project 权限（只读需 read:project）」 |
| fine-grained token | 看不出来，读写时才知道；组织的 Project 要给它「Projects」权限 |

读写 Issue 的标签、指派人、状态还要 `repo`（私有仓库）——Jarvis 的 Git 服务本来就要这一项。

## 会读什么、会改什么

### 读（`git.hosting.read`）

| 查询 | 什么时候 |
| --- | --- |
| `ListViewerProjects` / `ListOwnerProjects` / `ListRepositoryProjects` | 列 Project：你自己的、某个账号或组织的、与某个仓库关联的（各取最近更新的 50 个） |
| `ReadSchema` | 打开一个 Project、每次同步、每次写入之前（Jarvis 的漂移守卫要比对字段） |
| `OrganizationIssueTypes` | Project 属于组织、且有 Issue Type 字段时，读组织启用着的 Issue Type 当作它的选项 |
| `ReadItems` / `ReadItemsSince` | 同步条目，一页 100 条；增量同步带过滤串 `updated:>=YYYY-MM-DD` |
| `ResolveEdit` | 每次编辑之前一次：要改的 Issue / PR 的 id 与当前状态、父 Issue、指派人，以及这次要用到的标签、里程碑、Issue Type、用户、其它 Issue 的 id |
| `ReadItem` / `ReadField` | 改完读回那一条；加选项之前读字段的当前选项 |

### 改（`git.hosting.write`，manifest `git.mutations` 逐字）

| 变更 | 对应的编辑 | 传了什么 |
| --- | --- | --- |
| `updateProjectV2ItemFieldValue` | 改 Project 字段的值（文本、数字、日期、单选、多选、迭代） | 条目、字段、值 |
| `clearProjectV2ItemFieldValue` | 清空字段值（含「多选一个都不选」） | 条目、字段 |
| `closeIssue` | 关闭 Issue（「完成」或「不做了」） | Issue、原因 `COMPLETED` / `NOT_PLANNED` |
| `reopenIssue` | 重新打开 Issue | Issue |
| `updateIssueIssueType` | 改 Issue Type | Issue、类型 |
| `addLabelsToLabelable` / `removeLabelsFromLabelable` | 加 / 去掉标签 | Issue 或 PR、标签 |
| `updateIssue` | 改里程碑（含清掉） | **只传** Issue 与 `milestoneId`——这个变更还能改标题、正文、状态，这里一项都不碰 |
| `addAssigneesToAssignable` / `removeAssigneesFromAssignable` | 改指派人（整组替换：只加差的、只去多的） | Issue 或 PR、用户 |
| `addSubIssue` / `removeSubIssue` | 设父 Issue（替换原来的父）/ 脱离父 Issue | 父 Issue、子 Issue |
| `addBlockedBy` / `removeBlockedBy` | 加 / 去掉「被谁阻塞」 | 这条 Issue、阻塞它的 Issue |
| `createProjectV2Field` | 映射页上「在 Project 里建这个字段」 | Project、名字、类型、选项（灰色）或迭代配置 |
| `updateProjectV2Field` | 字段设置上「把新取值写回 Project」：给单选 / 多选加一个选项；迭代页「新增迭代」：给迭代字段加一个迭代 | 字段、**全部已有选项原样**（id、名字、颜色、说明）+ 新选项；或**全部已有迭代原样**（含已结束的：id、名字、开始日、天数）+ 新迭代 |

**不删任何东西**：没有删字段、删条目、删选项、删 Issue 的变更。Jarvis 也从不自己发起这些写入——
每一次都是你在界面上的一个动作，或你在「Project 关联」里写下的 Git 事件规则，并且先过 Jarvis 的工作流与漂移守卫。

## 怎么用

1. 在扩展商店装上「GitHub 项目」。
2. 确认 `设置 · Git · Git 服务` 里已经添加了 GitHub、填了带 `project`（或至少 `read:project`）的 token。
3. 打开工作区「项目」，批准授权屏上的两项，选一个 Project，按引导做一次字段映射。
4. 之后在需求 / 迭代 / 缺陷页上改状态、拖甘特、调父子与依赖，都会经它写回 GitHub。

## 它怎么做

- **只交原始值。** 字段值按契约的六种形状原样交回（文本、数字、日期、单选 id、多选 id 列表、迭代 id），
  选项与迭代按 id 认；翻译成「状态」「优先级」这类通用字段是 Jarvis 的事。
- **一次编辑 = 一次解析 + 逐步变更 + 一次读回。** 名字（标签、里程碑、Issue Type、登录名、`owner/name#123`）先在一次查询里换成 id；
  然后一步一份变更按顺序发；某一步被拒就停，报「第几步、被谁拒了、前几步已经写入」；最后读回那一条交给 Jarvis。
  已经是那个状态的步骤（关一个已关的 Issue、设成它现在的父 Issue）不发。
- **增量同步往前多读一天。** 过滤串按天、GitHub 没说按哪个时区，多读的那一天 Jarvis 按 `updatedAt` 去重。
  GitHub 若不认这个过滤串，这一次回落到全量从头读，之后的游标带 `all:` 前缀，翻页时不会拿全量的游标去配增量的查询。
- **加选项保住已有 id。** GitHub 的 `updateProjectV2Field` 是整组替换选项，但输入里带 `id`：已有选项连 id 原样写回，
  映射不会失效。同名选项已经在就什么都不改。

## 已知边界

- **Issue Type 只在组织仓库里有。** 用户名下的 Project 的 Issue Type 字段没有选项（不能映射）；在用户仓库里改类型会被拒，报「用不了 Issue Type」。
  读组织 Issue Type 要你是组织成员——不是时字段照常读，只是这一项没有选项。
- **PR 只能改标签与指派人。** 状态、类型、里程碑、父子、依赖只对 Issue 有效：PR 的里程碑要走 `updatePullRequest`，没有声明，也就不做。
- **草稿没有 Issue 身份。** 草稿只能改 Project 字段的值；父子、依赖、标签这些步骤报「草稿还不是 Issue」。
- **新建的迭代字段从今天（UTC）起排三个迭代**（`Iteration 1…3`，周期默认 14 天），与 GitHub 网页上新建迭代字段一致；
  之后要加，在 Jarvis 迭代页左栏点「新增迭代」（1.1.0 起；需要 Jarvis 带「新增迭代」的版本）：名字接着编号、从最后一个迭代结束的第二天开始。
- **加迭代会把已结束的迭代一起写回。** GitHub 的迭代配置是整组替换：只写进行中 / 未开始的，已结束的迭代连同条目上的迭代值都会被删掉。
- **新选项一律灰色、没有说明。** 颜色与说明在 GitHub 上改，不影响映射（映射认 id）。
- **一次至多：** 列 Project 50 个（最近更新的在前）、字段 100 个、一页条目 100 条、每条字段值 50 个、指派人 20、标签 50、blocked by 20。
  被截掉的部分在表格里看不到；一个 Project 的字段本来就至多 50 个。
- **关一个已关的 Issue 不改它的关闭原因。** 「完成」改成「不做了」要去 GitHub 上先打开再关；Jarvis 只在状态真的变化时才发这一步。
- **与直觉不同的 GraphQL 细节**（2026-10-15 对 GitHub 公开 schema 的只读内省）：Issue 与 PR 的 `state` 是两种枚举，同一个查询里取两边会冲突，
  因此两边都只取 `closed`；多选字段的选项叫 `multiSelectOptions`、多选取值是 `options { id }`；`ProjectV2Owner` 上没有 `login`；
  列账号的 Project 用 `repositoryOwner`，一次认出组织还是用户；`Repository.issueTypes` 让改类型不必先知道组织。
- 由于本机 token 没有 `project` scope，开发时只能用只读内省与 `INSUFFICIENT_SCOPES` 校验每一份查询的写法；全部数据路径由 `test/` 里的假 GitHub 覆盖。

## 相关链接

- 扩展点契约：[`sdk/src/services.ts`](../../sdk/src/services.ts)（`project.engine`）、[`docs/10-settings.md`](../../docs/10-settings.md)
- Git 操作域：[`sdk/src/capabilities.ts`](../../sdk/src/capabilities.ts)（`jarvis.git`）、[`docs/06-capabilities.md`](../../docs/06-capabilities.md)
- 宿主一侧：`jarvis-mac/specs/20261015-123126-github-project-management/`（spec K / H 节）、`contracts/schemas/extensions/bridge.v2.schema.json`
- GitHub：[Projects v2 GraphQL](https://docs.github.com/en/issues/planning-and-tracking-with-projects/automating-your-project/using-the-api-to-manage-projects)
