/**
 * 版式与读数节点的构造器（jarvis-mac `specs/20261028-191224-git-push-error-proxy-dashboard-issue-links` P-2 / P-3）：侧栏、自适应网格、表格、堆叠柱、宿主画的偏好控件。
 *
 * 它们**不在 `ui` 上**：`ui` 是一个对象，加一个成员就会让每个扩展的产物都变一点，没用到它们的扩展也得为此升版本。
 * 这里一个个是没有副作用的箭头函数，没用到 `layout` 的扩展打包时整块被摇掉、产物逐字节不变。
 * 与 `ui.*` 一样：只是给对象字面量加上类型推断，不做任何运行时工作。宿主在提交时逐项校验（bridge `$defs.*NodeProps`）。
 */
import type { BarsNode, GridNode, HeaderNode, PreferenceNode, SidebarNode, TableNode } from "./ui.js";

type Props<N extends { kind: string }> = Omit<N, "kind">;

export const layout = {
  /** 侧栏导航（只许做根）。 */
  sidebar: (props: Props<SidebarNode>): SidebarNode => ({ kind: "sidebar", ...props }),
  /** 自适应网格。 */
  grid: (props: Props<GridNode>): GridNode => ({ kind: "grid", ...props }),
  /** 表格。 */
  table: (props: Props<TableNode>): TableNode => ({ kind: "table", ...props }),
  /** 堆叠柱。 */
  bars: (props: Props<BarsNode>): BarsNode => ({ kind: "bars", ...props }),
  /** 宿主画的偏好控件。 */
  preference: (props: Props<PreferenceNode>): PreferenceNode => ({ kind: "preference", ...props }),
  /** 窗口一页的页头（jarvis-mac `specs/20261029-082059-proxy-window-desktop-layout` D-2，宿主 ≥ 3.3.1）。 */
  header: (props: Props<HeaderNode>): HeaderNode => ({ kind: "header", ...props }),
} as const;
