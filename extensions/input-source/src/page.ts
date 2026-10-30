/**
 * 工具箱那一页（400×520）：此刻这个应用一点即定、按输入法分组的全部规则、自己往一组里加应用、第一次用时的推荐。
 *
 * 每一块是一张带左缘色条的卡（jarvis-mac `specs/20261030-194903-input-source-cards-orb-flash` C-1）：此刻、每个输入法一组、
 * 记住上次、已停用、无规则的应用——与工具箱里时间转换器的读数行同一种画法，一眼分得开哪块是哪块。
 *
 * 加规则有两条路（jarvis-mac `specs/20261030-182223-input-source-rules-ux` U-1）：此刻的应用在顶上一点即定；
 * 别的应用在每一组右上角点「+」，从这台 Mac 装的应用里挑。页面跑在前台会话，只读写 `jarvis.storage` 与偏好；
 * 后台每次切应用、每次点开菜单都重读规则，不需要另开一条线把改动推过去。
 *
 * 网站规则（jarvis-mac `specs/20261030-234919-input-source-site-rules` S-3）：此刻是浏览器时，「此刻」卡上多一行当前页、一点即定；
 * 每组卡头的地球进「加网站」那一步，填网址或主机名。网站列在同一组的应用之后。读地址的两项授权只在点了加网站时才问。
 */
import {
  jarvis,
  layout,
  ui,
  type ActivationContext,
  type BrowserActiveTab,
  type FileHandle,
  type FrontmostApp,
  type InputSource,
  type MacApp,
  type Tint,
  type UINode,
  type Unsubscribe,
} from "@fusionseek/jarvis-extension-sdk";
import {
  candidates,
  choiceChips,
  choiceTitle,
  groupRules,
  lastUsedTitle,
  matchSite,
  normalizePattern,
  othersTitle,
  readSettings,
  ruleChoice,
  ruleFromChoice,
  setRule,
  setSite,
  sitePatternFor,
  suggestions,
  suggestionSummary,
  type ChoiceChip,
  type RuleChoice,
  type RuleGroup,
  type Rules,
  type Settings,
  type SiteRule,
  type Suggestion,
} from "./model.js";
import { readFallback, readRules, readSites, storageKeys } from "./storage.js";

/** 这一页要的授权：读输入法与知道前台是必须的，切与提示是后台的事，应用列表给「+」与推荐，一起问掉。 */
export const pageCapabilities = ["system.activity", "inputSources.read", "inputSources.select", "hud.show", "apps.read"] as const;
/** 网站规则要的两项（S-3）：读一次此刻这一页、跟着前台浏览器换页。只在点了「加网站」时问。 */
export const siteCapabilities = ["browser.activeTab", "browser.activeTab.watch"] as const;

/** 一次向宿主要几个图标（宿主上限 40）。 */
const ICON_BATCH = 40;
/** 搜索停下多久再补图标：每敲一个字都问一次宿主会撞上每分钟 60 次的上限。 */
const ICON_DEBOUNCE_MS = 300;
/** 推荐卡「不用了」之后不再出现。 */
const SUGGESTIONS_DISMISSED = "suggestionsDismissed";
/**
 * 输入法各组的色条，按系统输入法菜单的顺序轮流取（C-1）。与时间转换器四行读数同一个用意：一眼分得开是哪一组；
 * 青留给「此刻」，红留给「已停用」。
 */
const GROUP_TINTS: readonly Tint[] = ["blue", "violet", "amber", "live"];
/** 一排选项的最小列宽：352 宽的卡里放得下四枚（两个输入法 + 记住上次 + 无规则），再窄输入法的名字就要截断。 */
const CHIP_COLUMN_MINIMUM = 80;

type Status = { kind: "loading" } | { kind: "denied" } | { kind: "ready" } | { kind: "failed"; message: string };
type Stage = { kind: "groups" } | { kind: "add"; target: RuleChoice } | { kind: "addSite"; target: RuleChoice };

export class PageSession {
  status: Status = { kind: "loading" };
  stage: Stage = { kind: "groups" };
  sources: InputSource[] = [];
  currentId: string | undefined;
  app: FrontmostApp | undefined;
  rules: Rules = {};
  sites: SiteRule[] = [];
  /** 此刻（或最近一次）浏览器的当前页；没有 `browser.activeTab` 授权为 `undefined`，从没用过浏览器为 `null`。 */
  page: BrowserActiveTab | undefined;
  /** 加网站那一步填的字。 */
  siteDraft = "";
  fallbackSource: string | undefined;
  settings: Settings = readSettings({});
  /** 展开着「换成」那一排的规则：应用是 bundle id，网站是 `site:<pattern>`。 */
  editing: string | undefined;
  /** 刚加进来的那一行（点亮一下，用户找得到它落在哪）。 */
  highlight: string | undefined;
  /** 加应用那一步的搜索词。 */
  query = "";
  /** 这台 Mac 装的应用；没授权或还没读为 `undefined`。 */
  apps: MacApp[] | undefined;
  suggestionsDismissed = false;
  /** 应用图标（这个会话拿到的句柄）。 */
  readonly icons = new Map<string, FileHandle>();
  private granted: string[] = [];
  private iconTimer: ReturnType<typeof setTimeout> | undefined;
  private stopPreferences: Unsubscribe | undefined;

  /** 此刻（测试与渲染读）。 */
  now(): number {
    return Date.now();
  }

  /**
   * 页面出现了。
   * @param context 此刻的授权与偏好。
   */
  async activate(context: Pick<ActivationContext, "granted" | "preferences">): Promise<void> {
    this.granted = context.granted;
    this.settings = readSettings(context.preferences);
    this.stage = { kind: "groups" };
    this.editing = undefined;
    this.highlight = undefined;
    // 「无规则的应用」是宿主画的偏好控件：用户在这一页改了它，这里跟着重画（选了「默认输入法」才露出下面那一行）。
    this.stopPreferences ??= jarvis.preferences.onChange((changes) => {
      this.settings = readSettings({ ...this.settings, ...changes });
      jarvis.ui.update();
    });
    await this.load();
    if (this.status.kind === "ready") {
      await this.loadApps();
      await this.fetchIcons(this.visibleBundleIDs());
    }
  }

  /** 页面不在了。 */
  deactivate(): void {
    this.stopPreferences?.();
    this.stopPreferences = undefined;
    if (this.iconTimer !== undefined) clearTimeout(this.iconTimer);
    this.iconTimer = undefined;
  }

  private async load(): Promise<void> {
    if (!this.granted.includes("inputSources.read") || !this.granted.includes("system.activity")) {
      this.status = { kind: "denied" };
      return;
    }
    try {
      const [sources, current, app, rules, fallbackSource, dismissed, sites, page] = await Promise.all([
        jarvis.inputSources.list(),
        jarvis.inputSources.current(),
        jarvis.frontmostApp.current(),
        readRules(),
        readFallback(),
        jarvis.storage.get<boolean>(SUGGESTIONS_DISMISSED).catch(() => undefined),
        readSites(),
        this.readPage(),
      ]);
      this.sites = sites;
      this.page = page;
      this.sources = sources;
      this.currentId = current.id;
      this.app = app ?? undefined;
      if (app?.icon) this.icons.set(app.bundleId, app.icon);
      this.rules = rules;
      this.fallbackSource = fallbackSource;
      this.suggestionsDismissed = dismissed === true;
      this.status = { kind: "ready" };
    } catch (error) {
      this.status = { kind: "failed", message: error instanceof Error ? error.message : String(error) };
    }
  }

  /** 读一次此刻这一页（有 `browser.activeTab` 授权才读；读不到不当错）。 */
  private async readPage(): Promise<BrowserActiveTab | undefined> {
    if (!this.granted.includes("browser.activeTab")) return undefined;
    return jarvis.browser.activeTab().catch(() => null);
  }

  private async loadApps(): Promise<void> {
    if (this.apps !== undefined || !this.granted.includes("apps.read")) return;
    this.apps = await jarvis.apps.list().catch(() => undefined);
  }

  /** 此刻画在屏上的那些应用：分组页是全部规则；加应用那一步是列表的前一屏。 */
  visibleBundleIDs(): string[] {
    if (this.stage.kind === "add") return candidates(this.apps ?? [], this.query).list.map((app) => app.bundleId);
    return Object.keys(this.rules);
  }

  /** 补没取过的图标（一次至多 40 个）。 */
  private async fetchIcons(bundleIds: string[]): Promise<void> {
    if (!this.granted.includes("apps.read")) return;
    const missing = bundleIds.filter((id) => !this.icons.has(id)).slice(0, ICON_BATCH);
    if (missing.length === 0) return;
    const icons = await jarvis.apps.icons(missing).catch(() => []);
    for (const item of icons) if (item.icon) this.icons.set(item.bundleId, item.icon);
    jarvis.ui.update();
  }

  // MARK: - 规则

  /**
   * 给一个应用定规则（`none` = 删掉）。
   * @param bundleId 哪个应用。
   * @param name 应用名。
   * @param choice 选择。
   */
  async assign(bundleId: string, name: string, choice: RuleChoice): Promise<void> {
    this.rules = setRule(this.rules, bundleId, ruleFromChoice(choice, name || this.rules[bundleId]?.name || bundleId));
    this.highlight = choice === "none" ? undefined : bundleId;
    this.editing = undefined;
    await jarvis.storage.set(storageKeys.rules, this.rules);
  }

  /**
   * 删掉一条规则。
   * @param bundleId 哪个应用。
   */
  async remove(bundleId: string): Promise<void> {
    if (this.editing === bundleId) this.editing = undefined;
    if (this.highlight === bundleId) this.highlight = undefined;
    await this.assign(bundleId, "", "none");
  }

  /**
   * 给一个网站定输入法（`none` = 删掉，跟随应用）。
   * @param pattern 规范化过的 pattern。
   * @param choice 选择：`fixed:<id>` 或 `none`。
   */
  async assignSite(pattern: string, choice: RuleChoice): Promise<void> {
    const source = choice.startsWith("fixed:") ? choice.slice("fixed:".length) : undefined;
    this.sites = setSite(this.sites, pattern, source);
    this.highlight = source === undefined ? undefined : siteKey(pattern);
    this.editing = undefined;
    await jarvis.storage.set(storageKeys.sites, this.sites);
  }

  /**
   * 删掉一条网站规则。
   * @param pattern 哪个网站。
   */
  async removeSite(pattern: string): Promise<void> {
    if (this.editing === siteKey(pattern)) this.editing = undefined;
    if (this.highlight === siteKey(pattern)) this.highlight = undefined;
    await this.assignSite(pattern, "none");
  }

  /**
   * 往一组里加网站。还没给读地址的两项授权时先问（只在按钮回调里调）；不给也照样能填，只是后台跟不上网页。
   * @param target 那一组的选择（`fixed:<id>`）。
   */
  async startAddSite(target: RuleChoice): Promise<void> {
    if (!this.hasSiteAccess()) {
      const result = await jarvis.permissions.request([...siteCapabilities]);
      this.granted = result.granted;
    }
    this.stage = { kind: "addSite", target };
    this.siteDraft = "";
    this.editing = undefined;
    this.page = await this.readPage();
    jarvis.ui.update();
  }

  /** 再问一次读地址的两项授权（加网站那一步的「允许」，只在按钮回调里调）。 */
  async requestSiteAccess(): Promise<void> {
    const result = await jarvis.permissions.request([...siteCapabilities]);
    this.granted = result.granted;
    this.page = await this.readPage();
    jarvis.ui.update();
  }

  /** 此刻有没有读地址的两项授权（渲染读）。 */
  hasSiteAccess(): boolean {
    return siteCapabilities.every((id) => this.granted.includes(id));
  }

  /**
   * 加网站那一步填的字变了。
   * @param text 填的字。
   */
  setSiteDraft(text: string): void {
    this.siteDraft = text;
  }

  /**
   * 加进那一组，回到分组页。
   * @param pattern 规范化过的 pattern。
   */
  async pickSite(pattern: string): Promise<void> {
    if (this.stage.kind !== "addSite") return;
    const target = this.stage.target;
    this.stage = { kind: "groups" };
    this.siteDraft = "";
    await this.assignSite(pattern, target);
  }

  /** 展开 / 收起一条规则的「换成」。 */
  toggleEditing(bundleId: string): void {
    this.editing = this.editing === bundleId ? undefined : bundleId;
    this.highlight = undefined;
  }

  // MARK: - 加应用那一步

  /**
   * 往一组里加应用。还没给应用列表的授权时先问（只在按钮回调里调）。
   * @param target 那一组的选择。
   */
  async startAdd(target: RuleChoice): Promise<void> {
    if (!this.granted.includes("apps.read")) {
      const result = await jarvis.permissions.request(["apps.read"]);
      this.granted = result.granted;
      if (!this.granted.includes("apps.read")) return;
    }
    this.stage = { kind: "add", target };
    this.query = "";
    this.editing = undefined;
    await this.loadApps();
    await this.fetchIcons(this.visibleBundleIDs());
  }

  /**
   * 「此刻」卡上的刷新（C-4）：重读前台应用、此刻输入法与规则。面板钉住时切过应用，卡上还是打开那一刻的。
   * 点按钮不会把 Jarvis 拉到前台（面板只在点进输入框时才激活自己），读到的仍是用户刚才在用的那个应用。
   */
  async refresh(): Promise<void> {
    if (this.status.kind !== "ready") return;
    this.editing = undefined;
    await this.load();
    if (this.status.kind === "ready") await this.fetchIcons(this.visibleBundleIDs());
    // 读是异步的：按钮回调返回时还没读完，读完再画一次。
    jarvis.ui.update();
  }

  /** 不加了，回到分组页。 */
  cancelAdd(): void {
    this.stage = { kind: "groups" };
    this.siteDraft = "";
  }

  /**
   * 搜索词变了：停下 300 ms 再补图标。
   * @param query 搜索词。
   */
  setQuery(query: string): void {
    this.query = query;
    if (this.iconTimer !== undefined) clearTimeout(this.iconTimer);
    this.iconTimer = setTimeout(() => {
      this.iconTimer = undefined;
      void this.fetchIcons(this.visibleBundleIDs());
    }, ICON_DEBOUNCE_MS);
  }

  /**
   * 点了一个应用：加进那一组，回到分组页。
   * @param bundleId 应用。
   * @param name 应用名。
   */
  async pick(bundleId: string, name: string): Promise<void> {
    if (this.stage.kind !== "add") return;
    const target = this.stage.target;
    this.stage = { kind: "groups" };
    await this.assign(bundleId, name, target);
  }

  // MARK: - 推荐

  /** 此刻的推荐（不用了之后为空）。 */
  currentSuggestions(): Suggestion[] {
    if (this.suggestionsDismissed || this.apps === undefined) return [];
    return suggestions(this.apps, this.rules, this.sources, this.now());
  }

  /** 推荐全部加上。 */
  async acceptSuggestions(): Promise<void> {
    let rules = this.rules;
    for (const item of this.currentSuggestions()) rules = setRule(rules, item.bundleId, ruleFromChoice(item.choice, item.name));
    this.rules = rules;
    await jarvis.storage.set(storageKeys.rules, rules);
    await this.dismissSuggestions();
    await this.fetchIcons(Object.keys(rules));
  }

  /** 不用了：这张卡不再出现。 */
  async dismissSuggestions(): Promise<void> {
    this.suggestionsDismissed = true;
    await jarvis.storage.set(SUGGESTIONS_DISMISSED, true);
  }

  // MARK: - 其余

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
      if (session.stage.kind === "add") return addStage(session, session.stage.target);
      if (session.stage.kind === "addSite") return addSiteStage(session, session.stage.target);
      return groupsStage(session);
  }
}

// MARK: - 分组页

function groupsStage(session: PageSession): UINode {
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
  children.push(nowCard(session));
  const recommended = session.currentSuggestions();
  if (recommended.length > 0) {
    children.push(
      ui.note({
        key: "suggestions",
        tint: "accent",
        symbol: "sparkles",
        title: "先给常用的应用定好",
        body: suggestionSummary(recommended, session.sources),
        actions: [
          { id: "accept", title: "全部添加", onPress: () => void session.acceptSuggestions() },
          { id: "dismiss", title: "不用了", onPress: () => void session.dismissSuggestions() },
        ],
      }),
    );
  }
  for (const group of groupRules(session.rules, session.sources, session.sites)) children.push(groupCard(session, group));
  children.push(othersCard(session));
  return ui.scroll({ key: "page", children: [ui.stack({ key: "content", children })] });
}

/** 一张带左缘色条的卡，卡里一段（标题、读数、动作照旧）。 */
function card(key: string, tint: Tint | undefined, section: Parameters<typeof ui.section>[0]): UINode {
  return ui.card({ key: `card:${key}`, ...(tint ? { tint, stripe: true } : {}), children: [ui.section(section)] });
}

function nowCard(session: PageSession): UINode {
  const app = session.app;
  const current = session.sources.find((source) => source.id === session.currentId);
  const children: UINode[] = [];
  if (app) {
    const choice = ruleChoice(session.rules[app.bundleId]);
    children.push(
      ui.row({
        key: "now:app",
        symbol: "app",
        image: session.icons.get(app.bundleId) ?? app.icon,
        title: app.name,
        subtitle: choice === "none" ? `无规则 · ${othersTitle(session.settings.others)}` : choiceTitle(choice, session.sources),
        accessory: "none",
      }),
      chipGrid("now", choiceChips(session.sources), choice, (value) => void session.assign(app.bundleId, app.name, value)),
      ...nowPage(session, app.bundleId),
    );
  } else {
    children.push(ui.text({ key: "now:none", style: "footnote", text: "切到一个应用再点右上角的刷新，就能一点给它定输入法" }));
  }
  return card("now", "accent", {
    key: "now",
    title: "此刻 · NOW",
    trailing: current ? `正在用 ${current.name}` : undefined,
    actions: [
      { id: "refresh", title: "刷新", symbol: "arrow.clockwise", help: "重新读此刻在前台的应用与输入法", onPress: () => void session.refresh() },
    ],
    children,
  });
}

/**
 * 「此刻」卡上的当前页（S-3）：前台就是那个浏览器时，一行地球 + 网站，下面一排各输入法与「跟随应用」，一点即定这个网站。
 * 读不到地址（没在「自动化」里允许）时只给一句去哪里允许。
 */
function nowPage(session: PageSession, bundleId: string): UINode[] {
  const page = session.page;
  if (!page || page.browser.bundleId !== bundleId) return [];
  if (page.status === "denied") {
    return [
      ui.text({
        key: "now:site:denied",
        style: "footnote",
        text: `读不到这一页的地址：在 系统设置 › 隐私与安全性 › 自动化 里允许 Jarvis 控制「${page.browser.name}」`,
      }),
    ];
  }
  const url = page.status === "ok" ? page.url : undefined;
  const pattern = url ? sitePatternFor(url, session.sites) : undefined;
  if (!url || !pattern) return [];
  const matched = matchSite(url, session.sites);
  const source = matched ? session.sources.find((item) => item.id === matched.source) : undefined;
  return [
    ui.row({
      key: "now:site",
      symbol: "globe",
      title: pattern,
      subtitle: matched ? `网站规则 · 用 ${source?.name ?? "一个已停用的输入法"}` : "这个网站没有规则，跟着应用的",
      accessory: "none",
    }),
    chipGrid("now:site", siteChips(session.sources), matched ? `fixed:${matched.source}` : "none", (value) => void session.assignSite(pattern, value)),
  ];
}

/** 网站那一排：每个输入法一枚，再加「跟随应用」（删掉这个网站的规则）。网站上没有「记住上次」（S-2）。 */
function siteChips(sources: PageSession["sources"]): ChoiceChip[] {
  return [
    ...choiceChips(sources).filter((chip) => chip.value.startsWith("fixed:")),
    { value: "none", title: "跟随应用", help: "不给这个网站定规则，按浏览器这个应用的规则走", symbol: "arrow.turn.down.right" },
  ];
}

/** 网站行的 key（`editing` / `highlight` 与应用的 bundle id 分开）。 */
function siteKey(pattern: string): string {
  return `site:${pattern}`;
}

/** 一排一点即定的选项，排成等宽的一行（宿主把网格里的 chip 撑满格子，C-3）；选中的那枚点亮。 */
function chipGrid(keyPrefix: string, all: readonly ChoiceChip[], selected: RuleChoice, onPick: (value: RuleChoice) => void, exclude?: RuleChoice): UINode {
  const chips = all.filter((chip) => chip.value !== exclude);
  return layout.grid({
    key: `${keyPrefix}:choices`,
    minimum: CHIP_COLUMN_MINIMUM,
    spacing: "tight",
    children: chips.map((chip) =>
      ui.chip({
        key: `${keyPrefix}:${chip.value}`,
        title: chip.title,
        image: chip.image,
        symbol: chip.symbol,
        help: chip.help,
        // 选中的那枚点亮成青色（与工具箱里别的工具的选中 chip 同一种）；不给 tint 时选中只是灰一档，看不出选了哪个。
        tint: "accent",
        selected: chip.value === selected,
        onPress: () => onPick(chip.value),
      }),
    ),
  });
}

/** 一组的色条：输入法各组按顺序轮流取，记住上次中性，已停用红。 */
function groupTint(group: RuleGroup, sources: PageSession["sources"]): Tint {
  if (group.key === "stale") return "danger";
  const index = sources.findIndex((source) => `fixed:${source.id}` === group.key);
  return index < 0 ? "neutral" : GROUP_TINTS[index % GROUP_TINTS.length];
}

function groupCard(session: PageSession, group: RuleGroup): UINode {
  const children: UINode[] = [];
  for (const { bundleId, rule } of group.entries) {
    const name = rule.name || bundleId;
    const editing = session.editing === bundleId;
    children.push(
      ui.row({
        key: `rule:${bundleId}`,
        symbol: "app",
        image: session.icons.get(bundleId),
        title: name,
        subtitle: session.app?.bundleId === bundleId ? "此刻在前台" : group.key === "stale" ? "点一下，换一个还启用着的" : undefined,
        selected: editing || session.highlight === bundleId,
        accessory: "none",
        onPress: () => session.toggleEditing(bundleId),
        actions: [{ id: "remove", title: "删除规则", symbol: "xmark", help: `删除「${name}」的规则`, onPress: () => void session.remove(bundleId) }],
      }),
    );
    if (editing) {
      children.push(
        ui.text({ key: `rule:${bundleId}:label`, style: "footnote", text: `「${name}」换成` }),
        chipGrid(`rule:${bundleId}`, choiceChips(session.sources), ruleChoice(rule), (value) => void session.assign(bundleId, name, value), group.key),
      );
    }
  }
  const here = session.page?.status === "ok" && session.page.url ? matchSite(session.page.url, session.sites)?.pattern : undefined;
  for (const site of group.sites) {
    const key = siteKey(site.pattern);
    const editing = session.editing === key;
    children.push(
      ui.row({
        key: `site:${site.pattern}`,
        symbol: "globe",
        title: site.pattern,
        subtitle: here === site.pattern ? "此刻在看" : group.key === "stale" ? "点一下，换一个还启用着的" : "网站",
        selected: editing || session.highlight === key,
        accessory: "none",
        onPress: () => session.toggleEditing(key),
        actions: [{ id: "remove", title: "删除规则", symbol: "xmark", help: `删除「${site.pattern}」的规则`, onPress: () => void session.removeSite(site.pattern) }],
      }),
    );
    if (editing) {
      children.push(
        ui.text({ key: `site:${site.pattern}:label`, style: "footnote", text: `在「${site.pattern}」上换成` }),
        chipGrid(`site:${site.pattern}`, siteChips(session.sources), `fixed:${site.source}`, (value) => void session.assignSite(site.pattern, value), group.key),
      );
    }
  }
  if (group.entries.length === 0 && group.sites.length === 0) {
    const text = group.key.startsWith("fixed:") ? "还没有应用或网站。点右上角的 + 或地球加几个" : "还没有应用。点右上角的 + 加几个";
    children.push(ui.text({ key: `${group.key}:empty`, style: "footnote", text }));
  }
  const actions = group.addable
    ? [{ id: "add", title: "添加应用", symbol: "plus", help: `添加${group.title}的应用`, onPress: () => void session.startAdd(group.key) }]
    : [];
  // 网站上没有「记住上次」：只有输入法那几组能加网站。
  if (group.addable && group.key.startsWith("fixed:")) {
    actions.push({ id: "addSite", title: "添加网站", symbol: "globe", help: `添加${group.title}的网站`, onPress: () => void session.startAddSite(group.key) });
  }
  return card(`group:${group.key}`, groupTint(group, session.sources), {
    key: `group:${group.key}`,
    title: group.title,
    trailing: group.sites.length > 0 ? `${group.entries.length} 个应用 · ${group.sites.length} 个网站` : `${group.entries.length} 个应用`,
    actions: actions.length > 0 ? actions : undefined,
    children,
  });
}

function othersCard(session: PageSession): UINode {
  const children: UINode[] = [layout.preference({ key: "others", preference: "others" })];
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
  children.push(
    ui.text({
      key: "how",
      style: "footnote",
      text:
        "也可以在任何应用里点菜单栏上的键盘图标，给它一点即定。网站规则比应用规则优先，只在那一页开在前台的浏览器里时生效。中文输入法里按 ⇧ 切到的英文模式不算换了输入法，规则管不到它。",
    }),
  );
  // 这一块是设置，不是一类规则：不带色条。
  return card("others", undefined, { key: "others", title: "无规则的应用 · OTHERS", children });
}

// MARK: - 加应用那一步

function addStage(session: PageSession, target: RuleChoice): UINode {
  const title = choiceTitle(target, session.sources);
  const children: UINode[] = [
    ui.row({
      key: "add:back",
      symbol: "chevron.left",
      title: `加到「${title}」`,
      subtitle: "点一个应用就加进去；已经有规则的会挪过来",
      accessory: "none",
      onPress: () => session.cancelAdd(),
      label: `返回。加到「${title}」`,
    }),
    ui.search({ key: "add:search", value: session.query, placeholder: "搜应用名或 Bundle ID", label: "搜应用", onChange: (query) => session.setQuery(query) }),
  ];
  if (session.apps === undefined) {
    children.push(ui.text({ key: "add:loading", style: "footnote", text: "读不到应用列表：要「读取本机应用列表」的授权" }));
  } else {
    const { list, truncated } = candidates(session.apps, session.query);
    const now = session.now();
    for (const app of list) {
      const rule = session.rules[app.bundleId];
      const choice = ruleChoice(rule);
      const already = choice === target;
      children.push(
        ui.row({
          key: `app:${app.bundleId}`,
          symbol: "app",
          image: session.icons.get(app.bundleId),
          title: app.name,
          subtitle: rule ? (already ? "已经在这一组" : `现在：${choiceTitle(choice, session.sources)}`) : lastUsedTitle(app.lastUsedAt, now),
          selected: already,
          accessory: already ? "dot" : "none",
          onPress: () => void session.pick(app.bundleId, app.name),
        }),
      );
    }
    if (list.length === 0) children.push(ui.text({ key: "add:none", style: "footnote", text: "没找到。换个名字，或者用 Bundle ID 搜" }));
    if (truncated) children.push(ui.text({ key: "add:more", style: "footnote", text: "只列了最近用过的 60 个，输入名字找别的" }));
  }
  return ui.scroll({ key: "add", children: [ui.stack({ key: "add:content", children })] });
}

// MARK: - 加网站那一步（S-3）

function addSiteStage(session: PageSession, target: RuleChoice): UINode {
  const title = choiceTitle(target, session.sources);
  const children: UINode[] = [
    ui.row({
      key: "addSite:back",
      symbol: "chevron.left",
      title: `加网站到「${title}」`,
      subtitle: "填网址或主机名；github.com 也管它的子域",
      accessory: "none",
      onPress: () => session.cancelAdd(),
      label: `返回。加网站到「${title}」`,
    }),
  ];
  if (!session.hasSiteAccess()) {
    children.push(
      ui.note({
        key: "addSite:access",
        tint: "amber",
        symbol: "lock",
        body: "还没允许读浏览器当前页：规则照样能加，但不会跟着网页换输入法",
        actions: [{ id: "grant", title: "允许", onPress: () => void session.requestSiteAccess() }],
      }),
    );
  }
  children.push(
    ui.field({
      key: "addSite:field",
      value: session.siteDraft,
      placeholder: "github.com 或 docs.google.com/spreadsheets",
      label: "网址或主机名",
      mono: true,
      autoFocus: true,
      onChange: (text) => session.setSiteDraft(text),
      onSubmit: (text) => {
        const pattern = normalizePattern(text);
        if (pattern) void session.pickSite(pattern);
      },
    }),
  );
  const draft = session.siteDraft.trim();
  if (draft) {
    const pattern = normalizePattern(draft);
    if (pattern) {
      const existing = session.sites.find((site) => site.pattern === pattern);
      const already = existing !== undefined && `fixed:${existing.source}` === target;
      let subtitle = `也管 docs.${pattern} 这样的子域`;
      if (pattern.includes("/")) subtitle = "这个网站上以这段路径开头的页";
      if (existing && !already) subtitle = `现在：${choiceTitle(`fixed:${existing.source}`, session.sources)}，点一下挪过来`;
      children.push(
        ui.row({
          key: "addSite:add",
          symbol: "plus.circle",
          title: already ? `${pattern} 已经在这一组` : `添加 ${pattern}`,
          subtitle,
          selected: already,
          accessory: "none",
          onPress: () => void session.pickSite(pattern),
        }),
      );
    } else {
      children.push(ui.text({ key: "addSite:invalid", style: "footnote", text: "这不像一个网址：填主机名（github.com）或整个网址" }));
    }
  }
  const page = session.page;
  const url = page?.status === "ok" ? page.url : undefined;
  const current = url ? sitePatternFor(url, session.sites) : undefined;
  if (page && current) {
    children.push(
      ui.row({
        key: "addSite:current",
        symbol: "safari",
        title: current,
        subtitle: `${page.frontmost ? "此刻" : "刚才"}在「${page.browser.name}」里看的这一页`,
        accessory: "none",
        onPress: () => void session.pickSite(current),
      }),
    );
  }
  children.push(
    ui.text({
      key: "addSite:how",
      style: "footnote",
      text:
        "读地址时系统会问一次是否允许 Jarvis 控制这个浏览器（系统设置 › 隐私与安全性 › 自动化）。换标签就跟着换，要 Jarvis 有辅助功能权限；没有时只在切到浏览器时对一次。Firefox 读不了地址。",
    }),
  );
  return ui.scroll({ key: "addSite", children: [ui.stack({ key: "addSite:content", children })] });
}
