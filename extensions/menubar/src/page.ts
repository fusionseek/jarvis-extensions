/**
 * 工具箱那一页（400×520）：三段里各有哪些图标、哪些被刘海挡住、怎么分段。
 *
 * 页面跑在前台会话，收放的状态在后台会话：这一页不存状态，从菜单栏上自己那枚边界有多宽读出「此刻收没收着」，
 * 按钮经 `jarvis.commands.run("toggle")` 交给后台。打开这一页时读一次清单、订「有哪些项」的变化，离开就退订。
 */
import { jarvis, ui, type ActivationContext, type FileHandle, type MenuBarExtra, type ScreenInfo, type UINode, type Unsubscribe } from "@fusionseek/jarvis-extension-sdk";
import { classify, displayName, type Layout } from "./model.js";

type Status = { kind: "loading" } | { kind: "denied" } | { kind: "noAccessibility" } | { kind: "ready"; layout: Layout } | { kind: "failed"; message: string };

export class PageSession {
  status: Status = { kind: "loading" };
  private granted: string[] = [];
  private stopObserving: Unsubscribe | undefined;
  private screens: ScreenInfo[] = [];
  private refreshing: Promise<void> | undefined;
  /** 截到的图（1.1）：打开这一页时截一次；露着的当场截，藏着的是最近一次露着时的。 */
  private images = new Map<string, FileHandle>();

  /**
   * 页面出现了。
   * @param context 此刻的授权。
   */
  async activate(context: Pick<ActivationContext, "granted">): Promise<void> {
    this.granted = context.granted;
    await this.refresh();
    await this.captureImages();
    if (this.granted.includes("menuBarExtras.read")) {
      // 订阅推来的变化不经过任何界面事件：重读完要自己请宿主重画。
      this.stopObserving ??= jarvis.menuBarExtras.observe(() => void this.refresh().then(() => jarvis.ui.update()));
    }
  }

  /** 这一颗画哪张图：截到的，没有就用应用图标。 */
  image(item: MenuBarExtra): FileHandle | undefined {
    return this.images.get(item.id) ?? item.icon;
  }

  /** 截一次（没给截图授权、或 Jarvis 没有屏幕录制权限时就用应用图标）。 */
  private async captureImages(): Promise<void> {
    if (this.status.kind !== "ready" || !this.granted.includes("menuBarExtras.capture")) return;
    const { shown, hidden, always } = this.status.layout;
    const ids = [...always, ...hidden, ...shown].map((item) => item.id).slice(0, 40);
    if (ids.length === 0) return;
    const captures = await jarvis.menuBarExtras.capture(ids).catch(() => []);
    for (const capture of captures) if (capture.image) this.images.set(capture.id, capture.image);
  }

  /** 页面不在了：退订（订阅留着，宿主就会每 10 s 看一眼窗口列表）。 */
  deactivate(): void {
    this.stopObserving?.();
    this.stopObserving = undefined;
  }

  /** 重读一次（并发的合成一次）。 */
  refresh(): Promise<void> {
    this.refreshing ??= this.load().finally(() => (this.refreshing = undefined));
    return this.refreshing;
  }

  private async load(): Promise<void> {
    if (!this.granted.includes("menuBarExtras.read")) {
      this.status = { kind: "denied" };
      return;
    }
    try {
      const [items, screens] = await Promise.all([jarvis.menuBarExtras.list(), jarvis.screens.list()]);
      this.screens = screens;
      this.status = { kind: "ready", layout: classify(items, this.screens) };
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code === "permission.unavailable") this.status = { kind: "noAccessibility" };
      else if (code === "permission.denied") this.status = { kind: "denied" };
      else this.status = { kind: "failed", message: error instanceof Error ? error.message : String(error) };
    }
  }

  /** 收放：交给后台会话（状态在那里）；稍后清单变了，这一页跟着重画。 */
  async toggle(): Promise<void> {
    await jarvis.commands.run("toggle");
    setTimeout(() => void this.refresh(), 400);
  }

  /** 再问一次授权（只在按钮回调里调）。 */
  async requestAccess(): Promise<void> {
    const result = await jarvis.permissions.request(["menuBarExtras.read", "menuBar.pointer", "menuBarExtras.capture", "menuBarExtras.control"]);
    await this.activate({ granted: result.granted });
  }
}

type ImageOf = (item: MenuBarExtra) => FileHandle | undefined;

function rows(items: MenuBarExtra[], keyPrefix: string, subtitle: (item: MenuBarExtra) => string | undefined, image: ImageOf): UINode[] {
  return items.map((item) =>
    ui.row({
      key: `${keyPrefix}:${item.id}`,
      symbol: "app.dashed",
      image: image(item),
      title: displayName(item),
      subtitle: subtitle(item),
      accessory: "none",
    }),
  );
}

function section(
  key: string,
  title: string,
  items: MenuBarExtra[],
  empty: string,
  subtitle: (item: MenuBarExtra) => string | undefined,
  image: ImageOf,
): UINode {
  return ui.section({
    key,
    title,
    trailing: `${items.length} 颗`,
    children: items.length > 0 ? rows(items, key, subtitle, image) : [ui.text({ key: `${key}:empty`, style: "footnote", text: empty })],
  });
}

/**
 * 画一页。
 * @param session 页面状态。
 * @returns 节点树。
 */
export function renderPage(session: PageSession): UINode {
  const status = session.status;
  switch (status.kind) {
    case "loading":
      return ui.empty({ key: "loading", symbol: "menubar.rectangle", title: "正在读菜单栏", hint: "第一次要问一遍各个应用，约一两秒" });
    case "denied":
      return ui.empty({
        key: "denied",
        symbol: "lock",
        title: "还没允许读菜单栏",
        hint: "收起与显示不需要授权，照常能用；要列出每一段里有哪些图标，得允许「读取菜单栏上有哪些图标」",
        action: { id: "grant", title: "允许", onPress: () => void session.requestAccess() },
      });
    case "noAccessibility":
      return ui.empty({
        key: "ax",
        symbol: "hand.raised",
        title: "Jarvis 还没有辅助功能权限",
        hint: "macOS 26 起，菜单栏图标属于哪个应用只能经辅助功能认出来。收起与显示不受影响",
        action: { id: "open-ax", title: "打开系统设置", onPress: () => void jarvis.permissions.openSystemSettings("accessibility") },
      });
    case "failed":
      return ui.empty({ key: "failed", symbol: "exclamationmark.triangle", title: "没读出来", hint: status.message });
    case "ready":
      return ready(session, status.layout);
  }
}

function ready(session: PageSession, layout: Layout): UINode {
  const image: ImageOf = (item) => session.image(item);
  const hiddenCount = layout.hidden.length + layout.always.length;
  const children: UINode[] = [
    ui.row({
      key: "state",
      symbol: layout.collapsed ? "chevron.left" : "chevron.right",
      title: layout.collapsed ? `已收起 ${hiddenCount} 颗` : "隐藏的图标正露着",
      subtitle: layout.hasDivider ? "点菜单栏上的「‹」也一样" : "菜单栏上还没有分隔竖线：打开「在菜单栏显示」",
      actions: [{
        id: "toggle",
        title: layout.collapsed ? "显示" : "收起",
        symbol: layout.collapsed ? "eye" : "eye.slash",
        help: layout.collapsed ? "显示隐藏的图标" : "收起",
        onPress: () => void session.toggle(),
      }],
      accessory: "none",
    }),
  ];
  if (layout.notched.length > 0) {
    children.push(section("notch", "被刘海挡住", layout.notched, "", () => "在显示段里，但落在刘海下面看不见：拖到竖线左边收起，或者少放几颗", image));
  }
  children.push(
    section("shown", "显示", layout.shown.filter((item) => !layout.notched.includes(item)), "竖线右边的图标一直显示", (item) => item.title || undefined, image),
    section("hidden", "隐藏", layout.hidden, "按住 ⌘ 把图标拖到竖线左边，收起时它就藏起来", (item) => item.title || undefined, image),
  );
  if (layout.always.length > 0) {
    children.push(section("always", "永远隐藏", layout.always, "", (item) => item.title || "⌥ 点「‹」时才出来", image));
  }
  children.push(
    ui.text({
      key: "how",
      style: "footnote",
      text: "分段靠两条竖线：按住 ⌘ 拖动图标越过竖线就换了段。最左边那条是「永远隐藏」，只有 ⌥ 点「‹」才露出来。菜单栏没变时 Jarvis 不读它，空闲不占 CPU。",
    }),
  );
  return ui.scroll({ key: "page", children: [ui.stack({ key: "content", children })] });
}
