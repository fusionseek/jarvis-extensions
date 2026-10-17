/**
 * 会话状态与三条异步路：找设备 → 列应用 → 一屏一屏读应用名与图标。
 *
 * **列表从不等名字**：`apps` 一回来就画（包名与大小），名字与图标随后一批一批补上去。读名字要宿主把安装包拉到本机、
 * 用 aapt2 读，每个包几百毫秒到几秒；一进页面就把几百个包都问一遍，用户要盯着一张空表等一分钟。
 *
 * 三条规则守住「一次一批、只读看得见的、换了上下文就不认旧账」：
 *
 * 1. **一次只有一批在途**（`detailsBusy`）：宿主那边是一台手机、一条 adb，并发只会让每一批都更慢；
 * 2. **只读画出来的行**（`detailTargets()`）：先是第一页，滚到哪读到哪；用户点「读全部应用名」才往后读；
 * 3. **代号**（`generation`）：换设备、换范围、重新扫描、页面离开都让代号 +1；回来得晚的 `apps` 结果代号对不上就扔掉。
 *    `appDetails` 的结果按「序列号 + 包名」落进缓存——换了设备也不会张冠李戴——但只有页面还开着才接着排下一批。
 *
 * 缓存活在这个 JSContext 里（面板关了再开还在），按安装包大小判断还能不能用（`isCacheFresh`）：重新扫描之后，
 * 更新过的应用会重读，没动过的不再拉一次安装包。
 */
import {
  jarvis,
  maximumAndroidAppDetailsPerCall,
  sleep,
  type ActivationContext,
  type AndroidApp,
  type AndroidAppDetail,
  type AndroidAppScope,
  type AndroidDevice,
  type AndroidTool,
  type CapabilityID,
} from "@fusionseek/jarvis-extension-sdk";
import {
  chooseSerial,
  describeError,
  isCacheFresh,
  matchesQuery,
  nextDetailsBatch,
  nextVisibleCount,
  pageSize,
  rowsToRender,
  sortApps,
  type CachedDetail,
  type SortOrder,
} from "./model.js";

/** 内置工具在界面上的名字：报错与授权说明里用。 */
export const toolTitle: Record<AndroidTool, string> = { apkScan: "APK 扫描", dataExport: "数据导出" };

/** `rate.limited` 之后等多久再接着读名字。宿主的上限是每分钟 120 次，等 5 秒足够让窗口滑过去，又不至于让人以为它停了。 */
const rateLimitBackoffMs = 5000;

/** 页面上一张临时说明（交给工具失败）。 */
export interface Notice {
  title: string;
  body: string;
}

/** 读名字的进度：画出来的行里几行已经有了名字（或确定读不出）。 */
export interface DetailsProgress {
  done: number;
  target: number;
}

export class Session {
  /** 此刻拿到的能力。 */
  granted: string[] = [];
  /** adb 看得见的设备；`null` = 还没问过。 */
  devices: AndroidDevice[] | null = null;
  devicesLoading = false;
  /** 列设备失败的那句话（「未找到 adb」）。 */
  devicesError: string | null = null;
  /** 选着的设备。 */
  serial: string | null = null;
  scope: AndroidAppScope = "user";
  sort: SortOrder = "size";
  query = "";
  /** 这台设备、这一种范围下的应用；`null` = 还没列出来。 */
  apps: AndroidApp[] | null = null;
  appsLoading = false;
  /** 列应用失败的那句话。 */
  appsError: string | null = null;
  /** 列表展开到几行。 */
  visibleCount = pageSize;
  /** 用户点了「读全部应用名」：不只读画出来的行。换设备、换范围、重新扫描时复位。 */
  readAll = false;
  /** 读名字整批失败的那句话（「没有 aapt2，读不出应用名和图标」）；有它就不再往下读，等用户按「重试」。 */
  detailsProblem: string | null = null;
  /** 用户拒了「交给 APK 扫描 / 数据导出」。 */
  toolsDenied = false;
  notice: Notice | null = null;

  private active = false;
  private generation = 0;
  /** `apps` 是哪一台、哪一种范围的：同一个键刷新时旧列表留在屏幕上，换了键才清空。 */
  private appsKey: string | null = null;
  private detailsBusy = false;
  /** `序列号\0包名` → 详情。 */
  private cache = new Map<string, CachedDetail>();

  // ── 生命周期 ──────────────────────────────────────────────────────────

  /**
   * 页面 activate：记下授权，**不等**任何调用就返回——第一棵树要立刻画出来（「正在找设备」），不能是一块空白。
   * @param context 宿主给的上下文。
   * @returns 无。
   */
  activate(context: ActivationContext): void {
    this.granted = [...context.granted];
    this.active = true;
    this.notice = null;
    // 用户可能在设置里把「交给工具」打开了：上一次留下的拒绝说明不再成立
    if (this.has("android.tools.open")) this.toolsDenied = false;
    if (!this.has("android.apps.read")) return;
    void this.refresh();
  }

  /** 页面离开：代号 +1，在途的结果回来也不再接着排、不再重画。 */
  deactivate(): void {
    this.active = false;
    this.generation += 1;
  }

  has(capability: CapabilityID): boolean {
    return this.granted.includes(capability);
  }

  private grantLocally(capability: CapabilityID): void {
    if (!this.has(capability)) this.granted = [...this.granted, capability];
  }

  private revokeLocally(capability: CapabilityID): void {
    this.granted = this.granted.filter((id) => id !== capability);
  }

  // ── 设备与列表 ────────────────────────────────────────────────────────

  /**
   * 重新扫描：先问设备，再列选着的那台上的应用。读名字的整批失败也一起复位——用户按重新扫描，多半是刚装好 aapt2 或换了线。
   * @returns 列完（或失败）时兑现；从不抛。
   */
  async refresh(): Promise<void> {
    const generation = ++this.generation;
    this.devicesLoading = true;
    this.devicesError = null;
    this.appsLoading = false;
    // 上一次一台能读的都没有（那一屏是「没有连着的设备」之类）：回到「正在找」，免得按了重新扫描屏幕一动不动
    if (!this.devices?.some((device) => device.ready)) this.devices = null;
    this.detailsProblem = null;
    this.readAll = false;
    this.notice = null;
    jarvis.ui.update();
    let devices: AndroidDevice[];
    try {
      devices = await jarvis.android.devices();
    } catch (error) {
      if (generation !== this.generation) return;
      this.devicesLoading = false;
      this.fail(error, "读不到 adb 的设备列表", (message) => {
        this.devicesError = message;
        this.devices = null;
      });
      jarvis.ui.update();
      return;
    }
    if (generation !== this.generation) return;
    this.devicesLoading = false;
    this.devices = devices;
    const serial = chooseSerial(devices, this.serial);
    if (serial !== this.serial) {
      this.serial = serial;
      this.resetView();
    }
    if (serial === null) {
      this.apps = null;
      this.appsKey = null;
      jarvis.ui.update();
      return;
    }
    await this.loadApps(generation);
  }

  /**
   * 换一台设备（多台 ready 时的下拉）。
   * @param serial 选中的序列号。
   */
  selectDevice(serial: string): void {
    if (serial === this.serial || !this.devices?.some((device) => device.serial === serial && device.ready)) return;
    this.serial = serial;
    this.detailsProblem = null;
    this.resetView();
    void this.loadApps(++this.generation);
  }

  /**
   * 换范围：用户应用 / 全部。
   * @param scope 新范围。
   */
  selectScope(scope: string): void {
    if ((scope !== "user" && scope !== "all") || scope === this.scope) return;
    this.scope = scope;
    this.resetView();
    if (this.serial !== null) void this.loadApps(++this.generation);
  }

  /**
   * 换排序。只是同一份数据换个顺序：不重新列，只回到第一页，并按新的第一页接着读名字。
   * @param order `size` / `name`。
   */
  selectSort(order: string): void {
    if ((order !== "size" && order !== "name") || order === this.sort) return;
    this.sort = order;
    this.visibleCount = pageSize;
    this.pump();
  }

  /**
   * 搜索框里的字变了。
   * @param query 新的字。
   */
  setQuery(query: string): void {
    this.query = query;
    this.visibleCount = pageSize;
    this.pump();
  }

  /** 再展开一页（列表滚到底的哨兵，或底部那颗按钮）。 */
  loadMore(): void {
    this.visibleCount = nextVisibleCount(this.visibleCount);
    this.pump();
  }

  /** 「读全部应用名」：搜索要按名字找到还没轮到的那些应用时，用户自己点。 */
  readAllLabels(): void {
    this.readAll = true;
    this.pump();
  }

  /** 读名字整批失败之后的「重试」。 */
  retryDetails(): void {
    this.detailsProblem = null;
    this.pump();
  }

  private resetView(): void {
    this.visibleCount = pageSize;
    this.readAll = false;
  }

  private async loadApps(generation: number): Promise<void> {
    const serial = this.serial;
    if (serial === null) return;
    const scope = this.scope;
    const key = `${serial}\u0000${scope}`;
    if (this.appsKey !== key) {
      this.apps = null;
      this.appsKey = key;
    }
    this.appsLoading = true;
    this.appsError = null;
    jarvis.ui.update();
    try {
      const list = await jarvis.android.apps({ serial, scope });
      if (generation !== this.generation) return;
      this.apps = list.apps;
    } catch (error) {
      if (generation !== this.generation) return;
      this.fail(error, "列不出这台设备上的应用", (message) => {
        this.appsError = message;
      });
    }
    this.appsLoading = false;
    jarvis.ui.update();
    this.pump();
  }

  /**
   * 一次调用被拒：没授权 → 拒绝态（不是错误）；取消 → 什么都不说；其余把那句人话交给 `show`。
   */
  private fail(error: unknown, fallback: string, show: (message: string) => void): void {
    const { code, message } = describeError(error, fallback);
    if (code === "permission.denied") {
      this.revokeLocally("android.apps.read");
      return;
    }
    if (code === "cancelled") return;
    show(message);
  }

  /**
   * 这一页没有授权时那颗「授权」。只从按钮回调里调（宿主只在用户动作 1 秒内放行）。
   * @returns 问完（并在拿到授权时开始扫描）时兑现。
   */
  async requestAppsAccess(): Promise<void> {
    const result = await jarvis.permissions.request(["android.apps.read"]);
    if (result.granted.includes("android.apps.read")) {
      this.grantLocally("android.apps.read");
      void this.refresh();
    }
    jarvis.ui.update();
  }

  // ── 列表视图 ──────────────────────────────────────────────────────────

  /**
   * 一个包此刻可用的详情：缓存里有、且读它时的安装包大小与此刻一样。
   * @param app 应用。
   * @returns 详情；没有为 `undefined`。
   */
  detailFor(app: AndroidApp): AndroidAppDetail | undefined {
    if (this.serial === null) return undefined;
    const entry = this.cache.get(`${this.serial}\u0000${app.package}`);
    return entry && isCacheFresh(entry, app) ? entry.detail : undefined;
  }

  /** 按包名取详情（排序、搜索用）。 */
  private detailByName(): (name: string) => AndroidAppDetail | undefined {
    const index = new Map((this.apps ?? []).map((app) => [app.package, app]));
    return (name) => {
      const app = index.get(name);
      return app ? this.detailFor(app) : undefined;
    };
  }

  /** 全部应用按此刻的排序排好（不过滤）。 */
  sortedApps(): AndroidApp[] {
    return sortApps(this.apps ?? [], this.sort, this.detailByName());
  }

  /** 过滤之后的全部（不截断）。 */
  matchedApps(): AndroidApp[] {
    return this.sortedApps().filter((app) => matchesQuery(app, this.detailFor(app), this.query));
  }

  /** 此刻画出来的那几行。 */
  visibleApps(): AndroidApp[] {
    const matched = this.matchedApps();
    return matched.slice(0, rowsToRender(matched.length, this.visibleCount));
  }

  /**
   * 读名字的候选，按优先级：先是画出来的行；点了「读全部应用名」再接上整张表（不过滤）。
   */
  private detailTargets(): AndroidApp[] {
    const visible = this.visibleApps();
    return this.readAll ? [...visible, ...this.sortedApps()] : visible;
  }

  /** 还没读到名字的应用有几个（搜索的空结果那一屏要说）。 */
  unlabeledCount(): number {
    return (this.apps ?? []).filter((app) => this.detailFor(app) === undefined).length;
  }

  /**
   * 读名字的进度：画出来的行（「读全部」时是整张表）里有几行已经有了详情。
   * @returns 进度；没在读、或没有要读的为 `null`。
   */
  detailsProgress(): DetailsProgress | null {
    if (!this.detailsBusy) return null;
    const targets = this.readAll ? this.apps ?? [] : this.visibleApps();
    const done = targets.filter((app) => this.detailFor(app) !== undefined).length;
    return { done, target: targets.length };
  }

  // ── 一批一批读名字 ────────────────────────────────────────────────────

  /**
   * 排下一批。没开着、在读、整批失败过、没有列表、或没有要问的了，都什么都不做。
   * 结果按序列号 + 包名落进缓存；页面还开着才重画、才排下一批（换了设备也接着排——新设备的那一批）。
   */
  private pump(): void {
    if (!this.active || this.detailsBusy || this.detailsProblem !== null || this.serial === null || this.apps === null) return;
    if (!this.has("android.apps.read")) return;
    const serial = this.serial;
    const targets = this.detailTargets();
    const byName = new Map(targets.map((app) => [app.package, app]));
    const batch = nextDetailsBatch(
      targets.map((app) => app.package),
      (name) => {
        const app = byName.get(name);
        return app !== undefined && this.detailFor(app) !== undefined;
      },
      maximumAndroidAppDetailsPerCall,
    );
    if (batch.length === 0) return;
    // 记下发出去那一刻的安装包大小：结果回来时列表可能已经换成另一台、另一种范围。
    const sizes = new Map(batch.map((name) => [name, byName.get(name)?.apkBytes ?? null]));
    this.detailsBusy = true;
    jarvis.ui.update();
    void this.readBatch(serial, batch, sizes);
  }

  private async readBatch(serial: string, batch: string[], sizes: Map<string, number | null>): Promise<void> {
    let retryAfter = 0;
    try {
      const details = await jarvis.android.appDetails({ serial, packages: batch });
      const answered = new Map(details.map((detail) => [detail.package, detail]));
      for (const name of batch) {
        // 宿主漏掉的包也记一条「读不出」：否则它永远排在下一批的第一个，一直被问。
        const detail = answered.get(name) ?? { package: name, label: null, versionName: null, icon: null, problem: "宿主没有交回这个包" };
        this.cache.set(`${serial}\u0000${name}`, { detail, apkBytes: sizes.get(name) ?? null });
      }
    } catch (error) {
      const { code, message } = describeError(error, "读不出应用名和图标");
      if (code === "permission.denied") {
        this.revokeLocally("android.apps.read");
      } else if (code === "rate.limited") {
        retryAfter = rateLimitBackoffMs;
      } else if (code === "invalid.argument") {
        // 宿主不认这几个包名（多半是包名里有它不收的字符）：记成读不出，接着读别的，不让整页停下。
        for (const name of batch) {
          this.cache.set(`${serial}\u0000${name}`, {
            detail: { package: name, label: null, versionName: null, icon: null, problem: message },
            apkBytes: sizes.get(name) ?? null,
          });
        }
      } else if (code !== "cancelled") {
        this.detailsProblem = message;
      }
    }
    if (retryAfter > 0) {
      const generation = this.generation;
      await sleep(retryAfter);
      if (generation !== this.generation) {
        this.detailsBusy = false;
        this.pump();
        return;
      }
    }
    this.detailsBusy = false;
    if (!this.active) return;
    jarvis.ui.update();
    this.pump();
  }

  // ── 交给内置工具 ──────────────────────────────────────────────────────

  /**
   * 行尾那两颗：把包名交给内置的「APK 扫描」或「数据导出」。没授权时就地问一次——按钮本身就是那次用户动作。
   * 打开成功之后宿主把面板切到那个工具，这一页随之离开。
   * @param tool 哪一个工具。
   * @param name 包名。
   * @returns 交出去（或失败、被拒）时兑现；从不抛。
   */
  async openTool(tool: AndroidTool, name: string): Promise<void> {
    this.notice = null;
    if (!this.has("android.tools.open")) {
      const result = await jarvis.permissions.request(["android.tools.open"]);
      if (!result.granted.includes("android.tools.open")) {
        this.toolsDenied = true;
        jarvis.ui.update();
        return;
      }
      this.grantLocally("android.tools.open");
    }
    this.toolsDenied = false;
    try {
      await jarvis.android.openTool({ tool, package: name });
    } catch (error) {
      const { code, message } = describeError(error, `没能打开「${toolTitle[tool]}」`);
      if (code === "permission.denied") {
        this.revokeLocally("android.tools.open");
        this.toolsDenied = true;
      } else if (code !== "cancelled") {
        this.notice = { title: `没能交给「${toolTitle[tool]}」`, body: message };
      }
    }
    jarvis.ui.update();
  }

  /** 「授权」那颗（交给工具被拒之后）。 */
  async requestToolsAccess(): Promise<void> {
    const result = await jarvis.permissions.request(["android.tools.open"]);
    if (result.granted.includes("android.tools.open")) {
      this.grantLocally("android.tools.open");
      this.toolsDenied = false;
    }
    jarvis.ui.update();
  }

  dismissNotice(): void {
    this.notice = null;
  }
}
