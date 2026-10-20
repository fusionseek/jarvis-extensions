/** 每种语言切出来的记号：用「种类:原文」写成一串，读得出哪一段被认成了什么。 */
import test from "node:test";
import assert from "node:assert/strict";
import { loadSource } from "./support.mjs";

const { tokenize, supportedLanguages, scan } = await loadSource();

/** 记号 → ["keyword:let", "number:1"]。顺带核对：按起点递增、互不重叠、都在文本里。 */
function read(language, text) {
  const tokens = tokenize(language, text);
  let end = 0;
  for (const token of tokens) {
    assert.ok(token.start >= end, `${language} 记号重叠：${JSON.stringify(token)}`);
    assert.ok(token.length > 0 && token.start + token.length <= text.length, `${language} 记号越界：${JSON.stringify(token)}`);
    end = token.start + token.length;
  }
  return tokens.map((token) => `${token.kind}:${text.slice(token.start, token.start + token.length)}`);
}

test("认得的语言就是宿主那张表（除了没有）", () => {
  assert.deepEqual([...supportedLanguages].sort(), [
    "c", "cpp", "csharp", "css", "go", "html", "java", "javascript", "json", "kotlin", "markdown", "objc", "python", "rust", "shell", "sql", "swift", "typescript", "xml", "yaml",
  ]);
  assert.deepEqual(tokenize("cobol", "MOVE A TO B"), [], "不认得的语言交回空");
});

test("Swift：声明后面的名字、属性、#指令、多行字符串、嵌套块注释、类型", () => {
  const text = '@MainActor\nfinal class Widget: View {\n  /* a /* b */ c */\n  let title = """\n  hi\n  """\n  func render(_ x: Int) -> String { #if DEBUG\n print(x) }\n}';
  assert.deepEqual(read("swift", text), [
    "attribute:@MainActor", "keyword:final", "keyword:class", "type:Widget", "type:View",
    "comment:/* a /* b */ c */", "keyword:let", 'string:"""\n  hi\n  """',
    "keyword:func", "function:render", "type:Int", "type:String", "preprocessor:#if", "constant:DEBUG", "function:print",
  ]);
});

test("Kotlin / Java：注解、fun、字符串模板整段、数字后缀", () => {
  assert.deepEqual(read("kotlin", 'fun main() { val n = 10L; println("n=$n") }'), [
    "keyword:fun", "function:main", "keyword:val", "number:10L", "function:println", 'string:"n=$n"',
  ]);
  assert.deepEqual(read("java", "@Override public void run() { return null; } // done"), [
    "attribute:@Override", "keyword:public", "type:void", "function:run", "keyword:return", "constant:null", "comment:// done",
  ]);
});

test("C / C++：预处理把指令与路径分开、全大写是常量、原始字符串", () => {
  assert.deepEqual(read("c", '#include <stdio.h>\nint main(void) { return EXIT_SUCCESS; }'), [
    "preprocessor:#include ", "string:<stdio.h>", "type:int", "function:main", "type:void", "keyword:return", "constant:EXIT_SUCCESS",
  ]);
  assert.deepEqual(read("cpp", 'auto s = R"x(a "b")x"; std::vector<Widget> v;'), [
    "keyword:auto", 'string:R"x(a "b")x"', "type:std", "type:vector", "type:Widget",
  ]);
});

test("C#：逐字字符串与内插字符串、#region 只在行首", () => {
  assert.deepEqual(read("csharp", '#region X\nvar p = @"C:\\a""b"; var q = $"{p}!";'), [
    "preprocessor:#region", "keyword:var", 'string:@"C:\\a""b"', "keyword:var", 'string:$"{p}!"',
  ]);
});

test("Python：三引号、带前缀的字符串、装饰器、def / class 之后的名字、常量", () => {
  assert.deepEqual(read("python", '@cache\ndef f(x=None):\n    """doc"""\n    return rb"\\x00" if x else True  # ok'), [
    "attribute:@cache", "keyword:def", "function:f", "constant:None", 'string:"""doc"""', "keyword:return", 'string:rb"\\x00"', "keyword:if", "keyword:else", "constant:True", "comment:# ok",
  ]);
});

test("Shell：变量、注释不吃掉 $#、内置命令与函数", () => {
  assert.deepEqual(read("shell", 'deploy() {\n  echo "$1" ${HOME} $# # done\n}'), [
    "function:deploy", "function:echo", 'string:"$1"', "variable:${HOME}", "variable:$#", "comment:# done",
  ]);
});

test("JS / TS：模板字符串、类型、函数", () => {
  assert.deepEqual(read("typescript", "export interface Props { name: string }\nconst f = (p: Props) => `hi ${p.name}`;"), [
    "keyword:export", "keyword:interface", "type:Props", "type:string", "keyword:const", "type:Props", "string:`hi ${p.name}`",
  ]);
});

test("Go / Rust：反引号原始字符串、宏、生命周期、属性", () => {
  assert.deepEqual(read("go", "func main() { s := `raw`; fmt.Println(len(s), nil) }"), [
    "keyword:func", "function:main", "string:`raw`", "function:Println", "function:len", "constant:nil",
  ]);
  assert.deepEqual(read("rust", '#[derive(Debug)]\nfn f<\'a>(s: &\'a str) -> Option<u8> { println!("{}", s); None }'), [
    "attribute:#[derive(Debug)]", "keyword:fn", "function:f", "attribute:'a", "attribute:'a", "type:str", "type:Option", "type:u8",
    "function:println!", 'string:"{}"', "constant:None",
  ]);
});

test("JSON：键是属性、值是字符串、数字与常量", () => {
  assert.deepEqual(read("json", '{ "name": "jarvis", "count": -1.5e3, "ok": true }'), [
    'property:"name"', 'string:"jarvis"', 'property:"count"', "number:-1.5e3", 'property:"ok"', "constant:true",
  ]);
});

test("YAML：键、列表记号、整值的数字 / 常量、引号字符串、锚点、注释", () => {
  assert.deepEqual(read("yaml", '---\nname: "jarvis" # app\nitems:\n  - count: 3\n  - &base enabled: yes\n'), [
    "marker:---", 'property:name', 'string:"jarvis"', "comment:# app", "property:items", "marker:-", "property:count", "number:3", "marker:-", "property:&base enabled", "constant:yes",
  ]);
});

test("CSS / SCSS：选择器、属性、数值单位、颜色、!important、变量、嵌套", () => {
  assert.deepEqual(read("css", ".card:hover > a { color: #fff !important; margin: 0 4px; }"), [
    "type:.card", "keyword::hover", "tag:a", "property:color", "constant:#fff", "keyword:!important", "property:margin", "number:0", "number:4px",
  ]);
  assert.deepEqual(read("css", "$gap: 8px;\n.a { &:focus { width: calc(100% - $gap); } }"), [
    "variable:$gap", "number:8px", "type:.a", "keyword:&", "keyword::focus", "property:width", "function:calc", "number:100%", "variable:$gap",
  ]);
});

test("HTML / XML：注释、声明、标签、属性、值、实体", () => {
  assert.deepEqual(read("html", '<!DOCTYPE html>\n<a href="/x" disabled>Tom &amp; Jerry</a><!-- c -->'), [
    "preprocessor:<!DOCTYPE html>", "tag:<a", "attribute:href", 'string:"/x"', "attribute:disabled", "tag:>", "constant:&amp;", "tag:</a", "tag:>", "comment:<!-- c -->",
  ]);
  assert.deepEqual(read("xml", '<?xml version="1.0"?><plist><key>A</key></plist>'), [
    'preprocessor:<?xml version="1.0"?>', "tag:<plist", "tag:>", "tag:<key", "tag:>", "tag:</key", "tag:>", "tag:</plist", "tag:>",
  ]);
});

test("Markdown：标题、列表记号与待办框、行内代码、链接、强调、引用、围栏代码整块", () => {
  const text = "# Title\n- [x] done `x`\n> quote\nSee [docs](a.md) and **bold**.\n```swift\nlet a = 1\n```\n";
  assert.deepEqual(read("markdown", text), [
    "heading:# Title", "marker:- [x]", "code:`x`", "quote:> quote", "link:[docs](a.md)", "emphasis:**bold**", "code:```swift\nlet a = 1\n```",
  ]);
});

test("SQL：关键字不分大小写、类型、字符串、带引号的标识符、注释", () => {
  assert.deepEqual(read("sql", "SELECT id, COUNT(*) FROM \"users\" WHERE name = 'a''b' -- x\nCREATE TABLE t (n INTEGER);"), [
    "keyword:SELECT", "function:COUNT", "keyword:FROM", 'property:"users"', "keyword:WHERE", "string:'a''b'", "comment:-- x",
    "keyword:CREATE", "keyword:TABLE", "type:t", "type:INTEGER",
  ]);
});

test("没闭合的块注释、字符串到行尾 / 文本末尾为止，不越界", () => {
  assert.deepEqual(read("c", 'a = "open\nb /* tail'), ['string:"open', "comment:/* tail"]);
  assert.deepEqual(read("swift", "/* never closed"), ["comment:/* never closed"]);
});

test("一份十万行的文件也很快（扫描是一遍、线性的）", () => {
  const line = 'func render(_ x: Int) -> String { return "value \\(x)" } // comment 42\n';
  const text = line.repeat(20_000);
  const started = Date.now();
  const tokens = tokenize("swift", text);
  const elapsed = Date.now() - started;
  assert.equal(tokens.length, 20_000 * 7, "func · render · Int · String · return · 字符串 · 注释");
  assert.ok(elapsed < 2_000, `用了 ${elapsed} ms`);
});
