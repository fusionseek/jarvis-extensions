# 图片转换（示例）· `files.actions` 脚手架

Jarvis「文件」的文件动作扩展点（`files.actions`，SDK 2.13）的最小示例：在文件管理器里长按图片，转盘上多出「转为 PNG / JPEG / HEIC」的紫色扇面。

- `describe`：报动作（名字、SF Symbol、认哪些扩展名 / 类别、几项）。不需要授权，要快。
- `run`：拿到每个文件的**句柄**和一个空暂存目录的句柄；经 `jarvis.process.run` 跑命令，
  `{ file: 句柄 }` 填 manifest 参数组里的 `"{file}"`，`{ output: 名字 }` 填 `"{output}"`，`directory` 用暂存目录句柄。
  交回产物名，Jarvis 把它们移进当前文件夹、选中、⌘Z 可撤销。
- 进度：`progress({ fraction, message })`，画在 Jarvis 操作队列那一行；用户点 ✕ 时 `signal` 触发，取消进程后照常交回。

做自己的转换扩展：把 `process.executables` 换成你的工具（占位符各占参数组里的一整项），`describe` / `run` 照这里改。

```sh
npm run build      # 产物在 dist/extension.js
npm run validate
```
