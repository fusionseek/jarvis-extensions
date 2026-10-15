/**
 * `describe`：此刻能不能用、能做哪些事。宿主在装上、启用、授权变化之后都会问，给 15 秒——
 * 因此只问一次 token 的身份（`git.hosting.viewer`），不读任何 Project。**从不抛错**：用不了写进 `ready: false`。
 */
import type { ProjectEngineDescription, ProjectEngineFeature, ServiceContext } from "@fusionseek/jarvis-extension-sdk";
import { jarvis, projectEngineContractVersion } from "@fusionseek/jarvis-extension-sdk";
import { messageOf } from "./graphql.js";
import { clamp, hosting, maxLength } from "./limits.js";

/**
 * GitHub Projects v2 原生就有的五样：子 Issue、blocked by、组织的 Issue Type、在 Project 里建字段与选项、草稿条目。
 * 写成常量：这是 GitHub 的能力，不随 token 变——token 不够时是 `ready` 与说明的事，不是能力表的事。
 */
export const features: ProjectEngineFeature[] = ["nativeHierarchy", "nativeDependencies", "issueTypes", "createFields", "draftIssues"];

/** 缺 Projects 权限时那一句（宿主原样显示在「项目」的说明卡上）。 */
export const missingScopeProblem = "token 缺少 project 权限（只读需 read:project）";

/**
 * 描述引擎。
 * @param context 宿主带来的授权与偏好。
 * @returns 描述。
 */
export async function describe(context: ServiceContext): Promise<ProjectEngineDescription> {
  const base = { contractVersion: projectEngineContractVersion, hosting, features };
  const unavailable = (summary: string, problem: string): ProjectEngineDescription => ({
    ...base,
    ready: false,
    summary: clamp(summary, maxLength.summary),
    problem: clamp(problem, maxLength.summary),
  });

  if (!context.granted.includes("git.hosting.read")) {
    return unavailable("还没有授权读取 GitHub", "没有「读取 Git 服务数据」授权：到 设置 · 扩展 · GitHub 项目 里打开它");
  }
  let viewer;
  try {
    viewer = await jarvis.git.hosting.viewer({ hosting });
  } catch (error) {
    // 服务总开关关着、还没添加 GitHub、缺 token、gh 没装：宿主的原话已经说清了去哪修。
    return unavailable("连不上 GitHub", messageOf(error));
  }
  const who = viewer.login ? `GitHub · ${viewer.login}` : "GitHub";
  if (viewer.projectAccess === "none") return unavailable(`已接上 ${who}，但 token 读不了 Project`, missingScopeProblem);

  const limits: string[] = [];
  if (viewer.projectAccess === "readOnly") limits.push("token 只有 read:project，只能读");
  if (viewer.projectAccess === "unknown") limits.push("fine-grained token 看不出 Projects 权限，读写时才知道");
  if (!context.granted.includes("git.hosting.write")) limits.push("没有授权修改，只读浏览");
  const summary = limits.length ? `已接上 ${who}（${limits.join("；")}）` : `已接上 ${who}`;
  return { ...base, ready: true, summary: clamp(summary, maxLength.summary) };
}
