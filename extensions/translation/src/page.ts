/**
 * 面板里的页面：五种状态各答得出"现在怎么了、下一步按哪"。
 *
 * 对应 Figma `jarvis-extension-screenshot-translate` `983:2` 的 `translate-01…05`：
 * 空 / 截到并译出 / 翻译中 / 没有截图授权 / 翻译失败。从原地弹窗「在面板里打开」、钉住，
 * 或跑「翻译剪贴板」之后落在这里。
 */
import { jarvis, ui, type ActionSpec, type UINode } from "@fusionseek/jarvis-extension-sdk";
import { languageOptions, ocrLanguageOptions, type Session } from "./session.js";

const FOOTNOTE = "Vision 识别文字、合并段落、检测语言，再经 Google 翻译；免费端点无需 key，填了 API key 走官方接口。";

export function renderPage(s: Session): UINode {
  const children: UINode[] = [];
  const fresh = s.phase === "idle" && s.source === "" && s.translation === null;
  if (!s.has("screenshot.capture")) children.push(deniedCaptureSection(s));
  else if (fresh) children.push(captureSection(s));
  if (fresh) {
    if (!s.has("screenshot.capture")) children.push(fallbackSection(s));
    else children.push(languageSection(s));
    children.push(ui.text({ text: FOOTNOTE, style: "footnote" }));
  } else {
    children.push(sourceSection(s), translationSection(s), actionsRow(s));
    const note = footnote(s);
    if (note) children.push(ui.text({ key: "footnote", text: note, style: "footnote" }));
  }
  return ui.scroll({ children });
}

// ---------------------------------------------------------------------------
// 段
// ---------------------------------------------------------------------------

function captureSection(s: Session): UINode {
  const hotkeyT = s.hotkey("capture-translate");
  const hotkeyO = s.hotkey("capture-copy");
  const children: UINode[] = [];
  if (s.systemPermissionMissing) children.push(systemPermissionNote(s));
  children.push(
    ui.empty({ symbol: "viewfinder", title: "框选屏幕上任意一块", hint: "松手就翻译，译文贴着选区弹出来" }),
    ui.stack({
      axis: "horizontal",
      spacing: "tight",
      alignment: "center",
      children: [
        ui.button({
          key: "capture-button",
          title: "截屏翻译",
          symbol: "viewfinder",
          variant: "primary",
          size: "bar",
          disabled: s.busy,
          help: "框选屏幕上的一块，识字并翻译",
          onPress: () => void jarvis.commands.run("capture-translate"),
        }),
        ...(hotkeyT ? [ui.keycap({ text: hotkeyT })] : []),
      ],
    }),
    ui.stack({
      axis: "horizontal",
      spacing: "tight",
      alignment: "center",
      children: [
        clipboardButton(s),
        ui.button({
          key: "capture-copy",
          title: "截屏译文入剪贴板",
          variant: "secondary",
          size: "inline",
          disabled: s.busy || !s.has("clipboard.write"),
          help: "框选一块，翻译后直接复制，不开面板",
          onPress: () => void jarvis.commands.run("capture-copy"),
        }),
        ...(hotkeyO ? [ui.keycap({ text: hotkeyO })] : []),
      ],
    }),
  );
  return ui.section({ key: "capture", title: "截屏 · CAPTURE", trailing: hotkeyT ?? "", children });
}

function deniedCaptureSection(s: Session): UINode {
  const children: UINode[] = [deniedCaptureNote(s)];
  if (s.systemPermissionMissing) children.push(systemPermissionNote(s));
  return ui.section({ key: "capture", title: "截屏 · CAPTURE", trailing: "未授权", tint: "alert", children });
}

function fallbackSection(s: Session): UINode {
  return ui.section({
    key: "fallback",
    title: "还能做的 · FALLBACK",
    children: [
      ui.stack({
        axis: "horizontal",
        spacing: "regular",
        alignment: "center",
        children: [clipboardButton(s), ui.text({ text: "剪贴板里是图就先识字，是文字就直接翻", style: "subtle" })],
      }),
    ],
  });
}

function languageSection(s: Session): UINode {
  // 8 种识别语言排不进 376pt 一行：只画默认那四种加上用户已选的，其余在设置页。
  const shown = ocrLanguageOptions.filter((o, i) => i < 4 || s.ocrLanguages.includes(o.value)).slice(0, 5);
  const row = (label: string, control: UINode): UINode =>
    ui.stack({ axis: "horizontal", spacing: "regular", alignment: "center", children: [ui.text({ text: label, style: "body" }), ui.spacer(), control] });
  return ui.section({
    key: "language",
    title: "语言 · LANGUAGE",
    trailing: "AUTO-DETECT",
    children: [
      row("翻译成", ui.picker({ key: "target", layout: "compact", label: "翻译成", options: languageOptions, value: s.target, onChange: (v) => s.setTarget(v) })),
      row(
        "原文已是目标语言时",
        ui.picker({
          key: "alternate",
          layout: "compact",
          label: "原文已是目标语言时翻成",
          options: languageOptions.filter((o) => o.value !== s.target),
          value: s.alternate,
          onChange: (v) => s.setAlternate(v),
        }),
      ),
      row(
        "识别语言",
        ui.stack({
          axis: "horizontal",
          spacing: "tight",
          children: shown.map((o) =>
            ui.chip({
              key: `ocr-${o.value}`,
              title: o.title,
              selected: s.ocrLanguages.includes(o.value),
              help: `识别${o.title}`,
              onPress: () => s.toggleOCRLanguage(o.value),
            }),
          ),
        }),
      ),
    ],
  });
}

function sourceSection(s: Session): UINode {
  const parts: string[] = [];
  if (s.detected.name) parts.push(s.detected.name);
  if (s.lines > 0 && s.origin !== "typed") parts.push(`${s.lines} 行`);
  const children: UINode[] = [];
  if (!s.has("screenshot.capture")) children.push(deniedCaptureNote(s));
  if (s.image) {
    const size = s.imageSize ? ` · ${s.imageSize.width}×${s.imageSize.height}` : "";
    children.push(ui.image({ key: "shot", file: s.image, label: s.origin === "screenshot" ? `刚截到的那一块${size}` : "剪贴板里的图片", size: "small" }));
  }
  if (s.phase === "recognizing" && s.source === "") {
    children.push(ui.progress({ tint: "accent", label: "识别中 · Vision" }));
  } else {
    children.push(
      ui.editor({
        key: "source",
        value: s.source,
        rows: 4,
        maxRows: 10,
        label: "原文",
        placeholder: "把要翻译的文字放到这里…",
        onChange: (v) => s.setSource(v),
      }),
    );
  }
  const actions: ActionSpec[] = [
    { id: "speak-source", title: "朗读原文", symbol: "speaker.wave.2", help: "朗读原文", disabled: !s.has("speech.speak") || s.source.trim() === "", onPress: () => s.speak(s.source, s.detected.code) },
    { id: "clear", title: "清空", symbol: "xmark.circle", help: "清空原文与译文", disabled: s.busy, onPress: () => s.clear() },
  ];
  return ui.section({ key: "source-section", title: "原文 · SOURCE", trailing: parts.join(" · ") || `${Array.from(s.source).length} 字符`, actions, children });
}

function translationSection(s: Session): UINode {
  const failed = s.phase === "failed" && s.failure !== null;
  const children: UINode[] = [];
  if (!s.has("network.https")) {
    children.push(
      ui.note({
        key: "network-denied",
        tint: "alert",
        symbol: "lock",
        title: "没有访问 Google 翻译的授权",
        body: "译文要经 translate.googleapis.com 取回；不授权就只能识字，不能翻译。",
        actions: [{ id: "grant-network", title: "授权", onPress: () => void s.requestCapabilities(["network.https"]) }],
      }),
    );
  }
  if (s.phase === "translating") {
    children.push(
      ui.progress({ tint: "accent", label: "翻译中 · Google" }),
      ui.note({ key: "hold", tint: "accent", symbol: "hourglass", body: "翻译期间面板 hold 住，不会自己收回；30 秒没回来算失败。" }),
    );
  }
  if (failed && s.failure) {
    children.push(ui.note({ key: "failure", tint: "danger", symbol: "exclamationmark.triangle", title: s.failure.title, body: s.failure.body, actions: failureActions(s) }));
  }
  if (s.phase !== "translating" && !failed) {
    children.push(
      ui.result({
        key: "translation",
        text: s.translation?.text ?? "",
        copy: true,
        tint: s.translation ? "accent" : "neutral",
        empty: s.source.trim() === "" ? "译文会出现在这里" : "按「翻译」把上面的原文翻出来",
      }),
    );
  }
  const trailing = failed ? "失败" : s.phase === "translating" ? "翻译中" : s.translation ? `GOOGLE · ${s.targetTitle}` : "";
  const actions: ActionSpec[] = [
    { id: "speak-translation", title: "朗读译文", symbol: "speaker.wave.2", help: "朗读译文", disabled: !s.has("speech.speak") || !s.translation, onPress: () => s.speak(s.translation?.text ?? "", s.target) },
  ];
  return ui.section({ key: "translation-section", title: "译文 · TRANSLATION", trailing, tint: failed ? "danger" : "neutral", actions, children });
}

/** 动作那一排随状态变：有译文时是「再截一块 / 复制译文 / 朗读原文」，没有时是「截屏翻译 / 翻译」。 */
function actionsRow(s: Session): UINode {
  const hotkeyT = s.hotkey("capture-translate");
  const children: UINode[] = [
    ui.button({
      key: "capture-button",
      title: s.translation || s.phase === "failed" ? "再截一块" : "截屏翻译",
      symbol: "viewfinder",
      variant: "primary",
      size: "bar",
      disabled: s.busy || !s.has("screenshot.capture"),
      help: "框选屏幕上的一块，识字并翻译",
      onPress: () => void jarvis.commands.run("capture-translate"),
    }),
  ];
  if (hotkeyT) children.push(ui.keycap({ text: hotkeyT }));
  if (s.translation && !s.dirty) {
    children.push(ui.copy({ key: "copy-translation", text: s.translation.text, label: "复制译文", variant: "chip", disabled: s.busy }));
  } else if (s.phase === "failed" && s.source.trim() !== "") {
    children.push(ui.copy({ key: "copy-source", text: s.source, label: "复制原文", variant: "chip" }));
  } else {
    children.push(
      ui.button({
        key: "translate",
        title: "翻译",
        symbol: "arrow.right",
        variant: "secondary",
        size: "bar",
        disabled: s.busy || s.source.trim() === "" || !s.has("network.https"),
        help: "把上面的原文翻译成目标语言",
        onPress: () => void s.translate(),
      }),
    );
  }
  return ui.stack({ key: "actions", axis: "horizontal", spacing: "regular", alignment: "center", children });
}

function footnote(s: Session): string | null {
  if (s.phase === "done" && s.translation) {
    const host = s.translation.backend === "v2" ? "translation.googleapis.com" : "translate.googleapis.com";
    return `${s.autoCopied ? "已自动复制译文 · " : ""}${(s.elapsedMs / 1000).toFixed(1)} s · ${host}`;
  }
  if (s.phase === "translating") return "面板在译文回来前不会自动收回";
  if (s.dirty) return "原文或语言改过了，按「翻译」重翻";
  return null;
}

// ---------------------------------------------------------------------------
// 共用的小块
// ---------------------------------------------------------------------------

function clipboardButton(s: Session): UINode {
  return ui.button({
    key: "translate-clipboard",
    title: "翻译剪贴板",
    variant: "secondary",
    size: "inline",
    disabled: s.busy || !s.has("clipboard.read"),
    help: "把剪贴板里的文字或图片拿来翻译",
    onPress: () => void jarvis.commands.run("translate-clipboard"),
  });
}

function deniedCaptureNote(s: Session): UINode {
  return ui.note({
    key: "capture-denied",
    tint: "alert",
    symbol: "lock",
    title: "没有截图的授权",
    body: "第一次进入时你关掉了「截取屏幕」。没有它，这个扩展只能翻译剪贴板里的文字或图片。",
    actions: [{ id: "grant-capture", title: "授权", onPress: () => void s.requestCapabilities(["screenshot.capture"]) }],
  });
}

/** 这是宿主自己的 TCC 状态：扩展只看到 `permission.unavailable`，把去处画出来就够了。 */
function systemPermissionNote(s: Session): UINode {
  return ui.note({
    key: "system-permission",
    tint: "neutral",
    symbol: "rectangle.dashed.badge.record",
    title: "Jarvis 还没有屏幕录制权限",
    body: "系统那一层也要点头：打开系统设置 › 隐私与安全性 › 屏幕录制，把 Jarvis 拖进列表。",
    actions: [{ id: "system-settings", title: "打开系统设置", onPress: () => void s.openScreenRecordingSettings() }],
  });
}

export function failureActions(s: Session): ActionSpec[] {
  const actions: ActionSpec[] = [];
  const kind = s.failure?.kind;
  if (kind === "denied") {
    actions.push({ id: "grant-network", title: "授权", onPress: () => void s.requestCapabilities(["network.https"]) });
  } else if (kind === "empty" || kind === "clipboard") {
    actions.push({ id: "recapture", title: "再截一块", disabled: !s.has("screenshot.capture"), onPress: () => void jarvis.commands.run("capture-translate") });
  } else {
    actions.push({ id: "retry", title: "重试", onPress: () => void s.translate() });
  }
  if (kind === "network") {
    actions.push({ id: "settings", title: "填 API key 走官方接口", onPress: () => void jarvis.system.openExtensionSettings() });
  }
  return actions;
}
