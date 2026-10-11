/**
 * 宿主线缆的上限：jarvis-mac `contracts/schemas/extensions/bridge.v2.schema.json` 里
 * `junkCleanStatus / Progress / Section / Report / ActionResult` 写死的那几个数。
 *
 * 宿主按 schema 严格校验，超一个字符**整份**结果就被拒——用户看到的会是「清理失败」，
 * 而不是一份少了几个字的报告。所以在交出去之前自己剪好；剪掉的条目写明「另有 N 项」，不悄悄丢。
 */
export const limits = {
  /** `junkCleanStatus.summary` / `problem`。 */
  statusText: 200,
  /** `junkCleanActionResult.message`。 */
  actionMessage: 200,
  /** `junkCleanProgress.sectionTitle`、`junkCleanSection.id / title`。 */
  sectionTitle: 80,
  /** `junkCleanProgress.currentItem`。 */
  currentItem: 1024,
  /** `junkCleanReport.sections`。Mole 自己只有十几个区段，这条只防一个失控的输出。 */
  sections: 64,
  /** `junkCleanSection.failures` / `notes` 的条数。 */
  sectionList: 8,
  /** `junkCleanReport.notes` 的条数。 */
  reportNotes: 12,
  /** 报告里每一条字符串（失败、说明、整次失败）。 */
  text: 400,
} as const;

/**
 * 按 UTF-16 码元剪一段文字，末尾补「…」。
 *
 * 按码元而不是按字符数：宿主那边不论按码元、码位还是字形簇数，码元数都是最大的那个，
 * 按它剪三种数法都过。剪在代理对中间会留下半个字符（线缆上是一个非法的 `\ud8xx`），所以退一位。
 * @param text 原文。
 * @param max 上限（含「…」）。
 * @returns 不超过 `max` 个码元的文字；没超时原样返回。
 */
export function clampText(text: string, max: number): string {
  if (text.length <= max) return text;
  let cut = text.slice(0, max - 1);
  if (/[\uD800-\uDBFF]$/.test(cut)) cut = cut.slice(0, -1);
  return `${cut}…`;
}

/**
 * 剪一条路径：留**尾巴**、开头补「…」。路径最有信息量的是最后几段（哪个缓存、哪个文件），不是 `/Users/…`。
 * @param path 绝对路径。
 * @param max 上限（含「…」）。
 * @returns 不超过 `max` 个码元的路径；没超时原样返回。
 */
export function clampPath(path: string, max: number): string {
  if (path.length <= max) return path;
  let cut = path.slice(path.length - (max - 1));
  if (/^[\uDC00-\uDFFF]/.test(cut)) cut = cut.slice(1);
  return `…${cut}`;
}

/**
 * 剪一个列表：超出时留前 `max - 1` 条，最后一条写「还有多少条没列出来」。
 * @param items 条目（每条已经剪过长度）。
 * @param max 上限条数。
 * @param overflow 由被省略的条数生成最后那一条。
 * @returns 不超过 `max` 条的列表。
 */
export function clampList(items: string[], max: number, overflow: (hidden: number) => string): string[] {
  if (items.length <= max) return items;
  const kept = items.slice(0, max - 1);
  return [...kept, clampText(overflow(items.length - kept.length), limits.text)];
}
