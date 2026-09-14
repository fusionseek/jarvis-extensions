/**
 * 词典卡：一个词译出来之后，译文下面那几行音标与词性词义。
 *
 * **它是结果卡的一部分，不是独立一段。** 用户截到的是一个词，他要的是"这个词是什么意思"，
 * 而一个孤零零的「成立」回答不了——`found` 还有创建、创立、缔造、勘查十几个义项，
 * 只给排第一的那个等于替他做了选择。Easydict 的 Google 卡片给的就是这一块
 * （见 `README.md` 的「与 Easydict 的差距」），这里把它补上。
 *
 * 数据全部来自 `google.ts` 的 `Translation.dictionary`：Google 判定原文是一个词时才有，
 * 整句一律 `null`，因此**这里不需要再判一次"这算不算一个词"**——判据只有一个，在那边。
 *
 * 弹窗与页面画的是同一份（`popover.ts` / `page.ts` 各调一次），因为它们回答的是同一个问题。
 */
import { ui, type UINode } from "@fusionseek/jarvis-extension-sdk";
import type { Dictionary, DictionarySense } from "./google.js";
import type { Session } from "./session.js";

/**
 * 词典那几行。没有词典时返回空数组——调用方直接铺进 children，不必先判一次。
 * - Parameter s: 会话。
 * - Returns: 节点数组；`[]` = 这次没有词典。
 */
export function dictionaryRows(s: Session): UINode[] {
  const dictionary = s.translation?.dictionary;
  if (!dictionary) return [];
  const rows: UINode[] = [];
  const phonetic = phoneticRow(s, dictionary);
  if (phonetic) rows.push(phonetic);
  dictionary.senses.forEach((sense, index) => rows.push(senseRow(sense, index)));
  const base = baseFormNote(s, dictionary);
  if (base) rows.push(base);
  return rows;
}

/** 词典查的是哪个词：朗读与「词条按 … 查」都指着它。 */
function headword(s: Session, dictionary: Dictionary): string {
  return dictionary.baseForm ?? s.source.trim();
}

/** 「美 /found/ … 朗读」。读音是 Google 的转写，不是 IPA——标签在 `google.ts` 里按语言定。 */
function phoneticRow(s: Session, dictionary: Dictionary): UINode | null {
  if (!dictionary.phonetic) return null;
  const word = headword(s, dictionary);
  return ui.stack({
    key: "phonetic",
    axis: "horizontal",
    spacing: "tight",
    alignment: "center",
    children: [
      ui.badge({ key: "phonetic-label", title: dictionary.phonetic.label, tint: "neutral" }),
      ui.text({ key: "phonetic-text", text: `/ ${dictionary.phonetic.text} /`, style: "mono", selectable: true }),
      ui.button({
        key: "speak-word",
        title: "朗读",
        symbol: "speaker.wave.2",
        variant: "secondary",
        size: "inline",
        // 读的是**词条**不是整段原文：截到 `founded` 时词条是 `found`，
        // 而这一枚按钮就贴在 `found` 的音标旁边，读出另一个词会读成一句自相矛盾的话。
        disabled: !s.has("speech.speak") || word === "",
        help: `朗读 ${word}`,
        onPress: () => s.speak(word, s.detected.code),
      }),
    ],
  });
}

/**
 * 一个词性一行：`v.` + 该词性下的全部词义。
 *
 * **词义一个都不省。** 省掉尾巴上那几个省下的是两行高度，而用户截一个词进来
 * 要的正是"它还能是什么意思"——被截掉的那几个恰恰是他查不到才来查的。
 * 装不下由弹窗自己滚（它本来就是 `ui.scroll`）。
 */
function senseRow(sense: DictionarySense, index: number): UINode {
  const children: UINode[] = [];
  // 词性缺失（Google 偶尔只给 `terms`）时不画一枚空徽章：一个空壳比没有更难读。
  if (sense.short !== "") {
    children.push(ui.badge({ key: `pos-${index}`, title: sense.short, tint: "accent" }));
  }
  children.push(
    ui.text({ key: `terms-${index}`, text: sense.terms.join("; "), style: "body", selectable: true }),
  );
  // 不给 alignment：默认的 top 对齐才是悬挂缩进——词义换行之后仍然缩在词性右边。
  return ui.stack({ key: `sense-${index}`, axis: "horizontal", spacing: "tight", children });
}

/**
 * 「词条按 found 查」。
 *
 * 只在词条与原文**不是同一个词**时出现（`founded` → `found`）。不说这一句的话，
 * 上面那些词性词义看起来是在讲用户截到的那个词形，而它们讲的是另一个。
 */
function baseFormNote(s: Session, dictionary: Dictionary): UINode | null {
  const base = dictionary.baseForm;
  if (!base) return null;
  const source = s.source.trim();
  // 大小写与首尾标点不算"不同一个词"：`Found!` 与 `found` 说的是同一件事，
  // 为它们多一行等于把这句提示变成噪音，而噪音会让真正需要它的那一次也被跳过。
  const normalise = (text: string): string => text.toLowerCase().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
  if (normalise(base) === normalise(source)) return null;
  return ui.text({ key: "dict-base", text: `词条按 ${base} 查`, style: "footnote" });
}
