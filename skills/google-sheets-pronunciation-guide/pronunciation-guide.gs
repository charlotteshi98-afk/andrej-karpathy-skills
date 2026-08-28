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
 * Google Sheets API must be enabled as an Advanced Service so the script
 * can read Drive-file hyperlinks (Insert → Link) from the guide.
 * Enable it: Apps Script editor → Services (+) → Google Sheets API → Add.
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

  // Drive file smart chips store their URL in fields that getRichTextValues()
  // does not expose. We call the Sheets REST API directly with the script's
  // own OAuth token (no separate Advanced Service needed) to read all three
  // locations where Sheets can store a link URL.
  var sheetsHyperlinks = null;
  var sheetsApiError = '';
  try {
    var apiUrl = 'https://sheets.googleapis.com/v4/spreadsheets/' +
      encodeURIComponent(PRONUNCIATION_CONFIG.guideSheetId) +
      '?ranges=' + encodeURIComponent(PRONUNCIATION_CONFIG.guideTabName) +
      '&fields=' + encodeURIComponent(
        'sheets/data/rowData/values/hyperlink,' +
        'sheets/data/rowData/values/textFormatRuns/format/link,' +
        'sheets/data/rowData/values/richTextValue/textRuns/textFormat/link'
      ) +
      '&includeGridData=true';
    var apiResp = UrlFetchApp.fetch(apiUrl, {
      headers: { 'Authorization': 'Bearer ' + ScriptApp.getOAuthToken() },
      muteHttpExceptions: true
    });
    if (apiResp.getResponseCode() !== 200) {
      throw new Error('Sheets API returned HTTP ' + apiResp.getResponseCode() + ': ' +
                      apiResp.getContentText().slice(0, 300));
    } else {
      var resp = JSON.parse(apiResp.getContentText());
      var rowData = (resp.sheets[0].data[0].rowData || []);
      sheetsHyperlinks = rowData.map(function(row) {
        return (row.values || []).map(function(cell) {
          // 1. Plain cell-level hyperlink
          if (cell.hyperlink) return cell.hyperlink;
          // 2. textFormatRuns (older run-level links)
          var runs = cell.textFormatRuns || [];
          for (var r = 0; r < runs.length; r++) {
            var link = runs[r].format && runs[r].format.link;
            if (link && link.uri) return link.uri;
          }
          // 3. richTextValue.textRuns (Drive file smart chips)
          var rtv = cell.richTextValue;
          if (rtv && rtv.textRuns) {
            for (var r2 = 0; r2 < rtv.textRuns.length; r2++) {
              var tf = rtv.textRuns[r2].textFormat;
              if (tf && tf.link && tf.link.uri) return tf.link.uri;
            }
          }
          return '';
        });
      });
    }
  } catch (e) {
    sheetsApiError = e.message;
  }

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

  var entries = [];
  for (var i = headerRowIdx + 1; i < values.length; i++) {
    var name = String(values[i][nameCol] || '').trim();
    if (!name) continue;

    var audioUrl = '';
    var audioDisplayText = '';
    if (audioCol > -1) {
      // Try Sheets API first (handles plain hyperlinks and =HYPERLINK() formulas)
      if (sheetsHyperlinks && sheetsHyperlinks[i] && sheetsHyperlinks[i][audioCol]) {
        audioUrl = sheetsHyperlinks[i][audioCol];
      } else {
        audioUrl = extractCellUrl(richValues[i][audioCol], formulas[i][audioCol]);
      }
      audioDisplayText = String(values[i][audioCol] || '').trim();
    }

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

  // 1. Sheets API availability
  try {
    var testResp = Sheets.Spreadsheets.get(PRONUNCIATION_CONFIG.guideSheetId, {
      fields: 'spreadsheetId'
    });
    lines.push('Sheets API: OK (spreadsheetId=' + testResp.spreadsheetId + ')');
  } catch (e) {
    lines.push('Sheets API ERROR: ' + e.message + ' (DriveApp fallback will be used)');
  }

  // 2. DriveApp search (using the first 5 audio filenames from the guide as a probe)
  try {
    var guideSheet = SpreadsheetApp.openById(PRONUNCIATION_CONFIG.guideSheetId)
                       .getSheetByName(PRONUNCIATION_CONFIG.guideTabName);
    var guideVals  = guideSheet ? guideSheet.getDataRange().getValues() : [];
    var audioColIdx = columnLetterToIndex(PRONUNCIATION_CONFIG.audioLinkColumnFallback) - 1;
    var probeNames = [];
    for (var ri = 1; ri < guideVals.length && probeNames.length < 5; ri++) {
      var txt = String(guideVals[ri][audioColIdx] || '').trim();
      if (txt) probeNames.push(txt);
    }
    lines.push('\nProbing DriveApp for: ' + JSON.stringify(probeNames));
    var driveMap = buildDriveAudioMap(probeNames);
    var driveCount = Object.keys(driveMap).length;
    lines.push('DriveApp matches: ' + driveCount + ' of ' + probeNames.length);
    Object.keys(driveMap).forEach(function(k) { lines.push('  ' + k + ' → ' + driveMap[k]); });
    if (driveCount === 0) lines.push('  → files may be in a Shared Drive not reachable by DriveApp');
  } catch (e) {
    lines.push('\nDriveApp ERROR: ' + e.message);
  }

  // 3. Load entries and show first 8 with their resolved audioUrl
  try {
    var entries = loadPronunciationGuide();
    lines.push('\nEntries loaded: ' + entries.length);
    lines.push('First 8 with audio:');
    var sample = entries.slice(0, 8);
    sample.forEach(function(e) {
      lines.push('  ' + e.name + ' → ' + (e.audioUrl || '(no URL found)'));
    });
  } catch (e) {
    lines.push('\nloadPronunciationGuide() threw: ' + e.message);
  }

  // 3. Raw Sheets API dump for the audio column — shows ALL fields so we can
  //    see exactly where the link is stored regardless of format
  try {
    var resp = Sheets.Spreadsheets.get(PRONUNCIATION_CONFIG.guideSheetId, {
      ranges: [PRONUNCIATION_CONFIG.guideTabName],
      fields: 'sheets/data/rowData/values/hyperlink,' +
              'sheets/data/rowData/values/textFormatRuns/format/link,' +
              'sheets/data/rowData/values/richTextValue/textRuns/textFormat/link,' +
              'sheets/data/rowData/values/formattedValue'
    });
    var rowData = resp.sheets[0].data[0].rowData || [];
    var audioColFallback = columnLetterToIndex(PRONUNCIATION_CONFIG.audioLinkColumnFallback) - 1;
    lines.push('\nRaw Sheets API — audio column (rows 2–9):');
    for (var i = 1; i <= Math.min(8, rowData.length - 1); i++) {
      var row = rowData[i] || {};
      var cell = (row.values || [])[audioColFallback] || {};
      var parts = ['"' + (cell.formattedValue || '') + '"'];
      if (cell.hyperlink)         parts.push('hyperlink=' + cell.hyperlink);
      if (cell.textFormatRuns)    parts.push('textFormatRuns=' + JSON.stringify(cell.textFormatRuns));
      if (cell.richTextValue)     parts.push('richTextValue=' + JSON.stringify(cell.richTextValue));
      if (parts.length === 1)     parts.push('(no link fields found)');
      lines.push('  row ' + (i + 1) + ': ' + parts.join(' | '));
    }
  } catch (e) {
    lines.push('\nRaw dump error: ' + e.message);
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
