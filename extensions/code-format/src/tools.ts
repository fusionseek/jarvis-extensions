/**
 * 哪种语言用哪个格式化工具、什么参数（纯函数，单测直接调）。
 *
 * 宿主按文件名认出语言（`CodeFormatLanguageID`），这里决定交给谁：每种语言一串工具，按顺序取第一个找得到的。
 * 参数一律是 manifest `process.executables` 里**逐字声明**过的那几组——文件名是固定的占位名 `jarvis-format.<ext>`，
 * 只用来让工具认语言、按扩展名套 `.editorconfig` / `.prettierrc` 里的规则；工具在文件所在目录里跑（宿主给的目录句柄），
 * 因此照样找得到那里的 `.clang-format`、`pyproject.toml`。
 */
import type { CodeFormatLanguageID } from "@fusionseek/jarvis-extension-sdk";

/** 一个格式化工具。 */
export interface FormatTool {
  /** 工具标识，也是结果里的 `tool`（给人看）。 */
  id: string;
  /** manifest 里声明的可执行文件名。 */
  executable: string;
  /** 默认去哪里找：命令名（宿主在固定位置里找）或绝对路径（系统自带的工具）。 */
  defaultCommand: string;
  /** 用户能在设置里改路径的那一项偏好；没有为 `undefined`（只按默认找）。 */
  preference?: string;
  /** 找不到时给用户的装法（`brew install …`）。 */
  install: string;
}

/** 全部工具。 */
export const tools = {
  clangFormat: { id: "clang-format", executable: "clang-format", defaultCommand: "clang-format", preference: "clangFormat", install: "brew install clang-format" },
  swiftFormat: { id: "swift-format", executable: "swift-format", defaultCommand: "swift-format", preference: "swiftFormat", install: "brew install swift-format" },
  xcrunSwiftFormat: { id: "xcrun swift-format", executable: "xcrun", defaultCommand: "/usr/bin/xcrun", install: "装 Xcode（自带 swift-format）" },
  ktfmt: { id: "ktfmt", executable: "ktfmt", defaultCommand: "ktfmt", preference: "ktfmt", install: "brew install ktfmt" },
  googleJavaFormat: { id: "google-java-format", executable: "google-java-format", defaultCommand: "google-java-format", preference: "googleJavaFormat", install: "brew install google-java-format" },
  csharpier: { id: "csharpier", executable: "csharpier", defaultCommand: "csharpier", install: "dotnet tool install -g csharpier" },
  ruff: { id: "ruff", executable: "ruff", defaultCommand: "ruff", preference: "ruff", install: "brew install ruff" },
  black: { id: "black", executable: "black", defaultCommand: "black", install: "brew install black" },
  shfmt: { id: "shfmt", executable: "shfmt", defaultCommand: "shfmt", preference: "shfmt", install: "brew install shfmt" },
  prettier: { id: "prettier", executable: "prettier", defaultCommand: "prettier", preference: "prettier", install: "brew install prettier" },
  gofmt: { id: "gofmt", executable: "gofmt", defaultCommand: "gofmt", install: "brew install go" },
  rustfmt: { id: "rustfmt", executable: "rustfmt", defaultCommand: "rustfmt", install: "rustup component add rustfmt" },
  xmllint: { id: "xmllint", executable: "xmllint", defaultCommand: "/usr/bin/xmllint", install: "macOS 自带 /usr/bin/xmllint" },
} satisfies Record<string, FormatTool>;

/** 认得的语言、给人看的名字、按顺序试的工具。没列的语言（`sql`）不认。 */
export const languages: { id: CodeFormatLanguageID; title: string; tools: FormatTool[] }[] = [
  { id: "c", title: "C", tools: [tools.clangFormat] },
  { id: "cpp", title: "C++", tools: [tools.clangFormat] },
  { id: "objc", title: "Objective-C", tools: [tools.clangFormat] },
  { id: "java", title: "Java", tools: [tools.googleJavaFormat, tools.clangFormat] },
  { id: "kotlin", title: "Kotlin", tools: [tools.ktfmt] },
  { id: "swift", title: "Swift", tools: [tools.swiftFormat, tools.xcrunSwiftFormat] },
  { id: "csharp", title: "C#", tools: [tools.csharpier, tools.clangFormat] },
  { id: "python", title: "Python", tools: [tools.ruff, tools.black] },
  { id: "shell", title: "Shell", tools: [tools.shfmt] },
  { id: "markdown", title: "Markdown", tools: [tools.prettier] },
  { id: "javascript", title: "JavaScript", tools: [tools.prettier] },
  { id: "typescript", title: "TypeScript", tools: [tools.prettier] },
  { id: "json", title: "JSON", tools: [tools.prettier] },
  { id: "yaml", title: "YAML", tools: [tools.prettier] },
  { id: "css", title: "CSS", tools: [tools.prettier] },
  { id: "html", title: "HTML", tools: [tools.prettier] },
  { id: "go", title: "Go", tools: [tools.gofmt] },
  { id: "rust", title: "Rust", tools: [tools.rustfmt] },
  { id: "xml", title: "XML", tools: [tools.xmllint] },
];

/** 一种语言的那一行；不认得为 `undefined`。 */
export function languageEntry(id: string): (typeof languages)[number] | undefined {
  return languages.find((entry) => entry.id === id);
}

/** 占位文件名的前缀：工具只用它认语言、套 `.editorconfig` 的扩展名规则，从不读写这个文件。 */
export const placeholder = "jarvis-format";

/**
 * prettier 认的语法：文件扩展名 → 占位名用哪个扩展名。同一种语法的几个写法并到一个上（`yml` → `yaml`、`mjs` → `js`），
 * 每一个占位名都是 manifest 里逐字声明的一组参数。
 */
const prettierExtensions: Record<string, string> = {
  md: "md", markdown: "md", mdx: "mdx",
  js: "js", mjs: "js", cjs: "js", jsx: "jsx",
  ts: "ts", mts: "ts", cts: "ts", tsx: "tsx",
  json: "json", jsonc: "json", json5: "json",
  yml: "yaml", yaml: "yaml",
  css: "css", scss: "scss", less: "less",
  html: "html", htm: "html", vue: "vue",
};

/** 每种语言在 prettier 那边的缺省扩展名（文件名认不出时）。 */
const prettierDefaults: Partial<Record<CodeFormatLanguageID, string>> = {
  markdown: "md", javascript: "js", typescript: "ts", json: "json", yaml: "yaml", css: "css", html: "html",
};

/** clang-format 的占位扩展名（按语言）。`.h` 交给 C：头文件分不出 C / C++，clang-format 两种都一样排。 */
const clangExtensions: Partial<Record<CodeFormatLanguageID, string>> = {
  c: "c", cpp: "cpp", objc: "m", java: "java", csharp: "cs",
};

/** 文件名的扩展名（小写、不带点）。 */
export function extensionOf(fileName: string): string {
  const name = fileName.split("/").pop() ?? fileName;
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
}

/**
 * 跑某个工具时的参数——必须与 manifest 里声明的某一组逐项相等（`argumentShapes` 列出全部，测试拿它对 manifest）。
 * @param tool 工具。
 * @param language 语言。
 * @param fileName 文件名（prettier 按它挑语法）。
 * @param preferences 偏好（Java 的风格）。
 * @returns 参数。
 */
export function argumentsFor(tool: FormatTool, language: CodeFormatLanguageID, fileName: string, preferences: Record<string, unknown> = {}): string[] {
  switch (tool.id) {
    case tools.clangFormat.id:
      return ["--style=file", `--assume-filename=${placeholder}.${clangExtensions[language] ?? "cpp"}`];
    case tools.swiftFormat.id:
      return ["format", "--assume-filename", `${placeholder}.swift`, "-"];
    case tools.xcrunSwiftFormat.id:
      return ["swift-format", "format", "--assume-filename", `${placeholder}.swift`, "-"];
    case tools.ktfmt.id:
      return ["--kotlinlang-style", "-"];
    case tools.googleJavaFormat.id:
      return preferences.javaStyle === "aosp" ? ["--aosp", "-"] : ["-"];
    case tools.csharpier.id:
      return ["format", "--write-stdout"];
    case tools.ruff.id:
      return ["format", "--stdin-filename", `${placeholder}.py`, "-"];
    case tools.black.id:
      return ["-q", "--stdin-filename", `${placeholder}.py`, "-"];
    case tools.shfmt.id:
      return [`--filename=${placeholder}.sh`];
    case tools.prettier.id: {
      const ext = prettierExtensions[extensionOf(fileName)] ?? prettierDefaults[language] ?? "md";
      return ["--stdin-filepath", `${placeholder}.${ext}`];
    }
    case tools.gofmt.id:
      return [];
    case tools.rustfmt.id:
      return ["--edition", "2021"];
    case tools.xmllint.id:
      return ["--format", "-"];
    default:
      return [];
  }
}

/** `xcrun` 那一个要先问一句 swift-format 在不在（只装了命令行工具的机器上 xcrun 在、swift-format 不一定在）。 */
export const xcrunProbe = ["--find", "swift-format"];

/**
 * 每个可执行文件会用到的全部参数组（manifest `process.executables[].arguments` 必须与它一致，测试钉住）。
 * @returns 可执行文件名 → 参数组。
 */
export function argumentShapes(): Record<string, string[][]> {
  const shapes: Record<string, string[][]> = {};
  const add = (executable: string, shape: string[]) => {
    const list = (shapes[executable] ??= []);
    if (!list.some((existing) => existing.join("\u0000") === shape.join("\u0000"))) list.push(shape);
  };
  for (const entry of languages) {
    for (const tool of entry.tools) {
      if (tool.id === tools.prettier.id) continue;
      add(tool.executable, argumentsFor(tool, entry.id, `x.${clangExtensions[entry.id] ?? "x"}`));
    }
  }
  add(tools.googleJavaFormat.executable, ["--aosp", "-"]);
  add(tools.xcrunSwiftFormat.executable, xcrunProbe);
  for (const ext of new Set(Object.values(prettierExtensions))) add(tools.prettier.executable, ["--stdin-filepath", `${placeholder}.${ext}`]);
  return shapes;
}

/**
 * 用户在设置里填的命令（偏好）；没有偏好、没填或填了空白时是默认值。
 * @param tool 工具。
 * @param preferences 宿主带来的偏好。
 * @returns 命令名或路径。
 */
export function commandFor(tool: FormatTool, preferences: Record<string, unknown>): string {
  const raw = tool.preference ? preferences[tool.preference] : undefined;
  const trimmed = typeof raw === "string" ? raw.trim() : "";
  return trimmed || tool.defaultCommand;
}

/**
 * 一种语言一个工具都没找到时给用户的那句话：每个候选工具一种装法。
 * @param entry 语言那一行。
 * @returns 一句话（≤ 300 字）。
 */
export function missingMessage(entry: (typeof languages)[number]): string {
  const names = entry.tools.map((tool) => tool.id).join(" 或 ");
  const installs = entry.tools.map((tool) => tool.install).join("；");
  return `没找到 ${names}：${installs}，或在 设置 · Git · 代码格式化 里填路径`.slice(0, 300);
}

/**
 * 工具退出码非 0 时给用户的那句话：工具名 + stderr 开头几行（多半是语法错误的位置）。
 * @param tool 工具。
 * @param exitCode 退出码。
 * @param stderr stderr 末尾。
 * @returns 一句话。
 */
export function failureMessage(tool: FormatTool, exitCode: number, stderr: string): string {
  const lines = stderr.split("\n").map((line) => line.trim()).filter((line) => line.length > 0).slice(0, 3);
  const detail = lines.length ? `：${lines.join(" · ")}` : "";
  return `${tool.id} 没能格式化（退出码 ${exitCode}）${detail}`.slice(0, 400);
}
