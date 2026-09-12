/**
 * 截屏翻译（`translation`）—— 第一个用「命令 + 页面 + 原地弹窗」模型写的扩展，也是这个平台的参考实现。
 *
 * 三条命令：
 * - `capture-translate`（⌥⌘T，popover）：框选 → OCR → 合并段落 → 检测语言 → Google → 译文贴着选区弹出；
 * - `capture-copy`（⌥⌘O，silent）：同上，但译文直接进剪贴板 + 一条横幅，什么都不弹；
 * - `translate-clipboard`（panel）：剪贴板里是文字就翻文字，是图就先 OCR，结果在面板里。
 *
 * 只取 Easydict 的 OCR + Google 翻译这一段核心逻辑：不做划词、不做多引擎、不做跟随鼠标的浮窗。
 * 截图、OCR、语音、网络、弹窗窗体全在宿主；这里只有编排、Google 的请求 / 响应，与两棵节点树。
 */
import { defineExtension, jarvis, type CommandContext } from "@fusionseek/jarvis-extension-sdk";
import { Session, failureFor } from "./session.js";
import { renderPage } from "./page.js";
import { renderPopover } from "./popover.js";

const session = new Session();

async function captureTranslate(context: CommandContext): Promise<void> {
  session.adopt(context);
  if (!(await session.capture())) return;
  await session.translate();
}

async function captureCopy(context: CommandContext): Promise<void> {
  session.adopt(context);
  if (!(await session.capture())) return;
  if (!(await session.translate()) || !session.translation) {
    await session.reportFailureSilently();
    return;
  }
  try {
    await jarvis.clipboard.write(session.translation.text);
    session.autoCopied = true;
    if (session.has("notifications.post")) {
      await jarvis.notifications.post({ title: "已复制译文", body: session.translation.text.slice(0, 120) });
    }
  } catch (error) {
    session.fail(failureFor(error));
    await session.reportFailureSilently();
  }
}

async function translateClipboard(context: CommandContext): Promise<void> {
  session.adopt(context);
  if (await session.readClipboard()) await session.translate();
}

defineExtension({
  page: {
    activate: (context) => session.adopt(context),
    render: () => renderPage(session),
  },
  popover: {
    activate: (context) => session.adopt(context),
    render: () => renderPopover(session),
  },
  commands: {
    "capture-translate": captureTranslate,
    "capture-copy": captureCopy,
    "translate-clipboard": translateClipboard,
  },
  // 点了静默命令失败时那条横幅：宿主已经把面板展开到本扩展，错误屏在页面里，这里只要确保重画。
  onNotificationActivated: () => jarvis.ui.update(),
});
