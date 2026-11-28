/* Portalis Java compiler page - UI glue. Logic lives in java-tools.js. */
(function () {
  "use strict";
  var T = window.JavaTools;

  // ------------------------------------------------------------------ config
  var COMPILER_API = "https://ce.judge0.com/submissions";
  var SERVICE_UNAVAILABLE = "The Java compiler service is unavailable right now (it may be busy or offline). Wait a minute, then press Try again.";
  var JAVA_LANGUAGE_ID = 91;
  var MAX_SOURCE_LENGTH = 30000;
  var MAX_STDIN_LENGTH = 5000;
  var INPUTS_PREFIX = "PORTALIS_INPUTS:";
  var INPUT_COLORS = ["#54d6ff", "#ffba55", "#bd91ff", "#72dc91", "#ff7fa9", "#f0e45f"];

  var TEMPLATES = {
    "Hello World": "public class HelloWorld {\n    public static void main(String[] args) {\n        System.out.println(\"Hello, Java!\");\n    }\n}",
    "Ask for your name (Scanner)": "import java.util.Scanner;\n\npublic class Greeter {\n    public static void main(String[] args) {\n        Scanner sc = new Scanner(System.in);\n        System.out.print(\"What is your name? \");\n        String name = sc.nextLine();\n        System.out.print(\"How old are you? \");\n        int age = sc.nextInt();\n        System.out.println(\"Hi \" + name + \"! Next year you will be \" + (age + 1) + \".\");\n    }\n}",
    "Calculator (switch)": "import java.util.Scanner;\n\npublic class Calculator {\n    public static void main(String[] args) {\n        Scanner sc = new Scanner(System.in);\n        System.out.print(\"First number: \");\n        double a = sc.nextDouble();\n        System.out.print(\"Operator (+ - * /): \");\n        char op = sc.next().charAt(0);\n        System.out.print(\"Second number: \");\n        double b = sc.nextDouble();\n        switch (op) {\n            case '+': System.out.println(a + b); break;\n            case '-': System.out.println(a - b); break;\n            case '*': System.out.println(a * b); break;\n            case '/':\n                if (b == 0) System.out.println(\"Cannot divide by zero\");\n                else System.out.println(a / b);\n                break;\n            default: System.out.println(\"Unknown operator\");\n        }\n    }\n}",
    "Loops and arrays": "public class Numbers {\n    public static void main(String[] args) {\n        int[] scores = {88, 92, 75, 64, 99};\n        int total = 0;\n        for (int i = 0; i < scores.length; i++) {\n            total += scores[i];\n            System.out.println(\"Score \" + (i + 1) + \": \" + scores[i]);\n        }\n        System.out.println(\"Average: \" + (double) total / scores.length);\n    }\n}",
    "Class and object": "public class Student {\n    private final String name;\n    private int grade;\n\n    public Student(String name, int grade) {\n        this.name = name;\n        this.grade = grade;\n    }\n\n    public String describe() {\n        return name + \" has a grade of \" + grade;\n    }\n\n    public static void main(String[] args) {\n        Student s = new Student(\"Ana\", 90);\n        System.out.println(s.describe());\n    }\n}"
  };
  var STARTER_CODE = TEMPLATES["Hello World"];

  var SNIPPETS = {
    sout: { desc: "System.out.println", text: "System.out.println(|);" },
    soutf: { desc: "System.out.printf", text: "System.out.printf(\"|%n\");" },
    psvm: { desc: "main method", text: "public static void main(String[] args) {\n    |\n}" },
    main: { desc: "main method", text: "public static void main(String[] args) {\n    |\n}" },
    fori: { desc: "for loop", text: "for (int i = 0; i < |; i++) {\n    \n}" },
    fore: { desc: "for-each loop", text: "for (var item : |) {\n    \n}" },
    whilel: { desc: "while loop", text: "while (|) {\n    \n}" },
    ifel: { desc: "if / else", text: "if (|) {\n    \n} else {\n    \n}" },
    sw: { desc: "switch", text: "switch (|) {\n    case 1:\n        break;\n    default:\n        break;\n}" },
    tryc: { desc: "try / catch", text: "try {\n    |\n} catch (Exception e) {\n    System.out.println(e.getMessage());\n}" },
    scan: { desc: "Scanner for keyboard input", text: "Scanner sc = new Scanner(System.in);|", importName: "java.util.Scanner" },
    cls: { desc: "class", text: "public class | {\n    \n}" }
  };

  var KEYWORDS = ("abstract assert boolean break byte case catch char class continue default do double else enum extends final finally float for if implements import instanceof int interface long new null package private protected public return short static super switch this throw throws true false try void while var record").split(" ");
  var CLASS_WORDS = ["String", "System", "Math", "Integer", "Double", "Long", "Boolean", "Character", "Object", "StringBuilder", "Scanner", "ArrayList", "List", "HashMap", "Map", "Arrays", "Random", "Exception"];

  // ------------------------------------------------------------------ state
  var $ = function (id) { return document.getElementById(id); };
  var sourceCode = $("sourceCode");
  var projectTitle = $("projectTitle");
  var editor = null;

  var projects = [];
  var currentProjectId = null;
  var saveTimer = 0;
  var saveQueue = Promise.resolve();
  var isLoadingProject = false;

  var session = { inputs: [], eof: false };
  var lastInputs = [];
  var runId = 0;
  var controller = null;
  var lintTimer = 0;
  var hoverLine = null;
  var problemsOpen = false;

  var term = { segments: [], status: "idle", stateText: "idle", waiting: null, stderr: "", hint: null, footer: "", pendingEcho: null, message: "", retry: false };
  var compileDiags = [];  // {handle, ...diag}
  var runtimeDiags = [];
  var lintDiags = [];
  var rawCompilerOutput = "";
  var decorations = { lineClasses: [], widgets: [], marks: [], gutter: [] };
  var inputDeco = { lineClasses: [], bookmarks: [], gutterLines: [] };
  var waitDeco = null;

  // ------------------------------------------------------------------ VS Code style mode
  function defineMode() {
    var CONTROL = {}; "if else for while do switch case default break continue return try catch finally throw throws yield assert".split(" ").forEach(function (w) { CONTROL[w] = 1; });
    var PRIM = {}; "int long short byte double float boolean char void var".split(" ").forEach(function (w) { PRIM[w] = 1; });
    CodeMirror.defineMode("portalis-java", function (config) {
      var base = CodeMirror.getMode(config, "text/x-java");
      return {
        startState: function () { return { b: CodeMirror.startState(base), depth: 0 }; },
        copyState: function (s) { return { b: CodeMirror.copyState(base, s.b), depth: s.depth }; },
        token: function (stream, state) {
          var style = base.token(stream, state.b);
          var cur = stream.current();
          if (!style || style.indexOf("bracket") !== -1) {
            // the Java mode gives brackets no style of their own, so color them by nesting depth
            if (cur === "(" || cur === "[" || cur === "{") { return (style ? style + " " : "") + "java-b" + (state.depth++ % 3); }
            if (cur === ")" || cur === "]" || cur === "}") { state.depth = Math.max(0, state.depth - 1); return (style ? style + " " : "") + "java-b" + (state.depth % 3); }
            return style;
          }
          if (style === "keyword" && CONTROL[cur]) return style + " java-control";
          if (PRIM[cur] && (style === "type" || style === "keyword")) return "type java-prim";
          if (style === "variable" || style === "def" || style === "variable-2" || style === "type") {
            if (/^[A-Z][A-Z0-9_]+$/.test(cur)) return style + " java-const";
            if (/^[A-Z]/.test(cur)) return style + " java-class";
            if (/^\s*\(/.test(stream.string.slice(stream.pos))) return style + " java-func";
          }
          return style;
        },
        indent: function (state, textAfter, line) { return base.indent ? base.indent(state.b, textAfter, line) : CodeMirror.Pass; },
        electricInput: base.electricInput,
        blockCommentStart: "/*", blockCommentEnd: "*/", blockCommentContinue: " * ", lineComment: "//",
        fold: "brace", closeBrackets: "()[]{}''\"\"",
        blankLine: base.blankLine ? function (s) { return base.blankLine(s.b); } : undefined
      };
    });
  }

  // ------------------------------------------------------------------ editor helpers
  function getSource() { return editor ? editor.getValue() : sourceCode.value; }
  function setSource(value) { if (editor) editor.setValue(value); else sourceCode.value = value; }

  function applyTextEdit(newText) {
    var oldText = getSource();
    if (oldText === newText) return;
    if (!editor) { sourceCode.value = newText; scheduleSave(); return; }
    var oldLines = oldText.split("\n");
    var newLines = newText.split("\n");
    var p = 0;
    while (p < oldLines.length && p < newLines.length && oldLines[p] === newLines[p]) p++;
    var so = oldLines.length - 1;
    var sn = newLines.length - 1;
    while (so >= p && sn >= p && oldLines[so] === newLines[sn]) { so--; sn--; }
    var oldMid = oldLines.slice(p, so + 1);
    var newMid = newLines.slice(p, sn + 1);
    editor.operation(function () {
      if (!oldMid.length) {
        if (p >= oldLines.length) {
          var last = oldLines.length - 1;
          editor.replaceRange("\n" + newMid.join("\n"), { line: last, ch: oldLines[last].length });
        } else {
          editor.replaceRange(newMid.join("\n") + "\n", { line: p, ch: 0 });
        }
      } else if (!newMid.length) {
        if (so + 1 < oldLines.length) editor.replaceRange("", { line: p, ch: 0 }, { line: so + 1, ch: 0 });
        else if (p > 0) editor.replaceRange("", { line: p - 1, ch: oldLines[p - 1].length }, { line: so, ch: oldLines[so].length });
        else editor.replaceRange("", { line: 0, ch: 0 }, { line: so, ch: oldLines[so].length });
      } else {
        editor.replaceRange(newMid.join("\n"), { line: p, ch: 0 }, { line: so, ch: oldLines[so].length });
      }
    });
  }

  function jumpToLine(line, ch) {
    if (!editor || line < 0) return;
    editor.focus();
    editor.setCursor({ line: line, ch: ch || 0 });
    editor.scrollIntoView({ line: line, ch: 0 }, 120);
  }

  function colorFor(index) { return INPUT_COLORS[index % INPUT_COLORS.length]; }

  function el(tag, cls, text) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  // ------------------------------------------------------------------ problems (red lines, squiggles, quick fixes)
  function clearDecorations() {
    if (!editor) return;
    decorations.lineClasses.forEach(function (d) { editor.removeLineClass(d.handle, "background", d.cls); });
    decorations.widgets.forEach(function (w) { w.clear(); });
    decorations.marks.forEach(function (m) { m.clear(); });
    editor.clearGutter("java-error-gutter");
    decorations = { lineClasses: [], widgets: [], marks: [], gutter: [] };
  }

  function lineOf(d) {
    if (d.handle && editor) { var n = editor.getLineNumber(d.handle); return n === null ? -1 : n; }
    return d.line;
  }

  function allProblems() {
    var list = [];
    var occupied = {};
    function add(d) {
      var line = lineOf(d);
      if (line < 0) return;
      var copy = Object.assign({}, d, { line: line });
      list.push(copy);
    }
    runtimeDiags.forEach(add);
    compileDiags.forEach(function (d) { add(d); occupied[lineOf(d)] = true; });
    lintDiags.forEach(function (d) { if (!occupied[d.line]) add(d); });
    list.sort(function (a, b) { return a.line - b.line || (a.col || 0) - (b.col || 0); });
    return list;
  }

  function renderProblems() {
    var code = getSource();
    var problems = allProblems();
    problems.forEach(function (p) { var s = T.suggestFixes(p, code); p.explanation = p.explanation || s.explanation; p.fixes = s.fixes || []; });

    if (editor) {
      editor.operation(function () {
        clearDecorations();
        var byLine = {};
        problems.forEach(function (p) { (byLine[p.line] = byLine[p.line] || []).push(p); });
        Object.keys(byLine).forEach(function (key) {
          var line = Number(key);
          var handle = editor.getLineHandle(line);
          if (!handle) return;
          var group = byLine[key];
          var severe = group.some(function (p) { return p.severity === "error"; });
          var cls = severe ? "java-error-line" : "java-warning-line";
          editor.addLineClass(handle, "background", cls);
          decorations.lineClasses.push({ handle: handle, cls: cls });
          var marker = el("span", severe ? "java-error-marker" : "java-warning-marker", severe ? "!" : "▲");
          marker.title = group.map(function (p) { return p.message; }).join("\n");
          editor.setGutterMarker(handle, "java-error-gutter", marker);
          group.forEach(function (p) {
            if (p.col >= 0 && p.length > 0) {
              var lineLen = (editor.getLine(line) || "").length;
              var from = Math.min(p.col, lineLen);
              var to = Math.min(from + p.length, lineLen);
              if (to > from) decorations.marks.push(editor.markText({ line: line, ch: from }, { line: line, ch: to }, { className: severe ? "java-squiggle" : "java-squiggle-warn", title: p.message }));
            }
          });
        });
        // inline explanation under the first few problem lines
        var shown = 0;
        Object.keys(byLine).forEach(function (key) {
          if (shown >= 8) return;
          shown++;
          var group = byLine[key];
          var box = el("div", "java-inline-problem");
          group.slice(0, 2).forEach(function (p) {
            var row = el("div", "java-inline-row");
            row.appendChild(el("span", "java-inline-icon", p.severity === "error" ? "✖" : "▲"));
            row.appendChild(el("span", "java-inline-msg", p.message));
            (p.fixes || []).slice(0, 2).forEach(function (f) { row.appendChild(fixButton(f, "java-inline-fix")); });
            box.appendChild(row);
            if (p.explanation) box.appendChild(el("div", "java-inline-why", p.explanation));
          });
          decorations.widgets.push(editor.addLineWidget(Number(key), box, { coverGutter: false, noHScroll: true, above: false }));
        });
      });
    }

    // problems panel
    var panel = $("problems");
    var list = $("problemList");
    list.replaceChildren();
    var errors = problems.filter(function (p) { return p.severity === "error"; }).length;
    var warns = problems.length - errors;
    var toggle = $("problemsToggle");
    if (!problems.length) {
      toggle.textContent = "✔ No problems";
      toggle.className = "java-problems-toggle ok";
      problemsOpen = false;
    } else {
      var parts = [];
      if (errors) parts.push("✖ " + errors + " error" + (errors === 1 ? "" : "s"));
      if (warns) parts.push("▲ " + warns + " warning" + (warns === 1 ? "" : "s"));
      toggle.textContent = parts.join(" · ") + (problemsOpen ? "  ▾" : "  ▸");
      toggle.className = "java-problems-toggle " + (errors ? "has-errors" : "has-warnings");
    }
    toggle.setAttribute("aria-expanded", problemsOpen ? "true" : "false");
    panel.hidden = !(problemsOpen && problems.length);
    problems.forEach(function (p) {
      var card = el("section", "java-diagnostic-card" + (p.severity === "error" ? "" : " warn"));
      var head = el("strong", "", "Line " + (p.line + 1) + ": " + p.message);
      card.appendChild(head);
      if (p.explanation) card.appendChild(el("p", "", p.explanation));
      var row = el("div", "java-diagnostic-actions");
      (p.fixes || []).forEach(function (f) { row.appendChild(fixButton(f)); });
      var jump = el("button", "java-line-jump", "Go to line " + (p.line + 1));
      jump.type = "button";
      jump.addEventListener("click", function () { jumpToLine(p.line, Math.max(0, p.col || 0)); });
      row.appendChild(jump);
      card.appendChild(row);
      list.appendChild(card);
    });
    $("rawCompiler").hidden = !rawCompilerOutput;
    $("rawCompilerText").textContent = rawCompilerOutput;
  }

  function fixButton(fix, extra) {
    var b = el("button", "ghost java-fix" + (extra ? " " + extra : ""), "✨ " + fix.label);
    b.type = "button";
    b.addEventListener("click", function () {
      var before = getSource();
      var after = T.applyFix(fix, before);
      if (after === before) { setRunStatus("That quick fix could not be applied automatically.", true); return; }
      applyTextEdit(after);
      setRunStatus("Quick fix applied. Run the program to check it.", false);
    });
    return b;
  }

  function runLint() {
    lintDiags = T.lint(getSource()).map(function (d) {
      var handle = editor ? editor.getLineHandle(d.line) : null;
      return Object.assign({}, d, { handle: handle });
    });
    renderProblems();
  }

  function scheduleLint() {
    clearTimeout(lintTimer);
    lintTimer = setTimeout(runLint, 650);
  }

  // ------------------------------------------------------------------ input markers in the editor
  function clearInputDecorations() {
    if (!editor) return;
    inputDeco.lineClasses.forEach(function (d) { editor.removeLineClass(d.handle, "background", d.cls); });
    inputDeco.bookmarks.forEach(function (b) { b.clear(); });
    editor.clearGutter("java-input-gutter");
    if (waitDeco) { editor.removeLineClass(waitDeco, "background", "java-waiting-line"); waitDeco = null; }
    inputDeco = { lineClasses: [], bookmarks: [], gutterLines: [] };
  }

  function renderInputOverlays() {
    if (!editor) return;
    editor.operation(function () {
      clearInputDecorations();
      var ins = term.segments.filter(function (s) { return s.type === "in" && s.line > 0; });
      var byLine = {};
      ins.forEach(function (s) { (byLine[s.line - 1] = byLine[s.line - 1] || []).push(s); });
      Object.keys(byLine).forEach(function (key) {
        var line = Number(key);
        var group = byLine[key];
        var handle = editor.getLineHandle(line);
        if (!handle) return;
        var firstColor = group[0].index % INPUT_COLORS.length;
        var cls = "java-input-line-" + firstColor;
        editor.addLineClass(handle, "background", cls);
        inputDeco.lineClasses.push({ handle: handle, cls: cls });

        var chip = el("span", "java-input-marker", group.length === 1 ? String(group[0].index + 1) : (group[0].index + 1) + "–" + (group[group.length - 1].index + 1));
        chip.title = group.length === 1 ? "Input " + (group[0].index + 1) + " is read on this line" : "Inputs " + (group[0].index + 1) + " to " + (group[group.length - 1].index + 1) + " are read on this line";
        if (group.length === 1) chip.style.background = colorFor(group[0].index);
        else {
          var step = 100 / Math.min(group.length, 6);
          chip.style.background = "linear-gradient(90deg, " + group.slice(0, 6).map(function (s, i) { return colorFor(s.index) + " " + (i * step) + "% " + ((i + 1) * step) + "%"; }).join(", ") + ")";
        }
        editor.setGutterMarker(handle, "java-input-gutter", chip);

        var tag = el("span", "java-inline-input");
        group.slice(0, 4).forEach(function (s) {
          var item = el("span", "java-inline-input-item");
          item.style.setProperty("--c", colorFor(s.index));
          item.appendChild(el("i", "", String(s.index + 1)));
          item.appendChild(document.createTextNode(s.text === "" ? "(empty)" : s.text.length > 18 ? s.text.slice(0, 17) + "…" : s.text));
          tag.appendChild(item);
        });
        if (group.length > 4) tag.appendChild(el("span", "java-inline-input-more", "+" + (group.length - 4) + " more"));
        var len = (editor.getLine(line) || "").length;
        inputDeco.bookmarks.push(editor.setBookmark({ line: line, ch: len }, { widget: tag, insertLeft: true }));
      });

      if (term.waiting && term.waiting.line > 0) {
        var wh = editor.getLineHandle(term.waiting.line - 1);
        if (wh) {
          editor.addLineClass(wh, "background", "java-waiting-line");
          waitDeco = wh;
          var wl = el("span", "java-waiting-marker", "⌨");
          wl.title = "The program is waiting for input here";
          editor.setGutterMarker(wh, "java-input-gutter", wl);
          var wtag = el("span", "java-inline-waiting", "◀ waiting for input");
          inputDeco.bookmarks.push(editor.setBookmark({ line: term.waiting.line - 1, ch: (editor.getLine(term.waiting.line - 1) || "").length }, { widget: wtag, insertLeft: true }));
        }
      }
    });
  }

  // ------------------------------------------------------------------ terminal
  function setTermState(status, text) {
    term.status = status;
    term.stateText = text || status;
    var badge = $("termState");
    badge.textContent = term.stateText;
    badge.className = "term-state term-state-" + status;
  }

  function renderTerminal() {
    var body = $("termBody");
    var frag = document.createDocumentFragment();
    var endsWithNewline = true;

    term.segments.forEach(function (seg) {
      if (seg.type === "out") {
        var s = el("span", "t-out", seg.text);
        if (seg.line > 0) { s.dataset.line = String(seg.line); s.title = "Printed by line " + seg.line + " (click to jump)"; }
        frag.appendChild(s);
        endsWithNewline = /\n$/.test(seg.text);
      } else if (seg.type === "in") {
        var span = el("span", "t-in");
        span.style.setProperty("--c", colorFor(seg.index));
        var txt = el("span", "t-in-text", seg.text);
        span.appendChild(txt);
        var badge = el("span", "t-in-badge", String(seg.index + 1));
        badge.title = seg.line > 0 ? "Input " + (seg.index + 1) + " was read by line " + seg.line + " (click to jump)" : "Input " + (seg.index + 1);
        span.appendChild(badge);
        if (seg.line > 0) span.dataset.line = String(seg.line);
        frag.appendChild(span);
        frag.appendChild(document.createTextNode("\n"));
        endsWithNewline = true;
      } else if (seg.type === "eof") {
        frag.appendChild(el("span", "t-eof", "^D\n"));
        endsWithNewline = true;
      }
    });

    if (term.pendingEcho !== null) {
      var pend = el("span", "t-in t-pending");
      pend.style.setProperty("--c", colorFor(session.inputs.length - 1));
      pend.appendChild(el("span", "t-in-text", term.pendingEcho));
      pend.appendChild(el("span", "t-in-badge", String(session.inputs.length)));
      frag.appendChild(pend);
      frag.appendChild(document.createTextNode("\n"));
      endsWithNewline = true;
    }

    if (term.stderr) {
      if (!endsWithNewline) frag.appendChild(document.createTextNode("\n"));
      frag.appendChild(el("span", "t-err", term.stderr + "\n"));
      endsWithNewline = true;
    }
    if (term.hint) {
      var hint = el("span", "t-hint", "💡 " + term.hint + "\n");
      if (term.hintLine >= 0) { hint.dataset.line = String(term.hintLine + 1); }
      frag.appendChild(hint);
      endsWithNewline = true;
    }
    if (term.message) {
      if (!endsWithNewline) frag.appendChild(document.createTextNode("\n"));
      frag.appendChild(el("span", term.status === "error" ? "t-err" : "t-info", term.message + "\n"));
      endsWithNewline = true;
    }

    var promptInput = null;
    if (term.status === "waiting" && term.pendingEcho === null) {
      promptInput = createPromptInput();
      frag.appendChild(promptInput.wrap);
    } else if (term.footer) {
      if (!endsWithNewline) frag.appendChild(document.createTextNode("\n"));
      frag.appendChild(el("span", "t-footer", term.footer));
    }
    if (term.status === "running" && term.pendingEcho === null && !term.segments.length) {
      frag.appendChild(el("span", "t-info", "Compiling and running…"));
    }
    if (term.status === "idle" && !term.segments.length && !term.message && !term.stderr) {
      frag.appendChild(el("span", "t-placeholder", "Press ▶ Run.\nWhen the program asks for something, type your answer here and press Enter.\nEach answer gets a color, and the same color marks the line of code that read it."));
    }

    body.replaceChildren(frag);
    body.scrollTop = body.scrollHeight;
    if (term.retry) {
      var retry = el("button", "ghost term-retry", "Try again");
      retry.type = "button";
      retry.addEventListener("click", function () { execute(); });
      body.appendChild(retry);
    }
    if (promptInput) promptInput.input.focus({ preventScroll: true });

    $("termEof").hidden = term.status !== "waiting";
    $("termUndo").disabled = !session.inputs.length || term.status === "running";
    $("stopCode").hidden = term.status !== "running";
    $("runCode").disabled = false;
    $("replayCode").disabled = !lastInputs.length;
    renderChips();
    renderInputOverlays();
  }

  function renderChips() {
    var box = $("inputChips");
    box.replaceChildren();
    var ins = term.segments.filter(function (s) { return s.type === "in"; });
    if (!ins.length) { box.hidden = true; return; }
    box.hidden = false;
    box.appendChild(el("span", "chips-title", "Inputs used:"));
    ins.forEach(function (s) {
      var chip = el("button", "java-input-chip", "");
      chip.type = "button";
      chip.style.setProperty("--input-color", colorFor(s.index));
      chip.appendChild(el("span", "java-input-chip-number", String(s.index + 1)));
      chip.appendChild(document.createTextNode(s.text === "" ? "(empty line)" : s.text));
      if (s.line > 0) chip.appendChild(el("span", "java-input-destination", "line " + s.line));
      chip.title = s.line > 0 ? "Jump to the code that read this input" : "";
      chip.addEventListener("click", function () { if (s.line > 0) jumpToLine(s.line - 1, 0); });
      box.appendChild(chip);
    });
  }

  function createPromptInput() {
    var wrap = el("span", "t-prompt");
    var input = document.createElement("input");
    input.type = "text";
    input.className = "t-input";
    input.autocomplete = "off";
    input.spellcheck = false;
    input.setAttribute("autocapitalize", "off");
    input.setAttribute("aria-label", "Type input for the program, then press Enter");
    input.maxLength = 1000;
    input.placeholder = "type here, press Enter";
    input.style.setProperty("--c", colorFor(session.inputs.length));
    var historyIndex = session.inputs.length;
    function resize() { input.style.width = Math.max(input.value.length + 1, input.value ? 2 : input.placeholder.length + 1) + "ch"; }
    resize();
    input.addEventListener("input", resize);
    input.addEventListener("keydown", function (e) {
      if (e.key === "Enter") {
        e.preventDefault();
        submitInput(input.value);
      } else if ((e.ctrlKey || e.metaKey) && (e.key === "d" || e.key === "D")) {
        e.preventDefault();
        sendEof();
      } else if (e.key === "ArrowUp" && session.inputs.length) {
        e.preventDefault();
        historyIndex = Math.max(0, historyIndex - 1);
        input.value = session.inputs[historyIndex];
        resize();
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        historyIndex = Math.min(session.inputs.length, historyIndex + 1);
        input.value = historyIndex >= session.inputs.length ? "" : session.inputs[historyIndex];
        resize();
      }
    });
    input.addEventListener("paste", function (e) {
      var text = (e.clipboardData || window.clipboardData).getData("text");
      if (text && /[\r\n]/.test(text)) {
        e.preventDefault();
        var parts = text.replace(/\r\n?/g, "\n").split("\n");
        if (parts[parts.length - 1] === "") parts.pop();
        submitInputs(parts);
      }
    });
    wrap.appendChild(input);
    return { wrap: wrap, input: input };
  }

  function resetTerminal(message) {
    runId++;
    if (controller) controller.abort();
    session = { inputs: [], eof: false };
    term = { segments: [], status: "idle", stateText: "ready", waiting: null, stderr: "", hint: null, hintLine: -1, footer: "", pendingEcho: null, message: message || "", retry: false };
    setTermState("idle", "ready");
    renderTerminal();
  }

  // ------------------------------------------------------------------ running
  function setRunStatus(text, isError) {
    var status = $("runStatus");
    status.textContent = text;
    status.className = "java-status-msg" + (isError ? " err" : "");
    clearTimeout(setRunStatus.timer);
    if (text && !isError) setRunStatus.timer = setTimeout(function () { status.textContent = ""; }, 6000);
  }

  function setSaveStatus(text, isError) {
    var status = $("saveStatus");
    status.textContent = text;
    status.className = "java-status-save" + (isError ? " err" : "");
  }

  function startRun(replay) {
    if (replay) { session = { inputs: lastInputs.slice(), eof: false }; }
    else session = { inputs: [], eof: false };
    term.segments = []; term.stderr = ""; term.hint = null; term.footer = ""; term.message = ""; term.waiting = null; term.pendingEcho = null; term.retry = false;
    execute();
  }

  function submitInput(value) { submitInputs([value]); }

  function submitInputs(values) {
    if (term.status !== "waiting") return;
    var next = session.inputs.concat(values.map(function (v) { return String(v).replace(/[\r\n]+/g, " "); }));
    if (T.buildStdin(next, false).length > MAX_STDIN_LENGTH) {
      setRunStatus("That is more input than Portalis can send (" + MAX_STDIN_LENGTH + " characters).", true);
      return;
    }
    session.inputs = next;
    term.pendingEcho = values[values.length - 1];
    term.waiting = null;
    setTermState("running", "running…");
    renderTerminal();
    execute();
  }

  function sendEof() {
    if (term.status !== "waiting") return;
    session.eof = true;
    term.waiting = null;
    term.pendingEcho = null;
    setTermState("running", "running…");
    renderTerminal();
    execute();
  }

  function undoInput() {
    if (!session.inputs.length || term.status === "running") return;
    session.inputs.pop();
    session.eof = false;
    execute();
  }

  function stopRun() {
    runId++;
    if (controller) controller.abort();
    term.pendingEcho = null;
    term.message = "Stopped.";
    setTermState("idle", "stopped");
    renderTerminal();
  }

  async function execute() {
    var my = ++runId;
    if (controller) controller.abort();
    controller = new AbortController();
    var myController = controller;
    var code = getSource();
    var codeLines = code.split("\n");

    if (code.length > MAX_SOURCE_LENGTH) { setRunStatus("The source is too long to run.", true); return; }
    var built = T.buildProgram(code);
    if (built.error) {
      compileDiags = [{ severity: "error", source: "javac", line: built.error.line, handle: editor ? editor.getLineHandle(built.error.line) : null, col: -1, length: 0, message: built.error.message, explanation: "Every Java program starts from a main method inside a class. Paste a complete class, or type psvm and press Tab to insert main.", details: {}, kind: "no-main" }];
      runtimeDiags = [];
      rawCompilerOutput = "";
      term.message = "Nothing to run yet. " + built.error.message;
      term.stderr = ""; term.retry = false;
      setTermState("error", "can't run");
      renderTerminal(); renderProblems();
      return;
    }
    var stdin = T.buildStdin(session.inputs, session.eof);
    if (stdin.length > MAX_STDIN_LENGTH) { setRunStatus("The input is too long to run.", true); return; }

    setRunStatus("", false);
    term.retry = false;
    setTermState("running", "running…");
    renderTerminal();
    var timeout = setTimeout(function () { myController.abort(); }, 30000);

    try {
      var response = await fetch(COMPILER_API + "?base64_encoded=false&wait=true", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ language_id: JAVA_LANGUAGE_ID, source_code: built.source, stdin: stdin, cpu_time_limit: 2, cpu_extra_time: 1, wall_time_limit: 5, memory_limit: 128000 }),
        signal: myController.signal
      });
      if (my !== runId) return;
      if (!response.ok) throw httpError(response.status);
      var result = await response.json();
      while (result.token && result.status && result.status.id < 3) {
        if (my !== runId) return;
        await new Promise(function (resolve) { setTimeout(resolve, 700); });
        response = await fetch(COMPILER_API + "/" + encodeURIComponent(result.token) + "?base64_encoded=false", { signal: myController.signal });
        if (!response.ok) throw httpError(response.status);
        result = await response.json();
      }
      if (my !== runId) return;
      if (!result.status || typeof result.status.id !== "number") throw new Error("The compiler service returned an unexpected response.");
      handleResult(result, built, codeLines);
    } catch (error) {
      if (my !== runId) return;
      term.pendingEcho = null;
      var unreachable = error && (error.name === "AbortError" || error.name === "TypeError");
      term.message = unreachable || !error || !error.message ? SERVICE_UNAVAILABLE : error.message;
      term.retry = true;
      setTermState("error", "no connection");
      renderTerminal();
    } finally {
      clearTimeout(timeout);
    }
  }

  function httpError(status) {
    var e = new Error(status === 429 || status >= 500 ? SERVICE_UNAVAILABLE : "The compiler service answered with HTTP " + status + ".");
    e.status = status;
    return e;
  }

  function handleResult(result, built, codeLines) {
    term.pendingEcho = null;
    term.retry = false;
    runtimeDiags = [];
    if (session.inputs.length) { lastInputs = session.inputs.slice(); scheduleSave(); }

    if (result.status.id === 6) {
      rawCompilerOutput = T.unrename(result.compile_output || "");
      var diags = T.parseCompilerOutput(result.compile_output || "", { userLines: built.userLines, codeLines: codeLines });
      compileDiags = diags.map(function (d) { return Object.assign({}, d, { handle: editor ? editor.getLineHandle(d.line) : null }); });
      var errorCount = diags.filter(function (d) { return d.severity === "error"; }).length;
      term.segments = []; term.stderr = ""; term.hint = null; term.waiting = null;
      term.message = "✖ Compilation failed with " + errorCount + " error" + (errorCount === 1 ? "" : "s") + ". The red lines in the editor show where; try the ✨ quick fixes.";
      term.footer = "";
      setTermState("error", "compile error");
      renderTerminal(); renderProblems();
      var first = compileDiags[0];
      if (first && editor) { editor.scrollIntoView({ line: first.line, ch: 0 }, 140); }
      return;
    }

    compileDiags = [];
    rawCompilerOutput = result.compile_output ? T.unrename(result.compile_output) : "";
    var parsed = T.parseRunOutput(result.stdout || "", result.stderr || "", built.userLines);
    term.segments = parsed.segments;
    term.waiting = parsed.waiting;
    term.stderr = parsed.stderr;
    term.hint = null; term.hintLine = -1; term.message = "";
    var explained = T.explainRuntimeError(parsed.stderr, built.userLines);
    if (explained) {
      term.hint = explained.hint;
      term.hintLine = explained.line;
      if (explained.line >= 0) {
        runtimeDiags = [{ severity: "error", source: "runtime", line: explained.line, handle: editor ? editor.getLineHandle(explained.line) : null, col: -1, length: 0,
          message: explained.simple + (explained.message ? ": " + explained.message : ""), explanation: explained.hint, details: {}, kind: "runtime" }];
      }
    }

    var metrics = [];
    if (result.time) metrics.push(result.time + " s");
    if (result.memory) metrics.push(Number(result.memory).toLocaleString() + " KB");
    var metricText = metrics.length ? " · " + metrics.join(" · ") : "";

    if (parsed.waiting) {
      setTermState("waiting", "waiting for input");
      term.footer = "";
    } else if (result.status.id === 5) {
      term.message = "⏱ Time limit exceeded. The program ran too long - check for an endless loop.";
      setTermState("error", "time limit");
    } else if (result.status.id === 3) {
      term.footer = "✔ Program finished" + metricText;
      setTermState("done", "finished");
    } else if (result.status.id === 13) {
      term.message = "The compiler service had an internal problem. Try again in a moment." + (result.message ? " (" + result.message + ")" : "");
      term.retry = true;
      setTermState("error", "service error");
    } else {
      term.footer = "✖ Program stopped: " + result.status.description + metricText;
      setTermState("error", "stopped with error");
    }
    if (result.message && result.status.id !== 13 && result.status.id !== 3) term.footer += "\n" + result.message;
    renderTerminal();
    renderProblems();
  }

  // ------------------------------------------------------------------ project storage
  function loadInputValues(savedInput) {
    if (typeof savedInput === "string" && savedInput.indexOf(INPUTS_PREFIX) === 0) {
      try {
        var values = JSON.parse(savedInput.slice(INPUTS_PREFIX.length));
        if (Array.isArray(values) && values.every(function (v) { return typeof v === "string"; })) return values;
      } catch (_) { /* older or damaged values */ }
    }
    return savedInput ? String(savedInput).replace(/\r\n/g, "\n").split("\n") : [];
  }

  function saveInputValues() {
    var text = INPUTS_PREFIX + JSON.stringify(lastInputs);
    return text.length > MAX_STDIN_LENGTH ? INPUTS_PREFIX + "[]" : text;
  }

  function refreshProjectSelect() {
    var select = $("projectSelect");
    select.replaceChildren();
    projects.forEach(function (project) {
      var option = document.createElement("option");
      option.value = project.id;
      option.textContent = project.title;
      select.appendChild(option);
    });
    select.disabled = projects.length < 2;
    $("deleteProject").disabled = projects.length === 0;
  }

  function savedText(timestamp) {
    var when = new Date(timestamp);
    var today = new Date();
    var sameDay = when.toDateString() === today.toDateString();
    return "Saved " + (sameDay ? when.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : when.toLocaleDateString([], { month: "short", day: "numeric" }));
  }

  function updateStats() {
    var code = getSource();
    $("editorStats").textContent = code.split("\n").length + " lines · " + code.length.toLocaleString() + " / " + MAX_SOURCE_LENGTH.toLocaleString();
    $("sourceFileLabel").textContent = T.sourceFileName(code);
  }

  function displayProject(project) {
    isLoadingProject = true;
    currentProjectId = project.id;
    projectTitle.value = project.title;
    compileDiags = []; runtimeDiags = []; lintDiags = []; rawCompilerOutput = "";
    clearDecorations(); clearInputDecorations();
    setSource(project.source_code);
    if (editor) editor.clearHistory();
    lastInputs = loadInputValues(project.stdin);
    isLoadingProject = false;
    $("projectSelect").value = project.id;
    resetTerminal("");
    updateStats();
    runLint();
    setSaveStatus(savedText(project.updated_at), false);
  }

  async function createProject(title, code) {
    var res = await sb.from("java_projects").insert({
      title: title || "Untitled Java project",
      source_code: code === undefined ? STARTER_CODE : code,
      stdin: ""
    }).select("id,title,source_code,stdin,updated_at").single();
    if (res.error) throw res.error;
    projects.unshift(res.data);
    refreshProjectSelect();
    displayProject(res.data);
    return res.data;
  }

  async function loadProjects() {
    var res = await sb.from("java_projects").select("id,title,source_code,stdin,updated_at").order("updated_at", { ascending: false });
    if (res.error) throw res.error;
    projects = res.data || [];
    if (!projects.length) { await createProject("Hello Java", STARTER_CODE); return; }
    refreshProjectSelect();
    displayProject(projects[0]);
  }

  function captureDraft() {
    if (!currentProjectId) return null;
    var title = projectTitle.value.trim() || "Untitled Java project";
    projectTitle.value = title;
    return { id: currentProjectId, title: title, source_code: getSource(), stdin: saveInputValues() };
  }

  async function persistDraft(draft) {
    try {
      var res = await sb.from("java_projects")
        .update({ title: draft.title, source_code: draft.source_code, stdin: draft.stdin, updated_at: new Date().toISOString() })
        .eq("id", draft.id).select("id,title,source_code,stdin,updated_at").maybeSingle();
      if (res.error) { setSaveStatus("Could not save: " + res.error.message, true); return false; }
      if (!res.data) { setSaveStatus("This project could not be found. Reload the page and try again.", true); return false; }
      var index = projects.findIndex(function (p) { return p.id === res.data.id; });
      if (index !== -1) projects[index] = res.data;
      projects.sort(function (a, b) { return new Date(b.updated_at) - new Date(a.updated_at); });
      refreshProjectSelect();
      if (currentProjectId === res.data.id) {
        $("projectSelect").value = res.data.id;
        setSaveStatus(savedText(res.data.updated_at), false);
      }
      return true;
    } catch (error) {
      setSaveStatus("Could not save: " + (error.message || "network error"), true);
      return false;
    }
  }

  function enqueueSave() {
    var draft = captureDraft();
    if (!draft) return Promise.resolve(false);
    saveQueue = saveQueue.then(function () { return persistDraft(draft); });
    return saveQueue;
  }

  function scheduleSave() {
    if (isLoadingProject) return;
    updateStats();
    setSaveStatus("Unsaved changes…", false);
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function () { enqueueSave(); }, 900);
  }

  // ------------------------------------------------------------------ export / copy
  function download(filename, text) {
    var blob = new Blob([text], { type: "text/x-java;charset=utf-8" });
    var url = URL.createObjectURL(blob);
    var link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  function exportJava() {
    var code = getSource();
    var name = T.sourceFileName(code);
    download(name, code);
    setRunStatus("Exported " + name + " (your original code and class name).", false);
  }

  async function copyText(text, okMessage) {
    try {
      await navigator.clipboard.writeText(text);
      setRunStatus(okMessage, false);
    } catch (_) {
      setRunStatus("Copy was blocked by the browser. Select the text and copy it manually.", true);
    }
  }

  function terminalPlainText() {
    var out = "";
    term.segments.forEach(function (s) {
      if (s.type === "out") out += s.text;
      else if (s.type === "in") out += s.text + "\n";
      else if (s.type === "eof") out += "^D\n";
    });
    if (term.stderr) out += (out && !/\n$/.test(out) ? "\n" : "") + term.stderr + "\n";
    return out;
  }

  // ------------------------------------------------------------------ autocomplete + snippets
  function wordBefore(cm) {
    var cur = cm.getCursor();
    var line = cm.getLine(cur.line);
    var start = cur.ch;
    while (start > 0 && /[\w$]/.test(line.charAt(start - 1))) start--;
    return { word: line.slice(start, cur.ch), start: start, cur: cur, line: line };
  }

  function expandSnippet(cm, key, from, to) {
    var snip = SNIPPETS[key];
    var indent = /^\s*/.exec(cm.getLine(from.line))[0];
    var text = snip.text.split("\n").join("\n" + indent);
    var marker = text.indexOf("|");
    text = text.replace("|", "");
    var startIndex = cm.indexFromPos(from);
    cm.replaceRange(text, from, to);
    cm.setCursor(cm.posFromIndex(startIndex + (marker < 0 ? text.length : marker)));
    if (snip.importName) applyTextEdit(T.addImport(getSource(), snip.importName));
  }

  function javaHint(cm) {
    var w = wordBefore(cm);
    var before = w.line.slice(0, w.start);
    var list = [];
    var pos = function (ch) { return { line: w.cur.line, ch: ch }; };
    var member = /([\w$]+(?:\.[\w$]+)*)\.\s*$/.exec(before);
    if (member) {
      var recv = member[1];
      var type = null;
      if (recv === "System.out" || recv === "System.err") type = "PrintStream";
      else if (/^[A-Z]/.test(recv)) type = recv;
      else {
        var decl = new RegExp("([A-Z][\\w$]*)(?:<[^>]*>)?(?:\\[\\])?\\s+" + recv.replace(/\$/g, "\\$") + "\\s*(?:=|;|,|\\))").exec(cm.getValue());
        if (decl) type = decl[1];
      }
      var names = (type && T.API_METHODS[type]) || [];
      list = names.filter(function (n) { return n.toLowerCase().indexOf(w.word.toLowerCase()) === 0 && n !== w.word; })
        .map(function (n) { return { text: n, displayText: n, className: "java-hint-method" }; });
      if (!list.length) return null;
      return { list: list, from: pos(w.start), to: w.cur };
    }
    if (!w.word || w.word.length < 2) return null;
    var seen = {};
    var lower = w.word.toLowerCase();
    Object.keys(SNIPPETS).forEach(function (key) {
      if (key.indexOf(lower) === 0 && key !== w.word) {
        seen[key] = 1;
        list.push({ text: key, displayText: key + "  ⟶  " + SNIPPETS[key].desc, className: "java-hint-snippet", hint: function (c, data, completion) { expandSnippet(c, key, data.from, data.to); } });
      }
    });
    var pool = KEYWORDS.concat(CLASS_WORDS, T.tokenize(cm.getValue()).tokens.filter(function (t) { return t.type === "word"; }).map(function (t) { return t.value; }));
    pool.forEach(function (n) {
      if (seen[n] || n === w.word || n.toLowerCase().indexOf(lower) !== 0) return;
      seen[n] = 1;
      list.push({ text: n, displayText: n, className: /^[A-Z]/.test(n) ? "java-hint-class" : "java-hint-word" });
    });
    list = list.slice(0, 40);
    if (!list.length) return null;
    return { list: list, from: pos(w.start), to: w.cur };
  }

  // ------------------------------------------------------------------ setup
  function setupEditor() {
    if (!window.CodeMirror) return;
    defineMode();
    var tab = function (cm) {
      if (cm.somethingSelected()) { cm.indentSelection("add"); return; }
      var w = wordBefore(cm);
      if (SNIPPETS[w.word]) { expandSnippet(cm, w.word, { line: w.cur.line, ch: w.start }, w.cur); return; }
      cm.replaceSelection(" ".repeat(4 - (w.cur.ch % 4)), "end");
    };
    editor = CodeMirror.fromTextArea(sourceCode, {
      mode: "portalis-java",
      theme: "vscode",
      lineNumbers: true,
      styleActiveLine: true,
      matchBrackets: true,
      autoCloseBrackets: true,
      indentUnit: 4,
      tabSize: 4,
      smartIndent: true,
      lineWrapping: false,
      foldGutter: !!(CodeMirror.fold && CodeMirror.fold.brace),
      gutters: ["java-input-gutter", "java-error-gutter", "CodeMirror-linenumbers", "CodeMirror-foldgutter"],
      extraKeys: {
        "Tab": tab,
        "Shift-Tab": function (cm) { cm.indentSelection("subtract"); },
        "Ctrl-Enter": function () { startRun(false); },
        "Cmd-Enter": function () { startRun(false); },
        "Ctrl-/": "toggleComment",
        "Cmd-/": "toggleComment",
        "Ctrl-Space": function (cm) { cm.showHint({ hint: javaHint, completeSingle: false }); },
        "Ctrl-S": function () { clearTimeout(saveTimer); enqueueSave(); },
        "Cmd-S": function () { clearTimeout(saveTimer); enqueueSave(); }
      }
    });
    editor.on("beforeChange", function (cm, change) {
      if (change.origin === "setValue") return;
      var currentLength = cm.getValue().length;
      var replaced = cm.indexFromPos(change.to) - cm.indexFromPos(change.from);
      var inserted = change.text.join("\n").length;
      if (currentLength - replaced + inserted > MAX_SOURCE_LENGTH) {
        change.cancel();
        setSaveStatus("Java source is limited to " + MAX_SOURCE_LENGTH.toLocaleString() + " characters.", true);
      }
    });
    editor.on("change", function (cm, change) {
      if (isLoadingProject) return;
      var first = change.from.line;
      var lastLine = first + change.text.length - 1;
      var changed = false;
      compileDiags = compileDiags.filter(function (d) {
        var n = lineOf(d);
        if (n < 0) { changed = true; return false; }
        if (n >= first && n <= lastLine) { changed = true; return false; }
        return true;
      });
      runtimeDiags = runtimeDiags.filter(function (d) {
        var n = lineOf(d);
        if (n < 0 || (n >= first && n <= lastLine)) { changed = true; return false; }
        return true;
      });
      if (changed && !compileDiags.length) rawCompilerOutput = "";
      scheduleLint();
      scheduleSave();
    });
    editor.on("inputRead", function (cm, change) {
      if (!change.text || change.text.length !== 1 || cm.state.completionActive) return;
      var ch = change.text[0];
      if (ch.length === 1 && /[\w.$]/.test(ch)) {
        cm.showHint({ hint: javaHint, completeSingle: false, closeCharacters: /[\s()\[\]{};:>,+\-*\/=<!&|?"']/ });
      }
    });
    editor.on("gutterClick", function (cm, line, gutter) { /* keep default fold handling */ });
  }

  function setFontSize(delta) {
    var current = Number(localStorage.getItem("portalis.java.font")) || 15;
    var next = Math.max(11, Math.min(24, current + delta));
    try { localStorage.setItem("portalis.java.font", String(next)); } catch (_) { /* private mode */ }
    document.documentElement.style.setProperty("--java-font", next + "px");
    if (editor) editor.refresh();
  }

  // Small dropdown menus: open on click, close on outside click, Escape, or after picking an item.
  function wireMenu(button, panel) {
    function set(open) {
      panel.hidden = !open;
      button.setAttribute("aria-expanded", open ? "true" : "false");
    }
    button.addEventListener("click", function (e) {
      e.stopPropagation();
      var willOpen = panel.hidden;
      document.querySelectorAll(".java-menu").forEach(function (m) { if (m !== panel && !m.hidden) { m.hidden = true; var b = document.querySelector('[aria-controls="' + m.id + '"]'); if (b) b.setAttribute("aria-expanded", "false"); } });
      set(willOpen);
    });
    panel.addEventListener("click", function (e) {
      var t = e.target;
      if (t.tagName === "BUTTON" && !t.hasAttribute("data-keep-open")) set(false);
    });
    document.addEventListener("click", function (e) { if (!panel.hidden && !panel.contains(e.target)) set(false); });
    document.addEventListener("keydown", function (e) { if (e.key === "Escape" && !panel.hidden) { set(false); button.focus(); } });
  }

  function wireEvents() {
    projectTitle.addEventListener("input", scheduleSave);
    $("runCode").addEventListener("click", function () { startRun(false); });
    $("replayCode").addEventListener("click", function () { startRun(true); });
    $("stopCode").addEventListener("click", stopRun);
    $("downloadJava").addEventListener("click", exportJava);
    $("copyCode").addEventListener("click", function () { copyText(getSource(), "Code copied."); });
    $("fontUp").addEventListener("click", function () { setFontSize(1); });
    $("fontDown").addEventListener("click", function () { setFontSize(-1); });
    $("termEof").addEventListener("click", sendEof);
    $("termUndo").addEventListener("click", undoInput);
    $("termCopy").addEventListener("click", function () { copyText(terminalPlainText(), "Terminal text copied."); });
    $("termClear").addEventListener("click", function () { resetTerminal(""); });
    $("termBody").addEventListener("click", function (e) {
      var target = e.target.closest ? e.target.closest("[data-line]") : null;
      if (target) { jumpToLine(Number(target.dataset.line) - 1, 0); return; }
      var inputEl = $("termBody").querySelector(".t-input");
      if (inputEl && !window.getSelection().toString()) inputEl.focus();
    });
    $("termBody").addEventListener("mouseover", function (e) {
      var target = e.target.closest ? e.target.closest("[data-line]") : null;
      if (!editor) return;
      var line = target ? Number(target.dataset.line) - 1 : null;
      if (line === hoverLine) return;
      if (hoverLine !== null) editor.removeLineClass(hoverLine, "wrap", "java-out-hover");
      hoverLine = null;
      if (line !== null && line >= 0 && line < editor.lineCount()) { editor.addLineClass(line, "wrap", "java-out-hover"); hoverLine = line; }
    });
    $("termBody").addEventListener("mouseleave", function () {
      if (editor && hoverLine !== null) editor.removeLineClass(hoverLine, "wrap", "java-out-hover");
      hoverLine = null;
    });
    $("saveProject").addEventListener("click", async function () { clearTimeout(saveTimer); await enqueueSave(); });
    async function newFrom(title, code) {
      clearTimeout(saveTimer);
      await enqueueSave();
      try { await createProject(title, code); setSaveStatus("New project created", false); }
      catch (error) { setSaveStatus("Could not create project: " + error.message, true); }
    }
    $("newProject").addEventListener("click", function () { newFrom("Untitled Java project", STARTER_CODE); });
    Object.keys(TEMPLATES).forEach(function (name) {
      var item = document.createElement("button");
      item.type = "button";
      item.textContent = name;
      item.addEventListener("click", function () { newFrom(name, TEMPLATES[name]); });
      $("newMenu").appendChild(item);
    });
    wireMenu($("newBtn"), $("newMenu"));
    wireMenu($("moreBtn"), $("moreMenu"));

    $("infoBtn").addEventListener("click", function () {
      var panel = $("infoPanel");
      panel.hidden = !panel.hidden;
      $("infoBtn").setAttribute("aria-expanded", panel.hidden ? "false" : "true");
    });
    $("problemsToggle").addEventListener("click", function () {
      if (!allProblems().length) return;
      problemsOpen = !problemsOpen;
      renderProblems();
    });
    function setGuide(open) {
      $("guideModal").hidden = !open;
      if (open) $("guideClose").focus(); else $("guideBtn").focus();
    }
    $("guideBtn").addEventListener("click", function () { setGuide(true); });
    $("guideClose").addEventListener("click", function () { setGuide(false); });
    $("guideModal").addEventListener("click", function (e) { if (e.target === $("guideModal")) setGuide(false); });
    document.addEventListener("keydown", function (e) { if (e.key === "Escape" && !$("guideModal").hidden) setGuide(false); });
    $("projectSelect").addEventListener("change", async function (event) {
      var selectedId = event.target.value;
      clearTimeout(saveTimer);
      await enqueueSave();
      var project = projects.find(function (item) { return item.id === selectedId; });
      if (project) displayProject(project);
    });
    $("deleteProject").addEventListener("click", async function () {
      var project = projects.find(function (item) { return item.id === currentProjectId; });
      if (!project || !confirm("Delete \"" + project.title + "\"? This cannot be undone.")) return;
      clearTimeout(saveTimer);
      await saveQueue;
      try {
        var res = await sb.from("java_projects").delete().eq("id", project.id);
        if (res.error) throw res.error;
        projects = projects.filter(function (item) { return item.id !== project.id; });
        if (projects.length) { refreshProjectSelect(); displayProject(projects[0]); }
        else {
          try { await createProject("Hello Java", STARTER_CODE); }
          catch (error) { setSaveStatus("Project deleted, but a new project could not be created: " + error.message, true); }
        }
      } catch (error) {
        setSaveStatus("Could not delete project: " + (error.message || "network error"), true);
      }
    });
    if (!editor) {
      sourceCode.addEventListener("input", function () { scheduleLint(); scheduleSave(); });
      sourceCode.addEventListener("keydown", function (event) {
        if ((event.ctrlKey || event.metaKey) && event.key === "Enter") { event.preventDefault(); startRun(false); }
      });
    }
  }

  async function init() {
    var saved = Number(localStorage.getItem("portalis.java.font"));
    if (saved) document.documentElement.style.setProperty("--java-font", saved + "px");
    var ctx = await requireAuth();
    if (!ctx) return;
    renderBar(ctx, "java-compiler");
    try { await loadProjects(); }
    catch (error) { setSaveStatus("Could not load saved projects: " + error.message, true); }
  }

  setupEditor();
  wireEvents();
  renderTerminal();
  updateStats();
  window.__portalisJava = { startRun: startRun, submitInput: submitInput, sendEof: sendEof, getTerm: function () { return term; }, getEditor: function () { return editor; }, setSource: setSource, getSource: getSource, undoInput: undoInput, renderProblems: renderProblems, runLint: runLint, javaHint: javaHint, expandSnippet: expandSnippet, wordBefore: wordBefore, _session: function () { return session; } };
  init();
})();