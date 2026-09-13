# jarvis-extensions Agent Guide

本仓库是 Jarvis 的**扩展库**：每个扩展一个目录，加上它们共同依赖的契约（schema）、SDK 与文档。
它**不放宿主代码**——Jarvis 那一侧的运行时、渲染器、闸门在 `jarvis-mac`，按各自的 Speckit 流程改。

## 硬规则

> **HARD RULE — schema 先于实现。**
> `schemas/extension.v1.schema.json` 与 `schemas/registry.v1.schema.json` 是 manifest 与索引的唯一真源；
> `sdk/src/manifest.ts` 是它们的投影。改字段先改 schema，再改 SDK 类型，再改 `docs/03-manifest.md`，
> 三处同批。不因"只加一个可选字段"而豁免。

> **HARD RULE — 四个部分显式回答。**
> `toolbox`、`main` + `capabilities`、`settings`、`inbox` 全部必填；`settings: false` 与
> `inbox: false` 必须写出来。「没想过」与「想过了，不要」在审核里是两件事。

> **HARD RULE — 产物提交、按哈希校验。**
> `dist/extension.js` 由 `scripts/build-extension.mjs` 生成并提交；`registry.json` 由
> `scripts/build-registry.mjs` 生成并提交。CI 重建一遍比对哈希，对不上即拒绝。
> 两份生成物**不得手改**。

> **HARD RULE — 没有第二种运行时。**
> 扩展只有 JavaScriptCore + 声明式节点树这一条路。不接受 Swift 扩展、WebView 扩展、
> 自绘像素、自定义颜色值。想要新控件，给 `docs/07-ui-components.md` 与宿主提 PR。

> **HARD RULE — 一个扩展一个 PR，每次改动升版本。**
> `version` 相对主干不递增，CI 拒绝。改 `id` 等于新扩展。

## 目录约定

```text
extensions/<id>/
├── extension.json      manifest；id 等于目录名
├── package.json        name = jarvis-ext-<id>
├── tsconfig.json
├── src/index.ts        入口，defineExtension() 只调一次
├── dist/extension.js   产物（提交）
└── README.md           给用户看的：做什么、要哪些授权及为什么、怎么用、已知边界
```

保留 id 见 `docs/03-manifest.md`。`templates/` 下的东西不是扩展，校验脚本不扫它。

## 文档与代码约定

- 需求、方案、风险与说明用中文；代码、API、协议字段、命令保持英文。
- 文档形状：Overview → Concepts → Usage → Gotchas → Related Links；每个数、每条规则写**为什么**。
- SDK 里所有导出的类型与函数带中文优先的 doc comment。
- 提交信息用 Conventional Commits：`feat(<id>): …` / `docs: …` / `sdk: …` / `schema: …`；
  正文英文 bullets 在前、等量中文 bullets 在后（与 `jarvis-mac` 一致）。

## 与 jarvis-mac 的关系

- 宿主的每一期改动是 `jarvis-mac` 的一个 Speckit feature（`docs/14-host-integration-plan.md` 是提纲），
  受那边全部门禁约束（Speckit HARD STOP、CodeGraph-first、本地持久化单库、面板尺寸、对外产品页同步、版本号）。
- 本仓库**不得**改 `jarvis-mac` 的任何文件；反过来 `jarvis-mac` 不得内联本仓库的扩展。
- SDK 主版本与宿主运行时主版本必须一致；升主版本是两边同一轮的事。
- 能力目录（`CapabilityID` 枚举）加一项 = 三处同批：schema 枚举、`sdk/src/manifest.ts`、
  `docs/06-capabilities.md`，外加宿主那一侧的闸门映射。

## 验证

```bash
npm install
npm run verify       # check:sdk + check:extensions + build + validate + registry:check
npm run check:pr     # 与 origin/main 比：版本递增、锁文件跟上、registry diff 只涉及本 PR 的扩展
```

CI（`.github/workflows/verify.yml`）在每个 PR 与每次推 main 时跑 `npm run verify`；PR 上还多跑一次
`check:pr`，它排在 `npm ci` **之前**——那三条都只用 node 与 git，而其中一条拦的正是"锁文件没跟上、
依赖根本装不起来"。

> **升完版本记得 `npm install`。** 扩展是 npm workspace，版本号记在 `package-lock.json` 里；
> 不同步的话 CI 的 `npm ci` 会以一句 `Missing: jarvis-ext-… from lock file` 失败。
> 锁文件必须提交：`npm run verify` 会重建每个产物并与 `registry.json` 里的 sha256 比对，
> 而 esbuild 换一个补丁版本就可能吐出不同的字节——浮动依赖会让 CI 在与本次改动无关的地方红。

## 审核

`docs/13-review-checklist.md` 是 PR 模板的真源。一条不过就不合并——扩展一旦出现在扩展库里
就在别人的机器上跑。审核者要在 Jarvis 开发者模式里装上走一遍四个部分，并读一遍 `src/`。

## 待建

- **PR 模板**：从 `docs/13-review-checklist.md` 生成。
- **npm 发布 SDK**：目前扩展经 alias 从 `sdk/src` 直接构建；发布到 npm 是给仓库外的开发者用的，
  与宿主运行时 1.0 一起发。
- **仓库必须 public**：宿主匿名拉 zipball；私有仓库扩展库页面拉不到任何东西。
- **根仓库 `fusionseek/jarvis` 尚未把本仓库登记为 submodule**：登记与否由根仓库决定，
  本仓库不依赖它。
