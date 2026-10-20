# 代码高亮（`code-highlight`）

给 Jarvis 的 Git 加上语法高亮：文件 diff 页（File View / Diff View）与 Blame 里的源码，按语言切成关键字、类型、字符串、注释、函数这些记号，Jarvis 按记号上色。

## Overview

- **入驻哪里**：只入驻服务域，实现 Jarvis 的 `code.highlight` 扩展点。没有工具箱页、没有窗口、没有设置；
  设置 · Git ·「代码高亮」那一块写着由它提供、认得哪几种语言。
- **不要任何授权**：纯计算。不运行外部命令、不联网、不读文件，只切 Jarvis 交过来的那段文本。
- **不定颜色**：它只说「这一段是什么」，颜色由 Jarvis 按记号种类定（与速记代码块同一张色板）。

## Concepts

| 语言（Jarvis 按文件名认） | 认得的东西 |
| --- | --- |
| C / C++ / Objective-C | 关键字、内置类型、`#include` 指令与路径、全大写常量、字符串（含 C++ 原始字符串、ObjC 的 `@"…"`）、函数调用 |
| Java / Kotlin / Swift / C# | 注解与属性（`@…`）、声明后的类型名与函数名、大写开头的类型、多行 / 原始 / 逐字 / 内插字符串、Swift 的 `#if` 一类指令、嵌套块注释 |
| JavaScript / TypeScript | 模板字符串、TS 的类型与声明、装饰器（正则字面量不认：与除号分不开） |
| Go / Rust | 反引号原始字符串、Rust 的宏 `name!`、生命周期 `'a`、属性 `#[…]` |
| Python | 三引号、带前缀的字符串（`rb"…"`）、装饰器、`def` / `class` 之后的名字 |
| Shell | 变量（`$x`、`${x}`、`$#`）、内置命令、函数 |
| SQL | 关键字（不分大小写）、类型、带引号的标识符 |
| JSON / YAML | 键、字符串、数字、常量；YAML 的列表记号、锚点、标签、注释 |
| CSS / SCSS / Less | 选择器（类、id、伪类、标签）、属性、数值与单位、颜色、`!important`、变量、函数 |
| HTML / XML | 标签、属性、属性值、注释、`<!DOCTYPE>` / `<?xml?>`、实体 |
| Markdown | 标题、列表与待办记号、引用、行内代码、链接、强调、围栏代码块 |

认错一个词的代价是它换了个颜色，不影响内容：规则宁可漏，也不把一大段染错。

## Usage

扩展商店 → 安装「代码高亮」→ 打开 Git 页的任何一个源文件。

## Gotchas

- 一份文本超过 1 MiB 不着色（Jarvis 不交过来）。
- 正则字面量、heredoc、HTML 里内嵌的 `<script>` / `<style>` 不着色。

## Related Links

- Jarvis 侧：`jarvis-mac` `specs/20261020-181305-branch-folders-blame-fullscreen-code-format-log-duration` E
- 扩展点：[docs/10-settings.md](../../docs/10-settings.md)「设置 › Git · 代码高亮」
