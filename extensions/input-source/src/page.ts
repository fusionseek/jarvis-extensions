/**
 * 工具箱那一页（400×520）：此刻这个应用用什么、全部规则、没写规则的应用怎么办。
 *
 * 页面跑在前台会话，切换跑在后台会话。这一页只读写 `jarvis.storage` 与偏好；后台每次切应用、每次点开菜单都重读规则，
 * 不需要另开一条线把改动推过去。「此刻」是打开这一页时的前台应用：面板不抢前台，所以它就是你刚才在用的那个。
 */
import { jarvis, ui, type ActivationContext, type FrontmostApp, type InputSource, type UINode } from "@fusionseek/jarvis-extension-sdk";
import { othersTitle, readSettings, ruleChoice, ruleFromChoice, ruleTitle, setRule, type Others, type Rules, type Settings } from "./model.js";
import { readFallback, readRules, storageKeys } from "./storage.js";

/** 这一页要的授权：读输入法与知道前台是必须的，切与提示是后台的事，一起问掉。 */
export const pageCapabilities = ["system.activity", "inputSources.read", "inputSources.select", "hud.show"] as const;

type Status = { kind: "loading" } | { kind: "denied" } | { kind: "ready" } | { kind: "failed"; message: string };

export class PageSession {
  status: Status = { kind: "loading" };
  sources: InputSource[] = [];
  currentId: string | undefined;
  app: FrontmostApp | undefined;
  rules: Rules = {};
  fallbackSource: string | undefined;
  settings: Settings = readSettings({});
  /** 展开着选择器的那一条规则。 */
  editing: string | undefined;
  private granted: string[] = [];

  /**
   * 页面出现了。
   * @param context 此刻的授权与偏好。
   */
  async activate(context: Pick<ActivationContext, "granted" | "preferences">): Promise<void> {
    this.granted = context.granted;
    this.settings = readSettings(context.preferences);
    this.editing = undefined;
    await this.load();
  }

  /** 页面不在了。 */
  deactivate(): void {
    this.editing = undefined;
  }

  private async load(): Promise<void> {
    if (!this.granted.includes("inputSources.read") || !this.granted.includes("system.activity")) {
      this.status = { kind: "denied" };
      return;
    }
    try {
      const [sources, current, app, rules, fallbackSource] = await Promise.all([
        jarvis.inputSources.list(),
        jarvis.inputSources.current(),
        jarvis.frontmostApp.current(),
        readRules(),
        readFallback(),
      ]);
      this.sources = sources;
      this.currentId = current.id;
      this.app = app ?? undefined;
      this.rules = rules;
      this.fallbackSource = fallbackSource;
      this.status = { kind: "ready" };
    } catch (error) {
      this.status = { kind: "failed", message: error instanceof Error ? error.message : String(error) };
    }
  }

  /**
   * 改一条规则（`none` = 删掉）。
   * @param bundleId 哪个应用。
   * @param name 应用名。
   * @param choice 选择器的值。
   */
  async setRule(bundleId: string, name: string, choice: string): Promise<void> {
    this.rules = setRule(this.rules, bundleId, ruleFromChoice(choice, name));
    await jarvis.storage.set(storageKeys.rules, this.rules);
  }

  /**
   * 删掉一条规则。
   * @param bundleId 哪个应用。
   */
  async removeRule(bundleId: string): Promise<void> {
    if (this.editing === bundleId) this.editing = undefined;
    await this.setRule(bundleId, "", "none");
  }

  /** 展开 / 收起一条规则的选择器。 */
  toggleEditing(bundleId: string): void {
    this.editing = this.editing === bundleId ? undefined : bundleId;
  }

  /**
   * 没写规则的应用怎么办。
   * @param value 偏好值。
   */
  async setOthers(value: string): Promise<void> {
    this.settings = readSettings({ ...this.settings, others: value });
    await jarvis.preferences.set("others", this.settings.others);
  }

  /**
   * 默认输入法。
   * @param id 输入法 id。
   */
  async setFallback(id: string): Promise<void> {
    this.fallbackSource = id;
    await jarvis.storage.set(storageKeys.fallbackSource, id);
  }

  /** 恢复自动切换（交给后台：暂停状态与提示在那里）。 */
  async resume(): Promise<void> {
    this.settings = { ...this.settings, paused: false };
    await jarvis.commands.run("pause");
  }

  /** 再问一次授权（只在按钮回调里调）。 */
  async requestAccess(): Promise<void> {
    const result = await jarvis.permissions.request([...pageCapabilities]);
    await this.activate({ granted: result.granted, preferences: this.settings as unknown as Record<string, unknown> });
  }

  /** 选择器的选项：各输入法、记住上次、不管它、不写规则。 */
  ruleOptions(): { value: string; title: string; detail?: string }[] {
    return [
      ...this.sources.map((source) => ({ value: `fixed:${source.id}`, title: source.name })),
      { value: "remember", title: "记住上次用的" },
      { value: "ignore", title: "不管它" },
      { value: "none", title: "不写规则", detail: `跟着「没写规则的应用」：${othersTitle(this.settings.others)}` },
    ];
  }
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
      return ui.empty({ key: "loading", symbol: "keyboard", title: "正在读输入法" });
    case "denied":
      return ui.empty({
        key: "denied",
        symbol: "lock",
        title: "还没允许读输入法与前台应用",
        hint: "切到一个应用时要知道是哪个应用、此刻用的是哪个输入法，才能按规则换。只知道是哪个应用，不知道你在里面做什么",
        action: { id: "grant", title: "允许", onPress: () => void session.requestAccess() },
      });
    case "failed":
      return ui.empty({ key: "failed", symbol: "exclamationmark.triangle", title: "没读出来", hint: status.message });
    case "ready":
      return ready(session);
  }
}

function ready(session: PageSession): UINode {
  const current = session.sources.find((source) => source.id === session.currentId);
  const children: UINode[] = [];
  if (session.settings.paused) {
    children.push(
      ui.note({
        key: "paused",
        tint: "amber",
        symbol: "pause.circle",
        body: "自动切换已暂停：只记下你在各个应用里用的输入法，不替你切",
        actions: [{ id: "resume", title: "恢复", onPress: () => void session.resume() }],
      }),
    );
  }
  children.push(nowSection(session, current), rulesSection(session), othersSection(session));
  children.push(
    ui.text({
      key: "how",
      style: "footnote",
      text: "在哪个应用里，就点菜单栏上的键盘图标给它选输入法。中文输入法里按 ⇧ 切到的英文模式不算换了输入法，规则管不到它。",
    }),
  );
  return ui.scroll({ key: "page", children: [ui.stack({ key: "content", children })] });
}

function nowSection(session: PageSession, current: InputSource | undefined): UINode {
  const app = session.app;
  const children: UINode[] = [];
  if (app) {
    const rule = session.rules[app.bundleId];
    children.push(
      ui.row({
        key: "now:app",
        symbol: "app",
        image: app.icon,
        title: app.name,
        subtitle: ruleTitle(rule, session.sources, session.settings),
        accessory: "none",
      }),
      ui.picker({
        key: "now:rule",
        label: `在「${app.name}」里用`,
        options: session.ruleOptions(),
        value: ruleChoice(rule),
        searchable: true,
        onChange: (value) => void session.setRule(app.bundleId, app.name, value),
      }),
    );
  } else {
    children.push(ui.text({ key: "now:none", style: "footnote", text: "切到一个应用再打开这一页，就能给它定输入法" }));
  }
  return ui.section({ key: "now", title: "此刻 · NOW", trailing: current ? `正在用 ${current.name}` : undefined, children });
}

function rulesSection(session: PageSession): UINode {
  const entries = Object.entries(session.rules).sort(([, a], [, b]) => a.name.localeCompare(b.name, "zh-Hans"));
  const children: UINode[] = [];
  for (const [bundleId, rule] of entries) {
    const icon = session.app?.bundleId === bundleId ? session.app.icon : undefined;
    children.push(
      ui.row({
        key: `rule:${bundleId}`,
        symbol: "app",
        image: icon,
        title: rule.name || bundleId,
        subtitle: ruleTitle(rule, session.sources, session.settings),
        selected: session.editing === bundleId,
        accessory: "none",
        onPress: () => session.toggleEditing(bundleId),
        actions: [{ id: "remove", title: "删除规则", symbol: "xmark", help: "删除这条规则", onPress: () => void session.removeRule(bundleId) }],
      }),
    );
    if (session.editing === bundleId) {
      children.push(
        ui.picker({
          key: `rule:${bundleId}:picker`,
          label: `在「${rule.name || bundleId}」里用`,
          options: session.ruleOptions(),
          value: ruleChoice(rule),
          searchable: true,
          onChange: (value) => void session.setRule(bundleId, rule.name, value),
        }),
      );
    }
  }
  if (children.length === 0) {
    children.push(ui.text({ key: "rules:empty", style: "footnote", text: "还没有规则。在哪个应用里，就点菜单栏上的键盘图标给它选一个" }));
  }
  return ui.section({ key: "rules", title: "应用规则 · RULES", trailing: `${entries.length} 个`, children });
}

function othersSection(session: PageSession): UINode {
  const children: UINode[] = [
    ui.picker({
      key: "others",
      label: "没写规则的应用",
      options: (["keep", "remember", "default"] as Others[]).map((value) => ({ value, title: othersTitle(value) })),
      value: session.settings.others,
      onChange: (value) => void session.setOthers(value),
    }),
  ];
  if (session.settings.others === "default") {
    const value = session.fallbackSource && session.sources.some((source) => source.id === session.fallbackSource) ? session.fallbackSource : "";
    children.push(
      ui.picker({
        key: "fallback",
        label: "默认输入法",
        options: [{ value: "", title: "选一个输入法" }, ...session.sources.map((source) => ({ value: source.id, title: source.name }))],
        value,
        onChange: (id) => {
          if (id) void session.setFallback(id);
        },
      }),
    );
  }
  return ui.section({ key: "others", title: "没写规则的应用 · OTHERS", children });
}
