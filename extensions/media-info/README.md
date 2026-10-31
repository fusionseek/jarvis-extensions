# 媒体信息（`media-info`）

在 Jarvis「文件」的**详情**里读出影音文件的技术信息：容器与编码、码率、分辨率、帧率、HDR、声道与采样率、字幕与章节——
分段与字段照 MediaInfo 的「简洁」视图排，单位写成中文（`1 小时 2 分 3 秒`、`8 573 kb/s`、`48.0 kHz`、`1 920 × 1 080 像素`）。

## Overview

- **入驻哪里**：只入驻服务域，实现 Jarvis 的 `files.details` 扩展点。没有工具箱页、没有窗口；它体现在「文件」的详情里——
  窗口里是右侧那一列「详情」（⌘I 开 / 收），工具箱面板里是「详情」那一阶段（底栏 `info.circle`、⌘I）——选中一个影音文件时，
  一般信息下面多出一组「媒体信息 · 扩展」。设置 › 文件 ·「文件详情」里有它这一行（认哪些、授权状态、「重新检测」）。
- **扩展里没有任何解码器**：读文件的是你自己装好的命令行工具，扩展只决定跑哪个、怎么读它的输出、怎么排给你看。
  MediaInfo 改了字段名时发一个扩展新版本，不用发 Jarvis 新版本。

## Concepts

| 顺序 | 工具 | 会运行的命令（逐字） | 为什么 |
| --- | --- | --- | --- |
| 1 | `mediainfo`（MediaInfo 官方命令行） | `mediainfo --Output=JSON ‹选中的文件›` | 与 MediaInfo.app **同一个库**，读出来的字段与 App 一致，HDR、商业名（Dolby Atmos……）、编码库都在 |
| 2 | `ffprobe`（FFmpeg 自带） | `ffprobe -v error -print_format json -show_format -show_streams -show_chapters ‹选中的文件›` | 没装 mediainfo、或它没读出来时用；叫法换成 MediaInfo 的（`h264` 写成 `AVC`），段下面写一句「装上 MediaInfo 命令行能读出更多」 |

- **授权**：只要 `process.run`。上面两条命令逐字写在 `extension.json` 的 `process.executables` 里，授权屏与商店详情逐条念出来；
  每个工具只声明这一组参数，扩展跑不了别的。Jarvis **不会在你选中文件时自动弹授权屏**——详情里那一组先写一行
  「要运行 mediainfo / ffprobe 读取这个文件」和一颗「允许」，你点了才问；没授权之前一个进程都不跑。
- **只碰你选中的那一个文件**：Jarvis 把文件换成一个只在这一次有效的句柄交过来（`{file}`），扩展看不到路径，也拿不到别的文件；
  不改文件、不联网。工具在 Jarvis 里运行，继承 Jarvis 的完全磁盘访问权限。
- **认哪些文件**：系统认得是视频 / 音频的那些，再加一张系统常认不出的容器表（mkv、webm、flv、avi、ts、m2ts、ogg、opus、flac、ape……共 41 种）。
- **读一次就记住**：Jarvis 按（扩展、路径、修改时刻、大小）在内存里留最近 64 份结果；文件没变就不再跑工具。换了选中，正在跑的那一次被取消。

## Usage

1. 装一个工具（二选一，都装时先用 mediainfo）：
   - `brew install media-info`（推荐：MediaInfo 官方命令行，Homebrew 的包名带连字符，装好的命令叫 `mediainfo`）；
   - `brew install ffmpeg`（自带 `ffprobe`）。
2. 扩展商店 → 安装「媒体信息」。
3. 「文件」里选中一个影音文件 → 打开详情（⌘I）→「媒体信息 · 扩展」那一组点「允许」。之后选中别的影音文件就直接出。

## Gotchas

- **App Store 版 MediaInfo.app 调不动**：它是沙盒里的应用，没有命令行入口；扩展只能运行 manifest 里声明的命令行工具。
  它与 `mediainfo` 命令行是同一个库，装一份命令行就能读出同样的东西。
- **ffprobe 起不来**：Homebrew 升级了 FFmpeg 依赖的库（x265、libvpx……）而 FFmpeg 本身没跟着升时，`ffprobe` 一启动就停在 dyld。
  详情里会写「ffprobe 起不来……在终端里跑 brew upgrade ffmpeg」——照做即可。mediainfo 同理（`brew upgrade media-info`）。
- 工具不在 Homebrew、`/usr/local/bin`、`~/.local/bin`、`~/bin`、Nix 的固定位置里时找不到（例如自己编译放在别处的）；放进其中一处即可。
- 认不出格式（空文件、不是影音的文件、坏了的文件）时写一句原因，不出段。
- 显示有上限：至多 16 段、每段 80 行；章节至多 40 行（更多时最后一行写共几章），轨道多到放不下时其余的压成「其余轨道」一段里各一行。
- ffprobe 比 MediaInfo 少报几样：码率模式、视频的编码库、Dolby Atmos 这类商业名；HDR 只能从流的旁路数据与传输特性推（Dolby Vision、HDR10、HLG）。
- 只读一个文件；选中多项时详情是汇总，不跑工具。

## Related Links

- Jarvis 侧：`jarvis-mac` `specs/20261031-192049-files-details-media-info-type-select` M
- 扩展点：[docs/10-settings.md](../../docs/10-settings.md)「设置 › 文件 · 文件详情」；`process.run` 与 `{file}`：[docs/06-capabilities.md](../../docs/06-capabilities.md)
- MediaInfo 命令行：<https://mediaarea.net/en/MediaInfo/Download/Mac_OS>
