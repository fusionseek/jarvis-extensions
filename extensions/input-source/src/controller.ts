/**
 * 后台会话里的那一份：订前台应用与输入法的变化，切应用时按规则换输入法，记下你手动换的，推菜单栏模型，跑三条静默命令。
 * 有网站规则时再订前台浏览器的当前页（jarvis-mac `specs/20261030-234919-input-source-site-rules` S-2）：换了页、决定出来的输入法变了才切。
 *
 * **空闲时什么都不做**：一个定时器都不挂。前台换了、输入法换了，宿主才推一条事件过来；两条订阅让后台会话常驻
 * （jarvis-mac `specs/20261030-170731-input-source-switch-p1` N-4），关掉菜单栏图标也照样在切。
 */
import {
  jarvis,
  type BrowserActiveTabPage,
  type CommandContext,
  type FrontmostApp,
  type InputSource,
  type InputSourcesEvent,
  type MenuBarContext,
  type Unsubscribe,
} from "@fusionseek/jarvis-extension-sdk";
import {
  choiceFromMenuItem,
  defaultSettings,
  isSystemSource,
  emptyMemory,
  learnsOnLeave,
  menuModel,
  readSettings,
  remember,
  resolveTarget,
  ruleFromChoice,
  setRule,
  setSite,
  shortLabel,
  siteChoiceFromMenuItem,
  sitePatternFor,
  type Memory,
  type Page,
  type RuleChoice,
  type Rules,
  type Settings,
} from "./model.js";
import { readFallback, readLastUsed, readRules, readSites, storageKeys } from "./storage.js";

/** 提示一行至多几个字（宿主 `hud.show` 的上限）。 */
const HUD_LIMIT = 24;
/** 悬浮球那一档停多久（jarvis-mac `specs/20261030-194903-input-source-cards-orb-flash` C-8，仓库主人：「停留 2 秒后，恢复原样」）；屏幕那一档用宿主默认的 1.2 秒。 */
const ORB_DURATION_MS = 2000;
/**
 * 切完多久再核对一次（jarvis-mac `specs/20261030-190534-input-source-walkthrough-fixes` F-1）。
 * 300 ms 盖得住应用刚激活时自己（或输入法自己）把输入源改回去的那一下，又短到用户还没开始打字。
 */
const VERIFY_DELAY_MS = 300;

export class Controller {
  private settings: Settings = defaultSettings;
  private memory: Memory = emptyMemory;
  private sources: InputSource[] = [];
  /** 推最后一份菜单时的输入法：菜单项按序号引用它。 */
  private menuSources: InputSource[] = [];
  private currentId: string | undefined;
  /** 上一个不同的输入法（`previous` 命令切回它）。 */
  private previousId: string | undefined;
  private app: FrontmostApp | undefined;
  private granted: string[] = [];
  private started = false;
  /** 订阅之后宿主先补发一条此刻的前台：那一条只记下来，不切——启动、点了「允许」不该替你换掉正在用的输入法。 */
  private primed = false;
  private stopFrontmost: Unsubscribe | undefined;
  private stopSources: Unsubscribe | undefined;
  private stopPreferences: Unsubscribe | undefined;
  private stopPermissions: Unsubscribe | undefined;
  /** 前台事件一条一条处理（F-1）：并发处理时，切到上一个应用的那一次可能晚落地，把这一次覆盖掉。 */
  private queue: Promise<void> = Promise.resolve();
  /** 第几次换前台（或换了页）：处理到一条时后面已经又换了，这一条作废（只认最新一次）。 */
  private activation = 0;
  private stopBrowser: Unsubscribe | undefined;
  /** 每个浏览器的上一页（S-2）：切回浏览器、地址没变时宿主不再推，靠这份缓存当场对上。 */
  private readonly pages = new Map<string, string>();
  /**
   * 跳过下一条网页事件：启动、刚允许、从菜单定了第一条网站规则时订阅，宿主补发的那一条只记下、不切（同 `primed`）。
   * 至多跳一条；下一次真的换了前台就不再跳。订阅发生在「切到浏览器」的那一次处理里时不跳——那一条正是用户刚切过来的那一页。
   */
  private skipReplay = false;
  /** 这一次停留里决定过的目标（S-2）：页面换了、决定没变就不切——你在这一页上手动换了的，不替你换回去。 */
  private decided: string | undefined;

  /** 此刻在前台的应用（测试读）。 */
  get frontmost(): FrontmostApp | undefined {
    return this.app;
  }

  /** 此刻的记忆（测试读）。 */
  get state(): Memory {
    return this.memory;
  }

  /**
   * 菜单栏域的 `start`（应用启动、启用 / 更新时各一次；图标关着也照样来）。重复调用不会多订一份。
   * @param preferences 此刻的偏好。
   * @param granted 此刻的授权。
   */
  async start(preferences: Record<string, unknown>, granted: string[]): Promise<void> {
    this.settings = readSettings(preferences);
    if (!this.started) {
      this.started = true;
      await this.loadMemory();
      this.stopPreferences = jarvis.preferences.onChange(() => void this.reloadPreferences());
      this.stopPermissions = jarvis.permissions.onChange((now) => void this.applyGrants(now));
    }
    await this.applyGrants(granted);
  }

  /** 菜单点开的那一刻：页面可能刚改过规则，重读一次再画。 */
  async open(context: MenuBarContext): Promise<void> {
    await this.ensureStarted(context);
    await this.loadRules();
    await this.readPageOnce();
    await this.render();
  }

  /**
   * 菜单里点了一项：给此刻的应用定规则，或暂停 / 恢复。
   * @param itemId 菜单项 id。
   * @param context 此刻的授权与偏好。
   */
  async select(itemId: string, context: MenuBarContext): Promise<void> {
    await this.ensureStarted(context);
    const site = siteChoiceFromMenuItem(itemId, this.menuSources);
    if (site) return this.applySite(site.source);
    const choice = choiceFromMenuItem(itemId, this.menuSources);
    if (choice === undefined) return;
    if (choice === "pause") return this.togglePause();
    if (!this.app) return;
    await this.applyRule(this.app, choice);
  }

  /** 静默命令 `previous`：切回上一个输入法。 */
  async previous(context: CommandContext): Promise<void> {
    await this.ensureStarted(context);
    if (!this.previousId || !this.granted.includes("inputSources.select")) return;
    const target = this.previousId;
    const result = await jarvis.inputSources.select(target).catch(() => undefined);
    if (result?.effective) {
      this.note(target);
      await this.showHUD(this.source(target)?.name ?? target, this.source(target));
    }
  }

  /** 静默命令 `remember-here`：把此刻的输入法定给当前应用。 */
  async rememberHere(context: CommandContext): Promise<void> {
    await this.ensureStarted(context);
    if (!this.app || !this.currentId) return;
    await this.applyRule(this.app, `fixed:${this.currentId}`);
    const source = this.source(this.currentId);
    await this.showHUD(`${this.app.name} 用 ${source?.name ?? this.currentId}`, source);
  }

  /** 静默命令 `pause`：暂停 / 恢复自动切换。 */
  async pause(context: CommandContext): Promise<void> {
    await this.ensureStarted(context);
    await this.togglePause();
  }

  // MARK: - 订阅

  private async ensureStarted(context: { preferences: Record<string, unknown>; granted: string[] }): Promise<void> {
    if (!this.started) await this.start(context.preferences, context.granted);
    else if ([...context.granted].sort().join() !== this.granted.join()) await this.applyGrants(context.granted);
  }

  /** 按授权订 / 退两条订阅。用户刚在页面里点了「允许」时，宿主的 `permissionsChanged` 走到这里。 */
  private async applyGrants(granted: string[]): Promise<void> {
    this.granted = [...granted].sort();
    if (granted.includes("inputSources.read")) {
      this.stopSources ??= jarvis.inputSources.observe((event) => void this.onInputSource(event));
      await this.reloadSources();
    } else {
      this.stopSources?.();
      this.stopSources = undefined;
    }
    if (granted.includes("system.activity")) {
      if (!this.stopFrontmost) {
        this.primed = false;
        this.stopFrontmost = jarvis.frontmostApp.observe((app) => void this.onFrontmost(app));
      }
    } else {
      this.stopFrontmost?.();
      this.stopFrontmost = undefined;
    }
    this.memory = { ...this.memory, sites: await readSites() };
    this.updateBrowserWatch(false);
    await this.render();
  }

  /**
   * 订 / 退前台浏览器当前页（S-2）：有 `browser.activeTab.watch` 授权、且至少一条网站规则才订——没有网站规则的人不付这份代价。
   * @param actOnReplay 订阅时宿主补发的那一条要不要照规则切（在「切到浏览器」的那一次处理里订的才要）。
   */
  private updateBrowserWatch(actOnReplay: boolean): void {
    const wanted = this.granted.includes("browser.activeTab.watch") && this.memory.sites.length > 0;
    if (wanted && !this.stopBrowser) {
      this.skipReplay = !actOnReplay;
      this.stopBrowser = jarvis.browser.watchActiveTab((page) => void this.onPage(page));
    } else if (!wanted && this.stopBrowser) {
      this.stopBrowser();
      this.stopBrowser = undefined;
      this.pages.clear();
    }
  }

  /** 前台那个浏览器缓存着的一页；不是浏览器、没读到为 `undefined`。 */
  private pageFor(bundleId: string): Page | undefined {
    const url = this.pages.get(bundleId);
    return url === undefined ? undefined : { bundleId, url };
  }

  /** 菜单点开时，没订着当前页就读一次（有 `browser.activeTab` 授权才读）：第一条网站规则也能从菜单里定。 */
  private async readPageOnce(): Promise<void> {
    if (this.stopBrowser || !this.app || !this.granted.includes("browser.activeTab")) return;
    const tab = await jarvis.browser.activeTab().catch(() => null);
    if (!tab || tab.browser.bundleId !== this.app.bundleId || !tab.frontmost) return;
    if (tab.status === "ok" && tab.url) this.pages.set(tab.browser.bundleId, tab.url);
    else this.pages.delete(tab.browser.bundleId);
  }

  private async reloadSources(): Promise<void> {
    try {
      const [sources, current] = await Promise.all([jarvis.inputSources.list(), jarvis.inputSources.current()]);
      this.sources = sources;
      if (current.id !== this.currentId) this.note(current.id);
    } catch (error) {
      jarvis.log.warn("读不出输入法", error instanceof Error ? error.message : String(error));
    }
  }

  private async reloadPreferences(): Promise<void> {
    this.settings = readSettings(await jarvis.preferences.all());
    await this.render();
  }

  /**
   * 前台换了。
   * @param app 换到的应用。
   */
  onFrontmost(app: FrontmostApp): Promise<void> {
    // 记前台是同步的：手动切换的事件随时会来，要记给此刻真正在前台的那个应用。
    const left = this.app;
    const switched = left?.bundleId !== app.bundleId;
    this.app = app;
    const token = ++this.activation;
    const primed = this.primed;
    this.primed = true;
    // 真的换了一次前台（不是订阅时补发的那一条）：之后的网页事件都是用户切过去、翻过去的（S-2）。
    if (primed) this.skipReplay = false;
    return this.enqueue(async () => {
      if (!primed) return this.render();
      // 先记下换走的那个应用在用什么（W-2）：排在前面的切换都已落地，此刻的输入法就是离开它时真实用着的那一个。
      // 这一条作废了也照记——用户确实是带着这个输入法离开它的。
      if (switched && left) this.learn(left.bundleId);
      if (token !== this.activation) return;
      if (!switched || this.settings.paused || !this.granted.includes("inputSources.select")) return this.render();
      // 页面可能刚改过规则：规则与默认输入法每次切应用读一次（三次本机库读，毫秒级）；「上次用的」只有这里写，内存里就是最新的。
      await this.loadRules();
      // 页面里刚加了第一条网站规则：这一次切进来就订上，宿主补发的那一页正是用户切过来的这一页。
      this.updateBrowserWatch(true);
      if (this.sources.length === 0) await this.reloadSources();
      const target = resolveTarget(app.bundleId, this.memory, this.settings, this.sources.map((source) => source.id), this.pageFor(app.bundleId));
      this.decided = target;
      if (target !== undefined && token === this.activation) {
        // 以系统此刻的为准，不用自己记的：自己记的那个可能还是被顶掉的那一次之前的。
        const actual = (await jarvis.inputSources.current().catch(() => undefined))?.id;
        if (token !== this.activation) return;
        if (actual !== target) await this.switchTo(target, token);
      }
      await this.render();
    });
  }

  /**
   * 前台浏览器换了页（宿主 `browser.watchActiveTab`，S-2）。缓存先记下（同步：下一次切回这个浏览器要用）；
   * 决定出来的目标和这一次停留里已经决定过的一样就不切——同一网站里翻页不切，你在这一页上手动换了的也不换回去。
   * @param page 宿主推来的一页。
   */
  onPage(page: BrowserActiveTabPage): Promise<void> {
    const bundleId = page.browser.bundleId;
    if (page.status === "ok" && page.url) this.pages.set(bundleId, page.url);
    else this.pages.delete(bundleId);
    const acts = !this.skipReplay;
    this.skipReplay = false;
    const token = ++this.activation;
    return this.enqueue(async () => {
      if (token !== this.activation) return;
      const app = this.app;
      // 读的那几十毫秒里切走了：这一页不是此刻前台的了。
      if (!app || app.bundleId !== bundleId) return this.render();
      await this.loadRules();
      if (this.sources.length === 0) await this.reloadSources();
      const target = resolveTarget(bundleId, this.memory, this.settings, this.sources.map((source) => source.id), this.pageFor(bundleId));
      if (!acts || target === this.decided) {
        this.decided = target;
        return this.render();
      }
      this.decided = target;
      if (target === undefined || this.settings.paused || !this.granted.includes("inputSources.select")) return this.render();
      const actual = (await jarvis.inputSources.current().catch(() => undefined))?.id;
      if (token !== this.activation) return;
      if (actual !== target) await this.switchTo(target, token);
      await this.render();
    });
  }

  /**
   * 换走一个应用时，把此刻用着的输入法记成「上次在它里面用的」（jarvis-mac `specs/20261031-080909-input-source-walkthrough-fixes` W-2）。
   * 只从手动换的那一下学，刚装上时谁都没记过：在 Warp 里一直用拼音、切到 Rider 换成 ABC、再切回 Warp，「记住上次」不知道该换回拼音。
   * 输入法是规则定的（固定规则、命中网站规则的那一页）不记。写库不等：下一次切换马上就要用内存里的这一份。
   * @param bundleId 被换走的应用。
   */
  private learn(bundleId: string): void {
    const id = this.currentId;
    if (id === undefined || !learnsOnLeave(bundleId, this.memory, this.pageFor(bundleId))) return;
    const next = remember(this.memory.lastUsed, bundleId, id);
    if (next === this.memory.lastUsed) return;
    this.memory = { ...this.memory, lastUsed: next };
    void jarvis.storage.set(storageKeys.lastUsed, next).catch(() => undefined);
  }

  /** 排进前台事件的队列；出错只记日志，队列不断。 */
  private enqueue(task: () => Promise<void>): Promise<void> {
    const run = this.queue.then(task).catch((error: unknown) => {
      jarvis.log.warn("按规则换输入法时出错", error instanceof Error ? error.message : String(error));
    });
    this.queue = run;
    return run;
  }

  /**
   * 切完 300 ms 核对一次：前台还是它、输入源却不是目标，就再切一次，只补一次（F-1）。不循环：真有别的工具在抢，循环只会和它打架。
   * @param target 目标。
   * @param token 切的那一次是第几次换前台。
   */
  private async verify(target: string, token: number): Promise<void> {
    if (token !== this.activation || this.settings.paused) return;
    const actual = (await jarvis.inputSources.current().catch(() => undefined))?.id;
    if (actual === undefined || actual === target || token !== this.activation) return;
    jarvis.log.warn("切过去之后又被改回去了，再切一次", { target, actual });
    const result = await jarvis.inputSources.select(target).catch(() => undefined);
    if (result?.effective) this.note(target);
  }

  /**
   * 输入法换了（谁换的都推）。
   * @param event 宿主推来的一条。
   */
  async onInputSource(event: InputSourcesEvent): Promise<void> {
    if (event.type === "listChanged") {
      await this.reloadSources();
      return this.render();
    }
    this.note(event.id);
    if (!event.bySelf && this.app) {
      // 你手动换的：当场记给此刻的应用。自己刚切的这里不记（换走时 `learn` 记离开那一刻用着的，W-2）。
      const next = remember(this.memory.lastUsed, this.app.bundleId, event.id);
      if (next !== this.memory.lastUsed) {
        this.memory = { ...this.memory, lastUsed: next };
        await jarvis.storage.set(storageKeys.lastUsed, next).catch(() => undefined);
      }
      if (this.settings.hud && this.settings.hudOnManual) await this.showHUD(this.source(event.id)?.name ?? event.id, this.source(event.id));
    }
    await this.render();
  }

  // MARK: - 动作

  private async switchTo(target: string, token?: number): Promise<void> {
    try {
      const result = await jarvis.inputSources.select(target);
      if (token !== undefined) setTimeout(() => void this.enqueue(() => this.verify(target, token)), VERIFY_DELAY_MS);
      if (!result.effective) {
        jarvis.log.warn("系统接了却没换过去", target);
        return;
      }
      this.note(target);
      if (this.settings.hud) await this.showHUD(this.source(target)?.name ?? target, this.source(target));
    } catch (error) {
      jarvis.log.warn("换输入法失败", error instanceof Error ? error.message : String(error));
    }
  }

  private async applyRule(app: FrontmostApp, choice: RuleChoice): Promise<void> {
    await this.loadRules();
    const rule = ruleFromChoice(choice, app.name);
    const rules = setRule(this.memory.rules, app.bundleId, rule);
    this.memory = { ...this.memory, rules };
    await jarvis.storage.set(storageKeys.rules, rules).catch(() => undefined);
    // 定成固定的那一个：你此刻就在这个应用里，当场换过去。
    if (rule?.mode === "fixed" && rule.source !== this.currentId && this.granted.includes("inputSources.select")) await this.switchTo(rule.source);
    await this.render();
  }

  /**
   * 菜单里给此刻这一页定输入法（`source` 为 `undefined` = 删掉，跟随应用）。落到已经命中的那条上，没有就是这一页的主机名。
   * @param source 输入法 id。
   */
  private async applySite(source: string | undefined): Promise<void> {
    const app = this.app;
    const url = app ? this.pages.get(app.bundleId) : undefined;
    if (!app || url === undefined) return;
    await this.loadRules();
    const pattern = sitePatternFor(url, this.memory.sites);
    if (!pattern) return;
    const sites = setSite(this.memory.sites, pattern, source);
    this.memory = { ...this.memory, sites };
    await jarvis.storage.set(storageKeys.sites, sites).catch(() => undefined);
    // 第一条网站规则：订上当前页。你此刻就在这一页上，下面直接换过去，补发的那一条不必再切。
    this.updateBrowserWatch(false);
    this.decided = resolveTarget(app.bundleId, this.memory, this.settings, this.sources.map((item) => item.id), this.pageFor(app.bundleId));
    if (this.decided !== undefined && this.decided !== this.currentId && this.granted.includes("inputSources.select")) await this.switchTo(this.decided);
    await this.render();
  }

  private async togglePause(): Promise<void> {
    const paused = !this.settings.paused;
    this.settings = { ...this.settings, paused };
    await jarvis.preferences.set("paused", paused).catch(() => undefined);
    await this.showHUD(paused ? "自动切换已暂停" : "自动切换已恢复", undefined, paused ? "pause.fill" : "play.fill");
    await this.render();
  }

  private note(id: string): void {
    if (this.currentId !== undefined && this.currentId !== id) this.previousId = this.currentId;
    this.currentId = id;
  }

  private source(id: string): InputSource | undefined {
    return this.sources.find((source) => source.id === id);
  }

  private async showHUD(text: string, source?: InputSource, symbol?: string): Promise<void> {
    if (!this.granted.includes("hud.show")) return;
    const clipped = [...text].slice(0, HUD_LIMIT).join("");
    const art = hudArt(source, symbol);
    const anchor = this.settings.hudAnchor;
    await jarvis.hud.show({ text: clipped, anchor, ...(anchor === "orb" ? { duration: ORB_DURATION_MS } : {}), ...art }).catch(() => undefined);
  }

  // MARK: - 存储

  private async loadMemory(): Promise<void> {
    const [rules, lastUsed, fallbackSource, sites] = await Promise.all([readRules(), readLastUsed(), readFallback(), readSites()]);
    this.memory = { rules, lastUsed, fallbackSource, sites };
  }

  private async loadRules(): Promise<void> {
    const [rules, fallbackSource, sites] = await Promise.all([readRules(), readFallback(), readSites()]);
    this.memory = { ...this.memory, rules, fallbackSource, sites };
  }

  private async render(): Promise<void> {
    this.menuSources = this.sources;
    await jarvis.menuBar
      .update(
        menuModel({
          app: this.app,
          page: this.app ? this.pageFor(this.app.bundleId) : undefined,
          sites: this.memory.sites,
          rules: this.memory.rules as Rules,
          sources: this.sources,
          currentId: this.currentId,
          settings: this.settings,
        }),
      )
      .catch(() => undefined);
  }
}

/**
 * 提示上画什么：系统自带的输入法画字标键帽（「A」「中」，与菜单栏上那个字一致），三方输入法用它自己的图标，
 * 都没有时用给的 SF Symbol（jarvis-mac `specs/20261030-210500-input-source-orb-crash-keycap` K-3）。
 * @param source 换成的输入法。
 * @param symbol 没有输入法时的符号（暂停 / 恢复）。
 * @returns `hud.show` 的图那一项。
 */
export function hudArt(source: InputSource | undefined, symbol?: string): { monogram: string } | { image: NonNullable<InputSource["icon"]> } | { symbol: string } | Record<string, never> {
  if (source && isSystemSource(source)) {
    const label = shortLabel(source);
    if (label) return { monogram: label };
  }
  if (source?.icon) return { image: source.icon };
  return symbol ? { symbol } : {};
}
