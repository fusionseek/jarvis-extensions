/**
 * 纯函数：单位读法、两个解析器对着样例输出、排段与按契约截断。
 * 样例的来历见 `support.mjs`；每份结果都过一遍宿主的 `$defs.fileDetailsResult`。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { assertContract, byTitle, fixture, loadSource } from "./support.mjs";

const m = await loadSource();

/** 解析 → 排段 → 截断，与 `engine.ts` 同一条路。 */
function sectionsOf(report) {
  const result = m.clampResult(m.buildSections(report));
  assertContract(result);
  return result;
}

test("单位：千分位空格、码率、时长、采样率、文件大小、宽高比、帧率", () => {
  assert.equal(m.grouped(1920), "1 920");
  assert.equal(m.grouped(999), "999");
  assert.equal(m.grouped(1234567), "1 234 567");
  assert.equal(m.bitRateText(8573000), "8 573 kb/s");
  assert.equal(m.bitRateText(128000), "128 kb/s");
  assert.equal(m.bitRateText(35863268), "35.9 Mb/s", "10 Mb/s 起写 Mb/s");
  assert.equal(m.bitRateText(9999000), "9 999 kb/s");
  assert.equal(m.bitRateText(120000000), "120 Mb/s");
  assert.equal(m.bitRateText(640), "640 b/s");
  assert.equal(m.durationText(3723), "1 小时 2 分 3 秒");
  assert.equal(m.durationText(3603), "1 小时 0 分 3 秒", "中间的 0 留着，读的人才分得清");
  assert.equal(m.durationText(3600), "1 小时");
  assert.equal(m.durationText(125), "2 分 5 秒");
  assert.equal(m.durationText(3.008), "3 秒 8 毫秒");
  assert.equal(m.durationText(2), "2 秒");
  assert.equal(m.durationText(0.5), "500 毫秒");
  assert.equal(m.samplingRateText(48000), "48.0 kHz");
  assert.equal(m.samplingRateText(44100), "44.1 kHz");
  assert.equal(m.samplingRateText(22050), "22.05 kHz");
  assert.equal(m.fileSizeText(49267), "49 KB");
  assert.equal(m.fileSizeText(2411583), "2.4 MB");
  assert.equal(m.fileSizeText(62837463728), "62.84 GB");
  assert.equal(m.fileSizeText(512), "512 字节");
  assert.equal(m.resolutionText(1920, 1080), "1 920 × 1 080 像素");
  assert.equal(m.aspectRatioText(1.778), "16:9");
  assert.equal(m.aspectRatioText(2.39), "2.39:1");
  assert.equal(m.aspectRatioText(1.42), "1.42:1", "叫不出名字的写两位小数");
  assert.equal(m.frameRateText(24000 / 1001), "23.976 fps");
  assert.equal(m.timestampText(312.345), "00:05:12.345");
});

test("单位：语言码两种写法都认、und 不写、认不出的原样；日期归一、空日期不写", () => {
  assert.equal(m.languageText("en"), "英语");
  assert.equal(m.languageText("eng"), "英语");
  assert.equal(m.languageText("chi"), "中文");
  assert.equal(m.languageText("zh-CN"), "中文（中国大陆）");
  assert.equal(m.languageText("zh-Hans"), "中文（简体）");
  assert.equal(m.languageText("und"), undefined);
  assert.equal(m.languageText("tlh"), "tlh");
  assert.equal(m.dateText("UTC 2023-01-01 12:00:00"), "2023-01-01 12:00:00 UTC");
  assert.equal(m.dateText("2026-10-31T08:00:00.000000Z"), "2026-10-31 08:00:00 UTC");
  assert.equal(m.dateText("2026-10-31 08:00:00 UTC"), "2026-10-31 08:00:00 UTC");
  assert.equal(m.dateText("1904-01-01 00:00:00 UTC"), undefined, "MP4 里没填的日期是 Mac 纪元");
});

test("mediainfo · Matroska（MediaInfoLib 26.10 真跑的）：概要、视频、两条音频编号、字幕、章节", () => {
  const result = sectionsOf(m.parseMediaInfo(fixture("mediainfo-matroska.json")));
  assert.deepEqual(result.sections.map((section) => section.title), ["概要", "视频", "音频 #1", "音频 #2", "字幕", "章节"]);
  const by = byTitle(result.sections);
  assert.deepEqual(by["概要"], {
    格式: "Matroska（版本 4）",
    文件大小: "2.4 MB",
    时长: "3 秒 8 毫秒",
    总码率: "6 414 kb/s",
    帧率: "23.976 fps",
    写入程序: "Lavf62.3.100",
    标题: "测试影片",
  });
  assert.deepEqual(by["视频"], {
    格式: "AVC（High@L4）",
    "编码 ID": "V_MPEG4/ISO/AVC",
    分辨率: "1 920 × 1 080 像素",
    显示宽高比: "16:9",
    帧率: "23.976 fps（24000/1001，恒定）",
    色彩空间: "YUV",
    色度抽样: "4:2:0",
    位深: "8 位",
    扫描方式: "逐行",
  });
  assert.equal(by["音频 #1"]["格式"], "AC-3（Dolby Digital）");
  assert.equal(by["音频 #1"]["码率"], "384 kb/s（恒定）");
  assert.equal(by["音频 #1"]["声道"], "6 声道（L R C LFE Ls Rs）");
  assert.equal(by["音频 #1"]["采样率"], "48.0 kHz");
  assert.equal(by["音频 #1"]["语言"], "英语");
  assert.equal(by["音频 #1"]["默认"], "是", "两条音频时写哪条是默认");
  assert.equal(by["音频 #2"]["默认"], undefined, "否不写");
  assert.equal(by["音频 #2"]["语言"], "中文");
  assert.deepEqual(by["字幕"], { 格式: "UTF-8", 语言: "中文", 标题: "简体中文", 强制: "是" });
  assert.deepEqual(by["章节"], { "00:00:00.000": "开场", "00:00:01.500": "Ending" });
});

test("mediainfo · MP4 / MOV / FLAC（真跑的）：容器配置、HEVC 10 位、编码日期、单声道、艺术家与专辑", () => {
  const mp4 = byTitle(sectionsOf(m.parseMediaInfo(fixture("mediainfo-mp4.json"))).sections);
  assert.equal(mp4["概要"]["格式"], "MPEG-4（Base Media）");
  assert.equal(mp4["视频"]["格式"], "AVC（High 4:4:4 Predictive@L3.1）");
  assert.equal(mp4["音频"]["声道"], "1 声道（单声道）");
  assert.equal(mp4["音频"]["默认"], undefined, "只有一条时不写默认");

  const mov = byTitle(sectionsOf(m.parseMediaInfo(fixture("mediainfo-hevc-mov.json"))).sections);
  assert.equal(mov["概要"]["格式"], "MPEG-4（QuickTime）");
  assert.equal(mov["概要"]["编码日期"], "2026-10-31 08:00:00 UTC");
  assert.equal(mov["视频"]["格式"], "HEVC（Main 10@L5@Main）");
  assert.equal(mov["视频"]["位深"], "10 位");
  assert.equal(mov["视频"]["码率"], "35.9 Mb/s");

  const flac = byTitle(sectionsOf(m.parseMediaInfo(fixture("mediainfo-flac.json"))).sections);
  assert.deepEqual(Object.keys(flac), ["概要", "音频"]);
  assert.equal(flac["概要"]["艺术家"], "测试艺术家");
  assert.equal(flac["概要"]["专辑"], "测试专辑");
  assert.equal(flac["概要"]["总码率"], "228 kb/s（可变）");
  assert.equal(flac["音频"]["压缩模式"], "无损");
  assert.equal(flac["音频"]["位深"], "24 位");
  assert.equal(flac["音频"]["采样率"], "96.0 kHz");
});

test("mediainfo · Dolby Vision 蓝光 remux（手写）：HDR 逐层对齐、商业名、地区语言、超大章节表截到 40 行", () => {
  const result = sectionsOf(m.parseMediaInfo(fixture("mediainfo-movie-hdr.json")));
  const by = byTitle(result.sections);
  assert.equal(by["视频"]["HDR 格式"], "Dolby Vision，版本 1.0，dvhe.08.06，BL+RPU，兼容 HDR10 / SMPTE ST 2086，兼容 HDR10");
  assert.equal(by["视频"]["格式"], "HEVC（Main 10@L5.1@High）");
  assert.equal(by["视频"]["色彩原色"], "BT.2020");
  assert.equal(by["视频"]["传输特性"], "PQ");
  assert.equal(by["概要"]["时长"], "2 小时 15 分 31 秒");
  assert.equal(by["概要"]["编码库"], "libebml v1.4.5 + libmatroska v1.7.1");
  assert.equal(by["音频 #1"]["格式"], "MLP FBA（16-ch，Dolby TrueHD with Dolby Atmos）");
  assert.equal(by["音频 #1"]["声道"], "8 声道（L R C LFE Ls Rs Lb Rb）");
  assert.equal(by["音频 #2"]["语言"], "中文（中国大陆）");
  assert.equal(by["字幕 #2"]["语言"], "中文（简体）");
  assert.equal(by["字幕 #1"]["强制"], "是");

  const chapters = result.sections.find((section) => section.title === "章节");
  assert.equal(chapters.rows.length, m.maximumChapterRows);
  assert.deepEqual(chapters.rows[0], { label: "00:00:00.000", value: "Chapter 01" }, "去掉 en: 前缀");
  assert.deepEqual(chapters.rows.at(-1), { label: "其余", value: "共 60 章，这里只列出前 39 章" });
});

test("mediainfo：空文件认不出（只有一条没有 Format 的 General）、不是 JSON、media 为 null", () => {
  const kind = (output) => {
    try {
      m.parseMediaInfo(output);
      return "parsed";
    } catch (error) {
      return error.kind;
    }
  };
  assert.equal(kind(fixture("mediainfo-empty.json")), "unrecognized");
  assert.equal(kind("General\nComplete name : a.mkv\n"), "malformed", "老版本没有 JSON 导出时吐的是文本");
  assert.equal(kind('{"media":null}'), "unrecognized");
  assert.equal(kind("[]"), "malformed");
});

test("ffprobe · MP4（ffprobe 8.0 真跑的）：叫法换成 MediaInfo 的", () => {
  const by = byTitle(sectionsOf(m.parseFFprobe(fixture("ffprobe-mp4.json"), "mp4")).sections);
  assert.deepEqual(by["概要"], {
    格式: "MPEG-4（Base Media）",
    文件大小: "49 KB",
    时长: "2 秒",
    总码率: "197 kb/s",
    帧率: "30.000 fps",
    写入程序: "Lavf62.3.100",
  });
  assert.deepEqual(by["视频"], {
    格式: "AVC（High 4:4:4 Predictive@L3.1）",
    "编码 ID": "avc1",
    码率: "112 kb/s",
    分辨率: "1 280 × 720 像素",
    显示宽高比: "16:9",
    帧率: "30.000 fps",
    色彩空间: "YUV",
    色度抽样: "4:4:4",
    位深: "8 位",
    扫描方式: "逐行",
  });
  assert.deepEqual(by["音频"], { 格式: "AAC（LC）", 码率: "70 kb/s", 声道: "1 声道（单声道）", 采样率: "44.1 kHz", 压缩模式: "有损" });
});

test("ffprobe · Matroska / MOV / FLAC（真跑的）：章节、语言、强制字幕、10 位、编码日期、无损", () => {
  const mkv = sectionsOf(m.parseFFprobe(fixture("ffprobe-matroska.json"), "mkv"));
  assert.deepEqual(mkv.sections.map((section) => section.title), ["概要", "视频", "音频 #1", "音频 #2", "字幕", "章节"]);
  const by = byTitle(mkv.sections);
  assert.equal(by["概要"]["格式"], "Matroska");
  assert.equal(by["视频"]["帧率"], "23.976 fps（24000/1001）");
  assert.equal(by["音频 #1"]["声道"], "6 声道（5.1(side)）");
  assert.equal(by["音频 #1"]["语言"], "英语");
  assert.equal(by["音频 #1"]["默认"], "是");
  assert.equal(by["音频 #2"]["声道"], "2 声道（立体声）");
  assert.deepEqual(by["字幕"], { 格式: "SubRip（SRT）", 语言: "中文", 标题: "简体中文", 强制: "是" });
  assert.deepEqual(by["章节"], { "00:00:00.000": "开场", "00:00:01.500": "Ending" });
  assert.equal(byTitle(m.clampResult(m.buildSections(m.parseFFprobe(fixture("ffprobe-matroska.json"), "webm"))).sections)["概要"]["格式"], "WebM");

  const mov = byTitle(sectionsOf(m.parseFFprobe(fixture("ffprobe-hevc-mov.json"), "mov")).sections);
  assert.equal(mov["概要"]["格式"], "MPEG-4（QuickTime）");
  assert.equal(mov["概要"]["编码日期"], "2026-10-31 08:00:00 UTC");
  assert.equal(mov["视频"]["格式"], "HEVC（Main 10@L5）");
  assert.equal(mov["视频"]["位深"], "10 位", "yuv420p10le 推出 10 位");

  const flac = byTitle(sectionsOf(m.parseFFprobe(fixture("ffprobe-flac.json"), "flac")).sections);
  assert.equal(flac["概要"]["艺术家"], "测试艺术家");
  assert.equal(flac["音频"]["压缩模式"], "无损");
  assert.equal(flac["音频"]["位深"], "24 位");
});

test("ffprobe：读不了时吐的 {}、不是 JSON；封面归进图像；Dolby Vision 与 PQ 从旁路数据推", () => {
  const kind = (output) => {
    try {
      m.parseFFprobe(output, "mov");
      return "parsed";
    } catch (error) {
      return error.kind;
    }
  };
  assert.equal(kind("{\n\n}\n"), "unrecognized", "空文件：ffprobe 退出码 1、标准输出是 {}");
  assert.equal(kind("Invalid data found when processing input"), "malformed");

  const report = m.parseFFprobe(
    JSON.stringify({
      format: { format_name: "mp3", size: "4000000", duration: "180.5", bit_rate: "320000", tags: { ARTIST: "某人" } },
      streams: [
        { codec_type: "audio", codec_name: "mp3", sample_rate: "44100", channels: 2, channel_layout: "stereo", bit_rate: "320000", disposition: { default: 1 } },
        { codec_type: "video", codec_name: "mjpeg", width: 600, height: 600, disposition: { attached_pic: 1 } },
      ],
    }),
    "mp3",
  );
  const by = byTitle(sectionsOf(report).sections);
  assert.deepEqual(Object.keys(by), ["概要", "音频", "图像"]);
  assert.equal(by["概要"]["格式"], "MPEG Audio");
  assert.equal(by["概要"]["艺术家"], "某人", "标签不分大小写");
  assert.equal(by["音频"]["格式"], "MPEG Audio（Layer 3）");
  assert.deepEqual(by["图像"], { 格式: "JPEG", 分辨率: "600 × 600 像素" });

  assert.equal(
    m.ffprobeHdr({
      color_transfer: "smpte2084",
      side_data_list: [
        { side_data_type: "DOVI configuration record", dv_version_major: 1, dv_version_minor: 0, dv_profile: 8, dv_level: 6, rpu_present_flag: 1, el_present_flag: 0, bl_present_flag: 1, dv_bl_signal_compatibility_id: 1 },
        { side_data_type: "Mastering display metadata" },
      ],
    }),
    "Dolby Vision，版本 1.0，配置 8.1，级别 6，BL+RPU，兼容 HDR10 / SMPTE ST 2086，兼容 HDR10",
  );
  assert.equal(m.ffprobeHdr({ color_transfer: "smpte2084" }), "HDR10（PQ）");
  assert.equal(m.ffprobeHdr({ color_transfer: "arib-std-b67" }), "HLG");
  assert.equal(m.ffprobeHdr({ color_transfer: "bt709" }), undefined);
});

test("排段：轨道多到超过 16 段时，概要与章节留着、其余轨道压成一段里的一行，一条不丢", () => {
  const report = m.parseMediaInfo(fixture("mediainfo-movie-hdr.json"));
  report.texts = Array.from({ length: 30 }, (_, index) => ({ format: "PGS", language: index % 2 ? "en" : "zh", title: `字幕 ${index + 1}`, isForced: index === 3 }));
  const result = sectionsOf(report);
  assert.equal(result.sections.length, 16);
  assert.equal(result.sections[0].title, "概要");
  assert.equal(result.sections.at(-1).title, "章节");
  const rest = result.sections.at(-2);
  assert.equal(rest.title, "其余轨道");
  // 概要 + 章节 + 其余轨道 = 3 段，留给轨道 13 段：视频 1 + 音频 3 + 字幕 9；剩下 21 条字幕各一行。
  assert.equal(rest.rows.length, 21);
  assert.deepEqual(rest.rows[0], { label: "字幕 #10", value: "PGS，英语，字幕 10" });
});

test("截断：标签 / 值 / 标题 / notice 按契约截、不切开代理对；空行空段去掉；控制字符换空格；行数与段数封顶", () => {
  assert.equal(m.truncate("abcdef", 4), "abc…");
  const emoji = "😀".repeat(300);
  const cut = m.truncate(emoji, 500);
  assert.ok(cut.length <= 500);
  assert.ok(!/[\ud800-\udbff]…$/.test(cut), "不留半个代理对");

  const result = m.clampResult(
    [
      { title: "一".repeat(40), rows: [{ label: "标".repeat(50), value: "值".repeat(600) }, { label: "空", value: "   " }, { label: "换行", value: "第一行\n第二行\t完" }] },
      { title: "没有行", rows: [{ label: "x", value: "" }] },
      { title: "很多行", rows: Array.from({ length: 120 }, (_, index) => ({ label: `第 ${index + 1} 行`, value: "v" })) },
      ...Array.from({ length: 20 }, (_, index) => ({ title: `段 ${index}`, rows: [{ label: "a", value: "b" }] })),
    ],
    "提".repeat(300),
  );
  assertContract(result);
  assert.equal(result.sections.length, 16);
  assert.equal(result.sections[0].title.length, 32);
  assert.equal(result.sections[0].rows.length, 2, "全是空白的值去掉");
  assert.equal(result.sections[0].rows[0].label.length, 40);
  assert.equal(result.sections[0].rows[0].value.length, 500);
  assert.equal(result.sections[0].rows[1].value, "第一行 第二行 完");
  assert.equal(result.sections[1].title, "很多行", "没有行的段去掉");
  assert.equal(result.sections[1].rows.length, 80);
  assert.equal(result.notice.length, 200);
});

test("认领范围：video / audio 两类 + 系统认不出的容器扩展名，去重、合契约", async () => {
  const { assertDescribeContract } = await import("./support.mjs");
  const claims = m.describeClaims();
  assertDescribeContract(claims);
  assert.deepEqual(claims.categories, ["video", "audio"]);
  for (const extension of ["mkv", "webm", "flac", "opus", "ape", "m2ts", "ts", "rmvb", "mxf"]) assert.ok(claims.extensions.includes(extension), extension);
  assert.equal(new Set(claims.extensions).size, claims.extensions.length);
});
