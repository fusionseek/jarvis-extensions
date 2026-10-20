# 代码格式化（`code-format`）

给 Jarvis 的 Git 加上「格式化」：文件 diff 页里**工作区那一份**源码（未暂存 / 已暂存改动的工作区一侧、全局搜索打开的仓库文件），
按语言交给你装好的格式化工具，结果先在 Jarvis 里给你看对比，点「写入文件」才改；写入之后可以撤销。

## Overview

- **入驻哪里**：只入驻服务域，实现 Jarvis 的 `code.format` 扩展点。没有工具箱页、没有窗口；它体现在 Git 文件 diff 页第一行那颗「格式化」（⌥⇧F）
  与 设置 · Git ·「代码格式化」那一块（语言胶囊 + 工具路径）。
- **扩展里没有任何一种语言的格式化规则**：它只决定「哪种语言用哪个工具、什么参数」，格式化是工具做的。工具改了参数，发一个扩展新版本，不用发 Jarvis 新版本。

## Concepts

| 语言（Jarvis 按文件名认） | 工具（按顺序取第一个找得到的） |
| --- | --- |
| C / C++ / Objective-C | `clang-format`（`--style=file`：认 `.clang-format`） |
| Java | `google-java-format`（风格 Google / AOSP，见设置）→ `clang-format` |
| Kotlin | `ktfmt`（kotlinlang 风格） |
| Swift | `swift-format`（Homebrew）→ `xcrun swift-format`（Xcode 自带） |
| C# | `csharpier` → `clang-format` |
| Python | `ruff` → `black` |
| Shell | `shfmt` |
| Markdown / JavaScript / TypeScript / JSON / YAML / CSS / HTML（含 Vue） | `prettier` |
| Go | `gofmt` |
| Rust | `rustfmt`（edition 2021） |
| XML | `/usr/bin/xmllint --format`（macOS 自带；会补上 `<?xml …?>` 声明） |

- **授权**：只要 `process.run`。会运行的命令与参数逐字写在 `extension.json` 的 `process.executables` 里，授权屏与商店详情逐条念出来；
  全部声明了 `stdin: true`——源码经标准输入交给工具，扩展不写任何文件。
- **配置**：工具在文件所在的目录里跑（Jarvis 给的目录句柄），认得那里的 `.clang-format`、`.editorconfig`、`pyproject.toml`、`.prettierrc`。
  文件名是固定的占位名 `jarvis-format.<扩展名>`，只用来让工具认语言、套 `.editorconfig` 里按扩展名的规则；工具从不读写这个文件。
- **工具在哪**：Jarvis 在 Homebrew、`~/.local/bin`、`~/bin`、Nix、`~/.cargo/bin`、`~/.dotnet/tools`、`/usr/local/go/bin` 里找；
  别处的（例如 nvm 装的 prettier）在 设置 · Git · 代码格式化 里填完整路径。

## Usage

1. 装几个常用工具，例如 `brew install clang-format swift-format ktfmt google-java-format ruff shfmt prettier`。
2. 扩展商店 → 安装「代码格式化」→ 设置 · Git ·「代码格式化」看哪些语言亮了（第一次要点「授权」，或第一次点「格式化」时再决定）。
3. Git 页打开一个工作区里的文件 → 第一行「格式化」→ 看对比 →「写入文件」（⏎）或「取消」（esc）。

## Gotchas

- **只格式化整份文件**；选中一段只格式化那一段不支持。
- 文件在格式化之后又被编辑器改过，Jarvis 不写入（重新格式化一次）。
- `ktlint` 不在列表里：它的 `--stdin` 会把检查结果也写进标准输出，混进格式化结果里。
- `csharpier` 的读 stdin 写法随版本变：老版本不认时会报「没有交回内容」，升级它或改用 `clang-format`。
- 工具在 Jarvis 里运行，继承 Jarvis 的完全磁盘访问权限。

## Related Links

- Jarvis 侧：`jarvis-mac` `specs/20261020-181305-branch-folders-blame-fullscreen-code-format-log-duration` C
- 扩展点：[docs/10-settings.md](../../docs/10-settings.md)「设置 › Git · 代码格式化」；`process.run` 的三个选项：[docs/06-capabilities.md](../../docs/06-capabilities.md)
