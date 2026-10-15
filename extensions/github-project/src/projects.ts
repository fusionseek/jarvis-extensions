/**
 * `listProjects` 与 `readSchema`：有哪些 Project、一个 Project 有哪些字段。
 */
import type {
  CancelSignal,
  ProjectFieldOption,
  ProjectList,
  ProjectListRequest,
  ProjectSchema,
  ProjectSchemaRequest,
} from "@fusionseek/jarvis-extension-sdk";
import { listOwnerProjects, listRepositoryProjects, listViewerProjects, organizationIssueTypes, readSchema as readSchemaDocument } from "./documents.js";
import { GitHubError, query, throwIfCancelled } from "./graphql.js";
import type { Raw } from "./mapping.js";
import { mapField, mapOptions, mapProjectSummary } from "./mapping.js";
import { fieldsPerProject } from "./limits.js";

type Connection = { nodes?: Raw[] | null } | null | undefined;

function summaries(connection: Connection): ProjectList {
  const projects = (connection?.nodes ?? []).map(mapProjectSummary).filter((entry) => entry !== null);
  return { projects: projects.slice(0, 200) };
}

/**
 * 拆 `owner/name`。
 * @param repository `owner/name`。
 * @returns 两段；形状不对时抛错。
 */
export function splitRepository(repository: string): { owner: string; name: string } {
  const match = /^([^/\s]+)\/([^/\s]+)$/.exec(repository);
  if (!match) throw new Error(`仓库要写成 owner/name，收到的是「${repository}」`);
  return { owner: match[1]!, name: match[2]! };
}

/**
 * 列 Project：带 `repository` = 这个仓库关联的；带 `owner` = 这个账号或组织的；都不带 = token 自己的。
 * @param request 入参。
 * @param signal 取消信号。
 * @returns Project 概要，按最近更新排。
 */
export async function listProjects(request: ProjectListRequest, signal?: CancelSignal): Promise<ProjectList> {
  throwIfCancelled(signal);
  if (request.repository) {
    const { owner, name } = splitRepository(request.repository);
    const { data } = await query<{ repository: { projectsV2: Connection } | null }>(
      listRepositoryProjects,
      { owner, name },
      "读仓库关联的 Project",
    );
    if (!data.repository) throw new GitHubError(`找不到仓库 ${request.repository}（或 token 看不到它）`, []);
    return summaries(data.repository.projectsV2);
  }
  if (request.owner) {
    const { data } = await query<{ repositoryOwner: { projectsV2?: Connection } | null }>(
      listOwnerProjects,
      { owner: request.owner },
      "读账号的 Project",
    );
    if (!data.repositoryOwner) throw new GitHubError(`找不到 GitHub 账号或组织「${request.owner}」`, []);
    return summaries(data.repositoryOwner.projectsV2);
  }
  const { data } = await query<{ viewer: { projectsV2: Connection } | null }>(listViewerProjects, {}, "读你的 Project");
  return summaries(data.viewer?.projectsV2);
}

interface SchemaNode {
  __typename?: string;
  owner?: { __typename?: string; login?: string } | null;
  fields?: { nodes?: Raw[] | null } | null;
  [key: string]: unknown;
}

/**
 * 读一个组织的 Issue Type（启用着的）。读不到（用户名下、没开 Issue Type、没权限）时给空数组，不报错：
 * Issue Type 字段没有选项只是不能映射，不该让整份字段结构读不出来。
 * @param login 组织登录名。
 * @returns 选项。
 */
export async function readIssueTypes(login: string): Promise<ProjectFieldOption[]> {
  try {
    const { data } = await query<{ organization: { issueTypes: { nodes?: Raw[] | null } | null } | null }>(
      organizationIssueTypes,
      { login },
      "读组织的 Issue Type",
    );
    const nodes = (data.organization?.issueTypes?.nodes ?? []).filter((node) => node?.["isEnabled"] !== false);
    return mapOptions(nodes);
  } catch {
    return [];
  }
}

/**
 * 读一个 Project 的概要与字段结构。Issue Type 字段的选项来自 Project 所属组织的 Issue Type。
 * @param request 入参。
 * @param signal 取消信号。
 * @returns 字段结构（≤ 100 个字段）。
 */
export async function readSchema(request: ProjectSchemaRequest, signal?: CancelSignal): Promise<ProjectSchema> {
  if (!request.projectId) throw new Error("缺少 projectId");
  throwIfCancelled(signal);
  const { data } = await query<{ node: SchemaNode | null }>(readSchemaDocument, { id: request.projectId }, "读字段结构");
  const node = data.node;
  if (!node) throw new GitHubError("找不到这个 Project（或 token 看不到它）", []);
  if (node.__typename !== "ProjectV2") throw new GitHubError(`「${request.projectId}」不是一个 Project`, []);
  const project = mapProjectSummary(node);
  if (!project) throw new GitHubError("这个 Project 的概要读不出来", []);

  const rawFields = (node.fields?.nodes ?? []).slice(0, fieldsPerProject);
  let issueTypes: ProjectFieldOption[] | undefined;
  const ownerIsOrganization = node.owner?.__typename === "Organization" && Boolean(node.owner.login);
  if (ownerIsOrganization && rawFields.some((field) => field?.["dataType"] === "ISSUE_TYPE")) {
    throwIfCancelled(signal);
    issueTypes = await readIssueTypes(node.owner!.login!);
  }
  const fields = rawFields.map((field) => mapField(field, issueTypes)).filter((field) => field !== null);
  return { project, fields };
}
