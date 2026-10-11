/**
 * 截屏翻译（`translation`）—— 第一个用「命令 + 工具箱页面 + 原地弹窗」模型写的扩展，也是这个平台的参考实现。
 *
 * 入驻三个域：工具箱（页面与原地弹窗）、指令、设置。四条命令：
 * - `capture-translate`（⌥⌘T，popover）：框选 → OCR → 合并段落 → 检测语言 → Google → 译文贴着选区弹出；
 * - `capture-copy`（⌥⌘O，silent）：同上，但译文直接进剪贴板 + 一条横幅，什么都不弹；
 * - `translate-clipboard`（toolbox）：剪贴板里是文字就翻文字，是图就先 OCR，结果在工具箱页面里；
 * - `translate-text`（`/translate` · `/翻译`，toolbox）：翻译 `/` 后面跟的那段字；没跟字就同「翻译剪贴板」。
 *
 * 只取 Easydict 的 OCR + Google 翻译这一段核心逻辑：不做划词、不做多引擎、不做跟随鼠标的浮窗。
 * 截图、OCR、语音、网络、弹窗窗体全在宿主；这里只有编排、Google 的请求 / 响应，与两棵节点树。
 */
import { defineExtension, jarvis, JarvisError, type CommandContext, type PageDefinition } from "@fusionseek/jarvis-extension-sdk";
import { Session, describe, failureFor } from "./session.js";
import { renderPage } from "./page.js";
import { renderPopover } from "./popover.js";

/** 前台会话的那一份：工具箱页面、原地弹窗与落在它们上面的命令共用。 */
const session = new Session();

/**
 * 静默命令的那一份。
 *
 * 真机上静默命令跑在后台会话（另一个 JSContext），`session` 在那里是一份从没被页面碰过的空状态；
 * 单测里两者同处一个 JSContext。单独给一个实例，两边才是同一种行为——静默命令既读不到页面的状态，
 * 也不会把一次失败写进用户正看着的那一屏。
 */
const background = new Session({ headless: true });

async function captureTranslate(context: CommandContext): Promise<void> {
  session.adopt(context);
  if (!(await session.capture())) return;
  await session.translate();
}

/**
 * ⌥⌘O：框选 → 翻译 → 剪贴板 + 横幅。
 *
 * 跑在后台会话里：`panel.hold` 被拒（SDK 吞掉）、没有弹窗可撤、没有页面可画，
 * 因此这里每一条路都以剪贴板或横幅收尾，不留一个"去页面里看"的结局。
 */
async function captureCopy(context: CommandContext): Promise<void> {
  const s = background;
  s.adopt(context);
  if (!(await s.capture())) {
    await s.reportFailureSilently();
    return;
  }
  if (!(await s.translate()) || !s.translation) {
    await s.reportFailureSilently();
    return;
  }
  const translated = s.translation.text;
  try {
    await jarvis.clipboard.write(translated);
    s.autoCopied = true;
  } catch (error) {
    // 译文已经出来了，坏的是剪贴板那一步：标题不能再说「翻译失败」，否则用户会去查网络。
    s.fail(
      error instanceof JarvisError && error.code === "permission.denied"
        ? failureFor(error, true)
        : { kind: "other", title: "译文没放进剪贴板", body: `${describe(error)}。用「截屏翻译」能在弹窗里看到译文并复制。` },
    );
    await s.reportFailureSilently();
    return;
  }
  if (s.has("notifications.post")) {
    try {
      await jarvis.notifications.post({ title: "已复制译文", body: translated.slice(0, 120) });
    } catch (error) {
      // 译文已经在剪贴板里了：回执没发出去不算这条命令失败。
      jarvis.log.warn("「已复制译文」横幅没发出去", error instanceof Error ? error.message : String(error));
    }
  }
}

async function translateClipboard(context: CommandContext): Promise<void> {
  session.adopt(context);
  if (await session.readClipboard()) await session.translate();
}

/**
 * `/translate <文字>`：把那段字当原文，结果画在工具箱页面上（宿主随即把面板展开到这里）。
 *
 * 没跟字（`/translate` 回车）时不画一屏空的：与「翻译剪贴板」同一条路——
 * 用户多半是刚复制了一段、想不起来还要再粘一次。
 */
async function translateText(context: CommandContext): Promise<void> {
  session.adopt(context);
  const text = context.argument?.trim() ?? "";
  if (text === "") {
    if (await session.readClipboard()) await session.translate();
    return;
  }
  session.adoptText(text, "typed");
  await session.translate();
}

const toolbox: PageDefinition = {
  activate: (context) => session.adopt(context),
  render: () => renderPage(session),
};

defineExtension({
  toolbox,
  popover: {
    activate: (context) => session.adopt(context),
    render: () => renderPopover(session),
  },
  commands: {
    "capture-translate": captureTranslate,
    "capture-copy": captureCopy,
    "translate-clipboard": translateClipboard,
    "translate-text": translateText,
  },
});
