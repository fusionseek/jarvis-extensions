/**
 * 副栏（1.1）：菜单栏下方的一条，锚在「‹」（或隐藏段那条竖线）下面，画藏起来的、被刘海挡住的图标。
 *
 * 它是一条 `popover` 命令（manifest `popoverWidth: "content"`）：宿主按这棵树的宽度给弹窗定宽，不画页头脚注
 * （jarvis-mac `specs/20261030-081832-menubar-manager-p2` N-3 / N-4）。跑在前台会话、不存状态：打开时读一次清单与截图，
 * 点一颗就把它交给后台会话的 `reveal-item`（收放的状态在那里），自己关掉。
 *
 * 图从哪来：图标藏着时截不到（R-3），宿主交回的是它最近一次露着时截到的那一张；从没截到过、或没给截图授权的，画应用图标。
 */
import { jarvis, ui, type CommandContext, type FileHandle, type MenuBarExtra, type UINode } from "@fusionseek/jarvis-extension-sdk";
import { barItems, barScope, displayName, type BarScope } from "./model.js";

type Status = { kind: "loading" } | { kind: "ready"; items: MenuBarExtra[] } | { kind: "unavailable"; message: string };

export class BarSession {
  status: Status = { kind: "loading" };
  scope: BarScope = "hidden";
  private images = new Map<string, FileHandle>();
  private granted: string[] = [];

  /** 弹窗出现了：先画「正在读」，内容等命令带着范围来了再读（命令紧跟着 activate 到）。 */
  activate(): void {
    this.status = { kind: "loading" };
  }

  /**
   * `bar` 命令：读清单、拿截图。
   * @param context 命令上下文（`argument` 是范围：`hidden` / `all` / `obscured`）。
   */
  async open(context: Pick<CommandContext, "argument" | "granted">): Promise<void> {
    this.scope = barScope(context.argument);
    this.granted = context.granted;
    if (!context.granted.includes("menuBarExtras.read")) {
      this.status = { kind: "unavailable", message: "要先允许「读取菜单栏上有哪些图标」" };
      return;
    }
    try {
      const [items, screens] = await Promise.all([jarvis.menuBarExtras.list(), jarvis.screens.list()]);
      const shown = barItems(items, screens, this.scope);
      this.images.clear();
      if (shown.length > 0 && context.granted.includes("menuBarExtras.capture")) {
        // 只截这几颗：露着的当场截，藏着的交回最近一次截到的。没有屏幕录制权限时整次报错，退回应用图标。
        const captures = await jarvis.menuBarExtras.capture(shown.slice(0, 40).map((item) => item.id)).catch(() => []);
        for (const capture of captures) if (capture.image) this.images.set(capture.id, capture.image);
      }
      this.status = { kind: "ready", items: shown };
    } catch (error) {
      const code = (error as { code?: string }).code;
      this.status = {
        kind: "unavailable",
        message: code === "permission.unavailable" ? "Jarvis 还没有辅助功能权限" : error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * 点了一颗：交给后台会话去露出、点开（状态在那里），副栏自己关掉。
   * @param item 那一颗。
   */
  async press(item: MenuBarExtra): Promise<void> {
    // 没给「替你点开」：这一下就是最好的时机再问一次（用户刚点了它，知道为什么要）；不给就什么都不做。
    if (!this.granted.includes("menuBarExtras.control")) {
      const result = await jarvis.permissions.request(["menuBarExtras.control"]);
      if (!result.granted.includes("menuBarExtras.control")) return;
      this.granted = [...this.granted, "menuBarExtras.control"];
    }
    await jarvis.commands.run("reveal-item", item.id);
    await jarvis.ui.dismissPopover();
  }

  /** 这一颗画哪张图：截到的，没有就用应用图标。 */
  image(item: MenuBarExtra): FileHandle | undefined {
    return this.images.get(item.id) ?? item.icon;
  }
}

/**
 * 画副栏：一排按钮，从左到右与菜单栏上的顺序一致。
 * @param session 副栏状态。
 * @returns 节点树。
 */
export function renderBar(session: BarSession): UINode {
  const status = session.status;
  switch (status.kind) {
    case "loading":
      return ui.text({ key: "loading", style: "footnote", text: "正在读菜单栏" });
    case "unavailable":
      return ui.text({ key: "unavailable", style: "footnote", text: status.message });
    case "ready":
      if (status.items.length === 0) {
        return ui.text({
          key: "empty",
          style: "footnote",
          text: session.scope === "obscured" ? "刘海下面没有挡住的图标" : "没有藏起来的图标：按住 ⌘ 把图标拖到竖线左边",
        });
      }
      return ui.stack({
        key: "bar",
        axis: "horizontal",
        spacing: "tight",
        alignment: "center",
        children: status.items.map((item) =>
          ui.iconButton({
            key: item.id,
            symbol: "app.dashed",
            image: session.image(item),
            label: displayName(item),
            size: "bar",
            onPress: () => void session.press(item),
          }),
        ),
      });
  }
}
