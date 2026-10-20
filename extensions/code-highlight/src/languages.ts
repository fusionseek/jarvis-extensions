/**
 * 每种语言的扫描规则（纯数据 + 纯函数，单测直接调）。
 *
 * 不追求编译器那样的精确：认错一个词的代价是它换了个颜色，不影响内容；宁可漏，不把一大段染错——
 * 所以字符串只认单行（多行字符串只认语言里明确的那几种写法），正则字面量不认（与除号分不开）。
 */
import type { CodeLanguageID, CodeSyntaxKind } from "@fusionseek/jarvis-extension-sdk";
import { nestedBlockComment, scan, sticky, type Rule, type ScanSpec, type Token, type WordContext } from "./scanner.js";
import { scanCSS, scanHTML, scanMarkdown, scanYAML } from "./markup.js";

const words = (list: string): Set<string> => new Set(list.split(/\s+/).filter(Boolean));

// ---------------------------------------------------------------------------
// 共用的规则
// ---------------------------------------------------------------------------

const lineComment = (prefix: string): Rule => ({ pattern: sticky(prefix.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&") + "[^\\n]*"), kind: "comment" });
const blockComment: Rule = { pattern: /\/\*[\s\S]*?(?:\*\/|$)/y, kind: "comment" };
const doubleQuoted: Rule = { pattern: /"(?:[^"\\\n]|\\.)*"?/y, kind: "string" };
const singleQuoted: Rule = { pattern: /'(?:[^'\\\n]|\\.)*'?/y, kind: "string" };
const backtickTemplate: Rule = { pattern: /`(?:[^`\\]|\\[\s\S])*`?/y, kind: "string" };
const number: Rule = {
  pattern: /(?:0[xX][0-9a-fA-F_]+|0[bB][01_]+|0[oO][0-7_]+|\d[\d_]*(?:\.\d[\d_]*)?(?:[eE][+-]?\d+)?)[a-zA-Z]*/y,
  kind: "number",
};
const annotation: Rule = { pattern: /@[A-Za-z_][\w.]*/y, kind: "attribute" };
const identifier = /[A-Za-z_][\w]*/y;
const identifierWithDollar = /[A-Za-z_$][\w$]*/y;

/** C 系预处理：`#include <a.h>` 的指令与路径分开着色；只在行首。 */
const preprocessor: Rule = {
  pattern: /#\s*(?:include|import)\s*(?:<[^>\n]*>|"[^"\n]*")?|#\s*[A-Za-z]+/y,
  lineStart: true,
  emit(match, at, out) {
    const text = match[0];
    const path = /[<"]/.exec(text);
    if (path) {
      out.push({ start: at, length: path.index, kind: "preprocessor" });
      out.push({ start: at + path.index, length: text.length - path.index, kind: "string" });
    } else {
      out.push({ start: at, length: text.length, kind: "preprocessor" });
    }
  },
};

/** C 系标识符分类的设置。 */
interface WordTable {
  keywords: Set<string>;
  types: Set<string>;
  constants: Set<string>;
  /** 这些关键字之后的那个名字是函数（`func` / `fun` / `def` / `function` / `fn`）。 */
  functionDeclarations?: Set<string>;
  /** 这些关键字之后的那个名字是类型（`class` / `struct` / `interface`…）。 */
  typeDeclarations?: Set<string>;
  /** 大写开头、带小写的名字当类型（Java / Swift / Kotlin / C# / TS 的惯例）。 */
  capitalizedTypes?: boolean;
  /** 关键字不分大小写（SQL）。 */
  caseInsensitive?: boolean;
}

/** 按词表给标识符分类。 */
function classifier(table: WordTable): (word: string, context: WordContext) => CodeSyntaxKind | null {
  return (word, context) => {
    const fold = (text: string) => (table.caseInsensitive ? text.toLowerCase() : text);
    const key = fold(word);
    const previousWord = context.previousWord ? fold(context.previousWord) : null;
    if (context.previous !== "." && table.keywords.has(key)) return "keyword";
    if (table.constants.has(key)) return "constant";
    if (previousWord && table.functionDeclarations?.has(previousWord)) return "function";
    if (previousWord && table.typeDeclarations?.has(previousWord)) return "type";
    if (table.types.has(key)) return "type";
    // 全大写当常量（`EXIT_SUCCESS`、`MAX_COUNT`）；SQL 这种关键字本来就全大写写的语言不算。
    if (!table.caseInsensitive && /^[A-Z][A-Z0-9_]+$/.test(word)) return "constant";
    if (table.capitalizedTypes && /^[A-Z]/.test(word) && /[a-z]/.test(word)) return "type";
    if (context.next === "(") return "function";
    return null;
  };
}

// ---------------------------------------------------------------------------
// C 系
// ---------------------------------------------------------------------------

const cKeywords = "auto break case const continue default do else enum extern for goto if inline register restrict return sizeof static struct switch typedef union volatile while _Alignas _Alignof _Atomic _Generic _Noreturn _Static_assert _Thread_local alignas alignof";
const cTypes = "void char short int long float double signed unsigned bool _Bool _Complex size_t ssize_t ptrdiff_t intptr_t uintptr_t int8_t int16_t int32_t int64_t uint8_t uint16_t uint32_t uint64_t FILE";
const cppKeywords = cKeywords + " class namespace template typename public private protected virtual override final new delete this throw try catch using operator friend explicit mutable constexpr consteval constinit decltype noexcept static_cast dynamic_cast reinterpret_cast const_cast co_await co_return co_yield concept requires export import module";

const c: ScanSpec = {
  rules: [lineComment("//"), blockComment, preprocessor, doubleQuoted, singleQuoted, number],
  word: identifier,
  classify: classifier({ keywords: words(cKeywords), types: words(cTypes), constants: words("NULL true false"), typeDeclarations: words("struct enum union") }),
};

const cpp: ScanSpec = {
  rules: [lineComment("//"), blockComment, preprocessor, { pattern: /R"([^(\s]*)\([\s\S]*?\)\1"/y, kind: "string" }, doubleQuoted, singleQuoted, number],
  word: identifier,
  classify: classifier({
    keywords: words(cppKeywords), types: words(cTypes + " string wstring vector map unordered_map set array optional shared_ptr unique_ptr std"),
    constants: words("nullptr NULL true false"), typeDeclarations: words("class struct enum union namespace"), capitalizedTypes: true,
  }),
};

const objc: ScanSpec = {
  rules: [
    lineComment("//"), blockComment, preprocessor,
    { pattern: /@"(?:[^"\\\n]|\\.)*"?/y, kind: "string" },
    { pattern: /@[A-Za-z]+/y, kind: "keyword" },
    doubleQuoted, singleQuoted, number,
  ],
  word: identifier,
  classify: classifier({
    keywords: words(cKeywords + " self super in out inout oneway bycopy byref nonatomic atomic strong weak copy assign retain readonly readwrite nullable nonnull"),
    types: words(cTypes + " id instancetype BOOL NSInteger NSUInteger CGFloat SEL IMP Class"),
    constants: words("YES NO nil Nil NULL true false"), typeDeclarations: words("struct enum"), capitalizedTypes: true,
  }),
};

const java: ScanSpec = {
  rules: [lineComment("//"), blockComment, { pattern: /"""[\s\S]*?(?:"""|$)/y, kind: "string" }, doubleQuoted, singleQuoted, annotation, number],
  word: identifier,
  classify: classifier({
    keywords: words("abstract assert break case catch class continue default do else enum extends final finally for if implements import instanceof interface native new package private protected public return static strictfp super switch synchronized this throw throws transient try volatile while var record sealed permits yield"),
    types: words("boolean byte char double float int long short void"),
    constants: words("true false null"), typeDeclarations: words("class interface enum record"), capitalizedTypes: true,
  }),
};

const kotlin: ScanSpec = {
  rules: [lineComment("//"), nestedBlockComment(), { pattern: /"""[\s\S]*?(?:"""|$)/y, kind: "string" }, doubleQuoted, singleQuoted, annotation, number],
  word: identifier,
  classify: classifier({
    keywords: words("as break class continue do else for fun if in interface is object package return super this throw try typealias typeof val var when while by catch constructor delegate dynamic field file finally get import init param property receiver set setparam where actual abstract annotation companion const crossinline data enum expect external final infix inline inner internal lateinit noinline open operator out override private protected public reified sealed suspend tailrec vararg value it"),
    types: words("Int Long Short Byte Double Float Boolean Char String Unit Any Nothing Array List Map Set"),
    constants: words("true false null"), functionDeclarations: words("fun"), typeDeclarations: words("class interface object typealias"), capitalizedTypes: true,
  }),
};

const swift: ScanSpec = {
  rules: [
    lineComment("//"), nestedBlockComment(),
    { pattern: /(#*)"""[\s\S]*?(?:"""\1|$)/y, kind: "string" },
    { pattern: /(#*)"(?:[^"\\\n]|\\.)*(?:"\1)?/y, kind: "string" },
    { pattern: /#[A-Za-z_]\w*/y, kind: "preprocessor" },
    annotation, number,
  ],
  word: identifier,
  classify: classifier({
    keywords: words("associatedtype class deinit enum extension fileprivate func import init inout internal let open operator private precedencegroup protocol public rethrows static struct subscript typealias var break case catch continue default defer do else fallthrough for guard if in repeat return throw switch where while as await is throws try async actor some any convenience dynamic didSet final get indirect lazy mutating nonmutating optional override required set unowned weak willSet macro consume borrowing consuming self Self super"),
    types: words("Int Int8 Int16 Int32 Int64 UInt UInt8 UInt16 UInt32 UInt64 Double Float Bool String Character Void Any AnyObject Optional Array Dictionary Set"),
    constants: words("true false nil"), functionDeclarations: words("func"),
    typeDeclarations: words("class struct enum protocol extension actor typealias associatedtype"), capitalizedTypes: true,
  }),
};

const csharp: ScanSpec = {
  rules: [
    lineComment("//"), blockComment,
    { pattern: /#\s*[A-Za-z]+/y, lineStart: true, kind: "preprocessor" },
    { pattern: /"""[\s\S]*?(?:"""|$)/y, kind: "string" },
    { pattern: /\$?@"(?:[^"]|"")*"?|@\$"(?:[^"]|"")*"?/y, kind: "string" },
    { pattern: /\$?"(?:[^"\\\n]|\\.)*"?/y, kind: "string" },
    singleQuoted, number,
  ],
  word: identifier,
  classify: classifier({
    keywords: words("abstract as base break case catch checked class const continue default delegate do else enum event explicit extern finally fixed for foreach goto if implicit in interface internal is lock namespace new operator out override params private protected public readonly ref return sealed sizeof stackalloc static struct switch this throw try typeof unchecked unsafe using virtual volatile while add alias ascending async await by descending dynamic equals from get global group init into join let nameof notnull on orderby partial record remove required select set unmanaged value var when where with yield"),
    types: words("bool byte char decimal double float int long object sbyte short string uint ulong ushort void nint nuint"),
    constants: words("true false null"), typeDeclarations: words("class struct interface enum record namespace"), capitalizedTypes: true,
  }),
};

const jsKeywords = "break case catch class const continue debugger default delete do else export extends finally for function if import in instanceof let new return super switch this throw try typeof var void while with yield async await of static get set from as";
const javascript: ScanSpec = {
  rules: [lineComment("//"), blockComment, backtickTemplate, doubleQuoted, singleQuoted, annotation, number],
  word: identifierWithDollar,
  classify: classifier({
    keywords: words(jsKeywords), types: words(""), constants: words("true false null undefined NaN Infinity"),
    functionDeclarations: words("function"), typeDeclarations: words("class"), capitalizedTypes: true,
  }),
};

const typescript: ScanSpec = {
  rules: javascript.rules,
  word: identifierWithDollar,
  classify: classifier({
    keywords: words(jsKeywords + " interface type enum implements namespace declare abstract readonly private protected public keyof infer is asserts satisfies override module unique"),
    types: words("string number boolean any unknown never void object symbol bigint"),
    constants: words("true false null undefined NaN Infinity"),
    functionDeclarations: words("function"), typeDeclarations: words("class interface type enum namespace"), capitalizedTypes: true,
  }),
};

const go: ScanSpec = {
  rules: [lineComment("//"), blockComment, { pattern: /`[^`]*`?/y, kind: "string" }, doubleQuoted, singleQuoted, number],
  word: identifier,
  classify: classifier({
    keywords: words("break case chan const continue default defer else fallthrough for func go goto if import interface map package range return select struct switch type var"),
    types: words("bool byte complex64 complex128 error float32 float64 int int8 int16 int32 int64 rune string uint uint8 uint16 uint32 uint64 uintptr any comparable"),
    constants: words("true false nil iota"), functionDeclarations: words("func"), typeDeclarations: words("type"),
  }),
};

const rust: ScanSpec = {
  rules: [
    lineComment("//"), nestedBlockComment(),
    { pattern: /#!?\[[^\]\n]*\]?/y, kind: "attribute" },
    { pattern: /b?r(#*)"[\s\S]*?(?:"\1|$)/y, kind: "string" },
    { pattern: /b?"(?:[^"\\]|\\[\s\S])*"?/y, kind: "string" },
    { pattern: /b?'(?:\\.|[^'\\\n])'/y, kind: "string" },
    { pattern: /'[A-Za-z_]\w*/y, kind: "attribute" },
    { pattern: /[A-Za-z_]\w*!(?=\s*[([{])/y, kind: "function" },
    number,
  ],
  word: identifier,
  classify: classifier({
    keywords: words("as async await break const continue crate dyn else enum extern fn for if impl in let loop match mod move mut pub ref return self Self static struct super trait type unsafe use where while union"),
    types: words("i8 i16 i32 i64 i128 isize u8 u16 u32 u64 u128 usize f32 f64 bool char str String Vec Option Result Box"),
    constants: words("true false None"), functionDeclarations: words("fn"), typeDeclarations: words("struct enum trait type union"), capitalizedTypes: true,
  }),
};

// ---------------------------------------------------------------------------
// 其它
// ---------------------------------------------------------------------------

const python: ScanSpec = {
  rules: [
    lineComment("#"),
    { pattern: /[rRbBuUfF]{0,2}("""|''')[\s\S]*?(?:\1|$)/y, kind: "string" },
    { pattern: /[rRbBuUfF]{1,2}(?:"(?:[^"\\\n]|\\.)*"?|'(?:[^'\\\n]|\\.)*'?)/y, kind: "string" },
    doubleQuoted, singleQuoted,
    { pattern: /@[A-Za-z_][\w.]*/y, lineStart: true, kind: "attribute" },
    number,
  ],
  word: identifier,
  classify: classifier({
    keywords: words("and as assert async await break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield match case self cls"),
    types: words("int str float bool list dict set tuple bytes bytearray object type complex frozenset Exception"),
    constants: words("True False None NotImplemented Ellipsis"), functionDeclarations: words("def"), typeDeclarations: words("class"), capitalizedTypes: true,
  }),
};

const shell: ScanSpec = {
  rules: [
    { pattern: /\$\{[^}\n]*\}?|\$[A-Za-z_]\w*|\$[0-9@#?$!*-]/y, kind: "variable" },
    { pattern: /#[^\n]*/y, kind: "comment" },
    { pattern: /"(?:[^"\\]|\\[\s\S])*"?/y, kind: "string" },
    { pattern: /'[^']*'?/y, kind: "string" },
    { pattern: /\d+(?![\w])/y, kind: "number" },
  ],
  word: /[A-Za-z_][\w-]*/y,
  classify: (word, context) => {
    if (shellKeywords.has(word)) return "keyword";
    if (context.previousWord === "function") return "function";
    if (context.next === "(" && context.previous !== "$") return "function";
    if (shellBuiltins.has(word) && context.previous !== "-") return "function";
    return null;
  },
};
const shellKeywords = words("if then else elif fi for while until do done case esac function in select return local export readonly declare typeset set unset shift exit source alias break continue time");
const shellBuiltins = words("echo printf read cd pwd test eval exec trap wait kill true false");

const sql: ScanSpec = {
  rules: [
    lineComment("--"), blockComment,
    { pattern: /'(?:[^']|'')*'?/y, kind: "string" },
    { pattern: /"(?:[^"]|"")*"?|`[^`\n]*`?|\[[^\]\n]*\]/y, kind: "property" },
    number,
  ],
  word: identifier,
  classify: classifier({
    keywords: words("select from where and or not insert into values update set delete create table view index drop alter add column primary key foreign references join inner left right full outer cross on as group by order having limit offset union all distinct case when then else end is in like between exists default constraint unique check returning with recursive begin commit rollback transaction if replace trigger pragma asc desc"),
    types: words("int integer bigint smallint tinyint real float double decimal numeric char varchar text blob date time datetime timestamp boolean bool serial uuid json jsonb"),
    constants: words("null true false current_timestamp current_date"), typeDeclarations: words("table view index into from join update"), caseInsensitive: true,
  }),
};

const json: ScanSpec = {
  rules: [
    lineComment("//"), blockComment,
    {
      // 键（字符串后面跟着冒号）是属性，其余字符串是值。
      pattern: /"(?:[^"\\\n]|\\.)*"?/y,
      emit(match, at, out) {
        out.push({ start: at, length: match[0].length, kind: /^\s*:/.test(match.input.slice(at + match[0].length, at + match[0].length + 64)) ? "property" : "string" });
      },
    },
    { pattern: /-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/y, kind: "number" },
  ],
  word: identifier,
  classify: (word) => (word === "true" || word === "false" || word === "null" ? "constant" : null),
};

/** 每种语言的扫描。 */
const scanners: Record<CodeLanguageID, (text: string) => Token[]> = {
  c: (text) => scan(text, c),
  cpp: (text) => scan(text, cpp),
  objc: (text) => scan(text, objc),
  java: (text) => scan(text, java),
  kotlin: (text) => scan(text, kotlin),
  swift: (text) => scan(text, swift),
  csharp: (text) => scan(text, csharp),
  javascript: (text) => scan(text, javascript),
  typescript: (text) => scan(text, typescript),
  go: (text) => scan(text, go),
  rust: (text) => scan(text, rust),
  python: (text) => scan(text, python),
  shell: (text) => scan(text, shell),
  sql: (text) => scan(text, sql),
  json: (text) => scan(text, json),
  yaml: scanYAML,
  css: scanCSS,
  html: (text) => scanHTML(text),
  xml: (text) => scanHTML(text),
  markdown: scanMarkdown,
};

/** 认得的语言（describe 交回的那一张）。 */
export const supportedLanguages = Object.keys(scanners) as CodeLanguageID[];

/**
 * 给一份文本切记号。
 * @param language 语言。
 * @param text 整份文本。
 * @returns 记号；不认得的语言为空。
 */
export function tokenize(language: string, text: string): Token[] {
  const scanner = (scanners as Record<string, ((text: string) => Token[]) | undefined>)[language];
  return scanner ? scanner(text) : [];
}
