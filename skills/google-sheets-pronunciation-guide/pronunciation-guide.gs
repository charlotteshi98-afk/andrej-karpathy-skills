// CONFIGURATION — fill these in before deploying
var SHARED_DRIVE_FOLDER_ID = 'YOUR_SHARED_DRIVE_FOLDER_ID'; // ID of the Drive folder containing audio files
var COLUMN_T = 20; // Column T (1-indexed)
var LAST_ROW_KEY = 'lastProcessedRow';

/**
 * Time-based trigger entry point.
 * Scans new rows in column T, finds words that have matching audio files
 * in the configured Shared Drive folder, and annotates cells with notes
 * containing links to those audio files.
 *
 * Requires: Drive API (Advanced Service) enabled in the Apps Script project.
 */
function addPronunciationNotes() {
  var props = PropertiesService.getScriptProperties();
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();

  var lastProcessed = parseInt(props.getProperty(LAST_ROW_KEY) || '1', 10);
  var lastRow = sheet.getLastRow();

  if (lastRow <= lastProcessed) return;

  var audioMap = buildAudioMap();

  var startRow = lastProcessed + 1;
  var numRows = lastRow - startRow + 1;
  var values = sheet.getRange(startRow, COLUMN_T, numRows, 1).getValues();

  for (var i = 0; i < values.length; i++) {
    var cellText = String(values[i][0]).trim();
    if (!cellText) continue;

    var matchNotes = buildNoteForCell(cellText, audioMap);
    if (matchNotes) {
      sheet.getRange(startRow + i, COLUMN_T).setNote(matchNotes);
    }
  }

  props.setProperty(LAST_ROW_KEY, String(lastRow));
}

function buildNoteForCell(cellText, audioMap) {
  var words = cellText.replace(/[^a-zA-Z\s'\-]/g, ' ').split(/\s+/).filter(Boolean);
  var seen = {};
  var lines = [];

  for (var i = 0; i < words.length; i++) {
    var word = words[i];
    var key = word.toLowerCase();
    if (!seen[key] && audioMap[key]) {
      lines.push(word + ': ' + audioMap[key]);
      seen[key] = true;
    }
  }

  return lines.join('\n');
}

// Returns a map of lowercase-word → Drive file URL for all files in the folder.
function buildAudioMap() {
  var map = {};
  var pageToken = null;

  do {
    var params = {
      q: "'" + SHARED_DRIVE_FOLDER_ID + "' in parents and trashed = false",
      fields: 'nextPageToken, files(id, name)',
      includeItemsFromAllDrives: true,
      supportsAllDrives: true,
      corpora: 'allDrives',
      pageSize: 1000
    };
    if (pageToken) params.pageToken = pageToken;

    var response = Drive.Files.list(params);
    var files = response.files || [];

    for (var i = 0; i < files.length; i++) {
      var baseName = files[i].name.replace(/\.[^.]+$/, '').toLowerCase();
      map[baseName] = 'https://drive.google.com/file/d/' + files[i].id + '/view';
    }

    pageToken = response.nextPageToken;
  } while (pageToken);

  return map;
}

// Run once to register the daily time-based trigger.
function createTrigger() {
  ScriptApp.newTrigger('addPronunciationNotes')
    .timeBased()
    .everyDays(1)
    .create();
}
