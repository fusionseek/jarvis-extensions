/**
 * 原地结果弹窗：松手之后贴着选区出现的那一扇，眼睛不用离开刚才看的地方。
 *
 * 对应 Figma `popover-01-translating` `993:4` / `popover-02-result` `993:53`。它是页面的紧凑版：
 * 不画缩略图（选区就在旁边）、不画偏好行（那些在页面与设置页里），只有原文卡、语言行与译文卡。
 * 窗体、钉住、「在面板里打开」、关闭都是宿主的 chrome，这里一行都不用写。
 */
import { jarvis, ui, type UINode } from "@fusionseek/jarvis-extension-sdk";
import { languageOptions, type Session } from "./session.js";
import { failureActions } from "./page.js";

export function renderPopover(s: Session): UINode {
  return ui.scroll({ children: [sourceCard(s), languageRow(s), resultCard(s)] });
}

function sourceCard(s: Session): UINode {
  const meta: string[] = [];
  if (s.lines > 0 && s.origin !== "typed") meta.push(`${s.lines} 行`);
  if (s.imageSize) meta.push(`${s.imageSize.width}×${s.imageSize.height}`);
  return ui.card({
    key: "source-card",
    children: [
      ui.editor({ key: "source", value: s.source, rows: 3, minRows: 2, maxRows: 6, label: "原文", placeholder: "把要翻译的文字放到这里…", onChange: (v) => s.setSource(v) }),
      ui.stack({
        axis: "horizontal",
        spacing: "tight",
        alignment: "center",
        children: [
          ...(s.detected.name ? [ui.badge({ key: "detected", title: `识别为 ${s.detected.name}`, tint: "neutral" })] : []),
          ui.button({
            key: "speak-source",
            title: "朗读",
            symbol: "speaker.wave.2",
            variant: "secondary",
            size: "inline",
            disabled: !s.has("speech.speak") || s.source.trim() === "",
            help: "朗读原文",
            onPress: () => s.speak(s.source, s.detected.code),
          }),
          ui.copy({ key: "copy-source", text: s.source, label: "复制原文", variant: "chip", disabled: s.source.trim() === "" }),
          ui.spacer(),
          ...(meta.length ? [ui.text({ key: "source-meta", text: meta.join(" · "), style: "footnote" })] : []),
        ],
      }),
    ],
  });
}

/** 「英语 · 自动检测 ▾  ⇄  中文 ▾」：改哪一边都立刻重翻。 */
function languageRow(s: Session): UINode {
  const fromOptions = [{ value: "auto", title: s.detected.name ? `${s.detected.name} · 自动检测` : "自动检测" }, ...languageOptions];
  return ui.stack({
    key: "language",
    axis: "horizontal",
    spacing: "regular",
    alignment: "center",
    children: [
      ui.picker({
        key: "from",
        layout: "compact",
        label: "原文语言",
        options: fromOptions,
        value: s.sourceOverride ?? "auto",
        disabled: s.busy,
        onChange: (v) => {
          s.setSourceOverride(v);
          s.retranslate();
        },
      }),
      ui.symbol({ name: "arrow.left.arrow.right", size: "small", tint: "neutral" }),
      ui.picker({
        key: "to",
        layout: "compact",
        label: "翻译成",
        options: languageOptions,
        value: s.target,
        disabled: s.busy,
        onChange: (v) => {
          s.setTarget(v);
          s.retranslate();
        },
      }),
    ],
  });
}

function resultCard(s: Session): UINode {
  const done = s.phase === "done" && s.translation !== null;
  const hotkeyT = s.hotkey("capture-translate");
  const children: UINode[] = [];
  if (s.phase === "translating") {
    children.push(
      ui.progress({ tint: "accent", label: "翻译中 · Google" }),
      ui.text({ key: "hold", text: "原文已经识别出来，译文马上到；这期间弹窗不会自己收。", style: "subtle" }),
    );
  } else if (s.phase === "failed" && s.failure) {
    children.push(ui.note({ key: "failure", tint: "danger", symbol: "exclamationmark.triangle", title: s.failure.title, body: s.failure.body, actions: failureActions(s) }));
  } else {
    children.push(ui.result({ key: "translation", text: s.translation?.text ?? "", copy: false, tint: done ? "accent" : "neutral", empty: "译文会出现在这里" }));
  }
  const backend = done && s.translation ? `Google · ${s.translation.backend === "v2" ? "官方接口" : "免费端点"} · ${(s.elapsedMs / 1000).toFixed(1)} s` : "Google";
  children.push(
    ui.stack({
      axis: "horizontal",
      spacing: "tight",
      alignment: "center",
      children: [
        ui.copy({ key: "copy-translation", text: s.translation?.text ?? "", label: "复制译文", variant: "chip", disabled: !done }),
        ui.button({
          key: "speak-translation",
          title: "朗读",
          symbol: "speaker.wave.2",
          variant: "secondary",
          size: "inline",
          disabled: !done || !s.has("speech.speak"),
          help: "朗读译文",
          onPress: () => s.speak(s.translation?.text ?? "", s.target),
        }),
        ui.button({
          key: "recapture",
          title: hotkeyT ? `再截一块 ${hotkeyT}` : "再截一块",
          symbol: "viewfinder",
          variant: "secondary",
          size: "inline",
          disabled: s.busy || !s.has("screenshot.capture"),
          help: "框选屏幕上的另一块",
          onPress: () => void jarvis.commands.run("capture-translate"),
        }),
        ...(s.dirty
          ? [ui.button({ key: "translate", title: "翻译", variant: "primary", size: "inline", disabled: s.busy || s.source.trim() === "", help: "按改过的原文重翻", onPress: () => void s.translate() })]
          : []),
        ui.spacer(),
        ui.text({ key: "backend", text: backend, style: "footnote" }),
      ],
    }),
  );
  return ui.card({ key: "result-card", tint: done ? "accent" : "neutral", children });
}
