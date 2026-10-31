/**
 * 媒体信息（`media-info`）—— 一个没有界面的服务扩展。
 *
 * 只入驻服务域：实现宿主开放的 `files.details` 扩展点。Jarvis「文件」的详情侧栏（窗口里的右侧一列、面板里的「详情」阶段）
 * 显示一个影音文件时，把它的句柄交过来；这里经 `process.run` 跑用户装好的 mediainfo（没有就 ffprobe），
 * 把读出的东西照 MediaInfo「简洁」视图排成几段「标签 · 值」交回。画、缓存、授权、选中一换就取消，都是 Jarvis 的事。
 *
 * 读法与单位不在宿主里的理由：哪个工具、什么参数、字段叫什么，会随工具的版本变——跟着扩展的版本走，
 * MediaInfo 改了 JSON 字段时发一个扩展新版本，不用发 Jarvis 新版本。
 */
import { defineExtension } from "@fusionseek/jarvis-extension-sdk";
import { mediaEngine } from "./engine.js";

defineExtension({
  services: {
    media: mediaEngine,
  },
});
