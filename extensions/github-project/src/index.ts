/**
 * GitHub 项目（`github-project`）—— 一个没有界面的服务扩展。
 *
 * 它实现宿主开放的 `project.engine` 扩展点：Jarvis「项目」（需求 / 迭代 / 缺陷的原生表格与甘特、映射配置、
 * 工作流约束、漂移守卫）是宿主的框架，GitHub Projects v2 的全部专属知识——GraphQL、字段类型翻译、
 * Issue Type / 子 Issue / blocked by 的读写——在这里。
 *
 * 读写都经宿主的 Git 服务（`jarvis.git.hosting.*`）：token 留在 Jarvis 的钥匙串里，扩展只交 GraphQL、拿 JSON；
 * 变更只能是 manifest `git.mutations` 里逐字写着的那几种。
 */
import { defineExtension } from "@fusionseek/jarvis-extension-sdk";
import { githubProjectEngine } from "./engine.js";

defineExtension({
  services: {
    github: githubProjectEngine,
  },
});
