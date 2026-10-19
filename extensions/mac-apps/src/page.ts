/**
 * 工具箱那一页 = 全局搜索里应用的显示设置（仓库主人：「工具箱中打开是针对全局搜索这块的一些显示设置」）。
 *
 * 三段：「全局搜索」——搜索结果里出不出应用、出几条、要不要系统应用；「应用视图」——输入 `app ` 之后那张网格怎么分组、组里怎么排；
 * 「预览」——按这套设置分出来的每一组与个数，与全局搜索里看到的是同一份（`model.preview` 与服务交回的目录同一条路）。
 * 网格、长按删除、在访达中显示都在 Jarvis 的全局搜索里，这一页只管设置。
 */
import { ui, type UINode } from "@fusionseek/jarvis-extension-sdk";
import { groupModes, groupTitles, preview, searchLimits, sortModes, sortTitles, type GroupMode, type SortMode } from "./model.js";
import type { Session } from "./session.js";

function searchSection(session: Session): UINode {
  const { settings } = session;
  return ui.section({
    key: "search",
    title: "全局搜索 · SEARCH",
    children: [
      ui.toggle({
        key: "show",
        title: "搜索结果里显示应用",
        subtitle: "普通打字时排在指令之后、最近打开之前",
        value: settings.showInSearch,
        onChange: (value) => void session.change({ showInSearch: value }),
      }),
      ui.segmented({
        key: "limit",
        label: "至多几条",
        layout: "full",
        value: String(settings.searchLimit),
        disabled: !settings.showInSearch,
        options: searchLimits.map((limit) => ({ value: String(limit), title: `${limit} 条` })),
        onChange: (value) => void session.change({ searchLimit: Number(value) }),
      }),
      ui.toggle({
        key: "system",
        title: "显示系统应用",
        subtitle: "计算器、终端这类 /System 下自带的应用；关掉后搜索与网格里都不出",
        value: settings.includeSystem,
        onChange: (value) => void session.change({ includeSystem: value }),
      }),
    ],
  });
}

function viewSection(session: Session): UINode {
  const { settings } = session;
  return ui.section({
    key: "view",
    title: "应用视图 · APP VIEW",
    children: [
      ui.segmented({
        key: "group",
        label: "分组",
        layout: "full",
        value: settings.group,
        options: groupModes.map((mode) => ({ value: mode, title: groupTitles[mode] })),
        onChange: (value) => void session.change({ group: value as GroupMode }),
      }),
      ui.segmented({
        key: "sort",
        label: "排序",
        layout: "full",
        value: settings.sort,
        options: sortModes.map((mode) => ({ value: mode, title: sortTitles[mode] })),
        onChange: (value) => void session.change({ sort: value as SortMode }),
      }),
      ui.text({
        key: "how",
        style: "footnote",
        text: "在全局搜索（⌥Space）里输入 app 空格进应用视图，接着打字就在网格里筛；按住图标进编辑态移到废纸篓，右键在访达中显示。改动下一次唤出生效。",
      }),
    ],
  });
}

function previewSection(session: Session): UINode {
  if (!session.canRead) {
    return ui.empty({
      key: "denied",
      symbol: "lock",
      title: "没有读取本机应用的授权",
      hint: "全局搜索要先知道这台 Mac 装了哪些应用；打开、删除应用仍由你在全局搜索里点。",
      action: { id: "grant", title: "授权", onPress: () => void session.requestAccess() },
    });
  }
  if (session.error) {
    return ui.note({ key: "error", tint: "alert", symbol: "exclamationmark.triangle", title: "读不出本机应用", body: session.error,
      actions: [{ id: "retry", title: "重读", onPress: () => void session.refresh() }] });
  }
  if (session.apps === null) {
    return ui.text({ key: "loading", style: "footnote", text: "正在读本机应用" });
  }
  const groups = preview(session.apps, session.settings);
  const total = groups.reduce((sum, group) => sum + group.count, 0);
  return ui.section({
    key: "preview",
    title: "预览 · PREVIEW",
    trailing: `${total} 个应用 · ${groups.length} 组`,
    actions: [{ id: "refresh", title: "重读", symbol: "arrow.clockwise", help: "重读本机应用", onPress: () => void session.refresh() }],
    children: [
      ui.list({
        key: "groups",
        emptyState: ui.empty({ key: "none", symbol: "square.grid.3x3", title: "没有可显示的应用" }),
        children: groups.map((group) =>
          ui.row({ key: group.id, symbol: "square.grid.2x2", title: `${group.title}  ${group.count}`, subtitle: group.sample }),
        ),
      }),
    ],
  });
}

/**
 * 整页。
 * @param session 状态。
 * @returns 根节点。
 */
export function renderPage(session: Session): UINode {
  return ui.scroll({ children: [searchSection(session), viewSection(session), previewSection(session)] });
}
