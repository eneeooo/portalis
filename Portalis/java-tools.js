/*
 * Portalis Java tools - pure logic, no DOM.
 * Used by java-compiler.js in the browser and by the Node test harness.
 *
 *  - buildProgram():   turns whatever the student pasted into a Main.java that Judge0 can run.
 *                      The student's class keeps its own name (no renaming needed) and the
 *                      program's stdin/stdout are wrapped so the page can show an interactive
 *                      terminal and know which source line read each input / printed each text.
 *  - lint():           instant checks (unclosed strings, unbalanced brackets).
 *  - parseCompilerOutput() / suggestFixes():  javac errors -> line, column, plain-English hint, quick fixes.
 *  - parseRunOutput() / explainRuntimeError(): decode the marker stream coming back from the wrapper.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.JavaTools = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // ---------------------------------------------------------------- constants
  var RENAMED_MAIN = "Ma1n"; // same length as "Main" so columns never move
  var M_START = "\u0001";
  var M_MID = "\u0002";
  var M_END = "\u0003";
  var EOF_LINE = "\u0004";
  var MODIFIERS = { "public": 1, "protected": 1, "private": 1, "abstract": 1, "static": 1, "final": 1, "sealed": 1, "strictfp": 1, "non": 1, "-": 1 };
  var TYPE_KEYWORDS = { "class": 1, "interface": 1, "enum": 1, "record": 1 };

  // ---------------------------------------------------------------- tokenizer
  /**
   * Splits Java source into words / numbers / punctuation while skipping
   * comments, strings, chars and text blocks. Also reports unterminated literals.
   */
  function tokenize(code) {
    var tokens = [];
    var problems = [];
    var n = code.length;
    var i = 0;
    var line = 0;
    var depth = 0;

    function countNewlines(from, to) {
      var c = 0;
      for (var k = from; k < to; k++) if (code.charCodeAt(k) === 10) c++;
      return c;
    }

    while (i < n) {
      var ch = code[i];
      var nx = code[i + 1];
      if (ch === "\n") { line++; i++; continue; }
      if (ch === " " || ch === "\t" || ch === "\r" || ch === "\f") { i++; continue; }

      if (ch === "/" && nx === "/") {
        var eol = code.indexOf("\n", i);
        i = eol < 0 ? n : eol;
        continue;
      }
      if (ch === "/" && nx === "*") {
        var close = code.indexOf("*/", i + 2);
        var stop = close < 0 ? n : close + 2;
        if (close < 0) problems.push({ kind: "comment", line: line, index: i, length: 2, message: "This comment is never closed (missing */)." });
        line += countNewlines(i, stop);
        i = stop;
        continue;
      }
      if (ch === '"' && code.slice(i, i + 3) === '"""') {
        var j = i + 3;
        var found = false;
        while (j < n) {
          if (code[j] === "\\") { j += 2; continue; }
          if (code.slice(j, j + 3) === '"""') { found = true; break; }
          j++;
        }
        var end = found ? j + 3 : n;
        if (!found) problems.push({ kind: "string", line: line, index: i, length: 3, message: "This text block is never closed (missing \"\"\")." });
        line += countNewlines(i, end);
        i = end;
        continue;
      }
      if (ch === '"' || ch === "'") {
        var k2 = i + 1;
        while (k2 < n && code[k2] !== ch && code[k2] !== "\n") {
          if (code[k2] === "\\") k2++;
          k2++;
        }
        if (k2 >= n || code[k2] !== ch) {
          problems.push({
            kind: "string", line: line, index: i, length: Math.max(1, Math.min(k2, n) - i),
            message: ch === '"' ? "This string is not closed (missing a closing \")." : "This character literal is not closed (missing a closing ')."
          });
          i = Math.min(k2, n);
        } else {
          i = k2 + 1;
        }
        continue;
      }
      if (/[A-Za-z_$]/.test(ch)) {
        var s = i++;
        while (i < n && /[\w$]/.test(code[i])) i++;
        tokens.push({ value: code.slice(s, i), start: s, end: i, line: line, depth: depth, type: "word" });
        continue;
      }
      if (/[0-9]/.test(ch)) {
        var s2 = i++;
        while (i < n && /[0-9A-Za-z_.]/.test(code[i])) i++;
        tokens.push({ value: code.slice(s2, i), start: s2, end: i, line: line, depth: depth, type: "num" });
        continue;
      }
      if (ch === "{") {
        tokens.push({ value: ch, start: i, end: i + 1, line: line, depth: depth, type: "p" });
        depth++;
      } else if (ch === "}") {
        depth = Math.max(0, depth - 1);
        tokens.push({ value: ch, start: i, end: i + 1, line: line, depth: depth, type: "p" });
      } else {
        tokens.push({ value: ch, start: i, end: i + 1, line: line, depth: depth, type: "p" });
      }
      i++;
    }
    return { tokens: tokens, problems: problems };
  }

  // ---------------------------------------------------------------- analysis
  function analyze(code) {
    var tk = tokenize(code).tokens;
    var types = [];
    var packageRange = null;
    var idx;

    for (idx = 0; idx < tk.length; idx++) {
      var t = tk[idx];
      if (t.depth !== 0) continue;
      if (t.value === "package" && t.type === "word" && !packageRange) {
        var semi = idx + 1;
        while (semi < tk.length && tk[semi].value !== ";") semi++;
        if (semi < tk.length) packageRange = { start: t.start, end: tk[semi].end };
        continue;
      }
    }

    var skipUntil = -1; // tokens belonging to package/import statements
    for (idx = 0; idx < tk.length; idx++) {
      var tok = tk[idx];
      if (tok.depth !== 0 || tok.type !== "word") continue;
      if (packageRange && tok.start >= packageRange.start && tok.end <= packageRange.end) continue;
      if (tok.value === "import") {
        var e = idx + 1;
        while (e < tk.length && tk[e].value !== ";") e++;
        skipUntil = e;
      }
      if (idx <= skipUntil) continue;
      var isAtInterface = tok.value === "interface" && idx > 0 && tk[idx - 1].value === "@";
      if (!TYPE_KEYWORDS[tok.value] && !isAtInterface) continue;
      var prev = tk[idx - 1];
      if (prev && prev.value === "." && !isAtInterface) continue;
      var nameTok = tk[idx + 1];
      if (!nameTok || nameTok.type !== "word") continue;
      if (tok.value === "record") {
        var after = tk[idx + 2];
        if (!after || (after.value !== "(" && after.value !== "<")) continue;
      }
      // body = first "{" after the name at depth 0, matching "}" at depth 0
      var open = idx + 2;
      while (open < tk.length && !(tk[open].value === "{" && tk[open].depth === 0)) {
        if (tk[open].value === ";" && tk[open].depth === 0) break;
        open++;
      }
      if (open >= tk.length || tk[open].value !== "{") continue;
      var closeIdx = open + 1;
      while (closeIdx < tk.length && !(tk[closeIdx].value === "}" && tk[closeIdx].depth === 0)) closeIdx++;
      var info = {
        name: nameTok.value,
        kind: isAtInterface ? "@interface" : tok.value,
        keywordIndex: idx,
        declStart: isAtInterface ? idx - 1 : idx,
        nameIndex: idx + 1,
        openIndex: open,
        closeIndex: closeIdx,
        line: nameTok.line,
        isPublic: false,
        hasMain: false
      };
      // modifiers before the keyword
      var b = info.declStart - 1;
      while (b >= 0 && MODIFIERS[tk[b].value] && tk[b].depth === 0) {
        if (tk[b].value === "public") { info.isPublic = true; info.publicIndex = b; }
        b--;
      }
      // main method directly inside this type
      for (var m = open + 1; m < closeIdx && m < tk.length; m++) {
        if (tk[m].value !== "main" || tk[m].depth !== 1) continue;
        if (!tk[m + 1] || tk[m + 1].value !== "(") continue;
        var sawString = false;
        for (var q = m + 2; q < Math.min(tk.length, m + 8); q++) {
          if (tk[q].value === ")") break;
          if (tk[q].value === "String") sawString = true;
        }
        var sawStatic = false;
        for (var r = Math.max(open + 1, m - 6); r < m; r++) if (tk[r].value === "static") sawStatic = true;
        if (sawString && sawStatic) { info.hasMain = true; break; }
      }
      types.push(info);
      idx = closeIdx; // skip the body
    }

    var mainType = null;
    for (var a = 0; a < types.length; a++) if (types[a].hasMain && types[a].isPublic) { mainType = types[a]; break; }
    if (!mainType) for (var c2 = 0; c2 < types.length; c2++) if (types[c2].hasMain) { mainType = types[c2]; break; }
    return { tokens: tk, types: types, mainType: mainType, packageRange: packageRange };
  }

  function sourceFileName(code) {
    var a = analyze(code);
    var pub = null;
    for (var i = 0; i < a.types.length; i++) if (a.types[i].isPublic) { pub = a.types[i]; break; }
    var pick = pub || a.mainType || a.types[0];
    return (pick ? pick.name : "Main") + ".java";
  }

  // ---------------------------------------------------------------- wrapper
  var WRAPPER = String.raw`
final class PortalisIn__ extends java.io.InputStream {
    static final int USER_LINES = %LINES%;
    static java.io.PrintStream err;
    private final byte[] data;
    private final java.io.PrintStream out;
    private final boolean eof;
    private boolean eofShown = false;
    private int pos = 0, end = 0, count = 0;
    PortalisIn__(byte[] all, java.io.PrintStream out) {
        int n = all.length;
        boolean e = false;
        if (n >= 2 && all[n - 2] == 4 && all[n - 1] == '\n') { n -= 2; e = true; }
        this.data = java.util.Arrays.copyOf(all, n);
        this.eof = e;
        this.out = out;
    }
    static int callerLine() {
        for (StackTraceElement e : new Throwable().getStackTrace()) {
            String c = e.getClassName();
            if (c.equals("Main") || c.startsWith("PortalisIn__") || c.startsWith("PortalisOut__")) continue;
            if ("Main.java".equals(e.getFileName()) && e.getLineNumber() > 0 && e.getLineNumber() <= USER_LINES) return e.getLineNumber();
        }
        return -1;
    }
    private void emit(String s) {
        byte[] b = s.getBytes(java.nio.charset.StandardCharsets.UTF_8);
        out.write(b, 0, b.length);
    }
    private boolean next() {
        if (pos >= data.length) {
            out.flush();
            if (eof) {
                if (!eofShown) { eofShown = true; emit("\u0001Z\u0002\u0003"); out.flush(); }
                return false;
            }
            err.print("\u0001W" + callerLine() + "\u0002");
            err.flush();
            Runtime.getRuntime().halt(0);
        }
        int e = pos;
        while (e < data.length && data[e] != '\n') e++;
        if (e < data.length) e++;
        end = e;
        int t = e;
        while (t > pos && (data[t - 1] == '\n' || data[t - 1] == '\r')) t--;
        emit("\u0001I" + (count++) + "," + callerLine() + "\u0002" + new String(data, pos, t - pos, java.nio.charset.StandardCharsets.UTF_8) + "\u0003");
        out.flush();
        return true;
    }
    @Override public int read() {
        if (pos >= end && !next()) return -1;
        return data[pos++] & 0xff;
    }
    @Override public int read(byte[] b, int off, int len) {
        if (len == 0) return 0;
        if (pos >= end && !next()) return -1;
        int n = Math.min(len, end - pos);
        System.arraycopy(data, pos, b, off, n);
        pos += n;
        return n;
    }
    @Override public int available() { return end - pos; }
}

final class PortalisOut__ extends java.io.PrintStream {
    private int calls = 0;
    private int last = -2;
    PortalisOut__(java.io.PrintStream orig) {
        super(orig, true, java.nio.charset.StandardCharsets.UTF_8);
    }
    private void tag() {
        if (calls > 20000) return;
        calls++;
        int line = PortalisIn__.callerLine();
        if (line != last) {
            last = line;
            byte[] m = ("\u0001O" + line + "\u0002").getBytes(java.nio.charset.StandardCharsets.UTF_8);
            super.write(m, 0, m.length);
        }
    }
    @Override public void write(int b) { tag(); super.write(b); }
    @Override public void write(byte[] b, int off, int len) { tag(); super.write(b, off, len); }
}

public class Main {
    public static void main(String[] args) throws Throwable {
        java.io.PrintStream orig = System.out;
        byte[] all = System.in.readAllBytes();
        PortalisIn__.err = System.err;
        System.setIn(new PortalisIn__(all, orig));
        System.setOut(new PortalisOut__(orig));
        %MAIN%.main(args);
        System.out.flush();
    }
}
`;

  function blank(text) {
    return text.replace(/[^\r\n]/g, " ");
  }

  /**
   * Prepare the student's code for Judge0.
   * Returns { source, userLines, mainName, displayMain, renamed } or { error: {message, line} }.
   */
  function buildProgram(code) {
    var a = analyze(code);
    var lines = code.split("\n");
    if (!a.types.length) {
      return { error: { line: 0, message: "No class found. Write something like: public class Main { public static void main(String[] args) { ... } }" } };
    }
    if (!a.mainType) {
      var first = a.types[0];
      return { error: { line: first.line, message: "No main method found in \"" + first.name + "\". Java starts running from: public static void main(String[] args)" } };
    }
    var edits = [];
    var tk = a.tokens;
    if (a.packageRange) {
      edits.push({ start: a.packageRange.start, end: a.packageRange.end, text: blank(code.slice(a.packageRange.start, a.packageRange.end)) });
    }
    a.types.forEach(function (info) {
      if (info.isPublic) {
        var p = tk[info.publicIndex];
        edits.push({ start: p.start, end: p.end, text: "      " });
      }
    });
    var needsRename = a.types.some(function (info) { return info.name === "Main"; });
    var mainName = a.mainType.name;
    if (needsRename) {
      tk.forEach(function (t) {
        if (t.type === "word" && t.value === "Main") edits.push({ start: t.start, end: t.end, text: RENAMED_MAIN });
      });
      if (mainName === "Main") mainName = RENAMED_MAIN;
    }
    edits.sort(function (x, y) { return y.start - x.start; });
    var out = code;
    var seen = {};
    edits.forEach(function (e) {
      if (seen[e.start]) return;
      seen[e.start] = true;
      out = out.slice(0, e.start) + e.text + out.slice(e.end);
    });
    var userLines = lines.length;
    var wrapper = WRAPPER.replace("%LINES%", String(userLines)).replace("%MAIN%", mainName);
    return {
      source: out + "\n" + wrapper,
      userLines: userLines,
      mainName: mainName,
      displayMain: a.mainType.name,
      renamed: needsRename
    };
  }

  /** Put "Main" back wherever the compiler/JVM printed the temporary name. */
  function unrename(text) {
    return String(text || "").replace(new RegExp("\\b" + RENAMED_MAIN + "\\b", "g"), "Main");
  }

  // ---------------------------------------------------------------- stdin helper
  function buildStdin(inputs, eof) {
    var s = inputs.map(function (v) { return String(v).replace(/[\r\n]+/g, " ") + "\n"; }).join("");
    return eof ? s + EOF_LINE + "\n" : s;
  }

  // ---------------------------------------------------------------- lint
  function lint(code) {
    var tk = tokenize(code);
    var out = [];
    var starts = lineStarts(code);
    tk.problems.forEach(function (p) {
      out.push({
        severity: "error", source: "lint", kind: p.kind === "string" ? "unclosed-string" : "unclosed-comment",
        line: p.line, col: p.index - starts[p.line], length: p.length, message: p.message
      });
    });
    var stack = [];
    var pairs = { ")": "(", "]": "[", "}": "{" };
    tk.tokens.forEach(function (t) {
      if (t.type !== "p") return;
      if (t.value === "(" || t.value === "[" || t.value === "{") {
        stack.push(t);
      } else if (pairs[t.value]) {
        var top = stack[stack.length - 1];
        if (!top) {
          out.push({ severity: "error", source: "lint", kind: "extra-closer", line: t.line, col: t.start - starts[t.line], length: 1, ch: t.value,
            message: "Unexpected '" + t.value + "' - there is no '" + pairs[t.value] + "' to match it." });
        } else if (top.value !== pairs[t.value]) {
          out.push({ severity: "error", source: "lint", kind: "mismatch", line: t.line, col: t.start - starts[t.line], length: 1, ch: t.value,
            message: "'" + t.value + "' does not match the '" + top.value + "' opened on line " + (top.line + 1) + "." });
          stack.pop();
        } else {
          stack.pop();
        }
      }
    });
    stack.forEach(function (t) {
      out.push({ severity: "error", source: "lint", kind: "unclosed-opener", line: t.line, col: t.start - starts[t.line], length: 1, ch: t.value,
        message: "'" + t.value + "' is never closed." });
    });
    return out;
  }

  function lineStarts(code) {
    var starts = [0];
    for (var i = 0; i < code.length; i++) if (code.charCodeAt(i) === 10) starts.push(i + 1);
    return starts;
  }

  // ---------------------------------------------------------------- javac output
  function parseCompilerOutput(text, ctx) {
    ctx = ctx || {};
    var userLines = ctx.userLines || Infinity;
    var codeLines = ctx.codeLines || [];
    var raw = unrename(text).replace(/\r\n/g, "\n");
    var rows = raw.split("\n");
    var diags = [];
    var head = /^(?:[^\s:]+\.java):(\d+):\s*(error|warning):\s*(.*)$/;
    var cur = null;
    for (var i = 0; i < rows.length; i++) {
      var row = rows[i];
      var m = head.exec(row);
      if (m) {
        if (cur) diags.push(cur);
        cur = { severity: m[2], message: m[3].trim(), line: Number(m[1]) - 1, col: -1, details: {}, extra: [], source: "javac", sourceLine: null };
        var srcRow = rows[i + 1];
        var caretRow = rows[i + 2];
        if (typeof srcRow === "string" && typeof caretRow === "string" && /^\s*\^\s*$/.test(caretRow)) {
          cur.sourceLine = srcRow;
          cur.col = caretRow.indexOf("^");
          i += 2;
        }
        continue;
      }
      if (!cur) continue;
      if (/^\d+\s+(errors?|warnings?)\s*$/.test(row) || /^Note:/.test(row)) { diags.push(cur); cur = null; continue; }
      var d = /^\s+(symbol|location|required|found|reason|expected|actual)\s*:\s*(.*)$/.exec(row);
      if (d) cur.details[d[1]] = d[2].trim();
      else if (row.trim()) cur.extra.push(row.trim());
    }
    if (cur) diags.push(cur);

    diags.forEach(function (d2) {
      var clamped = false;
      if (d2.line >= userLines) { d2.line = Math.max(0, userLines - 1); clamped = true; }
      d2.clamped = clamped;
      d2.caret = d2.col; // exact position javac pointed at (needed by quick fixes)
      var lineText = codeLines[d2.line];
      if (clamped) {
        d2.col = -1;
        d2.length = 0;
      } else if (typeof lineText === "string") {
        var range = markRange(lineText, d2.col);
        d2.col = range.col;
        d2.length = range.length;
      } else {
        d2.length = 1;
      }
    });
    // A single mistake often makes javac repeat itself; keep the first message per line+text.
    var seen = {};
    return diags.filter(function (d3) {
      var key = d3.line + "|" + d3.message + "|" + d3.col;
      if (seen[key]) return false;
      seen[key] = true;
      return true;
    });
  }

  function markRange(lineText, col) {
    if (col < 0) return { col: 0, length: Math.max(1, lineText.length) };
    if (col >= lineText.length) return { col: Math.max(0, lineText.length - 1), length: lineText.length ? 1 : 0, atEnd: true };
    var start = col;
    if (lineText[start] === ".") start++;
    if (/[\w$]/.test(lineText[start] || "")) {
      var end = start;
      while (end < lineText.length && /[\w$]/.test(lineText[end])) end++;
      return { col: start, length: end - start };
    }
    return { col: col, length: 1 };
  }

  // ---------------------------------------------------------------- suggestions
  var IMPORTS = {
    Scanner: "java.util.Scanner", ArrayList: "java.util.ArrayList", List: "java.util.List", LinkedList: "java.util.LinkedList",
    HashMap: "java.util.HashMap", Map: "java.util.Map", TreeMap: "java.util.TreeMap", HashSet: "java.util.HashSet", Set: "java.util.Set",
    TreeSet: "java.util.TreeSet", Arrays: "java.util.Arrays", Collections: "java.util.Collections", Random: "java.util.Random",
    Queue: "java.util.Queue", Deque: "java.util.Deque", ArrayDeque: "java.util.ArrayDeque", Stack: "java.util.Stack",
    PriorityQueue: "java.util.PriorityQueue", Iterator: "java.util.Iterator", Optional: "java.util.Optional", Objects: "java.util.Objects",
    InputMismatchException: "java.util.InputMismatchException", NoSuchElementException: "java.util.NoSuchElementException",
    BufferedReader: "java.io.BufferedReader", InputStreamReader: "java.io.InputStreamReader", IOException: "java.io.IOException",
    PrintWriter: "java.io.PrintWriter", File: "java.io.File", FileReader: "java.io.FileReader", FileWriter: "java.io.FileWriter",
    LocalDate: "java.time.LocalDate", LocalDateTime: "java.time.LocalDateTime", LocalTime: "java.time.LocalTime",
    DecimalFormat: "java.text.DecimalFormat", BigDecimal: "java.math.BigDecimal", BigInteger: "java.math.BigInteger",
    Collectors: "java.util.stream.Collectors", Stream: "java.util.stream.Stream", IntStream: "java.util.stream.IntStream"
  };
  var JAVA_LANG = ["String", "System", "Math", "Integer", "Double", "Long", "Boolean", "Character", "Object", "StringBuilder", "Thread", "Exception", "RuntimeException", "Float", "Short", "Byte"];
  var API_METHODS = {
    PrintStream: ["println", "print", "printf", "format", "flush", "write", "append"],
    String: ["length", "charAt", "substring", "indexOf", "lastIndexOf", "equals", "equalsIgnoreCase", "compareTo", "contains", "startsWith", "endsWith", "toUpperCase", "toLowerCase", "trim", "split", "replace", "isEmpty", "toCharArray", "valueOf", "format", "join", "concat", "matches", "strip", "repeat"],
    Math: ["abs", "pow", "sqrt", "max", "min", "round", "floor", "ceil", "random", "sin", "cos", "tan", "log", "exp", "cbrt", "hypot", "floorMod"],
    Scanner: ["nextInt", "nextLine", "nextDouble", "next", "nextBoolean", "nextLong", "hasNext", "hasNextInt", "hasNextLine", "hasNextDouble", "close"],
    Integer: ["parseInt", "valueOf", "toString", "compare", "max", "min", "sum", "toBinaryString", "toHexString", "MAX_VALUE", "MIN_VALUE"],
    Double: ["parseDouble", "valueOf", "toString", "compare", "isNaN", "MAX_VALUE", "MIN_VALUE"],
    Character: ["isDigit", "isLetter", "isLetterOrDigit", "isUpperCase", "isLowerCase", "isWhitespace", "toUpperCase", "toLowerCase", "getNumericValue"],
    ArrayList: ["add", "get", "set", "remove", "size", "isEmpty", "contains", "clear", "indexOf", "addAll", "sort", "forEach", "toArray"],
    List: ["add", "get", "set", "remove", "size", "isEmpty", "contains", "clear", "indexOf", "addAll", "sort", "forEach", "of"],
    HashMap: ["put", "get", "containsKey", "containsValue", "remove", "size", "isEmpty", "keySet", "values", "entrySet", "getOrDefault", "putIfAbsent", "clear"],
    Map: ["put", "get", "containsKey", "containsValue", "remove", "size", "isEmpty", "keySet", "values", "entrySet", "getOrDefault", "putIfAbsent", "of"],
    Arrays: ["toString", "sort", "fill", "asList", "copyOf", "copyOfRange", "equals", "stream", "deepToString", "binarySearch"],
    StringBuilder: ["append", "insert", "reverse", "toString", "length", "charAt", "deleteCharAt", "delete", "setCharAt", "replace", "indexOf"],
    Random: ["nextInt", "nextDouble", "nextBoolean", "nextLong"],
    System: ["out", "in", "err", "currentTimeMillis", "nanoTime", "exit", "lineSeparator", "arraycopy"],
    Thread: ["sleep", "start", "join", "currentThread"]
  };
  var GENERIC_WORDS = ["System", "String", "Integer", "Double", "Boolean", "Character", "Math", "Scanner", "ArrayList", "HashMap", "StringBuilder", "args", "main", "length", "println", "print", "printf", "nextInt", "nextLine", "nextDouble"];

  function osaDistance(a, b) {
    var al = a.length, bl = b.length;
    var d = [];
    for (var i = 0; i <= al; i++) { d[i] = [i]; }
    for (var j = 0; j <= bl; j++) d[0][j] = j;
    for (i = 1; i <= al; i++) {
      for (j = 1; j <= bl; j++) {
        var cost = a[i - 1] === b[j - 1] ? 0 : 1;
        d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
        if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + cost);
      }
    }
    return d[al][bl];
  }

  function closestWord(word, candidates) {
    var best = null;
    var bestScore = Infinity;
    var limit = word.length <= 3 ? 1 : word.length <= 6 ? 2 : 3;
    var seen = {};
    candidates.forEach(function (cand) {
      if (!cand || cand === word || seen[cand]) return;
      seen[cand] = true;
      var dist = osaDistance(word, cand);
      if (word.toLowerCase() === cand.toLowerCase()) dist = 0.5;
      if (dist <= limit && dist < bestScore) { best = cand; bestScore = dist; }
    });
    return best;
  }

  function identifiersIn(code) {
    var out = {};
    tokenize(code).tokens.forEach(function (t) { if (t.type === "word") out[t.value] = 1; });
    return Object.keys(out);
  }

  function splitLines(code) { return code.split("\n"); }

  // Put the missing quote before the trailing ")", "]", ";" or "," the student already typed.
  function closeStringOnLine(quote) {
    return function (l) {
      var tail = /[\s)\];,]*$/.exec(l)[0];
      var head = l.slice(0, l.length - tail.length);
      return head + quote + tail;
    };
  }

  function replaceInLine(code, lineIdx, fn) {
    var lines = splitLines(code);
    if (lineIdx < 0 || lineIdx >= lines.length) return code;
    lines[lineIdx] = fn(lines[lineIdx]);
    return lines.join("\n");
  }

  function replaceWord(line, word, replacement, hintCol) {
    var re = new RegExp("(^|[^\\w$])" + word.replace(/[$]/g, "\\$") + "(?![\\w$])", "g");
    var best = null;
    var m;
    while ((m = re.exec(line))) {
      var at = m.index + m[1].length;
      if (best === null || (hintCol >= 0 && Math.abs(at - hintCol) < Math.abs(best - hintCol))) best = at;
      if (hintCol < 0) break;
    }
    if (best === null) return line;
    return line.slice(0, best) + replacement + line.slice(best + word.length);
  }

  function addImport(code, fqcn) {
    var imp = "import " + fqcn + ";";
    if (code.indexOf(imp) !== -1) return code;
    var pkg = fqcn.replace(/\.[^.]+$/, "");
    if (new RegExp("import\\s+" + pkg.replace(/\./g, "\\.") + "\\.\\*\\s*;").test(code)) return code;
    var lines = splitLines(code);
    var lastImport = -1;
    var pkgLine = -1;
    var pending = false;
    lines.forEach(function (l, i) {
      if (/^\s*import\s/.test(l)) lastImport = i;
      if (/^\s*package\s/.test(l)) pkgLine = i;
    });
    pending = lastImport === -1;
    var at = lastImport >= 0 ? lastImport + 1 : pkgLine >= 0 ? pkgLine + 1 : 0;
    lines.splice(at, 0, imp);
    if (pending && lines[at + 1] !== undefined && lines[at + 1].trim() !== "") lines.splice(at + 1, 0, "");
    return lines.join("\n");
  }

  function defaultValueFor(type) {
    if (/^(int|long|short|byte)$/.test(type)) return "0";
    if (/^(double|float)$/.test(type)) return "0.0";
    if (type === "boolean") return "false";
    if (type === "char") return "'\\0'";
    return "null";
  }

  function findEnclosingMethod(lines, fromLine) {
    var sig = /^\s*((?:(?:public|private|protected|static|final|abstract|synchronized)\s+)*)([\w<>\[\],.? ]+?)\s+([A-Za-z_$][\w$]*)\s*\(([^)]*)\)\s*(throws\s+[\w.,\s]+)?\s*\{?\s*$/;
    for (var i = Math.min(fromLine, lines.length - 1); i >= 0; i--) {
      var l = lines[i];
      if (/^\s*(if|for|while|switch|catch|else|try|do|synchronized|return|new)\b/.test(l)) continue;
      var m = sig.exec(l);
      if (m) return { line: i, returnType: m[2].trim(), name: m[3], throwsClause: m[5] || "" };
    }
    return null;
  }

  function wrapRhs(line, wrap) {
    // x = expr;   |   Type x = expr;   |   return expr;
    var m = /^(\s*(?:return\s+|(?:[\w$.<>\[\],?]+\s+)*?[\w$.\[\]]+\s*=\s*))(.*?)(\s*;\s*(?:\/\/.*)?)$/.exec(line);
    if (!m) return null;
    var rhs = m[2];
    if (!rhs.trim()) return null;
    return m[1] + wrap(rhs.trim()) + m[3];
  }

  /**
   * Returns { explanation, fixes:[{label, apply(code)->code}] } for one diagnostic.
   */
  function suggestFixes(diag, code) {
    var lines = splitLines(code);
    var line = lines[diag.line] || "";
    var msg = diag.message || "";
    var det = diag.details || {};
    var fixes = [];
    var explanation = "";
    var m;

    // ---- lint-only kinds
    if (diag.kind === "unclosed-string") {
      explanation = "A string needs a closing quote on the same line.";
      var q = /'/.test(line.slice(diag.col, diag.col + 1)) ? "'" : '"';
      fixes.push({ label: "Add closing " + q, apply: function (c) { return replaceInLine(c, diag.line, closeStringOnLine(q)); } });
      return { explanation: explanation, fixes: fixes };
    }
    if (diag.kind === "extra-closer" || diag.kind === "mismatch") {
      explanation = "This closing bracket has no matching opening bracket. Remove it, or add the missing opening bracket above.";
      fixes.push({ label: "Remove this '" + diag.ch + "'", apply: function (c) { return replaceInLine(c, diag.line, function (l) {
        var at = diag.col;
        if (l[at] !== diag.ch) at = l.indexOf(diag.ch);
        if (at < 0) return l;
        var out = l.slice(0, at) + l.slice(at + 1);
        return out;
      }); } });
      return { explanation: explanation, fixes: fixes };
    }
    if (diag.kind === "unclosed-opener") {
      explanation = "This '" + diag.ch + "' is opened but never closed.";
      fixes.push(closeAtEndFix());
      return { explanation: explanation, fixes: fixes };
    }
    if (diag.kind === "unclosed-comment") {
      explanation = "Close the comment with */ or remove the /*.";
      return { explanation: explanation, fixes: [] };
    }

    function closeAtEndFix() {
      return { label: "Add the missing closing bracket(s) at the end", apply: function (c) {
        var stack = [];
        tokenize(c).tokens.forEach(function (t) {
          if (t.type !== "p") return;
          if (t.value === "{" || t.value === "(" || t.value === "[") stack.push(t);
          else if (t.value === "}" || t.value === ")" || t.value === "]") stack.pop();
        });
        if (!stack.length) return c;
        var cl = { "{": "}", "(": ")", "[": "]" };
        var ls = splitLines(c);
        var add = [];
        for (var i = stack.length - 1; i >= 0; i--) {
          var openerLine = ls[stack[i].line] || "";
          var indent = /^\s*/.exec(openerLine)[0];
          add.push(indent + cl[stack[i].value]);
        }
        return c.replace(/\s+$/, "") + "\n" + add.join("\n") + "\n";
      } };
    }

    // ---- javac messages
    if ((m = /^'(\)|\]|;)'(?: or ',')? expected$/.exec(msg)) || /^'\)' or ',' expected$/.test(msg)) {
      var ch = m ? m[1] : ")";
      var what = ch === ";" ? "semicolon (;)" : ch === ")" ? "closing parenthesis ())" : "closing bracket (])";
      explanation = "Something is missing here: a " + what + ". Java statements end with ';' and every '(' needs a ')'.";
      fixes.push({ label: "Add " + ch, apply: function (c) { return replaceInLine(c, diag.line, function (l) {
        var at = typeof diag.caret === "number" && diag.caret >= 0 ? Math.min(diag.caret, l.length) : l.replace(/\s+$/, "").length;
        return l.slice(0, at) + ch + l.slice(at);
      }); } });
      return { explanation: explanation, fixes: fixes };
    }
    if (/reached end of file while parsing/.test(msg)) {
      explanation = "The file ended while Java still expected more code - usually a closing brace } is missing.";
      fixes.push(closeAtEndFix());
      return { explanation: explanation, fixes: fixes };
    }
    if (/class, interface, enum, or record expected/.test(msg)) {
      explanation = "Java found code outside of any class. This is usually one closing brace } too many above this line.";
      if (/^\s*\}\s*$/.test(line)) fixes.push({ label: "Remove this extra }", apply: function (c) { var ls = splitLines(c); ls.splice(diag.line, 1); return ls.join("\n"); } });
      return { explanation: explanation, fixes: fixes };
    }
    if (/unclosed string literal/.test(msg)) {
      explanation = "A string must be closed with a quote (\") on the same line.";
      fixes.push({ label: "Add closing \"", apply: function (c) { return replaceInLine(c, diag.line, closeStringOnLine('"')); } });
      return { explanation: explanation, fixes: fixes };
    }
    if ((m = /^package ([\w$]+) does not exist$/.exec(msg))) {
      var pk = m[1];
      var fixed = closestWord(pk, JAVA_LANG.concat(Object.keys(IMPORTS)));
      explanation = "\"" + pk + "\" is not a known name here. Java is case-sensitive: class names start with a capital letter (System, not system).";
      if (fixed) fixes.push({ label: "Change \"" + pk + "\" to \"" + fixed + "\"", apply: function (c) { return replaceInLine(c, diag.line, function (l) { return replaceWord(l, pk, fixed, diag.col); }); } });
      return { explanation: explanation, fixes: fixes };
    }
    if (/cannot find symbol/.test(msg)) {
      var sm = /^(class|variable|method)\s+([\w$]+)/.exec(det.symbol || "");
      var kind = sm ? sm[1] : "";
      var name = sm ? sm[2] : "";
      var locType = null;
      var lm = /of type ([\w$.<>\[\]]+)/.exec(det.location || "") || /^class ([\w$.<>\[\]]+)/.exec(det.location || "");
      if (lm) locType = lm[1].replace(/<.*$/, "");
      if (kind === "class" && IMPORTS[name]) {
        explanation = "Java doesn't know \"" + name + "\" yet - it needs an import at the top of the file.";
        fixes.push({ label: "Add import " + IMPORTS[name], apply: function (c) { return addImport(c, IMPORTS[name]); } });
        return { explanation: explanation, fixes: fixes };
      }
      var pool;
      if (kind === "method" || (diag.col >= 0 && line[diag.col] === ".")) {
        pool = (locType && API_METHODS[locType]) ? API_METHODS[locType] : [];
        if (/^(class|variable) (\w+)/.test(det.location || "")) {
          var lc = /^class (\w+)/.exec(det.location || "");
          if (lc && API_METHODS[lc[1]]) pool = pool.concat(API_METHODS[lc[1]]);
        }
        pool = pool.concat(identifiersIn(code));
      } else if (kind === "class") {
        pool = JAVA_LANG.concat(Object.keys(IMPORTS), identifiersIn(code));
      } else {
        pool = identifiersIn(code).concat(GENERIC_WORDS);
      }
      var guess = name ? closestWord(name, pool) : null;
      explanation = "Java can't find " + (kind || "a name") + (name ? " \"" + name + "\"" : "") + ". Check the spelling (Java is case-sensitive), that it is declared before you use it, and that any needed import is present.";
      if (guess) {
        var needsImport = kind === "class" && IMPORTS[guess] && !/^java\.lang\./.test(IMPORTS[guess]);
        fixes.push({ label: "Change \"" + name + "\" to \"" + guess + "\"", apply: function (c) {
          var out = replaceInLine(c, diag.line, function (l) { return replaceWord(l, name, guess, diag.col); });
          return needsImport ? addImport(out, IMPORTS[guess]) : out;
        } });
      }
      return { explanation: explanation, fixes: fixes };
    }
    if ((m = /incompatible types: possible lossy conversion from (\w+) to (\w+)/.exec(msg))) {
      var from = m[1], to = m[2];
      explanation = "A " + from + " value can lose information when it is stored in a " + to + ". Either cast it on purpose or use a bigger type.";
      var casted = wrapRhs(line, function (rhs) { return "(" + to + ") " + (/^[\w$.]+$/.test(rhs) ? rhs : "(" + rhs + ")"); });
      if (casted) fixes.push({ label: "Cast to (" + to + ")", apply: function (c) { return replaceInLine(c, diag.line, function (l) { return wrapRhs(l, function (rhs) { return "(" + to + ") " + (/^[\w$.]+$/.test(rhs) ? rhs : "(" + rhs + ")"); }) || l; }); } });
      if (/^\s*(?:final\s+)?(int|long|short|byte|char|float)\s+[\w$]+\s*=/.test(line)) {
        fixes.push({ label: "Change the variable type to " + from, apply: function (c) { return replaceInLine(c, diag.line, function (l) { return l.replace(/^(\s*(?:final\s+)?)(int|long|short|byte|char|float)(\s+[\w$]+\s*=)/, "$1" + from + "$3"); }); } });
      }
      return { explanation: explanation, fixes: fixes };
    }
    if ((m = /incompatible types: String cannot be converted to (int|double|long|boolean|float|short|byte)/.exec(msg))) {
      var target = m[1];
      var parser = { int: "Integer.parseInt", double: "Double.parseDouble", long: "Long.parseLong", boolean: "Boolean.parseBoolean", float: "Float.parseFloat", short: "Short.parseShort", byte: "Byte.parseByte" }[target];
      explanation = "A String (text) can't be stored in a " + target + " directly. Convert it with " + parser + "(...), or read it with the matching Scanner method.";
      var scanMethod = { int: "nextInt", double: "nextDouble", long: "nextLong", boolean: "nextBoolean", float: "nextFloat", short: "nextShort", byte: "nextByte" }[target];
      var sc = /(\b[\w$]+)\.(nextLine|next)\(\)/.exec(line);
      if (sc) fixes.push({ label: "Use " + sc[1] + "." + scanMethod + "() instead", apply: function (c) { return replaceInLine(c, diag.line, function (l) { return l.replace(/(\b[\w$]+)\.(nextLine|next)\(\)/, "$1." + scanMethod + "()"); }); } });
      if (wrapRhs(line, function (r) { return parser + "(" + r + ")"; })) fixes.push({ label: "Wrap with " + parser + "(...)", apply: function (c) { return replaceInLine(c, diag.line, function (l) { return wrapRhs(l, function (r) { return parser + "(" + r + ")"; }) || l; }); } });
      return { explanation: explanation, fixes: fixes };
    }
    if (/incompatible types: (int|double|long|char|float|short|byte|boolean) cannot be converted to String/.test(msg)) {
      explanation = "A number can't be stored directly in a String. Convert it with String.valueOf(...).";
      if (wrapRhs(line, function (r) { return "String.valueOf(" + r + ")"; })) fixes.push({ label: "Wrap with String.valueOf(...)", apply: function (c) { return replaceInLine(c, diag.line, function (l) { return wrapRhs(l, function (r) { return "String.valueOf(" + r + ")"; }) || l; }); } });
      return { explanation: explanation, fixes: fixes };
    }
    if (/incompatible types: (int|String|double) cannot be converted to boolean/.test(msg)) {
      explanation = "An if/while needs a true/false condition. A single = assigns a value; use == to compare.";
      if (/\b(if|while)\s*\(.*[^=!<>]=[^=].*\)/.test(line)) {
        fixes.push({ label: "Change = to ==", apply: function (c) { return replaceInLine(c, diag.line, function (l) {
          return l.replace(/(\b(?:if|while)\s*\()(.*)\)/, function (all, pre, cond) { return pre + cond.replace(/([^=!<>])=([^=])/, "$1==$2") + ")"; });
        }); } });
      }
      return { explanation: explanation, fixes: fixes };
    }
    if ((m = /variable ([\w$]+) might not have been initialized/.exec(msg))) {
      var v = m[1];
      explanation = "\"" + v + "\" is used before it has a value. Give it a starting value when you declare it.";
      var declRe = new RegExp("^(\\s*(?:final\\s+)?)([\\w$<>\\[\\],.?]+)(\\s+" + v.replace(/\$/g, "\\$") + ")\\s*;");
      for (var i = Math.min(diag.line, lines.length - 1); i >= 0; i--) {
        var dm = declRe.exec(lines[i]);
        if (dm) {
          (function (at, type) {
            fixes.push({ label: "Initialize " + v + " = " + defaultValueFor(type), apply: function (c) { return replaceInLine(c, at, function (l) { return l.replace(declRe, "$1$2$3 = " + defaultValueFor(type) + ";"); }); } });
          })(i, dm[2]);
          break;
        }
      }
      return { explanation: explanation, fixes: fixes };
    }
    if ((m = /unreported exception ([\w$.]+); must be caught or declared to be thrown/.exec(msg))) {
      var ex = m[1];
      explanation = ex + " is a checked exception: Java makes you either handle it with try/catch or declare it with \"throws " + ex + "\" on the method.";
      var meth = findEnclosingMethod(lines, diag.line);
      if (meth) {
        fixes.push({ label: "Add \"throws " + ex + "\" to " + meth.name + "()", apply: function (c) { return replaceInLine(c, meth.line, function (l) {
          if (/\bthrows\b/.test(l)) return l.replace(/(throws\s+[\w.,\s]+?)(\s*\{?\s*)$/, "$1, " + ex + "$2");
          return l.replace(/\)(\s*)(\{?\s*)$/, ") throws " + ex + "$1$2");
        }); } });
      }
      return { explanation: explanation, fixes: fixes };
    }
    if (/missing return statement/.test(msg)) {
      explanation = "A method that promises to return a value must return on every possible path. Add a return before this closing brace.";
      var mm = findEnclosingMethod(lines, diag.line - 1);
      if (mm && mm.returnType !== "void") {
        fixes.push({ label: "Add return " + defaultValueFor(mm.returnType), apply: function (c) {
          var ls = splitLines(c);
          var indent = (/^\s*/.exec(ls[diag.line] || "")[0]) + "    ";
          ls.splice(diag.line, 0, indent + "return " + defaultValueFor(mm.returnType) + ";");
          return ls.join("\n");
        } });
      }
      return { explanation: explanation, fixes: fixes };
    }
    if ((m = /non-static method ([\w$]+)\(.*\) cannot be referenced from a static context/.exec(msg))) {
      var fn = m[1];
      explanation = "main is static, so it can only call static methods directly. Make \"" + fn + "\" static, or create an object and call it through the object.";
      var mre = new RegExp("^(\\s*)((?:public|private|protected)\\s+)?(?!static\\b)([\\w$<>\\[\\],.?]+\\s+" + fn.replace(/\$/g, "\\$") + "\\s*\\()");
      for (var k = 0; k < lines.length; k++) {
        if (mre.test(lines[k])) {
          (function (at) { fixes.push({ label: "Make " + fn + "() static", apply: function (c) { return replaceInLine(c, at, function (l) { return l.replace(mre, "$1$2static $3"); }); } }); })(k);
          break;
        }
      }
      return { explanation: explanation, fixes: fixes };
    }
    if ((m = /non-static variable ([\w$]+) cannot be referenced from a static context/.exec(msg))) {
      var fv = m[1];
      explanation = "main is static, so it can only use static variables directly. Make \"" + fv + "\" static, or use it through an object.";
      var vre = new RegExp("^(\\s*)((?:public|private|protected)\\s+)?(?!static\\b)((?:final\\s+)?[\\w$<>\\[\\],.?]+\\s+" + fv.replace(/\$/g, "\\$") + "\\s*(?:=|;))");
      for (var k2 = 0; k2 < lines.length; k2++) {
        if (vre.test(lines[k2])) {
          (function (at) { fixes.push({ label: "Make " + fv + " static", apply: function (c) { return replaceInLine(c, at, function (l) { return l.replace(vre, "$1$2static $3"); }); } }); })(k2);
          break;
        }
      }
      return { explanation: explanation, fixes: fixes };
    }
    if ((m = /variable ([\w$]+) is already defined in method/.exec(msg))) {
      var dv = m[1];
      explanation = "\"" + dv + "\" was already declared in this method. Declare a variable only once; afterwards just assign to it.";
      var rre = new RegExp("^(\\s*)(?:final\\s+)?[\\w$<>\\[\\],.?]+\\s+(" + dv.replace(/\$/g, "\\$") + "\\s*=)");
      if (rre.test(line)) fixes.push({ label: "Reuse the variable (remove the type)", apply: function (c) { return replaceInLine(c, diag.line, function (l) { return l.replace(rre, "$1$2"); }); } });
      return { explanation: explanation, fixes: fixes };
    }
    if (/integer number too large/.test(msg)) {
      explanation = "That whole number is bigger than an int can hold (about 2.1 billion). Add an L to make it a long.";
      fixes.push({ label: "Add L to make it a long", apply: function (c) { return replaceInLine(c, diag.line, function (l) {
        var at = diag.col;
        var mm2 = /^\d+/.exec(l.slice(Math.max(0, at)));
        if (!mm2) { var any = /\d{10,}/.exec(l); if (!any) return l; return l.slice(0, any.index + any[0].length) + "L" + l.slice(any.index + any[0].length); }
        return l.slice(0, at + mm2[0].length) + "L" + l.slice(at + mm2[0].length);
      }); } });
      return { explanation: explanation, fixes: fixes };
    }
    if (/cannot be applied to given types/.test(msg) || /no suitable (method|constructor)/.test(msg)) {
      explanation = "The values you passed don't match what this method/constructor expects." +
        (det.required ? " It needs: " + det.required + "." : "") + (det.found ? " You gave: " + det.found + "." : "");
      return { explanation: explanation, fixes: [] };
    }
    if (/cannot be dereferenced/.test(msg)) {
      explanation = "Primitive values (int, double, char, boolean) have no methods. Use a wrapper or String method instead, e.g. String.valueOf(x).";
      return { explanation: explanation, fixes: [] };
    }
    if (/not a statement/.test(msg)) { return { explanation: "This line is not a complete instruction. Maybe a method call is missing its parentheses, or an operator is misplaced.", fixes: [] }; }
    if (/illegal start of expression/.test(msg)) { return { explanation: "Java met something it didn't expect here. Look for a missing ), }, or ; just above this line - or a method written inside another method.", fixes: [] }; }
    if (/<identifier> expected/.test(msg)) { return { explanation: "Java expected a name here. Statements must be inside a method; a stray ) or ; outside one causes this.", fixes: [] }; }
    if (/'else' without 'if'/.test(msg)) { return { explanation: "This else has no matching if. Check the braces and semicolons just before it.", fixes: [] }; }
    if (/invalid method declaration; return type required/.test(msg)) { return { explanation: "Methods need a return type (void, int, ...). A constructor must have exactly the same name as its class.", fixes: [] }; }
    if (/unreachable statement/.test(msg)) { return { explanation: "This code can never run, because something above it (return, break, continue, an endless loop) always leaves first.", fixes: [] }; }
    if (/bad operand types for binary operator/.test(msg)) { return { explanation: "That operator can't be used with these two types" + (det.first ? "" : "") + ". Check what each side is (e.g. you can't use < on Strings, or == between a String and an int).", fixes: [] }; }
    if (/incomparable types/.test(msg)) { return { explanation: "These two values are different types, so they can't be compared with ==. For Strings use .equals(...).", fixes: [] }; }
    if (/array required, but .* found/.test(msg)) { return { explanation: "Square brackets only work on arrays. For a String use charAt(i); for a List use get(i).", fixes: [] }; }
    if (/cannot return a value from method whose result type is void/.test(msg)) { return { explanation: "This method is void, so it can't return a value. Change void to the right type, or remove the value after return.", fixes: [] }; }
    if (/might already have been assigned|cannot assign a value to final variable/.test(msg)) { return { explanation: "A final variable can only be given a value once. Remove 'final' if it needs to change.", fixes: [] }; }
    if (/is public, should be declared in a file named/.test(msg)) { return { explanation: "Portalis handles the file name for you - this usually means two public classes. Keep only one 'public' class.", fixes: [] }; }
    if (/Illegal character/.test(msg)) { return { explanation: "There is a character Java doesn't accept here, often a curly quote copied from a document. Retype the quotes/characters.", fixes: [] }; }
    return { explanation: "Check this line for a typo or missing symbol. The full compiler message is in the details below.", fixes: [] };
  }

  /** Apply a fix and return the new source (never throws). */
  function applyFix(fix, code) {
    try { return fix.apply(code); } catch (e) { return code; }
  }

  // ---------------------------------------------------------------- run output
  function parseRunOutput(stdout, stderr, userLines) {
    var text = String(stdout || "");
    var segments = [];
    var curLine = -1;
    var i = 0;
    var buf = "";

    function flush() {
      if (!buf) return;
      var last = segments[segments.length - 1];
      if (last && last.type === "out" && last.line === curLine) last.text += buf;
      else segments.push({ type: "out", text: buf, line: curLine });
      buf = "";
    }

    while (i < text.length) {
      var ch = text[i];
      if (ch !== M_START) { buf += ch; i++; continue; }
      var kind = text[i + 1];
      if (kind === "O") {
        var mid = text.indexOf(M_MID, i + 2);
        var num = mid < 0 ? NaN : Number(text.slice(i + 2, mid));
        if (mid > 0 && !isNaN(num)) { flush(); curLine = num; i = mid + 1; continue; }
      } else if (kind === "I") {
        var mid2 = text.indexOf(M_MID, i + 2);
        var end2 = mid2 < 0 ? -1 : text.indexOf(M_END, mid2 + 1);
        var head = mid2 < 0 ? null : /^(\d+),(-?\d+)$/.exec(text.slice(i + 2, mid2));
        if (head && end2 >= 0) {
          flush();
          segments.push({ type: "in", index: Number(head[1]), line: Number(head[2]), text: text.slice(mid2 + 1, end2) });
          i = end2 + 1;
          continue;
        }
      } else if (kind === "Z") {
        var end3 = text.indexOf(M_END, i + 2);
        if (end3 >= 0) { flush(); segments.push({ type: "eof" }); i = end3 + 1; continue; }
      }
      buf += ch; i++; // stray control character: keep as text
    }
    flush();

    var err = String(stderr || "");
    var waiting = null;
    var wm = /\u0001W(-?\d+)\u0002/.exec(err);
    if (wm) {
      waiting = { line: Number(wm[1]) };
      err = err.replace(/\u0001W-?\d+\u0002/g, "");
    }
    var cut = typeof userLines === "number" ? userLines : Infinity;
    err = unrename(err.split("\n").filter(function (l) {
      var fr = /^\s*at ([\w.$]+)\.[\w$<>]+\(Main\.java:(\d+)\)\s*$/.exec(l);
      if (!fr) return true;
      if (/^Portalis(In|Out)__/.test(fr[1])) return false;
      return !(fr[1] === "Main" && Number(fr[2]) > cut); // the wrapper's own main()
    }).join("\n"));
    return { segments: segments, waiting: waiting, stderr: err.replace(/^\s+|\s+$/g, "") };
  }

  var RUNTIME_HINTS = {
    ArrayIndexOutOfBoundsException: "You used an array position that doesn't exist. Valid positions run from 0 to length - 1.",
    StringIndexOutOfBoundsException: "You asked for a character/part of the String that isn't there. Check the index against length().",
    IndexOutOfBoundsException: "You asked for a list position that doesn't exist. Valid positions run from 0 to size() - 1.",
    NullPointerException: "A variable that holds nothing (null) was used like an object. Make sure it was created/assigned before calling methods on it.",
    ArithmeticException: "A whole number was divided by zero. Check the divisor before dividing.",
    NumberFormatException: "The text could not be turned into a number. Make sure it contains only digits (and a decimal point for double).",
    InputMismatchException: "The Scanner expected a number but you typed something else. Type a valid number, or read with nextLine() and convert it yourself.",
    NoSuchElementException: "The program tried to read more input than was provided.",
    ClassCastException: "An object was converted to a type it isn't. Check what is really stored in that variable.",
    NegativeArraySizeException: "An array can't be created with a negative size.",
    StackOverflowError: "A method keeps calling itself without stopping (infinite recursion). Add or fix the base case.",
    OutOfMemoryError: "The program used more memory than allowed - often a loop that keeps adding to a list or building a huge array.",
    IllegalArgumentException: "A method was given a value it doesn't accept.",
    IllegalStateException: "A method was called at the wrong time for the object's state.",
    ConcurrentModificationException: "A collection was changed while a loop was going through it. Use an Iterator or loop over a copy.",
    UnsupportedOperationException: "This operation isn't allowed on that collection (for example, adding to List.of(...)).",
    ArrayStoreException: "The value you stored doesn't match the array's type."
  };

  function explainRuntimeError(stderr, userLines) {
    var err = String(stderr || "");
    var m = /Exception in thread "[^"]*"\s+([\w.$]+)(?::\s*([^\n]*))?/.exec(err);
    if (!m) return null;
    var full = m[1];
    var simple = full.split(".").pop().replace(/\$.*/, "");
    var detail = (m[2] || "").trim();
    var line = -1;
    var re = /\sat\s+[\w.$<>]+\(Main\.java:(\d+)\)/g;
    var f;
    while ((f = re.exec(err))) {
      var n = Number(f[1]);
      if (n >= 1 && n <= (userLines || Infinity)) { line = n - 1; break; }
    }
    var hint = RUNTIME_HINTS[simple] || "The program stopped because of an uncaught " + simple + ".";
    if (simple === "ArithmeticException" && /by zero/.test(detail)) hint = "A whole number was divided by zero. Check the divisor before dividing.";
    if (simple === "InputMismatchException" && detail) hint += " (Scanner saw: " + detail + ")";
    return { exception: full, simple: simple, message: detail, line: line, hint: hint };
  }

  return {
    RENAMED_MAIN: RENAMED_MAIN,
    tokenize: tokenize,
    analyze: analyze,
    sourceFileName: sourceFileName,
    buildProgram: buildProgram,
    buildStdin: buildStdin,
    unrename: unrename,
    lint: lint,
    parseCompilerOutput: parseCompilerOutput,
    suggestFixes: suggestFixes,
    applyFix: applyFix,
    parseRunOutput: parseRunOutput,
    explainRuntimeError: explainRuntimeError,
    API_METHODS: API_METHODS,
    addImport: addImport,
    closestWord: closestWord
  };
});
