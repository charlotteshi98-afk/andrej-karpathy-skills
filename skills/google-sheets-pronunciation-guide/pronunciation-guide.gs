/**
 * Pronunciation Guide
 * -------------------
 * Scans column K (dialogue text) on the active sheet for any character
 * name that appears in a separate Pronunciation Guide spreadsheet
 * (headers: sh | Name | Pronunciation | Notes | Link to Audio), and
 * writes matches into column H as: Name (Pronunciation) — Notes, each
 * hyperlinked to its Link to Audio.
 *
 * HOW COLUMN H WORKS
 * ------------------
 * Each cell in column H can have two zones:
 *
 *   [manual text]     ← anything you type here is PRESERVED on re-runs
 *   ***               ← auto-marker (blue, bold) — do not remove it
 *   [auto-generated]  ← rebuilt fresh every time you run the tool
 *
 * On re-run, only the auto-generated block (below ***) is refreshed.
 * If a cell has no *** yet, the tool appends one and adds matches below it.
 *
 * SETUP
 * -----
 * 1. Set guideSheetId to your Pronunciation Guide spreadsheet's ID
 *    (from its URL: docs.google.com/spreadsheets/d/<ID>/edit)
 * 2. Confirm guideTabName matches the tab name in that spreadsheet
 * 3. Adjust sourceTextColumn / outputColumn / voIdColumn if your sheet
 *    uses different columns
 * 4. Run addPronunciationNotes() via the "VO Tools" menu or directly
 *
 * DEPENDENCIES (same Apps Script project, shared global scope)
 * ------------
 *   normalizeHeader()      — ReferenceMaterialsTracker.gs
 *   columnLetterToIndex()  — LinkReferenceFiles.gs
 *
 * REQUIRED SERVICE
 * ----------------
 * The guide needs a column of plain-text audio URLs (see audioUrlColumn below).
 *
 * Why plain text: the guide is an .xlsx file opened in Sheets' Office
 * compatibility mode. Neither the Sheets API nor getRichTextValues() can read
 * hyperlinks or Drive smart chips out of an Office file, so the URLs have to
 * exist as readable text. In the guide, column Z holds them.
 *
 * To regenerate that column from chips/hyperlinks, put this in Z2 and fill down:
 *   =IFERROR(REGEXEXTRACT(FORMULATEXT(E2), """(https?://[^""]+)"""), "")
 * or paste the URLs in as plain text.
 */

var PRONUNCIATION_CONFIG = {
  guideSheetId: '1MBhpULGIMBFr9R_xbN2cGKbnSfyskyfm',
  guideTabName: 'Pronunciation',

  nameHeader:          'Name',
  pronunciationHeader: 'Pronunciation',
  notesHeader:         'Notes',
  audioLinkHeader:     'Link to Audio',
  // Fallback if a column literally headed "Link to Audio" isn't found —
  // used directly by column letter instead (guide has it in column E)
  audioLinkColumnFallback: 'E',
  // Column holding the audio URLs as plain text. This is where the links
  // actually come from; column E only supplies the display filename.
  audioUrlColumn: 'Z',

  sourceTextColumn: 'K',  // column containing dialogue text to scan
  outputColumn:     'H',  // column where pronunciation matches are written
  voIdColumn:       'B',  // rows blank in this column are skipped entirely
  startRow: 2             // first data row (row 1 assumed to be headers)
};

var PRONUNCIATION_AUTO_MARKER = '***';
var PRONUNCIATION_MARKER_COLOR = '#1155cc'; // blue — makes the marker easy to spot

function addPronunciationNotes() {
  var ui = SpreadsheetApp.getUi();
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getActiveSheet();

  var guideEntries = loadPronunciationGuide();
  if (guideEntries.length === 0) {
    ui.alert('Pronunciation guide has no usable entries.\nCheck PRONUNCIATION_CONFIG.guideSheetId / guideTabName / nameHeader.');
    return;
  }

  var lastRow = sheet.getLastRow();
  if (lastRow < PRONUNCIATION_CONFIG.startRow) {
    ui.alert('No data rows found starting at row ' + PRONUNCIATION_CONFIG.startRow + '.');
    return;
  }

  var textColIdx = columnLetterToIndex(PRONUNCIATION_CONFIG.sourceTextColumn);
  var outColIdx  = columnLetterToIndex(PRONUNCIATION_CONFIG.outputColumn);
  var voColIdx   = columnLetterToIndex(PRONUNCIATION_CONFIG.voIdColumn);
  var numRows    = lastRow - PRONUNCIATION_CONFIG.startRow + 1;
  var startRow   = PRONUNCIATION_CONFIG.startRow;

  // Batch-read all input columns at once to minimise Sheets API calls
  var textValues = sheet.getRange(startRow, textColIdx, numRows, 1).getValues();
  var voIdValues = sheet.getRange(startRow, voColIdx,   numRows, 1).getValues();

  // Read existing column H rich text: needed both for detecting manual content
  // and for writing back the full column in one batch at the end
  var outRange     = sheet.getRange(startRow, outColIdx, numRows, 1);
  var existingRich = outRange.getRichTextValues(); // [[RTV], [RTV], ...]

  // Count rows that have manual content (H has text before the *** marker,
  // or has text with no marker at all) — prompt the user once before touching them
  var manualRowCount = 0;
  for (var i = 0; i < numRows; i++) {
    var hText     = existingRich[i][0].getText();
    var markerPos = hText.indexOf(PRONUNCIATION_AUTO_MARKER);
    var before    = markerPos === -1 ? hText : hText.substring(0, markerPos);
    if (before.trim()) manualRowCount++;
  }

  var skipManualRows = false;
  if (manualRowCount > 0) {
    var resp = ui.alert(
      'Existing content found',
      manualRowCount + ' row(s) have content in column ' + PRONUNCIATION_CONFIG.outputColumn +
        ' that wasn\'t added by this tool.\n\n' +
        'Skip those rows entirely?\n\n' +
        '  Yes — leave them completely untouched\n' +
        '  No  — append auto-generated block below their existing content',
      ui.ButtonSet.YES_NO_CANCEL
    );
    if (resp === ui.Button.CANCEL) return;
    skipManualRows = (resp === ui.Button.YES);
  }

  // newRich[i] stays null for rows that don't need a write; set to the new RTV otherwise
  var newRich    = new Array(numRows).fill(null);
  var updated    = 0;
  var skipped    = 0;
  var errors     = [];
  var toastEvery = numRows < 50 ? 1 : 10;

  for (var i = 0; i < numRows; i++) {
    if (i % toastEvery === 0) {
      ss.toast('Scanning row ' + (i + 1) + ' of ' + numRows + '…', 'Pronunciation Guide', -1);
    }

    // Skip rows with no VO ID (blank in voIdColumn)
    if (!String(voIdValues[i][0] || '').trim()) continue;

    var text = String(textValues[i][0] || '').trim();
    if (!text) continue;

    var existingRTV  = existingRich[i][0];
    var existingText = existingRTV.getText();
    var markerPos    = existingText.indexOf(PRONUNCIATION_AUTO_MARKER);
    var beforeMarker = markerPos === -1 ? existingText : existingText.substring(0, markerPos);
    var hasManual    = !!beforeMarker.trim();

    if (skipManualRows && hasManual) {
      skipped++;
      continue;
    }

    try {
      var matches = findMatches(text, guideEntries);
      if (matches.length === 0 && markerPos === -1) continue; // nothing to add, nothing to refresh

      var rawManual      = markerPos !== -1 ? existingText.substring(0, markerPos) : existingText;
      var generatedLines = matches.map(buildGeneratedLine);
      newRich[i] = buildMergedRichText(existingRTV, rawManual, generatedLines);
      updated++;
    } catch (e) {
      errors.push('Row ' + (startRow + i) + ': ' + e.message);
    }
  }

  // Write all changes in one Sheets API call
  ss.toast('Writing results…', 'Pronunciation Guide', -1);
  var finalRich = existingRich.map(function(row, i) {
    return newRich[i] !== null ? [newRich[i]] : row;
  });

  try {
    outRange.setRichTextValues(finalRich);
  } catch (batchErr) {
    // Batch write failed — fall back to per-cell writes to save as much as possible
    for (var i = 0; i < numRows; i++) {
      if (newRich[i] === null) continue;
      try {
        sheet.getRange(startRow + i, outColIdx).setRichTextValue(newRich[i]);
      } catch (cellErr) {
        errors.push('Row ' + (startRow + i) + ' (write): ' + cellErr.message);
      }
    }
  }

  var summary = 'Done.\n\nUpdated: ' + updated + ' row(s)';
  if (skipped)       summary += '\nSkipped (manual content): ' + skipped;
  if (errors.length) summary += '\n\nErrors (' + errors.length + '):\n' + errors.join('\n');
  ui.alert(summary);
}


// ─── Guide loading ────────────────────────────────────────────────────────────

function loadPronunciationGuide() {
  var ss    = SpreadsheetApp.openById(PRONUNCIATION_CONFIG.guideSheetId);
  var sheet = ss.getSheetByName(PRONUNCIATION_CONFIG.guideTabName);
  if (!sheet) throw new Error('Tab not found: ' + PRONUNCIATION_CONFIG.guideTabName);

  var range      = sheet.getDataRange();
  var values     = range.getValues();
  var richValues = range.getRichTextValues();
  var formulas   = range.getFormulas(); // fallback for =HYPERLINK() cells

  var headerRowIdx = -1, nameCol = -1, pronCol = -1, notesCol = -1, audioCol = -1;
  for (var r = 0; r < values.length; r++) {
    for (var c = 0; c < values[r].length; c++) {
      var norm = normalizeHeader(values[r][c]);
      if (norm === normalizeHeader(PRONUNCIATION_CONFIG.nameHeader))          { headerRowIdx = r; nameCol  = c; }
      if (norm === normalizeHeader(PRONUNCIATION_CONFIG.pronunciationHeader)) pronCol  = c;
      if (norm === normalizeHeader(PRONUNCIATION_CONFIG.notesHeader))         notesCol = c;
      if (norm === normalizeHeader(PRONUNCIATION_CONFIG.audioLinkHeader))     audioCol = c;
    }
    if (headerRowIdx === r && nameCol > -1) break;
  }
  if (headerRowIdx === -1 || nameCol === -1) {
    throw new Error('Could not find a "' + PRONUNCIATION_CONFIG.nameHeader + '" column in the pronunciation guide.');
  }
  if (audioCol === -1 && PRONUNCIATION_CONFIG.audioLinkColumnFallback) {
    audioCol = columnLetterToIndex(PRONUNCIATION_CONFIG.audioLinkColumnFallback) - 1; // convert to 0-indexed
  }

  // Column of plain-text audio URLs. Required because the guide is an .xlsx
  // file — Sheets' Office compatibility mode exposes no hyperlink or smart-chip
  // data to either the Sheets API or getRichTextValues().
  var urlCol = columnLetterToIndex(PRONUNCIATION_CONFIG.audioUrlColumn) - 1;

  var entries = [];
  for (var i = headerRowIdx + 1; i < values.length; i++) {
    var name = String(values[i][nameCol] || '').trim();
    if (!name) continue;

    var audioUrl = String((values[i] || [])[urlCol] || '').trim();
    // Fall back to a real hyperlink/=HYPERLINK() in the display column, for
    // guides that are native Google Sheets rather than .xlsx.
    if (!audioUrl && audioCol > -1) {
      audioUrl = extractCellUrl(richValues[i][audioCol], formulas[i][audioCol]);
    }
    if (audioUrl && !/^https?:\/\//i.test(audioUrl)) audioUrl = '';

    var audioDisplayText = audioCol > -1 ? String(values[i][audioCol] || '').trim() : '';

    entries.push({
      name:             name,
      pronunciation:    pronCol  > -1 ? String(values[i][pronCol]  || '').trim() : '',
      notes:            notesCol > -1 ? String(values[i][notesCol] || '').trim() : '',
      audioUrl:         audioUrl,
      audioDisplayText: audioDisplayText
    });
  }

  entries.forEach(function(e) { delete e.audioDisplayText; });
  return entries;
}

// Extracts a hyperlink URL from a cell. Checks rich-text runs first — Drive-
// linked cells store the URL in a run rather than on the top-level RichTextValue,
// so getRichTextValue().getLinkUrl() returns null for them. Falls back to parsing
// a =HYPERLINK("url","label") formula if no run-level link is found.
function extractCellUrl(richValue, formulaStr) {
  var runs = richValue.getRuns();
  for (var r = 0; r < runs.length; r++) {
    var u = runs[r].getLinkUrl();
    if (u) return u;
  }
  var topLevel = richValue.getLinkUrl(); // works when the whole cell is uniformly linked
  if (topLevel) return topLevel;
  var m = String(formulaStr || '').match(/=HYPERLINK\("([^"]+)"/i);
  return m ? m[1] : '';
}


// ─── Matching ─────────────────────────────────────────────────────────────────

function findMatches(text, guideEntries) {
  var found = [];
  guideEntries.forEach(function(entry) {
    var idx = text.search(buildNameMatcher(entry.name));
    if (idx !== -1) found.push({ entry: entry, index: idx });
  });
  found.sort(function(a, b) { return a.index - b.index; });
  return found.map(function(f) { return f.entry; });
}

// Whole-word matching for plain ASCII names prevents "Ann" from matching inside
// "Anna". Falls back to substring match for names that contain spaces, CJK
// characters, or punctuation, where \b word-boundary semantics aren't reliable.
function buildNameMatcher(name) {
  var escaped     = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  var isAsciiWord = /^[A-Za-z0-9'\-]+$/.test(name);
  return isAsciiWord ? new RegExp('\\b' + escaped + '\\b') : new RegExp(escaped);
}


// ─── Debug helper ────────────────────────────────────────────────────────────

// Run this directly from the Apps Script editor (not via the menu) to diagnose
// why audio links aren't appearing. It shows: whether the Sheets API is reachable,
// what URL (if any) was found for each entry, and the raw cell values in column E.
function debugPronunciationGuide() {
  var ui = SpreadsheetApp.getUi();
  var lines = [];

  // 1. Show what's actually sitting in the URL column
  try {
    var guideSheet = SpreadsheetApp.openById(PRONUNCIATION_CONFIG.guideSheetId)
                       .getSheetByName(PRONUNCIATION_CONFIG.guideTabName);
    var vals   = guideSheet.getDataRange().getValues();
    var urlCol = columnLetterToIndex(PRONUNCIATION_CONFIG.audioUrlColumn) - 1;
    var filled = 0;
    for (var r = 1; r < vals.length; r++) {
      if (String((vals[r] || [])[urlCol] || '').trim()) filled++;
    }
    lines.push('URL column ' + PRONUNCIATION_CONFIG.audioUrlColumn + ': ' +
               filled + ' of ' + (vals.length - 1) + ' rows filled');
    lines.push('\nFirst 5 values:');
    for (var i = 1; i <= Math.min(5, vals.length - 1); i++) {
      lines.push('  row ' + (i + 1) + ': ' +
                 (String((vals[i] || [])[urlCol] || '').trim() || '(blank)'));
    }
  } catch (e) {
    lines.push('Could not read the guide: ' + e.message);
  }

  // 2. Load entries and show the first 8 with their resolved audioUrl
  try {
    var entries = loadPronunciationGuide();
    var withUrl = entries.filter(function(e) { return e.audioUrl; }).length;
    lines.push('\nEntries loaded: ' + entries.length + ' (' + withUrl + ' with a URL)');
    entries.slice(0, 8).forEach(function(e) {
      lines.push('  ' + e.name + ' → ' + (e.audioUrl || '(no URL found)'));
    });
  } catch (e) {
    lines.push('\nloadPronunciationGuide() threw: ' + e.message);
  }

  ui.alert('Pronunciation Guide Debug', lines.join('\n'), ui.ButtonSet.OK);
}


// ─── Rich-text construction ───────────────────────────────────────────────────

function buildGeneratedLine(entry) {
  var parts = [entry.name];
  if (entry.pronunciation) parts.push('(' + entry.pronunciation + ')');
  if (entry.notes)         parts.push('— ' + entry.notes);
  return { text: parts.join(' '), url: entry.audioUrl };
}

// Rebuilds a cell's rich text with two zones:
//   [manual text] \n\n *** \n [auto-generated lines]
// The manual zone keeps its original formatting and links.
// The auto-generated zone is written fresh each run.
function buildMergedRichText(existingRichText, rawManualText, generatedLines) {
  var manualText = rawManualText.replace(/\s+$/, '');
  var fullText = generatedLines.length > 0
    ? (manualText ? manualText + '\n\n' : '') + PRONUNCIATION_AUTO_MARKER + '\n' +
      generatedLines.map(function(l) { return l.text; }).join('\n')
    : manualText;

  var builder = SpreadsheetApp.newRichTextValue().setText(fullText);

  // Re-apply formatting and links from the manual zone verbatim
  existingRichText.getRuns().forEach(function(run) {
    var start = run.getStartIndex();
    var end   = Math.min(run.getEndIndex(), manualText.length);
    if (start >= manualText.length || start >= end) return;
    var style = run.getTextStyle();
    var url   = run.getLinkUrl();
    if (style) builder.setTextStyle(start, end, style);
    if (url)   builder.setLinkUrl(start, end, url);
  });

  if (generatedLines.length > 0) {
    // Style the *** marker blue + bold so it's easy to spot in the cell
    var markerStart = manualText ? manualText.length + 2 : 0;
    var markerEnd   = markerStart + PRONUNCIATION_AUTO_MARKER.length;
    builder.setTextStyle(markerStart, markerEnd,
      SpreadsheetApp.newTextStyle()
        .setForegroundColor(PRONUNCIATION_MARKER_COLOR)
        .setBold(true)
        .build());

    // Hyperlink each auto-generated line to its audio file
    var offset = markerEnd + 1;
    generatedLines.forEach(function(line) {
      if (line.url) builder.setLinkUrl(offset, offset + line.text.length, line.url);
      offset += line.text.length + 1;
    });
  }

  return builder.build();
}
