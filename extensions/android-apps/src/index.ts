/**
 * 手机应用（`android-apps`）—— 扫描连着的安卓手机上装了哪些应用：包名、大小、应用名与图标，
 * 点一下把包名交给内置的「APK 扫描」或「数据导出」接着做。
 *
 * 只入驻工具箱一个域，只要两项能力：`android.apps.read`（经宿主的 adb 读设备与应用）、`android.tools.open`（交给内置工具）。
 * 它**不跑任何命令**（没有 `process.run`）、不联网、不读文件：adb 与 aapt2 只在宿主里跑，跑的是宿主写死的那几条，
 * 扩展只给设备序列号与包名。
 */
import { defineExtension, type PageDefinition } from "@fusionseek/jarvis-extension-sdk";
import { renderPage } from "./page.js";
import { Session } from "./session.js";

const session = new Session();

const page: PageDefinition = {
  activate: (context) => session.activate(context),
  deactivate: () => session.deactivate(),
  render: () => renderPage(session),
};

defineExtension({ toolbox: page });
