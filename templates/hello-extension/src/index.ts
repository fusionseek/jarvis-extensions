/**
 * 字数统计 —— 脚手架示例（SDK 2）。
 *
 * 入驻两个域：
 * - 工具箱：面板里那一页，段 → 段 → 段，每段一个标题行，与内置工具同一套结构；
 * - 指令：`/count <文字>`（也认 `/字数`），在全局搜索与速记里都能打。落点是 `toolbox`：
 *   宿主先把面板展开到这一页，再调 `count`，处理函数只需要把文字放进状态。
 *
 * 它刻意什么能力都不申请：证明一个纯函数工具只靠节点树与自己的状态就能成立。
 * `storage` 是隐式能力，不进授权屏。
 */
import { defineExtension, jarvis, ui, type CommandContext } from "@fusionseek/jarvis-extension-sdk";

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

function remember(value: string): void {
  text = value;
  void (value === "" ? jarvis.storage.delete("text") : jarvis.storage.set("text", value));
}

/**
 * `/count <文字>`：把 `/` 后面那段放进输入框。没带文字就保留上次的输入——
 * 只敲 `/count` 回车的人要的是"打开字数统计"，不是"清空它"。
 */
function count(context: CommandContext): void {
  if (context.argument) remember(context.argument);
}

defineExtension({
  toolbox: {
    async activate() {
      // 跨越换一个扩展再回来记住上次的文本：前台会话只有一个，换走时 JS 上下文就销毁了。
      // 命令先于 activate 改过 `text` 时不要覆盖它。
      if (text === "") text = (await jarvis.storage.get<string>("text")) ?? "";
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
                onPress: () => remember(""),
              },
            ],
            children: [
              ui.editor({
                key: "input",
                value: text,
                rows: 4,
                maxRows: 10,
                placeholder: "粘一段文字进来，或在全局搜索里打 /count …",
                label: "要统计的文本",
                onChange: remember,
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
  },
  commands: { count },
});
