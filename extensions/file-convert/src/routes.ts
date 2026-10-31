/**
 * 路线规划（照 Filee 的 `RoutePlanner`：在「格式 → 格式」的边上做 Dijkstra）。
 *
 * 一步到不了的自动拆成两步：DOC → Markdown = textutil 到 HTML，再 pandoc。至多两步——三步以上的路线中间产物多、出错的地方多，
 * 也说明这一对格式本来就不该互转（Filee 也只给少数格式开多步）。边的代价见 `Conversion.cost`，每多一步再加 0.5。
 */
import type { Conversion, ToolName } from "./engines.js";
import { mediaConversions } from "./media.js";
import { officeConversions } from "./office.js";
import { textConversions } from "./text.js";

/** 全部的边（媒体、文本、办公三个模块各自的）。 */
export const conversions: Conversion[] = [...mediaConversions, ...textConversions, ...officeConversions];

/** 一条路线的一步。 */
export interface Step {
  conversion: Conversion;
  /** 这一步的源格式与目标格式。 */
  from: string;
  to: string;
}

/** 最多几步。 */
export const maximumSteps = 2;
/** 每多一步加的代价。 */
const stepPenalty = 0.5;

/**
 * 从一种格式到另一种的最便宜路线。
 * @param from 源格式 id。
 * @param to 目标格式 id。
 * @param available 此刻找得到的工具。
 * @param edges 边（测试注入）。
 * @returns 一步或两步；到不了（或同一种格式）为 `undefined`。
 */
export function plan(from: string, to: string, available: Set<ToolName>, edges: Conversion[] = conversions): Step[] | undefined {
  if (from === to) return undefined;
  const usable = edges.filter((edge) => available.has(edge.tool));
  // 至多两步、格式几十种：直接枚举「一步」与「两步」比写一个通用的优先队列更好读，结果与 Dijkstra 相同。
  let best: { cost: number; steps: Step[] } | undefined;
  for (const first of usable) {
    if (!first.from.includes(from)) continue;
    if (first.to === to) {
      const cost = first.cost;
      if (!best || cost < best.cost) best = { cost, steps: [{ conversion: first, from, to }] };
      continue;
    }
    if (maximumSteps < 2) continue;
    for (const second of usable) {
      if (second.to !== to || !second.from.includes(first.to)) continue;
      const cost = first.cost + second.cost + stepPenalty;
      if (!best || cost < best.cost) {
        best = { cost, steps: [{ conversion: first, from, to: first.to }, { conversion: second, from: first.to, to }] };
      }
    }
  }
  return best?.steps;
}

/**
 * 一个目标格式此刻能从哪些源格式转过来（`describe` 里那个动作认哪些扩展名）。
 * @param to 目标格式 id。
 * @param available 此刻找得到的工具。
 * @param sources 候选的源格式 id。
 * @param edges 边（测试注入）。
 * @returns 能到的源格式 id。
 */
export function reachableSources(to: string, available: Set<ToolName>, sources: string[], edges: Conversion[] = conversions): string[] {
  return sources.filter((from) => plan(from, to, available, edges) !== undefined);
}

/** 一条路线要用到的工具（`describe` 不跑工具，`run` 之前看一眼它们都还在）。 */
export function toolsOf(steps: Step[]): ToolName[] {
  return [...new Set(steps.map((step) => step.conversion.tool))];
}
