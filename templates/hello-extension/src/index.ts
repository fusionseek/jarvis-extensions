/**
 * 字数统计 —— 脚手架示例。
 *
 * 它刻意什么能力都不申请：证明一个纯函数工具只靠节点树与自己的状态就能成立。
 * 结构与内置工具同一套：段 → 段 → 段，每段一个标题行。
 */
import { defineExtension, jarvis, ui } from "@fusionseek/jarvis-extension-sdk";

let text = "";

function summary(): { characters: number; words: number; lines: number } {
  const trimmed = text.trim();
  return {
    characters: Array.from(text).length,
    // 中文没有空格分词：按连续的非空白段数，中文每个字算一个"词"。
    words: trimmed === "" ? 0 : trimmed.split(/\s+/).reduce((n, chunk) => n + (/^[一-鿿]+$/.test(chunk) ? Array.from(chunk).length : 1), 0),
    lines: text === "" ? 0 : text.split(/\r?\n/).length,
  };
}

defineExtension({
  async activate() {
    // 跨越一次面板收回记住上次的文本：面板 15 秒会自动收回，重新进入是新的一次 activate。
    text = (await jarvis.storage.get<string>("text")) ?? "";
    jarvis.ui.update();
  },

  render() {
    const s = summary();
    return ui.scroll({
      children: [
        ui.section({
          title: "输入 · INPUT",
          trailing: text === "" ? undefined : `${s.characters} 字符`,
          actions: [
            {
              id: "clear",
              title: "清空",
              symbol: "xmark.circle",
              help: "清空输入",
              disabled: text === "",
              onPress: () => {
                text = "";
                void jarvis.storage.delete("text");
              },
            },
          ],
          children: [
            ui.editor({
              key: "input",
              value: text,
              rows: 4,
              maxRows: 10,
              placeholder: "粘一段文字进来…",
              label: "要统计的文本",
              onChange: (value) => {
                text = value;
                void jarvis.storage.set("text", value);
              },
            }),
          ],
        }),
        ui.section({
          title: "读数 · COUNTS",
          children: [
            ui.readout({ label: "字符", value: String(s.characters), tint: "accent", copy: true }),
            ui.readout({ label: "单词", value: String(s.words), tint: "blue", copy: true }),
            ui.readout({ label: "行", value: String(s.lines), tint: "violet", copy: true }),
          ],
        }),
        ui.section({
          title: "摘要 · SUMMARY",
          children: [
            ui.result({
              text: text === "" ? "" : `${s.characters} 字符 · ${s.words} 词 · ${s.lines} 行`,
              copy: true,
              empty: "读数会实时出现在这里",
            }),
          ],
        }),
      ],
    });
  },
});
