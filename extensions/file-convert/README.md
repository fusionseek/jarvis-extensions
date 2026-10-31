# 文件转换（`file-convert`）

在 Jarvis「文件」里转换文件格式。长按选中的图像、音频、视频、文本或办公文档，转盘上多一片紫色的「格式转换」；指着它，盘外缘向外展开一圈
**此刻转得了的格式**（一张 PNG 只看到图像能转成的那几种，一个 MP4 只看到影音的），选一个就转：

- 产物与原文件同名、换扩展名，放回当前文件夹并选中；同名时 Jarvis 自动加「 2」。原文件不动，⌘Z 把产物移到废纸篓。
- 转的时候条目上看得见在转：列表里那一行扫过流光、大小那一列写百分比；图标视图里图标翻到目标格式又翻回来，直到转完闪一下。
- 右键菜单里是「格式转换」子菜单，窗口工具栏的功能区里是一枚「格式转换」下拉。

需要 Jarvis 3.3.3 以上（转盘外圈、条目上的「在转」、`files.actions` 的组与逐文件进度是 SDK 2.14 的宿主能力）。

## 转得了什么

| 类 | 系统自带就能转 | 装了之后还能转 |
|---|---|---|
| 图像 | PNG · JPEG · HEIC · TIFF · GIF · BMP · AVIF · JPEG 2000 · PDF（sips，读 WebP / PSD / TGA / SVG） | WebP · ICO（ImageMagick；没有它时 FFmpeg 也能写 WebP） |
| 音频 | M4A（AAC）· WAV · AIFF · CAF · FLAC（afconvert） | MP3 · OGG · Opus，以及 afconvert 读不了的源（FFmpeg） |
| 视频 | MOV · MP4 · M4V 互转、取音轨成 M4A（avconvert，有百分比） | MKV · WebM · GIF 动图、取音轨成 MP3 / WAV / FLAC，读 AVI / FLV / WMV / MPEG / TS（FFmpeg，有百分比） |
| 文本 | 纯文本 · HTML · RTF · Word（DOC / DOCX）· ODT 互转（textutil）；JSON ↔ plist（plutil） | Markdown 的读写与 EPUB（pandoc） |
| 办公 | — | 文档 / 表格 / 演示转 PDF，Excel · ODS · CSV 互转，PowerPoint · ODP 互转（LibreOffice） |

一步到不了的自动走两步（照 [Filee](https://github.com/KnifeLemon/Filee) 的路线规划）：DOC → Markdown = textutil 先转 HTML，再交给 pandoc。
中间产物留在 Jarvis 给的暂存目录里，转完一起删掉。

每个目标格式一组固定参数：H.264 CRF 23 + AAC 192k（MP4）、MP3 V2、WebP 质量 85、GIF 动图 12 帧宽 480。

## 工具

「设置 · 文件 · 文件转换」里每个可选的工具一行：找到了写路径与「已就绪」；没找到给「在终端中安装」（Homebrew）；装了却起不来（依赖的库被升级换掉）给「在终端中修复」。
也可以「选择」一份别处的（文件名必须是那个工具的名字）。

- FFmpeg（`brew install ffmpeg`，带 ffprobe：读时长，转换时才写得出百分比）
- ImageMagick（`brew install imagemagick`）
- pandoc（`brew install pandoc`）
- LibreOffice（`brew install --cask libreoffice`）：转换时先关掉开着的 LibreOffice 窗口，否则它一声不响地什么都不做。

## 怎么做到的

- 只入驻服务域：实现宿主的 `files.actions` 扩展点（SDK 2.14 的 `groups` / `group` / `produces` 与 `progress.files`）。
- 文件经句柄交过来（`{file}`），扩展看不到路径；产物写进暂存目录（`{output}`）。每条命令都在 `extension.json` 里逐字声明——
  声明由 `scripts/generate-manifest.mjs` 从 `src/media.ts` / `src/text.ts` / `src/office.ts` 的命令模板生成，测试钉住两边一字不差。
- 引擎表 `src/engines.ts`、路线 `src/routes.ts`、进度 `src/progress.ts`（ffmpeg 的 `-progress pipe:1`、avconvert 的 `--progress`）。

## 测试

`npm test`：路线规划、命令 ⊆ manifest、manifest 与引擎表一致、进度解析、一次转换走一遍（进程全是替身，不跑任何真的工具）。
