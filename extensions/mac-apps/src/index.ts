/**
 * 应用（`mac-apps`）—— 让 Jarvis 的全局搜索认得这台 Mac 上的应用。
 *
 * 两个域：
 * - 服务 `launcher.apps`：宿主每次唤出全局搜索问一次 `catalog`——读本机应用（`apps.read`），按这里的设置分好组、排好序交回去；
 *   网格、搜索结果、打开 / 在访达中显示 / 移到废纸篓都由 Jarvis 画、由用户点，这个扩展碰不到。
 * - 工具箱：那一页就是全局搜索里应用的显示设置（分组、排序、搜索结果里出几条、要不要系统应用）。
 *
 * 只要一项能力 `apps.read`：不联网、不跑命令、不读文件。设置存在扩展自己的存储里，页面与服务读同一份。
 */
import { defineExtension, jarvis, type PageDefinition } from "@fusionseek/jarvis-extension-sdk";
import { catalog } from "./model.js";
import { renderPage } from "./page.js";
import { loadSettings, Session } from "./session.js";

const session = new Session();

const page: PageDefinition = {
  activate: (context) => session.activate(context),
  deactivate: () => session.deactivate(),
  render: () => renderPage(session),
};

defineExtension({
  toolbox: page,
  services: {
    apps: {
      async catalog() {
        // 没授权时 apps.list 以 permission.denied 拒绝：原样抛出，宿主据此请用户打开这一页授权。
        const [settings, apps] = await Promise.all([loadSettings(), jarvis.apps.list()]);
        return catalog(apps, settings);
      },
    },
  },
});
