/**
 * 扩展页面：400×520 那块面板里的一屏。
 *
 * 五种样子，全由「输入框里那串字」决定，外加剪贴板那条命令留下的一点状态：
 *
 * | 屏 | 什么时候 |
 * | --- | --- |
 * | 分类 | 输入框是空的 |
 * | 详情 | 那串字指向确切的一条码 |
 * | 清单 | 命中多条 |
 * | 查不到 | 一条也没命中 |
 * | 未授权 | ⌥⌘/ 撞上了没给的 clipboard.read——它**只多一段**，页面其余部分照常能用 |
 *
 * 段的节奏抄内置工具：段与段 14、段内 10。一屏放得下就不滚；放不下的（4xx 有 28 条）
 * 交给根上的 `scroll`。
 */
import { jarvis, ui, type ActionSpec, type Tint, type UINode } from "@fusionseek/jarvis-extension-sdk";
import { byCode, standardCount, unofficialCount, type StatusCode } from "./data.js";
import { classSummaries, symbolFor, tintFor } from "./search.js";
import type { Session } from "./session.js";

/** 常查的几个：没有剪贴板授权那一屏用它顶掉分类清单，免得一屏之内又是说明又是五行。 */
const COMMON_CODES = [404, 500, 502, 429, 301];

const CLASS_TITLE: Record<number, string> = { 1: "信息", 2: "成功", 3: "重定向", 4: "客户端错误", 5: "服务端错误" };

function classBadge(entry: StatusCode): UINode {
  return ui.badge({ key: "class", title: CLASS_TITLE[Math.floor(entry.code / 100)] ?? "未知", tint: tintFor(entry.code) as Tint });
}

/** 「能不能重试」三态。它与「可不可缓存」一起，是工程师看一眼就想知道的两件事。 */
function retryBadge(entry: StatusCode): UINode {
  const map = {
    yes: { title: "可以重试", tint: "live" as Tint },
    maybe: { title: "看 Retry-After", tint: "amber" as Tint },
    no: { title: "重试没用", tint: "neutral" as Tint },
  };
  const it = map[entry.retriable];
  return ui.badge({ key: "retry", title: it.title, tint: it.tint });
}

function facts(entry: StatusCode): UINode {
  const children: UINode[] = [
    classBadge(entry),
    ui.badge({ key: "cache", title: entry.cacheable ? "默认可缓存" : "不可缓存", tint: "neutral" }),
    retryBadge(entry),
  ];
  if (entry.unofficial) children.push(ui.badge({ key: "unofficial", title: `非标准 · ${entry.unofficial}`, tint: "amber" }));
  return ui.stack({ key: "facts", axis: "horizontal", spacing: "tight", children });
}

/** 打开出处。没给 system.openURL 时就地问一次——按钮本身就是那次用户动作。 */
async function openDoc(session: Session, url: string): Promise<void> {
  if (!session.has("system.openURL")) {
    const result = await jarvis.permissions.request(["system.openURL"]);
    if (!result.granted.includes("system.openURL")) {
      // 拒了就别再问：这一屏改成把地址交给用户自己去开
      session.urlDenied = true;
      jarvis.ui.update();
      return;
    }
    session.grantLocally("system.openURL");
  }
  await jarvis.system.openURL(url);
}

function searchBox(session: Session): UINode {
  return ui.search({
    key: "query",
    value: session.query,
    placeholder: "输入状态码或关键词，如 404 / 超时 / redirect",
    label: "查状态码",
    onChange: (value) => session.setQuery(value),
  });
}

function footnote(text: string, key = "footnote"): UINode {
  return ui.text({ key, text, style: "footnote" });
}

const offlineNote = `离线 · ${standardCount} 个标准码 + ${unofficialCount} 个非标准码 · 一个请求都不发`;

// ── 分类（空输入）────────────────────────────────────────────────────────
function browse(session: Session): UINode[] {
  return [
    ui.section({
      key: "lookup",
      title: "查询 · LOOKUP",
      trailing: session.hotkey("lookup"),
      children: [searchBox(session)],
    }),
    ui.section({
      key: "classes",
      title: "分类 · CLASSES",
      trailing: `${standardCount} 个标准码`,
      children: classSummaries().map((summary) =>
        ui.row({
          key: `class-${summary.klass}`,
          symbol: summary.symbol,
          tint: summary.tint,
          title: summary.title,
          // 说全「标准码」：点进去的清单默认带上这一类的非标准码（4xx 多 7 条、5xx 多 5 条），
          // 只写「28 个」会和清单顶上那句「4xx · 35 个」读成矛盾
          subtitle: `${summary.count} 个标准码 · ${summary.preview}`,
          accessory: "chevron",
          onPress: () => session.setQuery(`${summary.klass}xx`),
        }),
      ),
    }),
    footnote(offlineNote),
  ];
}

/** 没有剪贴板授权那一屏用的紧凑版：搜索框 + 常查的几个 chip。 */
function compactBrowse(session: Session): UINode[] {
  return [
    ui.section({
      key: "lookup",
      title: "查询 · LOOKUP",
      trailing: session.hotkey("lookup"),
      children: [
        searchBox(session),
        ui.stack({
          key: "common",
          axis: "horizontal",
          spacing: "tight",
          alignment: "center",
          children: [
            ...COMMON_CODES.map((code) =>
              ui.chip({
                key: `common-${code}`,
                title: String(code),
                tint: tintFor(code) as Tint,
                help: byCode(code)?.zh,
                onPress: () => session.openCode(code),
              }),
            ),
            ui.spacer(),
            ui.text({ key: "common-label", text: "常查", style: "footnote" }),
          ],
        }),
      ],
    }),
  ];
}

// ── 详情 ────────────────────────────────────────────────────────────────
/**
 * 相关码那一枚 chip 上写什么。
 *
 * `stack` 是一行，装不下不会换行——所以这里有两条硬限制：**最多三枚**，
 * 而且中文名超过 6 个字就只留码。英文名与中文名都进 `help`（tooltip 与 VoiceOver 都读它），
 * 因此省掉的信息并没有丢。
 */
function chipTitle(entry: StatusCode): string {
  return Array.from(entry.zh).length > 6 ? String(entry.code) : `${entry.code} ${entry.zh}`;
}

function bullets(prefix: string, lines: string[]): UINode[] {
  return lines.map((line, index) => ui.text({ key: `${prefix}-${index}`, text: `· ${line}`, style: "subtle" }));
}

function detail(session: Session, entry: StatusCode): UINode[] {
  const children: UINode[] = [];

  if (session.previousQuery !== null) {
    children.push(
      ui.button({
        key: "back",
        title: `← 回到「${session.previousQuery}」`,
        variant: "link",
        size: "inline",
        onPress: () => session.back(),
      }),
    );
  }

  children.push(
    ui.readout({
      key: "readout",
      label: `${entry.zh} · ${CLASS_TITLE[Math.floor(entry.code / 100)] ?? ""}`,
      value: session.copyText(entry),
      tint: tintFor(entry.code) as Tint,
      copy: true,
    }),
    facts(entry),
    ui.text({ key: "summary", text: entry.summary, style: "body", selectable: true }),
  );

  if (entry.causes?.length) {
    children.push(ui.section({ key: "causes", title: "常见成因 · CAUSES", children: bullets("cause", entry.causes) }));
  }
  if (entry.fix?.length) {
    children.push(ui.section({ key: "fix", title: "怎么处理 · FIX", children: bullets("fix", entry.fix) }));
  }
  if (entry.related?.length) {
    children.push(
      ui.section({
        key: "related",
        title: "相关 · RELATED",
        trailing: entry.spec,
        children: [
          ui.stack({
            key: "related-chips",
            axis: "horizontal",
            spacing: "tight",
            children: entry.related
              .map((code) => byCode(code))
              .filter((related): related is StatusCode => Boolean(related))
              .slice(0, 3)
              .map((related) =>
                ui.chip({
                  key: `related-${related.code}`,
                  title: chipTitle(related),
                  tint: tintFor(related.code) as Tint,
                  help: `${related.name} · ${related.zh}`,
                  onPress: () => session.openCode(related.code, session.query),
                }),
              ),
          }),
        ],
      }),
    );
  }

  const links = session.links(entry);
  if (session.urlDenied) {
    children.push(
      ui.note({
        key: "url-denied",
        tint: "neutral",
        symbol: "link",
        title: "没有打开链接的授权",
        body: `出处是 ${entry.spec}：${links[0]?.url ?? ""}。把它复制出去自己打开也一样；想改主意就在 设置 › 扩展 里把「打开链接」打开。`,
      }),
    );
  }

  children.push(
    ui.stack({
      key: "actions",
      axis: "horizontal",
      spacing: "tight",
      alignment: "center",
      children: [
        ...(session.urlDenied
          ? [ui.copy({ key: "copy-url", text: links[0]?.url ?? "", variant: "chip", label: `复制 ${entry.spec} 的地址` })]
          : []),
        ...(session.urlDenied ? [] : links).map((link, index) =>
          ui.button({
            key: `link-${index}`,
            title: link.title,
            variant: "link",
            size: "inline",
            help: link.url,
            onPress: () => void openDoc(session, link.url),
          }),
        ),
        ui.spacer(),
        ui.copy({ key: "copy", text: session.copyText(entry), variant: "chip", label: `复制 ${session.copyText(entry)}` }),
      ],
    }),
  );

  return children;
}

// ── 清单 ────────────────────────────────────────────────────────────────
const RETRY_LABEL: Record<StatusCode["retriable"], string> = { yes: "可以重试", maybe: "看 Retry-After", no: "重试没用" };

function hoverCard(entry: StatusCode): UINode {
  return ui.card({
    tint: tintFor(entry.code) as Tint,
    children: [
      ui.stack({
        key: "head",
        axis: "horizontal",
        spacing: "tight",
        alignment: "center",
        children: [
          ui.text({ key: "code", text: `${entry.code} · ${entry.name.toUpperCase()}`, style: "sectionTitle", tint: tintFor(entry.code) as Tint }),
          ui.spacer(),
          ui.text({ key: "retry", text: RETRY_LABEL[entry.retriable], style: "footnote" }),
        ],
      }),
      ui.text({ key: "summary", text: entry.summary, style: "body" }),
      ui.text({ key: "hint", text: "点这一行展开完整一屏 · 指针移开即收", style: "footnote" }),
    ],
  });
}

/**
 * 清单里那一行的说明。
 *
 * 标准码给中文名加语义的第一句——它们是照着"单独一句也读得通"写的，所以截断了也不至于断在半截概念上；
 * 非标准码把这一格让给「非标准 · 来源」：一条不在注册表里的码，最该先说的就是这件事。
 */
function rowSubtitle(entry: StatusCode): string {
  if (entry.unofficial) return `${entry.zh} · 非标准 · ${entry.unofficial}`;
  const firstSentence = entry.summary.split("。")[0] ?? entry.summary;
  return `${entry.zh} · ${firstSentence}`;
}

function results(session: Session, entries: StatusCode[], label: string): UINode[] {
  const from = session.query;
  return [
    ui.section({
      key: "results",
      title: "结果 · RESULTS",
      trailing: label,
      children: [
        ui.list({
          key: "result-list",
          children: entries.map((entry) =>
            ui.row({
              key: String(entry.code),
              symbol: symbolFor(entry.code),
              tint: tintFor(entry.code),
              title: `${entry.code} · ${entry.name}`,
              subtitle: rowSubtitle(entry),
              accessory: "chevron",
              label: `${entry.code} ${entry.name} · ${entry.zh}`,
              onPress: () => session.openCode(entry.code, from),
              hoverCard: hoverCard(entry),
            }),
          ),
        }),
      ],
    }),
    ui.stack({
      key: "filters",
      axis: "horizontal",
      spacing: "tight",
      alignment: "center",
      children: [
        ui.chip({
          key: "unofficial",
          title: session.includeUnofficial ? "✓ 含非标准码" : "含非标准码",
          tint: "amber",
          selected: session.includeUnofficial,
          help: "nginx、IIS、Cloudflare 自己造的码；它们不在 IANA 注册表里",
          onPress: () => {
            session.includeUnofficial = !session.includeUnofficial;
          },
        }),
        ui.chip({
          key: "only-5xx",
          title: "只看 5xx",
          tint: "danger",
          selected: session.classFilter === 5,
          help: "只留服务端错误",
          onPress: () => {
            session.classFilter = session.classFilter === 5 ? null : 5;
          },
        }),
        ui.spacer(),
        ui.text({ key: "total", text: `${standardCount + unofficialCount} 个码在表里`, style: "footnote" }),
      ],
    }),
    footnote("点一行展开 · 指针停 320ms 浮出摘要 · Esc 清空搜索"),
  ];
}

// ── 查不到 ──────────────────────────────────────────────────────────────
function emptyScreen(session: Session, reason: "out-of-range" | "no-such-code" | "no-match"): UINode[] {
  const query = session.query.trim();
  const clear: ActionSpec = { id: "clear", title: "清空搜索", symbol: "xmark.circle", help: "回到分类", onPress: () => session.clear() };
  const title = reason === "no-match" ? `没有匹配「${query}」的码` : `没有 ${query} 这个码`;
  const hint =
    reason === "out-of-range"
      ? "状态码只有 100–599 这一段。999 这类是抓取被挡下时常见的自造码，不在任何注册表里。"
      : reason === "no-such-code"
        ? session.includeUnofficial
          ? "它在 100–599 之间，但没有任何规范或厂商定义过它——多半是某个服务自己造的。"
          : "它没有被任何规范定义过；如果是 nginx / Cloudflare 那类自造码，把「含非标准码」打开再搜一次。"
        : "换个词试试：中文名、英文名、别名与三位数字都收，也可以直接粘一整行响应进来。";
  return [
    ui.empty({ key: "empty", symbol: "questionmark.circle", title, hint, action: clear }),
    ui.note({
      key: "scope",
      tint: "neutral",
      symbol: "info.circle",
      title: "这里只收状态码",
      body: "Cache-Control、Retry-After 这些响应头，还有请求方法与 MIME 类型，都不在这张表里——查不到不等于不存在。",
    }),
    footnote(offlineNote),
  ];
}

// ── 未授权（只多一段，不是一整屏）────────────────────────────────────────
function deniedSection(session: Session): UINode[] {
  return [
    ui.section({
      key: "clipboard",
      title: "剪贴板 · CLIPBOARD",
      tint: "alert",
      trailing: "未授权",
      children: [
        ui.note({
          key: "denied",
          tint: "alert",
          symbol: "lock",
          title: "没有读剪贴板的授权",
          body: `第一次进入时你没勾「读剪贴板」。没有它，${session.commandRef("explain-clipboard", "解释剪贴板里的码")}这条命令跑不起来；页面里手输状态码不受影响。`,
          actions: [{ id: "grant", title: "授权", symbol: "lock.open", help: "再问一次读剪贴板的授权", onPress: () => void session.requestClipboard() }],
        }),
      ],
    }),
    ui.hairline(),
  ];
}

export function renderPage(session: Session): UINode {
  const denied = session.clipboard.kind === "denied";
  const outcome = session.outcome();
  const children: UINode[] = [];

  if (denied) children.push(...deniedSection(session));

  switch (outcome.kind) {
    case "browse":
      children.push(...(denied ? compactBrowse(session) : browse(session)));
      break;
    case "exact":
      children.push(searchBox(session), ...detail(session, outcome.entry));
      break;
    case "list":
      children.push(searchBox(session), ...results(session, outcome.entries, outcome.label));
      break;
    case "empty":
      children.push(searchBox(session), ...emptyScreen(session, outcome.reason));
      break;
  }

  if (denied) {
    children.push(footnote(`授权之后${session.commandRef("explain-clipboard", "解释剪贴板里的码")}会在指针旁原地弹出结果，面板不动。随时可以在 设置 › 扩展 里改。`, "denied-footnote"));
  }

  return ui.scroll({ children });
}
