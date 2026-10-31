/**
 * 读进度：ffmpeg 的 `-progress pipe:1`（每秒几行 `key=value`）与 avconvert 的 `--progress`（`avconvert progress:  37.50% complete`，
 * 用回车隔开——宿主逐行推的时候回车也算一行的结尾）。都读不到时这一项开始 0、做完 1。
 */

/**
 * ffmpeg 的一行进度 → 0…1。
 * @param line 一行（`out_time_us=1500000`、`progress=end`……）。
 * @param duration 总时长（秒，ffprobe 读的）；不知道时只认 `progress=end`。
 * @returns 比例；这一行不是进度为 `undefined`。
 */
export function ffmpegFraction(line: string, duration: number | undefined): number | undefined {
  const trimmed = line.trim();
  if (trimmed === "progress=end") return 1;
  if (!duration || duration <= 0) return undefined;
  const match = /^out_time_(us|ms)=(\d+)$/.exec(trimmed);
  if (!match) return undefined;
  // ffmpeg 的 out_time_ms 其实也是微秒（历史原因），两个键同一个单位。
  const seconds = Number(match[2]) / 1_000_000;
  return Math.min(Math.max(seconds / duration, 0), 0.99);
}

/**
 * avconvert 的一行进度 → 0…1。
 * @param line 一行。
 * @returns 比例；这一行不是进度为 `undefined`。
 */
export function avconvertFraction(line: string): number | undefined {
  const match = /avconvert progress:\s*([\d.]+)%/.exec(line);
  if (!match) return undefined;
  const value = Number(match[1]);
  return Number.isFinite(value) ? Math.min(Math.max(value / 100, 0), 1) : undefined;
}

/**
 * ffprobe 读出来的时长（`format=duration` 的那一行）→ 秒。
 * @param output 整份输出。
 * @returns 秒；读不出为 `undefined`。
 */
export function parseDuration(output: string): number | undefined {
  const value = Number(output.trim().split("\n")[0]);
  return Number.isFinite(value) && value > 0 ? value : undefined;
}
