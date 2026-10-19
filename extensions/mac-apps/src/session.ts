/**
 * 工具箱那一页的状态：设置（存在 `jarvis.storage` 里，后台服务读同一份）、应用清单（预览用）、授权。
 *
 * 改一项设置当场写进存储：下一次唤出全局搜索，宿主问 `catalog` 时就按新的来——这一页没有「保存」。
 */
import { jarvis, type ActivationContext, type MacApp } from "@fusionseek/jarvis-extension-sdk";
import { defaultSettings, normalizeSettings, type Settings } from "./model.js";

/** 设置在存储里的键。 */
export const settingsKey = "settings";

/**
 * 读设置（页面与后台服务共用）。存储读不出时用默认。
 * @returns 设置。
 */
export async function loadSettings(): Promise<Settings> {
  try {
    return normalizeSettings(await jarvis.storage.get(settingsKey));
  } catch {
    return { ...defaultSettings };
  }
}

/** 报错里那句人话。 */
export function describeError(error: unknown): string {
  if (typeof error === "object" && error !== null && "message" in error && typeof (error as { message: unknown }).message === "string") {
    return (error as { message: string }).message;
  }
  return "读不出本机应用";
}

export class Session {
  granted: string[] = [];
  settings: Settings = { ...defaultSettings };
  /** 本机应用；`null` = 还没读。 */
  apps: MacApp[] | null = null;
  loading = false;
  error: string | null = null;

  /** 读得了本机应用。 */
  get canRead(): boolean {
    return this.granted.includes("apps.read");
  }

  async activate(context: ActivationContext): Promise<void> {
    this.granted = [...context.granted];
    this.settings = await loadSettings();
    jarvis.ui.update();
    if (this.canRead) await this.refresh();
  }

  deactivate(): void {
    this.loading = false;
  }

  /** 重读清单（预览）。 */
  async refresh(): Promise<void> {
    if (!this.canRead || this.loading) return;
    this.loading = true;
    this.error = null;
    jarvis.ui.update();
    try {
      this.apps = await jarvis.apps.list();
    } catch (error) {
      this.error = describeError(error);
    }
    this.loading = false;
    jarvis.ui.update();
  }

  /** 改设置：当场写进存储（全局搜索下一次唤出就按新的来）。 */
  async change(patch: Partial<Settings>): Promise<void> {
    this.settings = normalizeSettings({ ...this.settings, ...patch });
    jarvis.ui.update();
    try {
      await jarvis.storage.set(settingsKey, this.settings);
    } catch (error) {
      this.error = `设置没存上：${describeError(error)}`;
      jarvis.ui.update();
    }
  }

  /** 页面上的「授权」。 */
  async requestAccess(): Promise<void> {
    const result = await jarvis.permissions.request(["apps.read"]);
    if (result.granted.includes("apps.read")) {
      this.granted = [...new Set([...this.granted, "apps.read"])];
      await this.refresh();
    }
  }
}
