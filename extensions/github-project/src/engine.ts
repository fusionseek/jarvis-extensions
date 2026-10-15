/**
 * GitHub Projects v2 的项目引擎（`project.engine`）。每个方法一个模块；这里只把它们接到契约上。
 */
import type { ProjectEngine } from "@fusionseek/jarvis-extension-sdk";
import { describe } from "./describe.js";
import { applyEdit } from "./edit.js";
import { createField, createOption } from "./fields.js";
import { readItems } from "./items.js";
import { listProjects, readSchema } from "./projects.js";

/** 引擎实现。宿主的规则（映射、工作流、漂移守卫）都不在这里：引擎只读写 GitHub。 */
export const githubProjectEngine: ProjectEngine = {
  describe: (context) => describe(context),
  listProjects: (request, _context, signal) => listProjects(request, signal),
  readSchema: (request, _context, signal) => readSchema(request, signal),
  readItems: (request, _context, signal) => readItems(request, signal),
  applyEdit: (request, _context, signal) => applyEdit(request, signal),
  createField: (request, _context, signal) => createField(request, signal),
  createOption: (request, _context, signal) => createOption(request, signal),
};
