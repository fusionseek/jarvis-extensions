/**
 * 测试共用的两样东西（不是测试文件，`node --test test/*.test.mjs` 不会把它当测试跑）：
 *
 * 1. `loadSource()`：把 `src/` 里的纯模块现编成一份 ESM 直接 import。产物 `dist/extension.js` 是 IIFE、
 *    只露出 `defineExtension` 那一次注册，解析器的内部字段（`trackedItems`、`endedSize` …）从服务那一面看不到；
 *    这里**只在测试时**编译，不落盘、不随扩展发布。
 * 2. `hostFiles()`：按宿主 `files.stat` / `files.tail` 的语义读一个真实的临时文件——只交完整的行、
 *    `offset` 停在最后一个换行之后、带 `size` 与 `inode`。单元测试注入它，服务测试把它挂到替身的桩上。
 *
 * **从不执行真的 `mo`**：进程一律由测试替身按脚本回放。
 */
import { build } from "esbuild";
import { closeSync, existsSync, openSync, readSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
export const extensionRoot = join(here, "..");
const repositoryRoot = join(extensionRoot, "..", "..");

/**
 * 现编 `src/` 的纯模块（含 `engine.ts` 之外的全部）。
 * @returns 模块命名空间。
 */
export async function loadSource() {
  const result = await build({
    stdin: {
      contents: [
        'export * from "./src/output-parser.ts";',
        'export * from "./src/operation-log.ts";',
        'export * from "./src/live-state.ts";',
        'export * from "./src/report.ts";',
        'export * from "./src/command.ts";',
        'export * from "./src/size-format.ts";',
        'export * from "./src/limits.ts";',
      ].join("\n"),
      resolveDir: extensionRoot,
      loader: "ts",
      sourcefile: "test-entry.ts",
    },
    bundle: true,
    format: "esm",
    platform: "neutral",
    target: ["es2020"],
    write: false,
    logLevel: "silent",
    alias: { "@fusionseek/jarvis-extension-sdk": join(repositoryRoot, "sdk", "src", "index.ts") },
  });
  const code = result.outputFiles[0].text;
  return import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`);
}

/**
 * 按宿主语义读一个真实文件的 `files` 能力替身。
 * @param realPath 真实文件（替身不管扩展传来的路径是什么，一律读它；路径由调用方另行断言）。
 * @param options `chunk`：一次最多读多少字节（宿主是 1 MB；测试调小以覆盖「一次读不完」）。
 * @returns `{ stat, tail, calls }`。
 */
export function hostFiles(realPath, options = {}) {
  const chunk = options.chunk ?? 1024 * 1024;
  const calls = [];
  const state = () => {
    if (!existsSync(realPath)) return null;
    const stat = statSync(realPath);
    return { size: stat.size, inode: Number(stat.ino) };
  };
  return {
    calls,
    async stat(path) {
      calls.push({ method: "stat", path });
      return state();
    },
    async tail(path, offset) {
      calls.push({ method: "tail", path, offset });
      const now = state();
      if (!now) return null;
      if (offset >= now.size) return { lines: [], offset, ...now };
      const length = Math.min(now.size - offset, chunk);
      const buffer = Buffer.alloc(length);
      const fd = openSync(realPath, "r");
      try {
        readSync(fd, buffer, 0, length, offset);
      } finally {
        closeSync(fd);
      }
      const last = buffer.lastIndexOf(0x0a);
      if (last < 0) return { lines: [], offset, ...now };
      return { lines: buffer.subarray(0, last).toString("utf8").split("\n"), offset: offset + last + 1, ...now };
    },
  };
}

/** 一段与 `mo clean` 非交互输出同形的文本（Mole 1.59）。数字是编的。 */
export const sampleOutput = [
  "\u001B[1;35mClean Your Mac\u001B[0m",
  "",
  "➤ System",
  "  ⚙ System-level cleanup skipped (no sudo session)",
  "➤ User essentials",
  "  ✓ User app cache · 2.40GB",
  "  ✓ User app logs · 12 items, 312.5MB",
  "  ✓ Trash · emptied, 9 items",
  "➤ Browsers",
  "  ✓ Chrome code cache · 3 items, 48.2MB",
  "  ✗ Edge cache · skipped (Edge running)",
  "➤ Developer tools",
  "  ✓ npm cache · 1.1GB",
  "",
  "====================================================================",
  "Cleanup complete",
  "Tracked cleanup: 3.87GB | Items cleaned: 26 | Categories: 4",
  "Free space: 120.5GB (+4.10GB)",
  "====================================================================",
];

/** 本机 Mole 1.59.1 写出的一个 run id。 */
export const RUN = "20261011174914-57562-26905-10086";
