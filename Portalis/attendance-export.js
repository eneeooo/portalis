/* Portalis attendance exports: PDF (jsPDF), XLSX (xlsx-js-style) and a printable table.
   The model comes from attendance.html:
   { school, academicYear, className, rangeLabel, generated: Date,
     dates: [{ iso, short, weekday, label }],
     rows:  [{ no, name, marks: ["present"|"absent"|"late"|"excused"|""], counts: { present, late, absent, excused } }],
     presentByDate: [number] } */
(function (root) {
  "use strict";

  var GLYPH = { present: "\u2713", absent: "X", late: "L", excused: "E" };
  var NAMES = { present: "Present", absent: "Absent", late: "Late", excused: "Excused" };
  var TOTAL_HEADS = ["Present", "Late", "Absent", "Excused"];

  function fileStem(model) {
    var range = String(model.rangeLabel || "all-dates").replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase();
    return (model.className + "-attendance-" + range).replace(/[^a-z0-9_-]+/gi, "-");
  }

  /* ---------------- PDF (8.5 x 13 in long bond, portrait) ---------------- */
  function toPdf(model, JsPDF) {
    var doc = new JsPDF({ orientation: "portrait", unit: "pt", format: [612, 936] });
    if (typeof doc.autoTable !== "function") throw new Error("The PDF table plugin did not load.");
    var margin = 36, perPage = 8, totalsFit = 6;
    var idx = model.dates.map(function (_, i) { return i; });
    var chunks = [];
    for (var i = 0; i < idx.length; i += perPage) chunks.push(idx.slice(i, i + perPage));
    if (!chunks.length) chunks.push([]);
    var last = chunks[chunks.length - 1];
    var totalsOwnPage = last.length > totalsFit;

    var fills = { absent: [253, 232, 232], late: [255, 244, 209], excused: [228, 238, 252] };

    function header(startNote) {
      if (model.logos) {
        try {
          if (model.logos.left) doc.addImage(model.logos.left.dataUrl, "PNG", margin + 6, 36, 56, 56 * model.logos.left.h / model.logos.left.w);
          if (model.logos.right) doc.addImage(model.logos.right.dataUrl, "PNG", 612 - margin - 6 - 56, 36, 56, 56 * model.logos.right.h / model.logos.right.w);
        } catch (e) { /* logos are optional */ }
      }
      doc.setFont("helvetica", "bold");
      doc.setFontSize(14);
      doc.setTextColor(20);
      doc.text(model.school, 306, 52, { align: "center" });
      doc.setFontSize(11);
      doc.text("A.Y " + model.academicYear, 306, 68, { align: "center" });
      doc.text(model.className + " CLASS ATTENDANCE", 306, 83, { align: "center" });
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);
      doc.setTextColor(90);
      doc.text(startNote, 306, 97, { align: "center" });
      doc.setTextColor(20);
      doc.setDrawColor(20);
      doc.setLineWidth(1);
      doc.line(margin, 106, 612 - margin, 106);
      return 116;
    }

    function drawTable(dateIdxs, withTotals, firstOnPage) {
      var head = ["STUDENT NAME"];
      dateIdxs.forEach(function (d) {
        var date = model.dates[d];
        head.push(date.short + "\n" + date.weekday);
      });
      if (withTotals) head = head.concat(TOTAL_HEADS);

      var body = model.rows.map(function (row) {
        var cells = [{ content: row.no + ". " + row.name, styles: { halign: "left" } }];
        dateIdxs.forEach(function (d) {
          var status = row.marks[d] || "";
          var cell = { content: status === "present" || status === "absent" ? "" : (GLYPH[status] || ""), _mark: status };
          if (fills[status]) cell.styles = { fillColor: fills[status] };
          if (status === "late" || status === "excused") cell.styles = Object.assign({ fontStyle: "bold" }, cell.styles);
          cells.push(cell);
        });
        if (withTotals) {
          cells.push(String(row.counts.present), String(row.counts.late), String(row.counts.absent), String(row.counts.excused));
        }
        return cells;
      });

      var footer = [{ content: "Total present (incl. late)", styles: { halign: "left", fontStyle: "bold", fillColor: [240, 240, 240] } }];
      dateIdxs.forEach(function (d) {
        footer.push({ content: String(model.presentByDate[d]), styles: { fontStyle: "bold", fillColor: [240, 240, 240] } });
      });
      if (withTotals) for (var k = 0; k < 4; k++) footer.push({ content: "", styles: { fillColor: [240, 240, 240] } });
      body.push(footer);

      var columnStyles = { 0: { halign: "left", cellWidth: 176 } };
      doc.autoTable({
        startY: firstOnPage,
        head: [head],
        body: body,
        theme: "grid",
        margin: { left: margin, right: margin },
        styles: { font: "helvetica", fontSize: 8.5, cellPadding: { top: 3.2, bottom: 3.2, left: 4, right: 4 }, lineColor: [110, 110, 110], lineWidth: 0.5, halign: "center", valign: "middle", textColor: 20, minCellHeight: 17 },
        headStyles: { fillColor: [226, 229, 235], textColor: 20, fontStyle: "bold", fontSize: 8.5, valign: "middle" },
        columnStyles: columnStyles,
        didDrawCell: function (data) {
          if (data.section !== "body") return;
          var mark = data.cell.raw && data.cell.raw._mark;
          if (mark !== "present" && mark !== "absent") return;
          var x = data.cell.x, y = data.cell.y, w = data.cell.width, h = data.cell.height;
          var cx = x + w / 2, cy = y + h / 2;
          if (mark === "present") {
            doc.setDrawColor(22, 120, 60);
            doc.setLineWidth(1.4);
            doc.line(cx - 4.5, cy + 0.5, cx - 1.5, cy + 3.8);
            doc.line(cx - 1.5, cy + 3.8, cx + 5, cy - 4);
          } else {
            doc.setDrawColor(190, 30, 45);
            doc.setLineWidth(1.4);
            doc.line(cx - 4, cy - 4, cx + 4, cy + 4);
            doc.line(cx - 4, cy + 4, cx + 4, cy - 4);
          }
          doc.setDrawColor(110);
          doc.setLineWidth(0.5);
        }
      });
    }

    chunks.forEach(function (dateIdxs, ci) {
      if (ci > 0) doc.addPage();
      var note = model.rangeLabel + (chunks.length + (totalsOwnPage ? 1 : 0) > 1 ? "  \u00b7  dates " + (dateIdxs.length ? (dateIdxs[0] + 1) + "-" + (dateIdxs[dateIdxs.length - 1] + 1) + " of " + model.dates.length : "") : "");
      var y = header(note.replace(/\u00b7/g, "-"));
      var isLast = ci === chunks.length - 1;
      drawTable(dateIdxs, isLast && !totalsOwnPage, y);
    });
    if (totalsOwnPage) {
      doc.addPage();
      var y2 = header(model.rangeLabel + "  -  totals");
      drawTable([], true, y2);
    }

    var pages = doc.getNumberOfPages();
    for (var p = 1; p <= pages; p++) {
      doc.setPage(p);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      doc.setTextColor(90);
      doc.text("Legend: check mark = Present, X = Absent, L = Late, E = Excused, blank = not recorded", margin, 910);
      doc.text("Generated " + model.generated.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" }) + "  -  Page " + p + " of " + pages, 612 - margin, 910, { align: "right" });
    }
    return doc;
  }

  /* ---------------- XLSX (ExcelJS, supports logos) ---------------- */
  function toXlsxBuffer(model, ExcelJS) {
    var wb = new ExcelJS.Workbook();
    wb.creator = "Portalis";
    wb.created = new Date();
    var ws = wb.addWorksheet("Attendance", { views: [] });
    var nDates = model.dates.length;
    var cols = 1 + nDates + 4;
    var thin = { style: "thin", color: { argb: "FF666666" } };
    var border = { top: thin, bottom: thin, left: thin, right: thin };
    var font = function (o) { return Object.assign({ name: "Arial", size: 10 }, o || {}); };

    ws.columns = [{ width: 36 }].concat(model.dates.map(function () { return { width: 11 }; }), [{ width: 9 }, { width: 9 }, { width: 9 }, { width: 9 }]);

    var titles = [
      [model.school, { bold: true, size: 14 }],
      ["A.Y " + model.academicYear, { bold: true, size: 11 }],
      [model.className + " CLASS ATTENDANCE", { bold: true, size: 11 }],
      [model.rangeLabel, { italic: true, size: 9, color: { argb: "FF555555" } }]
    ];
    titles.forEach(function (t, i) {
      var row = ws.getRow(i + 1);
      row.getCell(1).value = t[0];
      row.getCell(1).font = font(t[1]);
      row.getCell(1).alignment = { horizontal: "center", vertical: "middle" };
      row.height = 19;
      ws.mergeCells(i + 1, 1, i + 1, Math.max(cols, 2));
    });
    ws.getRow(5).height = 8;

    var headerRowNo = 6;
    var head = ws.getRow(headerRowNo);
    var headValues = ["STUDENT NAME"].concat(model.dates.map(function (d) { return d.short + " (" + d.weekday + ")"; }), TOTAL_HEADS);
    headValues.forEach(function (v, i) {
      var c = head.getCell(i + 1);
      c.value = v;
      c.font = font({ bold: true });
      c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE2E5EB" } };
      c.alignment = { horizontal: i === 0 ? "left" : "center", vertical: "middle", wrapText: true };
      c.border = border;
    });
    head.height = 28;

    var fills = { absent: "FFFDE8E8", late: "FFFFF4D1", excused: "FFE4EEFC" };
    var colors = { present: "FF167838", absent: "FFBE1E2D" };
    model.rows.forEach(function (rowData, i) {
      var row = ws.getRow(headerRowNo + 1 + i);
      var nameCell = row.getCell(1);
      nameCell.value = rowData.no + ". " + rowData.name;
      nameCell.font = font();
      nameCell.alignment = { horizontal: "left", vertical: "middle" };
      nameCell.border = border;
      rowData.marks.forEach(function (m, j) {
        var c = row.getCell(2 + j);
        c.value = GLYPH[m] || "";
        c.font = font({ bold: !!m, color: colors[m] ? { argb: colors[m] } : undefined });
        c.alignment = { horizontal: "center", vertical: "middle" };
        c.border = border;
        if (fills[m]) c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: fills[m] } };
      });
      [rowData.counts.present, rowData.counts.late, rowData.counts.absent, rowData.counts.excused].forEach(function (n, t) {
        var c = row.getCell(2 + nDates + t);
        c.value = n;
        c.font = font();
        c.alignment = { horizontal: "center", vertical: "middle" };
        c.border = border;
      });
    });

    var footNo = headerRowNo + model.rows.length + 1;
    var foot = ws.getRow(footNo);
    var footValues = ["Total present (incl. late)"].concat(model.presentByDate, ["", "", "", ""]);
    footValues.forEach(function (v, i) {
      var c = foot.getCell(i + 1);
      c.value = v;
      c.font = font({ bold: true });
      c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF0F0F0" } };
      c.alignment = { horizontal: i === 0 ? "left" : "center", vertical: "middle" };
      c.border = border;
    });

    var legend = ws.getRow(footNo + 2);
    legend.getCell(1).value = "Legend: \u2713 = Present, X = Absent, L = Late, E = Excused, blank = not recorded";
    legend.getCell(1).font = font({ size: 9, color: { argb: "FF555555" } });
    ws.mergeCells(footNo + 2, 1, footNo + 2, Math.max(cols, 2));

    ws.views = [{ state: "frozen", xSplit: 1, ySplit: headerRowNo }];
    ws.pageSetup = { orientation: nDates > 8 ? "landscape" : "portrait", paperSize: 5, fitToPage: true, fitToWidth: 1, fitToHeight: 0, margins: { left: 0.5, right: 0.5, top: 0.5, bottom: 0.5, header: 0.3, footer: 0.3 } };

    if (model.logos) {
      var place = function (logo, col, rowOffset) {
        var id = wb.addImage({ base64: logo.dataUrl, extension: "png" });
        var size = 74;
        ws.addImage(id, { tl: { col: col, row: rowOffset }, ext: { width: size, height: size * logo.h / logo.w } });
      };
      if (model.logos.left) place(model.logos.left, 0.04, 0.08);
      if (model.logos.right) place(model.logos.right, Math.max(cols - 2, 1) + 0.2, 0.08);
    }
    return wb.xlsx.writeBuffer();
  }

  /* ---------------- print preview table ---------------- */
  function toPrintNode(model, doc) {
    function mk(tag, cls, text) {
      var n = doc.createElement(tag);
      if (cls) n.className = cls;
      if (text !== undefined) n.textContent = text;
      return n;
    }
    var box = mk("div", "att-print-sheet" + (model.dates.length > 10 ? " att-print-wide" : ""));
    var head = mk("div", "att-print-head");
    if (model.logos) {
      var addLogo = function (logo, side) {
        if (!logo) return;
        var img = mk("img", "att-print-logo att-print-logo-" + side);
        img.src = logo.dataUrl;
        img.alt = "";
        head.appendChild(img);
      };
      addLogo(model.logos.left, "left");
      addLogo(model.logos.right, "right");
    }
    head.appendChild(mk("h1", "", model.school));
    head.appendChild(mk("p", "att-print-ay", "A.Y " + model.academicYear));
    head.appendChild(mk("p", "att-print-title", model.className + " CLASS ATTENDANCE"));
    head.appendChild(mk("p", "att-print-range", model.rangeLabel));
    box.appendChild(head);

    var table = mk("table", "att-print-table");
    var thead = mk("thead"), hr = mk("tr");
    hr.appendChild(mk("th", "att-print-name", "STUDENT NAME"));
    model.dates.forEach(function (d) {
      var th = mk("th");
      th.appendChild(mk("span", "", d.short));
      th.appendChild(mk("small", "", d.weekday));
      hr.appendChild(th);
    });
    TOTAL_HEADS.forEach(function (t) { hr.appendChild(mk("th", "att-print-total", t)); });
    thead.appendChild(hr);
    table.appendChild(thead);
    var tbody = mk("tbody");
    model.rows.forEach(function (row) {
      var tr = mk("tr");
      tr.appendChild(mk("td", "att-print-name", row.no + ". " + row.name));
      row.marks.forEach(function (m) { tr.appendChild(mk("td", "att-mark-" + (m || "none"), GLYPH[m] || "")); });
      [row.counts.present, row.counts.late, row.counts.absent, row.counts.excused].forEach(function (n) { tr.appendChild(mk("td", "att-print-total", String(n))); });
      tbody.appendChild(tr);
    });
    var fr = mk("tr", "att-print-foot");
    fr.appendChild(mk("td", "att-print-name", "Total present (incl. late)"));
    model.presentByDate.forEach(function (n) { fr.appendChild(mk("td", "", String(n))); });
    for (var k = 0; k < 4; k++) fr.appendChild(mk("td", "att-print-total", ""));
    tbody.appendChild(fr);
    table.appendChild(tbody);
    box.appendChild(table);
    box.appendChild(mk("p", "att-print-legend", "Legend: \u2713 Present \u00b7 X Absent \u00b7 L Late \u00b7 E Excused \u00b7 blank = not recorded. Generated " + model.generated.toLocaleString()));
    return box;
  }

  var api = { toPdf: toPdf, toXlsxBuffer: toXlsxBuffer, toPrintNode: toPrintNode, fileStem: fileStem, GLYPH: GLYPH, NAMES: NAMES };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.AttendanceExport = api;
})(typeof window !== "undefined" ? window : this);
