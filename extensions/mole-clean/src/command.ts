/**
 * `mo` 命令的偏好、定位结论的说法与版本号解析（移植自宿主 `JunkCleanPreferences.moleCommand`、
 * `JunkCleanEngineFactory.describe` 与 `MoleVersionProbe.parse`）。纯函数，单测直接调。
 */
import type { ExecutableLocation } from "@fusionseek/jarvis-extension-sdk";

/** 默认命令：`mo`，由宿主在 Homebrew、`~/.local/bin`、`~/bin` 与 Nix 的固定位置里找。 */
export const defaultCommand = "mo";

/** 用不了的三种原因（`process.locate` 找不到时）。 */
export type LocateProblem = Extract<ExecutableLocation, { path: null }>["problem"];

/**
 * 用户填的 `mo` 命令：命令名（`mo`）或路径。没填、填了空白或不是字符串时是默认值。
 * @param preferences 宿主带来的偏好。
 * @returns 去掉首尾空白的命令。
 */
export function commandPreference(preferences: Record<string, unknown>): string {
  const raw = preferences.command;
  const trimmed = typeof raw === "string" ? raw.trim() : "";
  return trimmed || defaultCommand;
}

/**
 * 找不到时给用户的那句话。三种原因的出路不一样：没装就装一个，填错就去设置里改——
 * 所以写清是哪一种，**不悄悄回落到自动探测**（用户明确指定的那一份被换掉、屏幕上却一切正常，是最难查的一种错）。
 * @param problem `process.locate` 给的原因。
 * @param command 用户填的命令（原样写进句子里，让人认得出是自己填的那一串）。
 * @returns 一句话。
 */
export function describeProblem(problem: LocateProblem, command: string): string {
  switch (problem) {
    case "notFound":
      return `没有找到 ${command} 命令`;
    case "missing":
      return `填的路径 ${command} 不存在`;
    case "notExecutable":
      return `${command} 不是可执行文件`;
  }
}

/**
 * 从 `mo --version` 的输出里取版本号（`Mole version 1.59.1` → `1.59.1`）。
 * @param lines 输出各行。
 * @returns 版本号；没有那一行时为 `null`。
 */
export function parseVersion(lines: string[]): string | null {
  for (const line of lines) {
    const match = /Mole version (\S+)/.exec(line);
    if (match) return match[1]!;
  }
  return null;
}
