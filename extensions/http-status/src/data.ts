/**
 * 状态码表 —— 这个扩展的全部"数据源"。
 *
 * 它编在 `dist/extension.js` 里，因此 manifest 的授权清单上**没有 network.https**：
 * 一个查手册的工具没有理由拿到出网的权力，而状态码这张表一年也变不了几次——
 * 它跟着扩展的版本走，不跟着网络走。
 *
 * 62 个标准码取自 IANA 的 HTTP Status Code Registry（注册表里 418 标着 Unused，
 * 因此它被算进下面的"非标准"那一组）；12 个非标准码是实际日志里最常撞见的那些：
 * nginx、IIS、Cloudflare 各自造的，它们**不在**任何注册表里，命中时界面上会标出来。
 *
 * 每条的字段回答的是同一串问题：它叫什么（`name` / `zh`）、什么意思（`summary`）、
 * 为什么会出现（`causes`）、该怎么办（`fix`）、还能看哪几个（`related`）、
 * 出处在哪（`spec` / `specUrl`）、能不能缓存、要不要重试。
 */

/** 能不能重试。`maybe` = 要看请求是不是幂等的，或者要看 `Retry-After`。 */
export type Retriable = "yes" | "no" | "maybe";

export interface StatusCode {
  code: number;
  /** 注册表里的英文 reason phrase。 */
  name: string;
  /** 中文名。它同时是搜索的主要中文入口（搜「超时」命中 408 / 504 / 522 / 524）。 */
  zh: string;
  /** 一句话语义：这个码到底在说什么，以及它**不**在说什么。 */
  summary: string;
  /** 常见成因；只给最常撞见的三条以内，多了等于没给。 */
  causes?: string[];
  /** 怎么处理。写给"看到这个码的人"，不是写给规范。 */
  fix?: string[];
  /** 相关的码：读完这条最可能要接着看的那几个。 */
  related?: number[];
  /** 出处，形如 `RFC 9110 §15.5.5`。 */
  spec: string;
  /** 出处链接；`system.openURL` 只放行 https。 */
  specUrl: string;
  /** 默认是否可缓存（RFC 9110 §15.1 的启发式可缓存清单）。 */
  cacheable: boolean;
  retriable: Retriable;
  /** 额外的搜索词（英文别名、口语说法）。 */
  aliases?: string[];
  /** 非标准码：这里写它是谁造的（`nginx` / `Cloudflare` / `IIS` …）。标准码不带这个字段。 */
  unofficial?: string;
}

const rfc9110 = (section: string) => `https://www.rfc-editor.org/rfc/rfc9110#section-${section}`;
const rfc = (number: number, section?: string) =>
  `https://www.rfc-editor.org/rfc/rfc${number}${section ? `#section-${section}` : ""}`;

/**
 * 源码里按类分组，非标准码单独一组放在最后——这样读得下去，也改得动。
 * 对外暴露的 `catalog` 是它**按码升序**之后的样子：顺序就是搜索结果的顺序，
 * 没有"相关度"排序，查手册的人要的是可预测，而不是每次换一批。
 */
const entries: StatusCode[] = [
  // ── 1xx 信息 ────────────────────────────────────────────────────────────
  {
    code: 100, name: "Continue", zh: "继续",
    summary: "服务端收到了请求头，愿意接着收正文。只有客户端先发了 Expect: 100-continue 才会出现。",
    causes: ["客户端带 Expect: 100-continue 发了一个大 body"],
    fix: ["不用处理：HTTP 库会自己接着发 body，最终状态是后面那个"],
    related: [417, 413], spec: "RFC 9110 §15.2.1", specUrl: rfc9110("15.2.1"),
    cacheable: false, retriable: "no", aliases: ["expect"],
  },
  {
    code: 101, name: "Switching Protocols", zh: "切换协议",
    summary: "服务端同意按 Upgrade 头换协议，这条连接之后不再是普通 HTTP。ws:// 握手成功就是它。",
    causes: ["ws:// 握手（Upgrade: websocket）", "h2c 升级"],
    fix: ["握手成功：接着按新协议读写这条连接"],
    related: [426, 400], spec: "RFC 9110 §15.2.2", specUrl: rfc9110("15.2.2"),
    cacheable: false, retriable: "no", aliases: ["websocket", "upgrade", "ws"],
  },
  {
    code: 102, name: "Processing", zh: "处理中",
    summary: "WebDAV 的临时响应：请求收到了、还在做，别超时。已很少见。",
    related: [207], spec: "RFC 2518 §10.1", specUrl: rfc(2518, "10.1"),
    cacheable: false, retriable: "no", aliases: ["webdav"],
  },
  {
    code: 103, name: "Early Hints", zh: "早期提示",
    summary: "正式响应之前先把 Link 头发给你，让浏览器提前预连接、预加载。后面一定还有一个正式状态。",
    causes: ["CDN 或框架开了 early hints 来抢首屏"],
    fix: ["客户端忽略它即可；真正的结果在后面那个响应里"],
    related: [200], spec: "RFC 8297", specUrl: rfc(8297),
    cacheable: false, retriable: "no", aliases: ["preload", "预加载"],
  },

  // ── 2xx 成功 ────────────────────────────────────────────────────────────
  {
    code: 200, name: "OK", zh: "成功",
    summary: "请求成功，body 里是结果。注意：业务失败也可能裹在 200 里返回，别只看状态码。",
    causes: ["一切正常"],
    fix: ["接口把错误塞进 200 的 body 时，监控要读 body 而不是只读状态码"],
    related: [201, 204, 206], spec: "RFC 9110 §15.3.1", specUrl: rfc9110("15.3.1"),
    cacheable: true, retriable: "yes", aliases: ["ok", "成功"],
  },
  {
    code: 201, name: "Created", zh: "已创建",
    summary: "资源建好了，Location 头指向它。POST 建资源的标准答案。",
    causes: ["POST / PUT 新建了资源"],
    fix: ["必须带 Location；body 里给新资源的表示或它的 id"],
    related: [200, 202, 204], spec: "RFC 9110 §15.3.2", specUrl: rfc9110("15.3.2"),
    cacheable: false, retriable: "no", aliases: ["created", "创建"],
  },
  {
    code: 202, name: "Accepted", zh: "已接受",
    summary: "收下了，但还没做完，甚至可能最后不做。异步任务的入口，不保证结果。",
    causes: ["请求进了队列，由后台 worker 处理"],
    fix: ["给一个能查进度的地址，否则调用方无从知道结局"],
    related: [201, 303], spec: "RFC 9110 §15.3.3", specUrl: rfc9110("15.3.3"),
    cacheable: false, retriable: "no", aliases: ["async", "异步"],
  },
  {
    code: 203, name: "Non-Authoritative Information", zh: "非权威信息",
    summary: "成功，但 body 被中间代理改过，不是源站的原话。",
    related: [200], spec: "RFC 9110 §15.3.4", specUrl: rfc9110("15.3.4"),
    cacheable: true, retriable: "yes", aliases: ["proxy", "代理"],
  },
  {
    code: 204, name: "No Content", zh: "无内容",
    summary: "成功，而且明确没有 body。DELETE 与 PUT 更新最常用它。",
    causes: ["删除成功", "更新成功但不需要回内容"],
    fix: ["别在 204 里塞 body——很多客户端会直接忽略，或者报协议错"],
    related: [200, 205, 304], spec: "RFC 9110 §15.3.5", specUrl: rfc9110("15.3.5"),
    cacheable: true, retriable: "yes", aliases: ["empty", "空"],
  },
  {
    code: 205, name: "Reset Content", zh: "重置内容",
    summary: "成功，并且请客户端把表单清空。几乎只在老式表单里见得到。",
    related: [204], spec: "RFC 9110 §15.3.6", specUrl: rfc9110("15.3.6"),
    cacheable: false, retriable: "yes",
  },
  {
    code: 206, name: "Partial Content", zh: "部分内容",
    summary: "按 Range 头只给了一段。断点续传与视频拖进度条靠它。",
    causes: ["客户端发了 Range 头", "播放器在拖进度"],
    fix: ["必须带 Content-Range；多段用 multipart/byteranges"],
    related: [200, 416, 304], spec: "RFC 9110 §15.3.7", specUrl: rfc9110("15.3.7"),
    cacheable: true, retriable: "yes", aliases: ["range", "断点续传", "分段"],
  },
  {
    code: 207, name: "Multi-Status", zh: "多状态",
    summary: "WebDAV：一次请求里每个子资源各有各的状态，body 是一份 XML 清单。",
    related: [102, 208], spec: "RFC 4918 §11.1", specUrl: rfc(4918, "11.1"),
    cacheable: false, retriable: "no", aliases: ["webdav"],
  },
  {
    code: 208, name: "Already Reported", zh: "已报告",
    summary: "WebDAV：同一个资源在这次多状态响应里已经列过了，不再重复。",
    related: [207], spec: "RFC 5842 §7.1", specUrl: rfc(5842, "7.1"),
    cacheable: false, retriable: "no", aliases: ["webdav"],
  },
  {
    code: 226, name: "IM Used", zh: "已应用差量",
    summary: "响应是对某个已有版本的差量（delta encoding），不是完整表示。极少见。",
    related: [200], spec: "RFC 3229 §10.4.1", specUrl: rfc(3229, "10.4.1"),
    cacheable: true, retriable: "yes", aliases: ["delta"],
  },

  // ── 3xx 重定向 ──────────────────────────────────────────────────────────
  {
    code: 300, name: "Multiple Choices", zh: "多种选择",
    summary: "同一个地址有好几个表示，请客户端挑一个。没有统一的挑选格式，实际上没人用。",
    related: [301, 406], spec: "RFC 9110 §15.4.1", specUrl: rfc9110("15.4.1"),
    cacheable: true, retriable: "yes",
  },
  {
    code: 301, name: "Moved Permanently", zh: "永久移动",
    summary: "资源永久换了地址，以后直接用 Location 里那个。浏览器会把它记很久，改错了很难收回。",
    causes: ["域名或路径迁移", "强制 https、强制带/不带 www"],
    fix: ["确认新地址稳定之后再上；先用 302 跑一段时间更安全", "带上 Location；缓存期靠 Cache-Control 控制，别只靠默认"],
    related: [308, 302, 410], spec: "RFC 9110 §15.4.2", specUrl: rfc9110("15.4.2"),
    cacheable: true, retriable: "yes", aliases: ["redirect", "重定向", "跳转", "永久"],
  },
  {
    code: 302, name: "Found", zh: "临时移动",
    summary: "临时去 Location 那个地址，下次还来这里。历史上各家实现会把 POST 改写成 GET——要明确语义就用 303 或 307。",
    causes: ["登录后跳回", "灰度或 A/B 分流"],
    fix: ["想强制变 GET 用 303；想保持方法与 body 用 307"],
    related: [303, 307, 301], spec: "RFC 9110 §15.4.3", specUrl: rfc9110("15.4.3"),
    cacheable: false, retriable: "yes", aliases: ["redirect", "重定向", "跳转", "临时"],
  },
  {
    code: 303, name: "See Other", zh: "参见其他",
    summary: "去 Location 那个地址用 GET 看结果。POST 之后防重复提交的标准做法（POST/Redirect/GET）。",
    causes: ["表单提交完跳到结果页"],
    fix: ["无论原请求是什么方法，客户端都改用 GET"],
    related: [302, 307, 201], spec: "RFC 9110 §15.4.4", specUrl: rfc9110("15.4.4"),
    cacheable: false, retriable: "yes", aliases: ["redirect", "重定向", "prg"],
  },
  {
    code: 304, name: "Not Modified", zh: "未修改",
    summary: "你手里那份还是新的，没有 body。条件请求（If-None-Match / If-Modified-Since）命中缓存。",
    causes: ["客户端带了 ETag 或 Last-Modified 来问"],
    fix: ["304 里不许带 body；ETag 必须与 200 时的一致", "接口明明变了还返 304，先查 ETag 是不是按内容算的"],
    related: [200, 412, 204], spec: "RFC 9110 §15.4.5", specUrl: rfc9110("15.4.5"),
    cacheable: true, retriable: "yes", aliases: ["cache", "etag", "缓存"],
  },
  {
    code: 305, name: "Use Proxy", zh: "使用代理",
    summary: "已废弃：出于安全原因，客户端不得遵守它。",
    related: [302], spec: "RFC 9110 §15.4.6", specUrl: rfc9110("15.4.6"),
    cacheable: false, retriable: "no", aliases: ["deprecated", "废弃"],
  },
  {
    code: 306, name: "(Unused)", zh: "未使用",
    summary: "早期草案用过，现在保留不分配。看到它多半是有人在自造码。",
    related: [305], spec: "RFC 9110 §15.4.7", specUrl: rfc9110("15.4.7"),
    cacheable: false, retriable: "no", aliases: ["unused", "保留"],
  },
  {
    code: 307, name: "Temporary Redirect", zh: "临时重定向",
    summary: "临时换地址，而且「方法与 body 原样保留」。302 语义含糊时用它。",
    causes: ["维护期把写请求引到备用地址"],
    fix: ["POST 仍然是 POST：目标端要接得住同样的 body"],
    related: [302, 303, 308], spec: "RFC 9110 §15.4.8", specUrl: rfc9110("15.4.8"),
    cacheable: false, retriable: "yes", aliases: ["redirect", "重定向", "临时"],
  },
  {
    code: 308, name: "Permanent Redirect", zh: "永久重定向",
    summary: "永久换地址，方法与 body 原样保留。301 的「不改方法」版本。",
    causes: ["API 版本迁移，POST 也要跟着走"],
    fix: ["和 301 一样会被长期缓存：先确认新地址是终态"],
    related: [301, 307], spec: "RFC 9110 §15.4.9", specUrl: rfc9110("15.4.9"),
    cacheable: true, retriable: "yes", aliases: ["redirect", "重定向", "永久"],
  },

  // ── 4xx 客户端错误 ──────────────────────────────────────────────────────
  {
    code: 400, name: "Bad Request", zh: "请求有误",
    summary: "服务端认为这个请求本身就不合法，不打算再理解它。很多框架也把参数校验失败塞进这里。",
    causes: ["JSON 语法错、字段类型不对、必填项缺失", "请求行或头部不合语法（网关直接挡下）", "Content-Length 与实际 body 对不上"],
    fix: ["先分清是网关挡的还是应用返的：网关的 400 通常没有 JSON body", "body 里写清楚哪个字段错了；只回一句 Bad Request 等于什么都没说", "参数校验失败更准确的码是 422（语法对、语义不对）"],
    related: [422, 404, 500], spec: "RFC 9110 §15.5.1", specUrl: rfc9110("15.5.1"),
    cacheable: false, retriable: "no", aliases: ["bad request", "参数错误", "请求错误"],
  },
  {
    code: 401, name: "Unauthorized", zh: "未认证",
    summary: "名字骗人：它说的是「没认证」（你是谁不知道），不是没权限。必须带 WWW-Authenticate 头告诉客户端怎么认证。",
    causes: ["没带 Authorization 头", "token 过期或签名不对", "Cookie 会话已失效"],
    fix: ["响应必须带 WWW-Authenticate，否则不合规范", "客户端拿到它应当去刷新 token，而不是原样重试", "已认证但权限不够，该返 403"],
    related: [403, 407, 440], spec: "RFC 9110 §15.5.2", specUrl: rfc9110("15.5.2"),
    cacheable: false, retriable: "no", aliases: ["unauthorized", "auth", "认证", "登录", "token"],
  },
  {
    code: 402, name: "Payment Required", zh: "需要付费",
    summary: "预留给付费场景。规范里一直没定下来，实际含义由各家 API 自己说（配额用完、账户欠费）。",
    causes: ["SaaS 配额用尽或账单未付"],
    fix: ["自家用它就把账单页地址写进 body，别让调用方猜"],
    related: [403, 429], spec: "RFC 9110 §15.5.3", specUrl: rfc9110("15.5.3"),
    cacheable: false, retriable: "no", aliases: ["payment", "付费", "配额"],
  },
  {
    code: 403, name: "Forbidden", zh: "禁止访问",
    summary: "知道你是谁，就是不让。重新认证没有用——换个身份才有用。",
    causes: ["权限不足、越权访问别人的资源", "IP / 地域 / WAF 规则挡下", "目录没有索引权限（静态站点常见）"],
    fix: ["不想暴露资源是否存在时，规范允许改用 404", "WAF 拦截的 403 通常没有应用日志：先看网关那一侧", "身份没认出来应该返 401，不是 403"],
    related: [401, 404, 451], spec: "RFC 9110 §15.5.4", specUrl: rfc9110("15.5.4"),
    cacheable: false, retriable: "no", aliases: ["forbidden", "权限", "禁止"],
  },
  {
    code: 404, name: "Not Found", zh: "未找到",
    summary: "服务器认得这台主机，但这条路径上没有资源。它不表示永久——永久移除该返回 410。",
    causes: ["路径拼错、大小写不符、少了尾斜杠", "SPA 刷新时前端路由没落到 index.html", "网关按 host 选错 upstream，或资源真的已删"],
    fix: ["先分清是源站还是网关返的：看 Via / X-Cache 头", "永久移除返 410；换了地址返 301 + Location", "同一个 URL 重试不会变成 200，别退避重试"],
    related: [410, 403, 301, 400], spec: "RFC 9110 §15.5.5", specUrl: rfc9110("15.5.5"),
    cacheable: true, retriable: "no", aliases: ["not found", "找不到", "404"],
  },
  {
    code: 405, name: "Method Not Allowed", zh: "方法不允许",
    summary: "地址存在，但不接受这个方法。响应必须带 Allow 头列出接受哪些。",
    causes: ["用 POST 打了只读接口", "CORS 预检的 OPTIONS 没有被路由处理"],
    fix: ["必须带 Allow: GET, POST …", "OPTIONS 被 405 挡掉时，跨域预检会整个失败"],
    related: [501, 400, 404], spec: "RFC 9110 §15.5.6", specUrl: rfc9110("15.5.6"),
    cacheable: true, retriable: "no", aliases: ["method", "方法"],
  },
  {
    code: 406, name: "Not Acceptable", zh: "无法接受",
    summary: "按你的 Accept 头挑不出能给的表示。实际上大多数服务端会忽略 Accept 直接返回默认格式。",
    causes: ["Accept: application/xml 但接口只出 JSON"],
    fix: ["要么放宽 Accept，要么让服务端给默认表示"],
    related: [415, 300], spec: "RFC 9110 §15.5.7", specUrl: rfc9110("15.5.7"),
    cacheable: false, retriable: "no", aliases: ["accept", "内容协商"],
  },
  {
    code: 407, name: "Proxy Authentication Required", zh: "需要代理认证",
    summary: "401 的代理版：要先向「代理」认证。必须带 Proxy-Authenticate 头。",
    causes: ["公司网络的出口代理要账号"],
    fix: ["带 Proxy-Authorization 重试；这条与源站的鉴权无关"],
    related: [401, 502], spec: "RFC 9110 §15.5.8", specUrl: rfc9110("15.5.8"),
    cacheable: false, retriable: "no", aliases: ["proxy", "代理"],
  },
  {
    code: 408, name: "Request Timeout", zh: "请求超时",
    summary: "客户端没在服务端愿意等的时间里把请求发完。说的是「发请求」这一段，不是处理慢。",
    causes: ["keep-alive 空闲连接被服务端回收", "上传慢或中途断流", "客户端开了连接却迟迟不发请求头"],
    fix: ["幂等请求可以直接重开一条连接重试", "调大 nginx 的 client_header_timeout / client_body_timeout"],
    related: [504, 425, 499], spec: "RFC 9110 §15.5.9", specUrl: rfc9110("15.5.9"),
    cacheable: false, retriable: "yes", aliases: ["timeout", "超时"],
  },
  {
    code: 409, name: "Conflict", zh: "冲突",
    summary: "请求与资源此刻的状态冲突，重试同样的内容还是会冲突——要先解决冲突。",
    causes: ["乐观锁版本号对不上", "唯一键重复（用户名已被占用）"],
    fix: ["body 里说清楚跟什么冲突了，让调用方能自己解决", "并发更新用 ETag + If-Match，冲突时返 412 更准确"],
    related: [412, 422, 423], spec: "RFC 9110 §15.5.10", specUrl: rfc9110("15.5.10"),
    cacheable: false, retriable: "no", aliases: ["conflict", "冲突", "重复"],
  },
  {
    code: 410, name: "Gone", zh: "已永久删除",
    summary: "曾经有，现在永久没了，别再来问。比 404 更明确，也更适合让搜索引擎删索引。",
    causes: ["资源被主动下线且不打算恢复"],
    fix: ["不确定是不是永久就用 404——410 是个承诺"],
    related: [404, 301, 451], spec: "RFC 9110 §15.5.11", specUrl: rfc9110("15.5.11"),
    cacheable: true, retriable: "no", aliases: ["gone", "删除", "下线"],
  },
  {
    code: 411, name: "Length Required", zh: "需要长度",
    summary: "服务端拒绝没有 Content-Length 的请求。",
    causes: ["用了分块传输但服务端不接受"],
    fix: ["补上 Content-Length，或者让服务端接受 chunked"],
    related: [400, 413], spec: "RFC 9110 §15.5.12", specUrl: rfc9110("15.5.12"),
    cacheable: false, retriable: "no",
  },
  {
    code: 412, name: "Precondition Failed", zh: "前置条件失败",
    summary: "条件请求里的条件不成立（If-Match / If-Unmodified-Since）。并发更新的标准保护。",
    causes: ["别人先改了，ETag 已经变了"],
    fix: ["重新 GET 拿到新 ETag，合并之后再提交"],
    related: [409, 428, 304], spec: "RFC 9110 §15.5.13", specUrl: rfc9110("15.5.13"),
    cacheable: false, retriable: "no", aliases: ["etag", "并发"],
  },
  {
    code: 413, name: "Content Too Large", zh: "请求体过大",
    summary: "body 超过服务端愿意收的大小。旧名字是 Payload Too Large。",
    causes: ["上传超过 nginx 的 client_max_body_size", "网关或函数计算的请求体上限"],
    fix: ["分片上传，或调大网关与应用两处的上限——它们通常不是同一个值", "服务端可以带 Retry-After 表示只是临时限"],
    related: [414, 431, 411], spec: "RFC 9110 §15.5.14", specUrl: rfc9110("15.5.14"),
    cacheable: false, retriable: "no", aliases: ["too large", "过大", "上传"],
  },
  {
    code: 414, name: "URI Too Long", zh: "URI 过长",
    summary: "地址太长，服务端不收。通常是把该放 body 的东西放进了查询串。",
    causes: ["GET 带了一大串查询参数", "重定向绕成了环，参数越滚越长"],
    fix: ["改用 POST 把参数放进 body"],
    related: [413, 431], spec: "RFC 9110 §15.5.15", specUrl: rfc9110("15.5.15"),
    cacheable: true, retriable: "no", aliases: ["uri", "url", "过长"],
  },
  {
    code: 415, name: "Unsupported Media Type", zh: "媒体类型不支持",
    summary: "body 的 Content-Type 服务端不认。最常见的原因是压根没带这个头。",
    causes: ["发 JSON 却没有 Content-Type: application/json", "带了 charset 或额外参数导致不匹配"],
    fix: ["对齐 Content-Type；接口文档里把它写出来"],
    related: [406, 400, 422], spec: "RFC 9110 §15.5.16", specUrl: rfc9110("15.5.16"),
    cacheable: false, retriable: "no", aliases: ["media type", "content-type", "类型"],
  },
  {
    code: 416, name: "Range Not Satisfiable", zh: "范围无法满足",
    summary: "Range 头要的区间超出了资源大小。",
    causes: ["续传时文件已经变短或被替换"],
    fix: ["丢掉本地分片重新下；响应应带 Content-Range: bytes */长度"],
    related: [206, 200], spec: "RFC 9110 §15.5.17", specUrl: rfc9110("15.5.17"),
    cacheable: false, retriable: "no", aliases: ["range", "断点续传"],
  },
  {
    code: 417, name: "Expectation Failed", zh: "预期失败",
    summary: "Expect 头里的要求服务端满足不了（实际上只有 100-continue 这一种）。",
    related: [100], spec: "RFC 9110 §15.5.18", specUrl: rfc9110("15.5.18"),
    cacheable: false, retriable: "no", aliases: ["expect"],
  },
  {
    code: 421, name: "Misdirected Request", zh: "请求发错了地方",
    summary: "这条连接不该用来请求这个 authority。HTTP/2 连接复用时，证书覆盖了多个域名才会撞见。",
    causes: ["HTTP/2 把不同域名的请求合并到了同一条连接"],
    fix: ["客户端应当换一条连接重试；这是少数值得自动重试的 4xx"],
    related: [400, 502], spec: "RFC 9110 §15.5.20", specUrl: rfc9110("15.5.20"),
    cacheable: false, retriable: "yes", aliases: ["http2", "h2"],
  },
  {
    code: 422, name: "Unprocessable Content", zh: "无法处理的内容",
    summary: "语法没问题，语义不对——JSON 解析得了，但字段的值说不通。业务校验失败的准确答案。",
    causes: ["日期格式对但落在未来", "两个字段互相矛盾"],
    fix: ["逐字段给出错误原因，别只给一句话", "语法本身就错了该用 400"],
    related: [400, 409, 415], spec: "RFC 9110 §15.5.21", specUrl: rfc9110("15.5.21"),
    cacheable: false, retriable: "no", aliases: ["validation", "校验", "参数"],
  },
  {
    code: 423, name: "Locked", zh: "已锁定",
    summary: "WebDAV：资源被锁住了。",
    related: [409, 424], spec: "RFC 4918 §11.3", specUrl: rfc(4918, "11.3"),
    cacheable: false, retriable: "maybe", aliases: ["webdav", "锁"],
  },
  {
    code: 424, name: "Failed Dependency", zh: "依赖失败",
    summary: "WebDAV：因为前一个请求失败，这个也做不了。",
    related: [423, 207], spec: "RFC 4918 §11.4", specUrl: rfc(4918, "11.4"),
    cacheable: false, retriable: "no", aliases: ["webdav"],
  },
  {
    code: 425, name: "Too Early", zh: "太早了",
    summary: "服务端不愿处理 TLS 0-RTT 早期数据里的请求，怕重放。",
    causes: ["开了 TLS 1.3 early data"],
    fix: ["等握手完成再重发；这一条重试是安全的"],
    related: [408, 429], spec: "RFC 8470 §5.2", specUrl: rfc(8470, "5.2"),
    cacheable: false, retriable: "yes", aliases: ["tls", "0-rtt"],
  },
  {
    code: 426, name: "Upgrade Required", zh: "需要升级协议",
    summary: "必须换协议才伺候，响应带 Upgrade 头说明换成什么。",
    causes: ["接口只收 HTTP/2 或只收 TLS"],
    fix: ["按 Upgrade 头换协议重试"],
    related: [101, 505], spec: "RFC 9110 §15.5.22", specUrl: rfc9110("15.5.22"),
    cacheable: false, retriable: "no", aliases: ["upgrade", "升级"],
  },
  {
    code: 428, name: "Precondition Required", zh: "需要前置条件",
    summary: "服务端要求你带条件头再来，免得覆盖别人的修改（丢失更新问题）。",
    causes: ["PUT 没带 If-Match"],
    fix: ["先 GET 拿 ETag，再带 If-Match 提交"],
    related: [412, 409], spec: "RFC 6585 §3", specUrl: rfc(6585, "3"),
    cacheable: false, retriable: "no", aliases: ["etag", "并发"],
  },
  {
    code: 429, name: "Too Many Requests", zh: "请求过多",
    summary: "你被限流了。响应通常带 Retry-After：那是等待时间的真源，别自己拍脑袋。",
    causes: ["超过每分钟配额", "重试风暴把自己压死"],
    fix: ["读 Retry-After；没有就指数退避 + 抖动", "限流常常按 (IP, 客户端标识) 计算——换个 client 参数可能就通了", "别在失败时立刻重试：那正是限流在统计的东西"],
    related: [503, 402, 425], spec: "RFC 6585 §4", specUrl: rfc(6585, "4"),
    cacheable: false, retriable: "maybe", aliases: ["rate limit", "限流", "429", "退避"],
  },
  {
    code: 431, name: "Request Header Fields Too Large", zh: "请求头过大",
    summary: "请求头整体或某一行太大。Cookie 攒太多是头号原因。",
    causes: ["Cookie 累积到几 KB", "Authorization 里塞了超长 JWT"],
    fix: ["清 Cookie；把大数据挪出请求头", "nginx 调 large_client_header_buffers"],
    related: [413, 414, 494], spec: "RFC 6585 §5", specUrl: rfc(6585, "5"),
    cacheable: false, retriable: "no", aliases: ["header", "cookie", "请求头"],
  },
  {
    code: 451, name: "Unavailable For Legal Reasons", zh: "因法律原因不可用",
    summary: "因为法律要求不给看。响应应带 Link 指向做出要求的那一方。",
    causes: ["版权下架、地区封禁"],
    fix: ["与 403 的区别是原因：451 明说是法律"],
    related: [403, 410], spec: "RFC 7725 §3", specUrl: rfc(7725, "3"),
    cacheable: true, retriable: "no", aliases: ["legal", "法律", "封禁"],
  },

  // ── 5xx 服务端错误 ──────────────────────────────────────────────────────
  {
    code: 500, name: "Internal Server Error", zh: "服务器内部错误",
    summary: "服务端自己出了问题，而且没有更具体的话可说。它是兜底，不是诊断。",
    causes: ["未捕获的异常", "依赖的数据库或下游炸了", "配置错误（密钥、路径、权限）"],
    fix: ["去服务端日志按时间与 trace id 找那次请求，客户端这边看不出原因", "别把 500 当业务错误用：调用方无法据此做任何决定", "幂等请求可以退避重试一次；非幂等的先确认有没有落库"],
    related: [502, 503, 400], spec: "RFC 9110 §15.6.1", specUrl: rfc9110("15.6.1"),
    cacheable: false, retriable: "maybe", aliases: ["internal", "服务器错误", "500"],
  },
  {
    code: 501, name: "Not Implemented", zh: "未实现",
    summary: "服务端不支持这个方法本身（不是「这个地址不支持」——那是 405）。",
    causes: ["代理不认识自定义方法", "老服务端不支持 PATCH"],
    fix: ["确认方法拼写；换成服务端支持的方法"],
    related: [405, 502], spec: "RFC 9110 §15.6.2", specUrl: rfc9110("15.6.2"),
    cacheable: true, retriable: "no", aliases: ["not implemented", "未实现"],
  },
  {
    code: 502, name: "Bad Gateway", zh: "错误网关",
    summary: "网关连上了上游，但上游回的东西不合法，或者根本连不上——问题在上游或它们之间，不在你这一侧。",
    causes: ["上游进程挂了、端口不通、TLS 握手失败", "上游吐了不合 HTTP 的字节，多半是崩溃栈", "容器刚重启，网关还指着旧实例"],
    fix: ["先看网关日志里的 upstream 地址，再去那台机器上验", "幂等请求退避重试有意义；连着几次 502 说明上游是真的下线了", "健康检查与摘除策略比重试更能解决它"],
    related: [503, 504, 500], spec: "RFC 9110 §15.6.3", specUrl: rfc9110("15.6.3"),
    cacheable: false, retriable: "yes", aliases: ["bad gateway", "网关", "502"],
  },
  {
    code: 503, name: "Service Unavailable", zh: "服务不可用",
    summary: "服务端此刻处理不了——过载或在维护。它是「临时」的，而且应当带 Retry-After。",
    causes: ["过载、线程池打满", "计划内维护", "滚动发布期间实例全在重启"],
    fix: ["读 Retry-After；没有就指数退避 + 抖动", "维护页要返 503 而不是 200，否则搜索引擎会把维护页当正文收录"],
    related: [429, 502, 504], spec: "RFC 9110 §15.6.4", specUrl: rfc9110("15.6.4"),
    cacheable: false, retriable: "maybe", aliases: ["unavailable", "不可用", "维护", "过载"],
  },
  {
    code: 504, name: "Gateway Timeout", zh: "网关超时",
    summary: "网关等上游响应等到了自己的上限。说的是网关与上游之间，不是你与网关之间。",
    causes: ["上游处理慢（慢查询、外部依赖卡住）", "网关的读超时窗口比上游的处理时间短"],
    fix: ["先量上游自己的耗时，再决定是调超时还是优化处理", "长任务改成 202 + 轮询，别让网关替你等"],
    related: [502, 408, 524], spec: "RFC 9110 §15.6.5", specUrl: rfc9110("15.6.5"),
    cacheable: false, retriable: "yes", aliases: ["gateway timeout", "超时", "网关"],
  },
  {
    code: 505, name: "HTTP Version Not Supported", zh: "HTTP 版本不支持",
    summary: "服务端不支持请求里那个 HTTP 主版本。",
    related: [426, 400], spec: "RFC 9110 §15.6.6", specUrl: rfc9110("15.6.6"),
    cacheable: true, retriable: "no", aliases: ["version", "版本"],
  },
  {
    code: 506, name: "Variant Also Negotiates", zh: "变体也要协商",
    summary: "透明内容协商配置成了环。极少见，属于服务端配置错误。",
    related: [300, 500], spec: "RFC 2295 §8.1", specUrl: rfc(2295, "8.1"),
    cacheable: false, retriable: "no",
  },
  {
    code: 507, name: "Insufficient Storage", zh: "存储不足",
    summary: "WebDAV：服务端存不下这次请求要保存的东西。",
    causes: ["磁盘满、配额用尽"],
    fix: ["清空间或加配额；这一条重试之前先确认空间真的回来了"],
    related: [413, 500], spec: "RFC 4918 §11.5", specUrl: rfc(4918, "11.5"),
    cacheable: false, retriable: "maybe", aliases: ["webdav", "磁盘", "存储"],
  },
  {
    code: 508, name: "Loop Detected", zh: "检测到循环",
    summary: "WebDAV：处理过程中发现了无限循环，主动停下。",
    related: [507, 506], spec: "RFC 5842 §7.2", specUrl: rfc(5842, "7.2"),
    cacheable: false, retriable: "no", aliases: ["webdav", "循环"],
  },
  {
    code: 510, name: "Not Extended", zh: "需要扩展",
    summary: "已废弃的实验性扩展机制（RFC 2774）。注册表里标着 OBSOLETED。",
    related: [426], spec: "RFC 2774 §7", specUrl: rfc(2774, "7"),
    cacheable: false, retriable: "no", aliases: ["obsolete", "废弃"],
  },
  {
    code: 511, name: "Network Authentication Required", zh: "需要网络认证",
    summary: "要先在网络入口处登录（机场、酒店的 Portal）。「只应由拦截的中间设备返回」，源站不该用它。",
    causes: ["连上了要求 Portal 登录的 Wi-Fi"],
    fix: ["打开浏览器完成 Portal 登录再重试"],
    related: [401, 407], spec: "RFC 6585 §6", specUrl: rfc(6585, "6"),
    cacheable: false, retriable: "yes", aliases: ["portal", "wifi", "认证"],
  },

  // ── 非标准码：不在 IANA 注册表里，各家自己造的 ──────────────────────────
  {
    code: 418, name: "I'm a Teapot", zh: "我是茶壶",
    summary: "1998 年愚人节 RFC 2324（超文本咖啡壶控制协议）里的玩笑码。注册表把 418 标为 Unused，不要在真接口上用它。",
    causes: ["有人拿它当占位", "服务端在用它挡爬虫"],
    fix: ["把它换成真正想表达的那个码（多半是 400 / 403 / 501）"],
    related: [400, 501], spec: "RFC 2324 §2.3.2", specUrl: rfc(2324, "2.3.2"),
    cacheable: false, retriable: "no", unofficial: "玩笑码", aliases: ["teapot", "茶壶", "彩蛋"],
  },
  {
    code: 440, name: "Login Time-out", zh: "登录超时",
    summary: "IIS：会话过期，要重新登录。标准做法是 401。",
    fix: ["重新认证之后再发一次"],
    related: [401, 408], spec: "IIS 自定义", specUrl: "https://learn.microsoft.com/iis/",
    cacheable: false, retriable: "no", unofficial: "IIS", aliases: ["iis", "登录", "会话"],
  },
  {
    code: 444, name: "No Response", zh: "不作响应",
    summary: "nginx 内部码：直接关掉连接，一个字节都不回。日志里看得到，客户端只会看到连接被断。",
    causes: ["配置里用 return 444 挡恶意请求"],
    fix: ["它不会出现在客户端；抓包看到的是 RST 或 EOF"],
    related: [499, 403], spec: "nginx 自定义", specUrl: "https://nginx.org/en/docs/http/ngx_http_rewrite_module.html",
    cacheable: false, retriable: "no", unofficial: "nginx", aliases: ["nginx"],
  },
  {
    code: 494, name: "Request Header Too Large", zh: "请求头过大",
    summary: "nginx 内部码，标准对应的是 431。",
    fix: ["调 large_client_header_buffers，或者少发点 Cookie"],
    related: [431, 413], spec: "nginx 自定义", specUrl: "https://nginx.org/en/docs/http/ngx_http_core_module.html",
    cacheable: false, retriable: "no", unofficial: "nginx", aliases: ["nginx", "请求头"],
  },
  {
    code: 495, name: "SSL Certificate Error", zh: "客户端证书错误",
    summary: "nginx：双向 TLS 里客户端证书校验没过。",
    causes: ["客户端证书过期或不是这个 CA 签的"],
    fix: ["换一张有效的客户端证书；服务端看 ssl_client_verify"],
    related: [497, 526, 403], spec: "nginx 自定义", specUrl: "https://nginx.org/en/docs/http/ngx_http_ssl_module.html",
    cacheable: false, retriable: "no", unofficial: "nginx", aliases: ["nginx", "ssl", "tls", "证书", "mtls"],
  },
  {
    code: 497, name: "HTTP Request Sent to HTTPS Port", zh: "明文请求打到了 HTTPS 端口",
    summary: "nginx：往 TLS 端口发了明文 HTTP。",
    causes: ["客户端把 https 写成了 http", "内网调用忘了改 scheme"],
    fix: ["改用 https://；或者在 80 端口上做跳转"],
    related: [400, 426], spec: "nginx 自定义", specUrl: "https://nginx.org/en/docs/http/ngx_http_ssl_module.html",
    cacheable: false, retriable: "no", unofficial: "nginx", aliases: ["nginx", "https", "明文"],
  },
  {
    code: 499, name: "Client Closed Request", zh: "客户端提前断开",
    summary: "nginx：响应还没写完，客户端先把连接关了。它记录的是「客户端走了」，不是服务端错了。",
    causes: ["用户关了页面或点了取消", "上游太慢，客户端自己的超时先到了", "负载均衡的空闲超时比后端处理时间短"],
    fix: ["大量 499 通常意味着后端变慢了：先看 upstream_response_time", "它不该计入服务端错误率，否则会误报"],
    related: [408, 504], spec: "nginx 自定义", specUrl: "https://nginx.org/en/docs/http/ngx_http_log_module.html",
    cacheable: false, retriable: "no", unofficial: "nginx", aliases: ["nginx", "断开", "取消"],
  },
  {
    code: 520, name: "Web Server Returned an Unknown Error", zh: "源站返回了未知错误",
    summary: "Cloudflare：源站的响应它解析不了。是个兜底，本身不说明原因。",
    causes: ["源站返回了空响应或非法头", "源站崩溃、连接被重置"],
    fix: ["绕过 Cloudflare 直连源站验一次，就能分清是哪一侧的问题"],
    related: [521, 502], spec: "Cloudflare 自定义", specUrl: "https://developers.cloudflare.com/support/troubleshooting/http-status-codes/cloudflare-5xx-errors/",
    cacheable: false, retriable: "maybe", unofficial: "Cloudflare", aliases: ["cloudflare", "cf"],
  },
  {
    code: 521, name: "Web Server Is Down", zh: "源站已关闭",
    summary: "Cloudflare：连不上源站——端口不通或进程没起。",
    causes: ["源站进程挂了", "防火墙把 Cloudflare 的 IP 挡了"],
    fix: ["确认源站在跑，并放行 Cloudflare 的 IP 段"],
    related: [520, 522, 502], spec: "Cloudflare 自定义", specUrl: "https://developers.cloudflare.com/support/troubleshooting/http-status-codes/cloudflare-5xx-errors/",
    cacheable: false, retriable: "maybe", unofficial: "Cloudflare", aliases: ["cloudflare", "cf", "源站"],
  },
  {
    code: 522, name: "Connection Timed Out", zh: "连接超时",
    summary: "Cloudflare：TCP 握手就没成——在建立连接这一步超时，比 524 更早。",
    causes: ["源站过载到接不了新连接", "丢包或路由问题", "防火墙静默丢弃"],
    fix: ["从别的网络直连源站的端口试一次，看是不是只有 Cloudflare 连不上"],
    related: [524, 521, 504], spec: "Cloudflare 自定义", specUrl: "https://developers.cloudflare.com/support/troubleshooting/http-status-codes/cloudflare-5xx-errors/",
    cacheable: false, retriable: "yes", unofficial: "Cloudflare", aliases: ["cloudflare", "cf", "timeout", "超时"],
  },
  {
    code: 524, name: "A Timeout Occurred", zh: "源站超时",
    summary: "Cloudflare：连接建起来了，但源站没在窗口内（默认 100 秒）把响应写完。",
    causes: ["源站有个长任务在跑", "同步导出、大报表这类接口"],
    fix: ["长任务改成异步：先 202 再轮询", "企业版可以调窗口，其他版本只能改接口"],
    related: [522, 504, 202], spec: "Cloudflare 自定义", specUrl: "https://developers.cloudflare.com/support/troubleshooting/http-status-codes/cloudflare-5xx-errors/",
    cacheable: false, retriable: "maybe", unofficial: "Cloudflare", aliases: ["cloudflare", "cf", "timeout", "超时"],
  },
  {
    code: 526, name: "Invalid SSL Certificate", zh: "源站证书无效",
    summary: "Cloudflare：回源时校验源站证书没过（Full (strict) 模式下）。",
    causes: ["源站证书过期、自签名、域名不匹配"],
    fix: ["换一张受信任的证书，或把加密模式降到 Full（不推荐）"],
    related: [495, 497, 521], spec: "Cloudflare 自定义", specUrl: "https://developers.cloudflare.com/support/troubleshooting/http-status-codes/cloudflare-5xx-errors/",
    cacheable: false, retriable: "no", unofficial: "Cloudflare", aliases: ["cloudflare", "cf", "ssl", "证书"],
  },
];

/** 全部状态码，按码升序。 */
export const catalog: StatusCode[] = [...entries].sort((a, b) => a.code - b.code);

/** 按码查一条；不在表里为 `undefined`。 */
export const byCode = (code: number): StatusCode | undefined => catalog.find((entry) => entry.code === code);

/** 1xx…5xx。传进来的码不在 100–599 时返回 0——调用方据此判断"这压根不是状态码"。 */
export const classOf = (code: number): 0 | 1 | 2 | 3 | 4 | 5 =>
  code >= 100 && code <= 599 ? ((Math.floor(code / 100) as 1 | 2 | 3 | 4 | 5)) : 0;

export const standardCount = catalog.filter((e) => !e.unofficial).length;
export const unofficialCount = catalog.filter((e) => e.unofficial).length;
