# 字数统计（脚手架 · SDK 2）

粘一段文字，实时数出字符、单词与行数；一键复制摘要。

- **入驻**：工具箱（面板里一页）· 指令（`/count <文字>`，也认 `/字数`；全局搜索与速记都能打，落点是面板里这一页）。
- **授权**：不需要任何授权。
- **设置**：无（manifest 没有 `contributes.settings`）。
- **Inbox**：无（`"inbox": false`）。
- **存储**：把上次输入的文本记在 `storage`，换一个扩展再回来时恢复。

把这个目录拷到 `extensions/<你的-id>/`，改 `extension.json`、`package.json` 与 `src/index.ts`，
然后按 [开发手册](../../docs/12-developer-guide.md) 走。`/count` 这个指令词在仓库里要唯一——拷过去之后换成你自己的。
