/**
 * 字节数怎么写：移植自宿主 `JunkCleanSizeFormat.panel`，报告说明里那句「Mole 自己统计的总数为 …」用它。
 *
 * 必须与宿主面板上的读数**同一套写法**：同一份报告里，说明写「2.90 GB」而结果页写「2.9 GB」，
 * 人会以为是两个数。
 */

/** 十进制单位：与 Finder 的「磁盘上的大小」同一套（1 KB = 1000 B），也与 Mole 自己的输出一致，用户拿去对照时数字对得上。 */
const units = ["B", "KB", "MB", "GB", "TB"] as const;

/**
 * 面板里的读数：保留两位有效小数，例如 `1.24 GB`、`312 MB`、`0 B`。
 * @param bytes 字节数；负数当 0。
 * @returns 读数。
 */
export function panelSize(bytes: number): string {
  const total = Math.max(0, bytes);
  if (total < 1000) return `${total} B`;
  let value = total;
  let unit = 0;
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000;
    unit += 1;
  }
  // 四舍五入会进位到下一档时先升单位：999.7 MB 写成 1.00 GB，不写 1000 MB。
  if (value >= 999.5 && unit < units.length - 1) {
    value /= 1000;
    unit += 1;
  }
  if (value < 9.995) return `${value.toFixed(2)} ${units[unit]}`;
  if (value < 99.95) return `${value.toFixed(1)} ${units[unit]}`;
  return `${value.toFixed(0)} ${units[unit]}`;
}
