/**
 * 工具箱页面：面板里 400×520 那一屏（内容区 368 宽）。
 *
 * 两段：「设备」一行（名字 + 重新扫描；多台时一个下拉），「应用」一段（搜索、范围与排序、进度、清单）。
 * 设备那一段在正常时只有标题行——这块面板最稀缺的是纵向，留给清单。
 *
 * | 屏 | 什么时候 |
 * | --- | --- |
 * | 没授权 | 没有 `android.apps.read`：一屏说明 + 「授权」 |
 * | 找设备 | 第一次 `devices()` 还没回来 |
 * | 读不到设备 | `devices()` 被拒（「未找到 adb」）：宿主那句话原样给出来 + 重新扫描 |
 * | 没有设备 | 一台都没连 |
 * | 设备读不了 | 连着的都没允许调试 / 离线：在手机上点「允许 USB 调试」 |
 * | 清单 | 有 ready 的设备：先画包名与大小，名字与图标一批一批补上 |
 *
 * 行尾两颗图标按钮用内置工具自己的那两枚符号（`shippingbox` / `square.and.arrow.down`）：
 * 点过去落在那个工具里，徽标与刚才那颗按钮是同一枚，用户知道自己到了哪儿。
 */
import { ui, type ActionSpec, type AndroidApp, type AndroidDevice, type EmptyNode, type UINode } from "@fusionseek/jarvis-extension-sdk";
import { canLoadMore, deviceIssue, displayName, formatBytes, maximumRows, pageSize, rowSubtitle, summarize, summaryLine, totalBytes } from "./model.js";
import { toolTitle, type Session } from "./session.js";

function rescanAction(session: Session): ActionSpec {
  return { id: "rescan", title: "重新扫描", symbol: "arrow.clockwise", help: "重新扫描设备与应用", onPress: () => void session.refresh() };
}

function footnote(key: string, text: string): UINode {
  return ui.text({ key, text, style: "footnote" });
}

// ── 整屏的几种空 ────────────────────────────────────────────────────────

function deniedScreen(session: Session): UINode {
  return ui.empty({
    key: "denied",
    symbol: "lock",
    title: "没有读取手机应用的授权",
    hint: "扫描要经 adb 读手机上装了哪些应用；读应用名和图标时把安装包临时拉到本机，读完即删。",
    action: { id: "grant", title: "授权", onPress: () => void session.requestAppsAccess() },
  });
}

function rescanEmpty(session: Session, key: string, symbol: string, title: string, hint: string): UINode {
  return ui.empty({ key, symbol, title, hint, action: { id: "rescan", title: "重新扫描", onPress: () => void session.refresh() } });
}

/** 没有一台 ready 的设备时那一屏。 */
function deviceScreen(session: Session, devices: AndroidDevice[]): UINode {
  if (devices.length === 0) {
    return rescanEmpty(session, "no-device", "cable.connector", "没有连着的安卓设备", "用 USB 连上手机、打开 USB 调试，再点重新扫描");
  }
  // 都读不了：说第一台的情况（最常见是「还没点允许」）；不止一台时补一句还有几台
  const first = devices[0]!;
  const issue = deviceIssue(first);
  const more = devices.length > 1 ? `（另有 ${devices.length - 1} 台也读不了）` : "";
  return rescanEmpty(session, "device-issue", "lock.iphone", issue.title, `${issue.hint}${more}`);
}

// ── 设备段 ──────────────────────────────────────────────────────────────

function deviceSection(session: Session, devices: AndroidDevice[]): UINode {
  const ready = devices.filter((device) => device.ready);
  const current = ready.find((device) => device.serial === session.serial);
  const children: UINode[] = [];
  if (ready.length > 1) {
    children.push(
      ui.picker({
        key: "device",
        label: "选设备",
        layout: "compact",
        value: session.serial ?? "",
        options: ready.map((device) => ({ value: device.serial, title: device.name, detail: device.serial })),
        onChange: (serial) => session.selectDevice(serial),
      }),
    );
  }
  const blocked = devices.filter((device) => !device.ready);
  if (blocked.length > 0) {
    const issue = deviceIssue(blocked[0]!);
    const more = blocked.length > 1 ? `等 ${blocked.length} 台` : "";
    children.push(footnote("blocked", `${issue.title}${more}：${issue.hint}`));
  }
  return ui.section({
    key: "device-section",
    title: "设备 · DEVICE",
    // 多台时名字已经在下拉里，标题右端不再重复；重新扫描期间这里说一声，旧的清单先留在屏幕上
    ...(session.devicesLoading ? { trailing: "正在扫描" } : ready.length === 1 && current ? { trailing: current.name } : {}),
    actions: [rescanAction(session)],
    children,
  });
}

// ── 应用段 ──────────────────────────────────────────────────────────────

function controls(session: Session): UINode[] {
  return [
    ui.search({
      key: "query",
      value: session.query,
      placeholder: "搜应用名或包名",
      label: "搜应用",
      onChange: (value) => session.setQuery(value),
    }),
    ui.stack({
      key: "modes",
      axis: "horizontal",
      spacing: "tight",
      alignment: "center",
      children: [
        ui.segmented({
          key: "scope",
          label: "范围",
          layout: "full",
          value: session.scope,
          options: [
            { value: "user", title: "用户应用", help: "只列你自己装的应用" },
            { value: "all", title: "全部", help: "连同系统应用一起列" },
          ],
          onChange: (value) => session.selectScope(value),
        }),
        ui.segmented({
          key: "sort",
          label: "排序",
          layout: "full",
          value: session.sort,
          options: [
            { value: "size", title: "按大小", help: "占得多的在前" },
            { value: "name", title: "按名称", help: "按应用名；还没读到名字的按包名" },
          ],
          onChange: (value) => session.selectSort(value),
        }),
      ],
    }),
  ];
}

function toolActions(session: Session, app: AndroidApp): ActionSpec[] {
  return [
    {
      id: "apk-scan",
      title: toolTitle.apkScan,
      symbol: "shippingbox",
      help: `在「${toolTitle.apkScan}」里打开 ${app.package}`,
      onPress: () => void session.openTool("apkScan", app.package),
    },
    {
      id: "data-export",
      title: toolTitle.dataExport,
      symbol: "square.and.arrow.down",
      help: `在「${toolTitle.dataExport}」里打开 ${app.package}`,
      onPress: () => void session.openTool("dataExport", app.package),
    },
  ];
}

function appRow(session: Session, app: AndroidApp): UINode {
  const detail = session.detailFor(app);
  const title = displayName(app, detail);
  const total = totalBytes(app);
  const spoken = [title, detail?.versionName ? `版本 ${detail.versionName}` : null, total === null ? "大小读不出" : `共 ${formatBytes(total)}`]
    .filter((part): part is string => part !== null)
    .join("，");
  return ui.row({
    key: app.package,
    // 读到图标就换成图标；还没轮到、或读不出时是同一口井里的通用应用符号
    ...(detail?.icon ? { image: detail.icon } : { symbol: "app" }),
    title,
    subtitle: rowSubtitle(app, detail, session.scope),
    label: spoken,
    actions: toolActions(session, app),
  });
}

function emptyList(session: Session): EmptyNode {
  const query = session.query.trim();
  if (query === "") {
    return session.scope === "user"
      ? ui.empty({ symbol: "app.dashed", title: "这台设备上没有用户应用", hint: "切到「全部」看系统应用" })
      : ui.empty({ symbol: "app.dashed", title: "这台设备上一个应用都没列出来", hint: "点重新扫描再试一次" });
  }
  const unlabeled = session.unlabeledCount();
  const total = session.apps?.length ?? 0;
  const hint =
    unlabeled > 0
      ? `应用名读到之后才搜得到（已读 ${total - unlabeled} / ${total}）；没读到名字的只按包名匹配`
      : "按应用名或包名搜，不分大小写";
  return ui.empty({ symbol: "magnifyingglass", title: `没有匹配「${query}」的应用`, hint });
}

function notes(session: Session): UINode[] {
  const out: UINode[] = [];
  if (session.detailsProblem !== null) {
    out.push(
      ui.note({
        key: "details-problem",
        tint: "alert",
        symbol: "exclamationmark.triangle",
        title: "读不出应用名和图标",
        body: `${session.detailsProblem}。包名与大小照常列出。`,
        actions: [{ id: "retry-details", title: "重试", onPress: () => session.retryDetails() }],
      }),
    );
  }
  if (session.toolsDenied) {
    out.push(
      ui.note({
        key: "tools-denied",
        tint: "alert",
        symbol: "lock",
        title: "没有交给 APK 扫描 / 数据导出的授权",
        body: "行尾那两颗按钮要它才能把包名交过去；也可以在 设置 › 扩展 › 手机应用 里打开。",
        actions: [{ id: "grant-tools", title: "授权", onPress: () => void session.requestToolsAccess() }],
      }),
    );
  }
  if (session.notice) {
    out.push(
      ui.note({
        key: "notice",
        tint: "danger",
        symbol: "xmark.octagon",
        title: session.notice.title,
        body: session.notice.body,
        actions: [{ id: "dismiss-notice", title: "知道了", onPress: () => session.dismissNotice() }],
      }),
    );
  }
  return out;
}

function appsSection(session: Session, deviceName: string): UINode {
  const children: UINode[] = [...controls(session)];
  const apps = session.apps;

  if (apps === null) {
    // 还没列出来：要么在列，要么列失败了
    if (session.appsError !== null) {
      children.push(
        ui.note({
          key: "apps-error",
          tint: "danger",
          symbol: "xmark.octagon",
          title: "列不出应用",
          body: session.appsError,
          actions: [{ id: "rescan-apps", title: "重新扫描", onPress: () => void session.refresh() }],
        }),
      );
    } else {
      children.push(ui.progress({ key: "apps-progress", tint: "accent", label: `正在读 ${deviceName} 上的应用` }));
    }
    return ui.section({ key: "apps-section", title: "应用 · APPS", children });
  }

  const matched = session.matchedApps();
  const visible = session.visibleApps();
  const searching = session.query.trim() !== "";
  const all = summarize(apps);
  const progress = session.detailsProgress();

  if (session.appsLoading) {
    children.push(ui.progress({ key: "apps-progress", tint: "accent", label: "正在刷新应用列表" }));
  } else if (progress && progress.target > 0) {
    children.push(
      ui.progress({
        key: "details-progress",
        tint: "accent",
        value: progress.done / progress.target,
        label: `读应用名与图标 ${progress.done} / ${progress.target}`,
      }),
    );
  }
  if (session.appsError !== null) {
    children.push(ui.note({ key: "apps-error", tint: "danger", symbol: "xmark.octagon", title: "刷新失败，下面是上一次的列表", body: session.appsError }));
  }
  children.push(...notes(session));

  const more = canLoadMore(matched.length, session.visibleCount);
  children.push(
    ui.list({
      key: "apps",
      children: visible.map((app) => appRow(session, app)),
      emptyState: emptyList(session),
      ...(more ? { onLoadMore: () => session.loadMore() } : {}),
    }),
  );
  if (more) {
    // 宿主的哨兵滚到才触发；这颗按钮给键盘用户，也给滚不到底的那一下
    const next = Math.min(pageSize, matched.length - visible.length);
    children.push(ui.button({ key: "load-more", title: `再列 ${next} 个`, variant: "link", size: "inline", onPress: () => session.loadMore() }));
  } else if (matched.length > maximumRows) {
    children.push(footnote("cap", `只列出前 ${maximumRows} 个：用搜索缩小范围`));
  }
  if (searching && matched.length === 0 && session.unlabeledCount() > 0 && !session.readAll && session.detailsProblem === null) {
    children.push(
      ui.button({ key: "read-all", title: "读全部应用名", variant: "secondary", size: "inline", help: "一批 8 个往后读，读到的名字随时搜得到", onPress: () => session.readAllLabels() }),
    );
  }
  if (all.unknown > 0) children.push(footnote("unknown-size", `${all.unknown} 个应用读不出大小，没算进总数`));

  return ui.section({
    key: "apps-section",
    title: "应用 · APPS",
    trailing: summaryLine(summarize(matched), all, searching),
    children,
  });
}

/**
 * 这一屏。
 * @param session 会话。
 * @returns 根节点（`scroll`）。
 */
export function renderPage(session: Session): UINode {
  if (!session.has("android.apps.read")) return ui.scroll({ children: [deniedScreen(session)] });

  const devices = session.devices;
  if (devices === null) {
    if (session.devicesError !== null) {
      return ui.scroll({
        children: [rescanEmpty(session, "devices-error", "exclamationmark.triangle", "读不到设备", session.devicesError)],
      });
    }
    if (!session.devicesLoading) {
      // 上一次扫描被宿主取消了（没有结论也没有错误）：给一颗按钮，而不是一条永远不满的进度条
      return ui.scroll({ children: [rescanEmpty(session, "not-scanned", "arrow.clockwise", "还没扫描", "点重新扫描，读连着的安卓设备")] });
    }
    return ui.scroll({
      children: [ui.progress({ key: "devices-progress", tint: "accent", label: "正在找连着的安卓设备" })],
    });
  }

  const current = devices.find((device) => device.ready && device.serial === session.serial);
  if (!current) return ui.scroll({ children: [deviceScreen(session, devices)] });

  return ui.scroll({
    children: [
      deviceSection(session, devices),
      appsSection(session, current.name),
      footnote("hint", "行尾两颗：交给「APK 扫描」或「数据导出」，包名已经填好，开始由你在那边按"),
    ],
  });
}
