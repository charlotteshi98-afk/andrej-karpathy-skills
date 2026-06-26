/**
 * VO Schedule Manager (Incremental Update Edition)
 *
 * Changelog:
 *  - HTML tags stripped from event descriptions; links rendered as plain "(Link: URL)"
 *  - Analytics tab: per-actor billable hours + session efficiency (utilization & lines/hr)
 *  - Avails sheet + Auto-Assign Monitors with PST timezone conversion
 */

// ========== 常量 ==========
const HEADERS = [
  'Date', 'Studio', 'Session ID\nAuto-generated',
  'Time JP\n(UTC+9)', 'Time PST\n(UTC-8)', 'Time SH\n(UTC+8)', 'Time UK\n(BST)',
  'Zoom Link', 'VA', 'Character',
  'Scheduled hours', 'Billable hours', 'Actual duration (min)', 'Notes from Studio', 'Last Updated',
  'Content recorded', 'Marketing content?', 'Session Start (PST)', 'Session End (PST)', 'Monitor Availability',
  'Monitor', 'Director', 'Num of lines recorded', 'Notes', 'Follow-up',
  'Extra'
];

const UPDATE_COLUMNS = 15;              // A-O: system data
const MANUAL_DATA_START_COLUMN = 16;    // P: manual data start
const MANUAL_DATA_END_COLUMN = 26;      // Z: manual data end
const MANUAL_COL_COUNT = MANUAL_DATA_END_COLUMN - MANUAL_DATA_START_COLUMN + 1;
const EVENT_ID_COLUMN = 27;             // AA
const EVENT_ID_HEADER = 'Event ID (System)';
const TOTAL_MANAGED_COLUMNS = EVENT_ID_COLUMN; // 27

const STATUS_CANCELLED = 'Cancelled';
const STATUS_UPDATED = '[Updated]';
const SYSTEM_MANAGED_STATUSES = new Set(['', STATUS_CANCELLED, STATUS_UPDATED]);

const CANCELLED_BG = '#d9d9d9';
const CANCELLED_FONT = '#999999';
const HEADER_BG = '#005d5d';
const HEADER_FONT = '#ffffff';
const ROW_COLORS = ['#ffffff', '#f1f8e9'];
const WEEKEND_BG = '#38761d';
const WEEKEND_FONT = '#ffffff';

const NEW_ROW_DEFAULT_FONT_SIZE = 9;
const NEW_ROW_DEFAULT_FONT_FAMILY = 'Arial';

const NO_SESSION_WEEKEND = 'Happy weekend : )';
const NO_SESSION_WEEKDAY = 'Yay, no sessions today~';
const NO_SESSION_VA_TEXTS = new Set([NO_SESSION_WEEKEND, NO_SESSION_WEEKDAY]);

// basicData column indices (0-based)
const IDX_DATE = 0;
const IDX_STUDIO = 1;
const IDX_SESSION_ID = 2;
const IDX_TIME_JP = 3;
const IDX_TIME_PST = 4;
const IDX_TIME_SH = 5;
const IDX_TIME_UK = 6;
const IDX_ZOOM = 7;
const IDX_VA = 8;
const IDX_CHARACTER = 9;
const IDX_SCHEDULED = 10;
const IDX_BILLABLE = 11;
const IDX_ACTUAL_DURATION = 12;
const IDX_STATUS = 13;       // N — "Notes from Studio"
const IDX_LAST_UPDATED = 14;

// 0-based index for manual columns (relative to full row)
const IDX_MONITOR = 20;           // U column (0-based index 20)
const IDX_LINES_RECORDED = 22;    // W column (0-based index 22)

const CHANGE_DETECTION_INDICES = [
  IDX_DATE, IDX_TIME_JP, IDX_TIME_PST, IDX_TIME_SH, IDX_TIME_UK,
  IDX_ZOOM, IDX_VA, IDX_CHARACTER, IDX_SCHEDULED, IDX_BILLABLE
];

// ========== Avails sheet ==========
const AVAILS_SHEET_NAME = 'Avails';
const AVAILS_HEADERS = ['Name', 'Timezone', 'Date (their local)', 'From (HH:MM local)', 'To (HH:MM local)', 'Max Hours/Day'];
const LINES_PER_HOUR_BENCHMARK = 30;

// Monitor priority: first entry = highest priority; all others are equal.
// Used only as a tiebreaker when two monitors have the same total hours.
const MONITOR_PRIORITY_ORDER = ['Gabe'];
const WARNING_BG = '#ff4444';
const WARNING_FONT = '#ffffff';

// ========== 菜单 ==========
function onOpen() {
  const ui = SpreadsheetApp.getUi();
  ui.createMenu('🎙 VO Schedule Manager (Beta)')
    .addItem('🔄 Update Schedule / 更新日程', 'exportCalendarEventsToScheduleSheet')
    .addSeparator()
    .addItem('📊 Generate Analytics / 生成分析', 'generateAnalytics')
    .addSeparator()
    .addSubMenu(ui.createMenu('👥 Monitor Assignment / 监听分配')
      .addItem('📋 Setup Avails Sheet / 创建排班表', 'ensureAvailsSheet')
      .addItem('🤖 Auto-Assign Monitors / 自动分配监听', 'autoAssignMonitors'))
    .addSeparator()
    .addSubMenu(ui.createMenu('Debug / 调试工具')
      .addItem('Debug Existing Data / 调试现有数据', 'debugExistingData')
      .addItem('Data Integrity Check / 数据完整性检查', 'validateDataIntegrity'))
    .addSeparator()
    .addSubMenu(ui.createMenu('🛠 数据管理')
      .addItem('Backup Data / 备份数据', 'backupCurrentData')
      .addItem('Export JSON / 导出JSON', 'exportDataToJSON')
      .addItem('Batch Update Status / 批量更新状态', 'updateStatusBatch'))
    .addToUi();
}

// ========== 主流程 ==========
function exportCalendarEventsToScheduleSheet() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  const startDate = new Date(sheet.getRange('B2').getValue());
  const endDate = new Date(sheet.getRange('F2').getValue());

  if (isNaN(startDate) || isNaN(endDate)) {
    SpreadsheetApp.getUi().alert('请在 B2 和 F2 中填写有效的起止日期。');
    return;
  }

  console.log('🚀 开始增量刷新排期');

  ensureHeadersAndEventIdColumn(sheet);

  const existing = readExistingRows(sheet);
  console.log(`📖 读取到 ${existing.length} 行现有数据`);

  const existingByEventId = new Map();
  const orphanRows = [];
  const orphanByContentKey = new Map();
  for (const row of existing) {
    if (row.eventId) {
      existingByEventId.set(row.eventId, row);
    } else if (!row.isNoSession) {
      orphanRows.push(row);
      const key = buildContentKey(row.basicData);
      if (key) {
        if (orphanByContentKey.has(key)) {
          console.log(`⚠️ 多行 orphan 命中同一 content key "${key}"，仅首行可被自动迁移`);
        } else {
          orphanByContentKey.set(key, row);
        }
      }
    }
  }

  const events = CalendarApp.getCalendarById('primary').getEvents(startDate, endDate);
  console.log(`📅 查询范围内获取到 ${events.length} 个日历事件`);

  const finalRows = [];
  const processedEventIds = new Set();
  const dedupKeys = new Set();
  const adoptedOrphanRows = new Set();

  events.forEach(event => {
    try {
      const startTime = event.getStartTime();
      const endTime = event.getEndTime();
      if (startTime.getTime() === endTime.getTime() || event.isAllDayEvent()) return;

      const eventId = event.getId();
      if (processedEventIds.has(eventId)) return;
      processedEventIds.add(eventId);

      const freshBasic = buildBasicDataFromEvent(event);
      const isCancelled = isEventCancelled(event);

      const dedupKey = `${freshBasic[IDX_DATE]}|${freshBasic[IDX_TIME_PST]}|${freshBasic[IDX_VA]}|${freshBasic[IDX_CHARACTER]}`;
      if (dedupKeys.has(dedupKey) && !existingByEventId.has(eventId)) return;
      dedupKeys.add(dedupKey);

      let prior = existingByEventId.get(eventId);
      if (!prior) {
        const contentKey = buildContentKey(freshBasic);
        const candidate = contentKey ? orphanByContentKey.get(contentKey) : null;
        if (candidate && !adoptedOrphanRows.has(candidate)) {
          prior = candidate;
          adoptedOrphanRows.add(candidate);
          console.log(`🔗 迁移匹配：把旧行 "${contentKey}" 绑定到 Event ID ${eventId.substring(0, 20)}...`);
        }
      }

      let studioNotes;
      let manualData;
      let manualFormat;

      if (prior) {
        manualData = prior.manualData;
        manualFormat = prior.manualFormat;
        const hasChanges = hasBasicDataChanged(prior.basicData, freshBasic);
        const revivedFromCancelled = prior.isCancelled && !isCancelled;
        const isUpdated = !isCancelled && (hasChanges || revivedFromCancelled);
        studioNotes = buildStudioNotes(event, isUpdated);
      } else {
        manualData = emptyManualData();
        manualFormat = null;
        studioNotes = buildStudioNotes(event, false);
      }

      const basicData = freshBasic.slice();
      basicData[IDX_STATUS] = studioNotes;
      if (prior) {
        const priorActual = prior.basicData[IDX_ACTUAL_DURATION];
        if (priorActual !== '' && priorActual != null) {
          basicData[IDX_ACTUAL_DURATION] = priorActual;
        }
      }

      finalRows.push({
        eventId: eventId,
        basicData: basicData,
        manualData: manualData,
        manualFormat: manualFormat,
        isCancelled: isCancelled,
        isNoSession: false
      });
    } catch (err) {
      console.log(`⚠️ 处理事件时出错（已跳过该事件）: ${err && err.message ? err.message : err}`);
    }
  });

  existingByEventId.forEach((prior, eventId) => {
    if (processedEventIds.has(eventId)) return;

    const dateStr = (prior.basicData[IDX_DATE] || '').toString();
    const resolvedDate = parseDateInRange(dateStr, startDate, endDate);

    if (resolvedDate) {
      const newBasic = prior.basicData.slice();
      finalRows.push({
        eventId: eventId,
        basicData: newBasic,
        manualData: prior.manualData,
        manualFormat: prior.manualFormat,
        isCancelled: true,
        isNoSession: false
      });
    } else {
      finalRows.push({
        eventId: eventId,
        basicData: prior.basicData.slice(),
        manualData: prior.manualData,
        manualFormat: prior.manualFormat,
        isCancelled: prior.isCancelled,
        isNoSession: false
      });
    }
  });

  orphanRows.forEach(row => {
    if (adoptedOrphanRows.has(row)) return;
    finalRows.push({
      eventId: null,
      basicData: row.basicData.slice(),
      manualData: row.manualData,
      manualFormat: row.manualFormat,
      isCancelled: row.isCancelled,
      isNoSession: false
    });
  });

  const activeDateSet = new Set();
  finalRows.forEach(row => {
    if (!row.isCancelled && !row.isNoSession) {
      activeDateSet.add(row.basicData[IDX_DATE]);
    }
  });

  for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
    const dateStr = formatDateToPST(d);
    if (activeDateSet.has(dateStr)) continue;
    const va = isPSTWeekend(d) ? NO_SESSION_WEEKEND : NO_SESSION_WEEKDAY;
    const basicData = new Array(UPDATE_COLUMNS).fill('');
    basicData[IDX_DATE] = dateStr;
    basicData[IDX_STUDIO] = 'SCS';
    basicData[IDX_VA] = va;
    finalRows.push({
      eventId: null,
      basicData: basicData,
      manualData: emptyManualData(),
      manualFormat: null,
      isCancelled: false,
      isNoSession: true
    });
  }

  sortFinalRows(finalRows, startDate, endDate);

  console.log(`✅ 准备写入 ${finalRows.length} 行`);

  writeRowsToSheet(sheet, finalRows);

  const stats = getManualDataStats(sheet);
  console.log(`📊 完成：总 ${stats.totalRows} 行，含手动数据 ${stats.manualDataRows} 行，取消行 ${stats.cancelledRows} 行`);
}

// ========== 读取 ==========

function ensureHeadersAndEventIdColumn(sheet) {
  sheet.getRange(3, 1, 1, HEADERS.length)
    .setValues([HEADERS])
    .setFontWeight('bold')
    .setFontColor(HEADER_FONT)
    .setBackground(HEADER_BG);

  const cell = sheet.getRange(3, EVENT_ID_COLUMN);
  if (cell.getValue() !== EVENT_ID_HEADER) {
    cell.setValue(EVENT_ID_HEADER)
      .setFontWeight('bold')
      .setFontColor(HEADER_FONT)
      .setBackground(HEADER_BG);
  }
  sheet.setFrozenRows(3);
}

function readExistingRows(sheet) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 4) return [];

  const numRows = lastRow - 3;
  const numCols = Math.max(sheet.getLastColumn(), TOTAL_MANAGED_COLUMNS);
  const range = sheet.getRange(4, 1, numRows, numCols);
  const values = range.getValues();
  const formulas = range.getFormulas();

  const manualRange = sheet.getRange(4, MANUAL_DATA_START_COLUMN, numRows, MANUAL_COL_COUNT);
  const mBgs = manualRange.getBackgrounds();
  const mFcs = manualRange.getFontColors();
  const mFws = manualRange.getFontWeights();
  const mFls = manualRange.getFontLines();
  const mFsts = manualRange.getFontStyles();
  const mFszs = manualRange.getFontSizes();
  const mFfs = manualRange.getFontFamilies();
  const mHas = manualRange.getHorizontalAlignments();
  const mVas = manualRange.getVerticalAlignments();
  const mWrs = manualRange.getWrapStrategies();
  const mNfs = manualRange.getNumberFormats();

  const result = [];
  for (let i = 0; i < values.length; i++) {
    const row = values[i];
    const rowFormulas = formulas[i];

    const allEmpty = row.every(cell => cell === '' || cell === null);
    if (allEmpty) continue;

    const basicData = row.slice(0, UPDATE_COLUMNS);

    const dateVal = basicData[IDX_DATE];
    if (dateVal instanceof Date && !isNaN(dateVal.getTime())) {
      basicData[IDX_DATE] = Utilities.formatDate(dateVal, 'America/Los_Angeles', 'MMM-d');
    }

    const mFormula = rowFormulas[IDX_ACTUAL_DURATION];
    if (mFormula && mFormula.charAt(0) === '=') {
      basicData[IDX_ACTUAL_DURATION] = '';
    }

    const manualData = [];
    for (let c = 0; c < MANUAL_COL_COUNT; c++) {
      manualData.push(row[MANUAL_DATA_START_COLUMN - 1 + c] ?? '');
    }

    const manualFormat = {
      backgrounds: mBgs[i].slice(),
      fontColors: mFcs[i].slice(),
      fontWeights: mFws[i].slice(),
      fontLines: mFls[i].slice(),
      fontStyles: mFsts[i].slice(),
      fontSizes: mFszs[i].slice(),
      fontFamilies: mFfs[i].slice(),
      hAligns: mHas[i].slice(),
      vAligns: mVas[i].slice(),
      wrapStrategies: mWrs[i].slice(),
      numberFormats: mNfs[i].slice()
    };

    const eventId = (row[EVENT_ID_COLUMN - 1] || '').toString().trim() || null;
    const vaCell = (basicData[IDX_VA] || '').toString();
    const isNoSession = !eventId && NO_SESSION_VA_TEXTS.has(vaCell);

    const rowBg = sheet.getRange(i + 4, 1).getBackground().toLowerCase();
    const isCancelled = rowBg === CANCELLED_BG.toLowerCase();

    result.push({
      eventId: eventId,
      basicData: basicData,
      manualData: manualData,
      manualFormat: manualFormat,
      isNoSession: isNoSession,
      isCancelled: isCancelled,
      originalRowIndex: i + 4
    });
  }
  return result;
}

function buildContentKey(basicData) {
  const date = (basicData[IDX_DATE] || '').toString().trim();
  const time = (basicData[IDX_TIME_PST] || '').toString().trim();
  const va = (basicData[IDX_VA] || '').toString().trim();
  const character = (basicData[IDX_CHARACTER] || '').toString().trim();
  if (!date || !time || !va) return null;
  return `${date}|${time}|${va}|${character}`;
}

// ========== 处理 ==========

function buildBasicDataFromEvent(event) {
  const startTime = event.getStartTime();
  const endTime = event.getEndTime();
  const titleDetails = parseTitleDetails(event.getTitle());
  const duration = formatDuration(startTime, endTime);

  const basic = new Array(UPDATE_COLUMNS).fill('');
  basic[IDX_DATE] = formatDateToPST(startTime);
  basic[IDX_STUDIO] = 'SCS';
  basic[IDX_SESSION_ID] = '';
  basic[IDX_TIME_JP] = formatTimeRange(startTime, endTime, 'Asia/Tokyo');
  basic[IDX_TIME_PST] = formatTimeRange(startTime, endTime, 'America/Los_Angeles');
  basic[IDX_TIME_SH] = formatTimeRange(startTime, endTime, 'Asia/Shanghai');
  basic[IDX_TIME_UK] = formatTimeRange(startTime, endTime, 'Europe/London');
  basic[IDX_ZOOM] = extractZoomLink(event.getDescription());
  basic[IDX_VA] = titleDetails.voiceActor;
  basic[IDX_CHARACTER] = titleDetails.character;
  basic[IDX_SCHEDULED] = duration;
  basic[IDX_BILLABLE] = duration < 2 ? 2 : duration;
  basic[IDX_ACTUAL_DURATION] = '';
  basic[IDX_STATUS] = '';
  basic[IDX_LAST_UPDATED] = Utilities.formatDate(event.getLastUpdated(), 'America/Los_Angeles', 'yyyy-MM-dd HH:mm:ss');
  return basic;
}

/**
 * Strips HTML from the event description and formats links as plain text.
 * Converts <a href="URL">...</a> → "(Link: URL)"
 * Converts <br> → newline
 * Strips all other HTML tags
 */
function stripHtmlAndFormatLinks(html) {
  if (!html) return '';
  let text = html.replace(/<br\s*\/?>/gi, '\n');
  // Replace anchor tags with plain-text link
  text = text.replace(/<a\s+[^>]*href=["']([^"']+)["'][^>]*>.*?<\/a>/gi, '(Link: $1)');
  // Strip remaining tags
  text = text.replace(/<[^>]+>/g, '');
  // Decode common HTML entities
  text = text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"');
  return text.replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * Builds the N-column text: organiser email + cleaned event description.
 * Appends [Updated] when isUpdated is true.
 */
function buildStudioNotes(event, isUpdated) {
  const organiserEmail = getOrganiserEmail(event);
  const rawDesc = (event.getDescription() || '').trim();

  let desc = stripHtmlAndFormatLinks(rawDesc);

  // Remove cancellation phrases
  const cancelPhrases = [
    'This event has been canceled.',
    'This event has been cancelled.',
    'has been canceled',
    'has been cancelled'
  ];
  cancelPhrases.forEach(p => {
    desc = desc.replace(new RegExp(p, 'gi'), '').trim();
  });

  desc = desc.replace(/\n{3,}/g, '\n\n').trim();

  const parts = [];
  if (organiserEmail) parts.push(organiserEmail);
  if (desc) parts.push(desc);
  if (isUpdated) parts.push(STATUS_UPDATED);

  return parts.join('\n');
}

function getOrganiserEmail(event) {
  try {
    if (typeof Calendar !== 'undefined' && Calendar.Events && event.getId) {
      const rawId = event.getId();
      const eventId = rawId.indexOf('@') !== -1 ? rawId.substring(0, rawId.indexOf('@')) : rawId;
      const adv = Calendar.Events.get('primary', eventId);
      if (adv && adv.organizer && adv.organizer.email) return adv.organizer.email;
    }
  } catch (e) {}
  try {
    if (event.getCreators && event.getCreators().length > 0) return event.getCreators()[0];
  } catch (e) {}
  return '';
}

function isEventCancelled(event) {
  try {
    const description = (event.getDescription() || '').toLowerCase();
    const cancelPhrases = [
      'has been canceled', 'has been cancelled',
      'this event has been canceled', 'this event has been cancelled'
    ];
    for (const p of cancelPhrases) {
      if (description.indexOf(p) !== -1) return true;
    }
    if (event.getMyStatus && event.getMyStatus() === CalendarApp.GuestStatus.NO) return true;
  } catch (e) {}

  try {
    if (typeof Calendar !== 'undefined' && Calendar && Calendar.Events && event.getId) {
      const rawId = event.getId();
      const eventId = rawId.indexOf('@') !== -1 ? rawId.substring(0, rawId.indexOf('@')) : rawId;
      const adv = Calendar.Events.get('primary', eventId);
      if (adv && adv.status === 'cancelled') return true;
    }
  } catch (e) {}
  return false;
}

function hasBasicDataChanged(oldBasic, newBasic) {
  for (const idx of CHANGE_DETECTION_INDICES) {
    const a = (oldBasic[idx] == null ? '' : oldBasic[idx]).toString();
    const b = (newBasic[idx] == null ? '' : newBasic[idx]).toString();
    if (a !== b) return true;
  }
  return false;
}

// ========== 写入 ==========

function writeRowsToSheet(sheet, rows) {
  const lastRow = sheet.getLastRow();

  if (lastRow >= 4) {
    const wipe = sheet.getRange(4, 1, lastRow - 3, TOTAL_MANAGED_COLUMNS);
    wipe.clearContent();
    wipe.clearFormat();
  }

  if (rows.length === 0) return;

  const writeMatrix = rows.map(row => {
    const line = new Array(TOTAL_MANAGED_COLUMNS).fill('');
    for (let i = 0; i < UPDATE_COLUMNS; i++) line[i] = row.basicData[i] ?? '';
    for (let i = 0; i < MANUAL_COL_COUNT; i++) {
      line[MANUAL_DATA_START_COLUMN - 1 + i] = row.manualData[i] ?? '';
    }
    line[EVENT_ID_COLUMN - 1] = row.eventId || '';
    return line;
  });

  sheet.getRange(4, 1, writeMatrix.length, TOTAL_MANAGED_COLUMNS).setValues(writeMatrix);

  let colorIndex = -1;
  let lastDate = null;
  rows.forEach(row => {
    const dateKey = row.basicData[IDX_DATE];
    if (dateKey !== lastDate) {
      colorIndex++;
      lastDate = dateKey;
    }
    row._rowColor = ROW_COLORS[colorIndex % ROW_COLORS.length];
  });

  applySystemFormatting(sheet, rows);
  applyManualFormatting(sheet, rows);

  rows.forEach(r => { delete r._rowColor; });
}

function applySystemFormatting(sheet, rows) {
  const n = rows.length;
  if (n === 0) return;

  const backgroundsFull = new Array(n);
  const fontColorsFull = new Array(n);
  const fontLinesFull = new Array(n);
  const sessionFormulas = new Array(n);
  const needActualFormula = [];
  const weekendVaRowIndexes = [];

  for (let i = 0; i < n; i++) {
    const row = rows[i];
    const rowIndex = i + 4;
    const bg = row.isCancelled ? CANCELLED_BG : row._rowColor;
    const fc = row.isCancelled ? CANCELLED_FONT : '#000000';
    const fl = row.isCancelled ? 'line-through' : 'none';

    backgroundsFull[i] = new Array(TOTAL_MANAGED_COLUMNS).fill(bg);
    fontColorsFull[i] = new Array(TOTAL_MANAGED_COLUMNS).fill(fc);
    fontLinesFull[i] = new Array(TOTAL_MANAGED_COLUMNS).fill(fl);

    if (row.isNoSession || row.isCancelled) {
      sessionFormulas[i] = [''];
    } else {
      sessionFormulas[i] = [
        `=IF(OR(A${rowIndex}="",B${rowIndex}=""),"",` +
        `TEXT(A${rowIndex},"mm.dd.yyyy")&"_"&B${rowIndex}&"_"&` +
        `TEXT(COUNTIFS(A$4:A${rowIndex},A${rowIndex},B$4:B${rowIndex},B${rowIndex}),"00"))`
      ];
    }

    const mVal = row.basicData[IDX_ACTUAL_DURATION];
    if (!row.isNoSession && (mVal === '' || mVal == null)) {
      needActualFormula.push(rowIndex);
    }

    if (row.basicData[IDX_VA] === NO_SESSION_WEEKEND) {
      weekendVaRowIndexes.push(rowIndex);
    }
  }

  const fullRange = sheet.getRange(4, 1, n, TOTAL_MANAGED_COLUMNS);
  fullRange.setBackgrounds(backgroundsFull);
  fullRange.setFontColors(fontColorsFull);
  fullRange.setFontLines(fontLinesFull);

  sheet.getRange(4, 1, n, UPDATE_COLUMNS).setFontSize(9);
  sheet.getRange(4, 1, n, 7).setWrap(true).setHorizontalAlignment('center');
  sheet.getRange(4, 8, n, UPDATE_COLUMNS - 7).setWrap(true).setHorizontalAlignment('center');
  sheet.getRange(4, IDX_ZOOM + 1, n, 1).setWrap(false);
  sheet.getRange(4, IDX_ACTUAL_DURATION + 1, n, 1).setNumberFormat('0');

  weekendVaRowIndexes.forEach(rowIndex => {
    sheet.getRange(rowIndex, IDX_VA + 1)
      .setBackground(WEEKEND_BG)
      .setFontColor(WEEKEND_FONT)
      .setFontWeight('bold');
  });

  sheet.getRange(4, IDX_SESSION_ID + 1, n, 1).setFormulas(sessionFormulas);

  needActualFormula.forEach(rowIndex => {
    sheet.getRange(rowIndex, IDX_ACTUAL_DURATION + 1).setFormula(
      `=IF(AND(R${rowIndex}<>"",S${rowIndex}<>""),(S${rowIndex}-R${rowIndex})*24*60,"")`
    );
  });
}

function applyManualFormatting(sheet, rows) {
  const n = rows.length;
  if (n === 0) return;

  const bgs = new Array(n);
  const fcs = new Array(n);
  const fws = new Array(n);
  const fls = new Array(n);
  const fsts = new Array(n);
  const fszs = new Array(n);
  const ffs = new Array(n);
  const has = new Array(n);
  const vas = new Array(n);
  const wrs = new Array(n);
  const nfs = new Array(n);

  const DEFAULT_WRAP = SpreadsheetApp.WrapStrategy.WRAP;

  for (let i = 0; i < n; i++) {
    const row = rows[i];
    const mf = row.manualFormat;

    if (mf) {
      if (row.isCancelled) {
        bgs[i] = new Array(MANUAL_COL_COUNT).fill(CANCELLED_BG);
        fcs[i] = new Array(MANUAL_COL_COUNT).fill(CANCELLED_FONT);
        fls[i] = new Array(MANUAL_COL_COUNT).fill('line-through');
      } else {
        bgs[i] = mf.backgrounds.slice();
        fcs[i] = mf.fontColors.slice();
        fls[i] = mf.fontLines.slice();
      }
      fws[i] = mf.fontWeights.slice();
      fsts[i] = mf.fontStyles.slice();
      fszs[i] = mf.fontSizes.slice();
      ffs[i] = mf.fontFamilies.slice();
      has[i] = mf.hAligns.slice();
      vas[i] = mf.vAligns.slice();
      wrs[i] = mf.wrapStrategies.slice();
      nfs[i] = mf.numberFormats.slice();
    } else {
      const defBg = row.isCancelled ? CANCELLED_BG : row._rowColor;
      const defFc = row.isCancelled ? CANCELLED_FONT : '#000000';
      const defFl = row.isCancelled ? 'line-through' : 'none';

      bgs[i] = new Array(MANUAL_COL_COUNT).fill(defBg);
      fcs[i] = new Array(MANUAL_COL_COUNT).fill(defFc);
      fls[i] = new Array(MANUAL_COL_COUNT).fill(defFl);
      fws[i] = new Array(MANUAL_COL_COUNT).fill('normal');
      fsts[i] = new Array(MANUAL_COL_COUNT).fill('normal');
      fszs[i] = new Array(MANUAL_COL_COUNT).fill(NEW_ROW_DEFAULT_FONT_SIZE);
      ffs[i] = new Array(MANUAL_COL_COUNT).fill(NEW_ROW_DEFAULT_FONT_FAMILY);
      has[i] = new Array(MANUAL_COL_COUNT).fill('center');
      vas[i] = new Array(MANUAL_COL_COUNT).fill('middle');
      wrs[i] = new Array(MANUAL_COL_COUNT).fill(DEFAULT_WRAP);
      nfs[i] = new Array(MANUAL_COL_COUNT).fill('');
    }
  }

  const rng = sheet.getRange(4, MANUAL_DATA_START_COLUMN, n, MANUAL_COL_COUNT);
  rng.setBackgrounds(bgs);
  rng.setFontColors(fcs);
  rng.setFontLines(fls);
  rng.setFontWeights(fws);
  rng.setFontStyles(fsts);
  rng.setFontSizes(fszs);
  rng.setFontFamilies(ffs);
  rng.setHorizontalAlignments(has);
  rng.setVerticalAlignments(vas);
  rng.setWrapStrategies(wrs);
  rng.setNumberFormats(nfs);
}

// ========== 排序 ==========

function sortFinalRows(rows, startDate, endDate) {
  rows.forEach(r => {
    r._sortDate = parseDateForSort(r.basicData[IDX_DATE], startDate, endDate);
    const rawTime = (r.basicData[IDX_TIME_PST] == null ? '' : r.basicData[IDX_TIME_PST])
      .toString().split(' - ')[0].trim();
    if (r.isNoSession) {
      r._sortTime = '99:99';
    } else {
      r._sortTime = rawTime || '00:00';
    }

    if (!r._sortDate) {
      console.log(`⚠️ 日期无法解析，该行将被排到末尾: dateCell="${r.basicData[IDX_DATE]}" eventId=${r.eventId || 'none'} isCancelled=${r.isCancelled}`);
    }
  });

  rows.sort((a, b) => {
    if (a._sortDate && b._sortDate) {
      const cmp = a._sortDate - b._sortDate;
      if (cmp !== 0) return cmp;
    } else if (a._sortDate && !b._sortDate) {
      return -1;
    } else if (!a._sortDate && b._sortDate) {
      return 1;
    } else {
      const ds = (a.basicData[IDX_DATE] || '').toString().localeCompare((b.basicData[IDX_DATE] || '').toString());
      if (ds !== 0) return ds;
    }
    const ts = a._sortTime.localeCompare(b._sortTime);
    if (ts !== 0) return ts;
    const ea = a.eventId || '';
    const eb = b.eventId || '';
    return ea.localeCompare(eb);
  });

  rows.forEach(r => { delete r._sortDate; delete r._sortTime; });
}

// ========== ANALYTICS ==========

/**
 * Generates (or refreshes) an analytics tab named "[Sheet Name] Analytics".
 * Tables:
 *   1. Billable Hours by Actor
 *   2. Time Utilization (scheduled vs actual)
 *   3. Session Efficiency (lines/hr vs 30-line benchmark)
 */
function generateAnalytics() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const scheduleSheet = ss.getActiveSheet();
  const analyticsName = scheduleSheet.getName() + ' Analytics';

  // Read all session rows from the schedule sheet
  const lastRow = scheduleSheet.getLastRow();
  if (lastRow < 4) {
    SpreadsheetApp.getUi().alert('没有数据可供分析。');
    return;
  }

  const numRows = lastRow - 3;
  const numCols = Math.max(scheduleSheet.getLastColumn(), IDX_LINES_RECORDED + 1);
  const allValues = scheduleSheet.getRange(4, 1, numRows, numCols).getValues();
  const backgrounds = scheduleSheet.getRange(4, 1, numRows, 1).getBackgrounds();

  // Collect active (non-cancelled, non-no-session) sessions with data
  const sessions = [];
  allValues.forEach((row, i) => {
    const va = (row[IDX_VA] || '').toString();
    if (NO_SESSION_VA_TEXTS.has(va)) return;
    if (backgrounds[i][0].toLowerCase() === CANCELLED_BG.toLowerCase()) return;

    const dateStr = (row[IDX_DATE] || '').toString();
    const scheduledHrs = parseFloat(row[IDX_SCHEDULED]) || 0;
    const billableHrs = parseFloat(row[IDX_BILLABLE]) || 0;
    const actualMin = parseFloat(row[IDX_ACTUAL_DURATION]);
    const actualHrs = isNaN(actualMin) ? null : actualMin / 60;
    const linesRaw = parseFloat(row[IDX_LINES_RECORDED]);
    const lines = isNaN(linesRaw) ? null : linesRaw;
    const character = (row[IDX_CHARACTER] || '').toString();

    if (!va || !dateStr) return;

    sessions.push({ dateStr, va, character, scheduledHrs, billableHrs, actualHrs, lines });
  });

  // ── Table 1: Billable Hours by Actor ──
  const actorMap = {};
  sessions.forEach(s => {
    if (!actorMap[s.va]) actorMap[s.va] = { sessions: 0, billable: 0 };
    actorMap[s.va].sessions++;
    actorMap[s.va].billable += s.billableHrs;
  });
  const actorRows = Object.entries(actorMap)
    .sort((a, b) => b[1].billable - a[1].billable)
    .map(([va, d]) => [va, d.sessions, Math.round(d.billable * 100) / 100]);

  // ── Table 2: Time Utilization ──
  const utilizationRows = sessions
    .filter(s => s.actualHrs !== null)
    .map(s => {
      const utilPct = s.scheduledHrs > 0
        ? Math.round((s.actualHrs / s.scheduledHrs) * 100)
        : null;
      let status = '';
      if (utilPct !== null) {
        if (utilPct > 105) status = 'Overrun';
        else if (utilPct >= 85) status = 'On Target';
        else status = 'Underutilized';
      }
      return [
        s.dateStr, s.va, s.character,
        s.scheduledHrs,
        Math.round(s.actualHrs * 100) / 100,
        utilPct !== null ? utilPct + '%' : '',
        status
      ];
    });

  // ── Table 3: Session Efficiency (lines/hr) ──
  const efficiencyRows = sessions
    .filter(s => s.actualHrs !== null && s.lines !== null && s.actualHrs > 0)
    .map(s => {
      const lph = Math.round((s.lines / s.actualHrs) * 10) / 10;
      const vsBenchmark = Math.round(((lph / LINES_PER_HOUR_BENCHMARK) - 1) * 100) + '%';
      const status = lph >= LINES_PER_HOUR_BENCHMARK ? '✅ On/Above' : '⚠️ Below';
      return [
        s.dateStr, s.va, s.character,
        s.lines,
        Math.round(s.actualHrs * 100) / 100,
        lph,
        vsBenchmark,
        status
      ];
    });

  // ── Write to analytics sheet ──
  let analyticsSheet = ss.getSheetByName(analyticsName);
  if (!analyticsSheet) {
    analyticsSheet = ss.insertSheet(analyticsName);
  } else {
    analyticsSheet.clearContents();
    analyticsSheet.clearFormats();
  }

  let writeRow = 1;

  const writeSection = (title, headers, dataRows, noDataMsg) => {
    // Title row
    analyticsSheet.getRange(writeRow, 1).setValue(title)
      .setFontWeight('bold').setFontSize(11).setFontColor(HEADER_FONT)
      .setBackground(HEADER_BG);
    analyticsSheet.getRange(writeRow, 1, 1, headers.length).setBackground(HEADER_BG);
    writeRow++;

    // Header row
    analyticsSheet.getRange(writeRow, 1, 1, headers.length)
      .setValues([headers])
      .setFontWeight('bold')
      .setBackground('#e8f5e9');
    writeRow++;

    if (dataRows.length === 0) {
      analyticsSheet.getRange(writeRow, 1).setValue(noDataMsg).setFontStyle('italic');
      writeRow += 2;
      return;
    }

    analyticsSheet.getRange(writeRow, 1, dataRows.length, headers.length).setValues(dataRows);

    // Zebra stripe
    for (let r = 0; r < dataRows.length; r++) {
      const bg = r % 2 === 0 ? '#ffffff' : '#f1f8e9';
      analyticsSheet.getRange(writeRow + r, 1, 1, headers.length).setBackground(bg);
    }

    // Status column colour for utilization (col 7)
    if (headers[headers.length - 1] === 'Status' && headers.length === 7) {
      for (let r = 0; r < dataRows.length; r++) {
        const status = dataRows[r][6];
        const cell = analyticsSheet.getRange(writeRow + r, 7);
        if (status === 'Overrun') cell.setFontColor('#c00000').setFontWeight('bold');
        else if (status === 'On Target') cell.setFontColor('#2e7d32').setFontWeight('bold');
        else if (status === 'Underutilized') cell.setFontColor('#e65100').setFontWeight('bold');
      }
    }

    // Status column colour for efficiency (col 8)
    if (headers[headers.length - 1] === 'Status' && headers.length === 8) {
      for (let r = 0; r < dataRows.length; r++) {
        const status = dataRows[r][7];
        const cell = analyticsSheet.getRange(writeRow + r, 8);
        if (status.startsWith('✅')) cell.setFontColor('#2e7d32').setFontWeight('bold');
        else cell.setFontColor('#c00000').setFontWeight('bold');
      }
    }

    writeRow += dataRows.length + 2;
  };

  writeSection(
    '📊 Billable Hours by Actor',
    ['VA / Voice Actor', 'Session Count', 'Total Billable Hours'],
    actorRows,
    'No session data found.'
  );

  writeSection(
    '⏱ Time Utilization (Scheduled vs Actual)',
    ['Date', 'VA', 'Character', 'Scheduled (hrs)', 'Actual (hrs)', 'Utilization %', 'Status'],
    utilizationRows,
    'No sessions with actual duration data.'
  );

  writeSection(
    `🎯 Session Efficiency (benchmark: ${LINES_PER_HOUR_BENCHMARK} lines/hr)`,
    ['Date', 'VA', 'Character', 'Lines Recorded', 'Actual Hours', 'Lines/hr', 'vs Benchmark', 'Status'],
    efficiencyRows,
    'No sessions with both lines recorded and actual duration.'
  );

  // Auto-resize columns
  analyticsSheet.autoResizeColumns(1, 8);

  // Add a timestamp note
  analyticsSheet.getRange(writeRow, 1)
    .setValue(`Generated: ${Utilities.formatDate(new Date(), 'America/Los_Angeles', 'yyyy-MM-dd HH:mm:ss')} PST`)
    .setFontStyle('italic').setFontSize(8).setFontColor('#999999');

  SpreadsheetApp.getUi().alert(`✅ Analytics generated in tab: "${analyticsName}"`);
  ss.setActiveSheet(analyticsSheet);
}

// ========== AVAILS SHEET ==========

/**
 * Creates the Avails sheet if it doesn't exist, with headers and timezone dropdown validation.
 */
function ensureAvailsSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(AVAILS_SHEET_NAME);

  if (sheet) {
    SpreadsheetApp.getUi().alert(`"${AVAILS_SHEET_NAME}" sheet already exists.`);
    ss.setActiveSheet(sheet);
    return;
  }

  sheet = ss.insertSheet(AVAILS_SHEET_NAME);

  // Headers
  sheet.getRange(1, 1, 1, AVAILS_HEADERS.length)
    .setValues([AVAILS_HEADERS])
    .setFontWeight('bold')
    .setFontColor(HEADER_FONT)
    .setBackground(HEADER_BG);

  // Instruction row
  sheet.getRange(2, 1).setValue('Example: Jane Smith');
  sheet.getRange(2, 2).setValue('Asia/Tokyo');
  sheet.getRange(2, 3).setValue(new Date());
  sheet.getRange(2, 3).setNumberFormat('yyyy-mm-dd');
  sheet.getRange(2, 4).setValue('09:00');
  sheet.getRange(2, 5).setValue('18:00');
  sheet.getRange(2, 6).setValue(8);
  sheet.getRange(2, 1, 1, AVAILS_HEADERS.length).setFontStyle('italic').setFontColor('#999999');

  // Timezone dropdown
  const tzOptions = [
    'America/Los_Angeles', 'America/New_York', 'America/Chicago', 'America/Denver',
    'Europe/London', 'Europe/Paris', 'Europe/Berlin',
    'Asia/Tokyo', 'Asia/Shanghai', 'Asia/Singapore', 'Asia/Seoul',
    'Australia/Sydney', 'Pacific/Auckland'
  ];
  const tzRule = SpreadsheetApp.newDataValidation()
    .requireValueInList(tzOptions, true)
    .setAllowInvalid(true)
    .build();
  sheet.getRange(3, 2, 100, 1).setDataValidation(tzRule);

  // Date format for column C
  sheet.getRange(3, 3, 100, 1).setNumberFormat('yyyy-mm-dd');

  // Column widths
  sheet.setColumnWidth(1, 150);
  sheet.setColumnWidth(2, 200);
  sheet.setColumnWidth(3, 120);
  sheet.setColumnWidth(4, 150);
  sheet.setColumnWidth(5, 150);
  sheet.setColumnWidth(6, 130);

  // Note about the sheet
  sheet.getRange(1, AVAILS_HEADERS.length + 2)
    .setValue('ℹ️ Enter From/To times in your LOCAL timezone (HH:MM, 24hr). They will be automatically converted to PST.')
    .setFontStyle('italic').setFontColor('#555555').setWrap(true);
  sheet.setColumnWidth(AVAILS_HEADERS.length + 2, 400);

  sheet.setFrozenRows(1);
  ss.setActiveSheet(sheet);
  SpreadsheetApp.getUi().alert(`✅ "${AVAILS_SHEET_NAME}" sheet created. Fill in monitor availabilities, then use "Auto-Assign Monitors".`);
}

// ========== MONITOR AUTO-ASSIGNMENT ==========

/**
 * Converts a local date + time string to a UTC Date object.
 * Uses an iterative adjustment to handle DST correctly.
 */
function localDateTimeToUTC(dateObj, timeStr, timezone) {
  if (!dateObj || !timeStr) return null;
  const parts = timeStr.toString().match(/^(\d{1,2}):(\d{2})$/);
  if (!parts) return null;
  const targetH = parseInt(parts[1], 10);
  const targetM = parseInt(parts[2], 10);

  // Use the date's year/month/day as formatted in the target timezone
  const refDate = dateObj instanceof Date ? dateObj : new Date(dateObj);
  const dateStr = Utilities.formatDate(refDate, timezone, 'yyyy-MM-dd');
  const [year, month, day] = dateStr.split('-').map(Number);

  // Start with a UTC estimate: place the time as if the timezone were UTC
  let utcEstimate = new Date(Date.UTC(year, month - 1, day, targetH, targetM, 0));

  // Iteratively refine: check what local time the estimate produces and adjust
  for (let i = 0; i < 3; i++) {
    const localH = parseInt(Utilities.formatDate(utcEstimate, timezone, 'HH'), 10);
    const localM = parseInt(Utilities.formatDate(utcEstimate, timezone, 'mm'), 10);
    const diffMin = (targetH * 60 + targetM) - (localH * 60 + localM);
    if (diffMin === 0) break;
    utcEstimate = new Date(utcEstimate.getTime() + diffMin * 60 * 1000);
  }

  return utcEstimate;
}

/** Parses "HH:MM" string to minutes since midnight */
function parseTimeToMinutes(timeStr) {
  const m = (timeStr || '').toString().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
}

/**
 * Converts any time value from getValues() to minutes since midnight.
 * Google Sheets stores time cells as a decimal fraction of a day (e.g. 9:00 = 0.375),
 * but may also return a Date object or a "HH:MM" string depending on the cell format.
 */
function timeValueToMinutes(val) {
  if (val === '' || val === null || val === undefined) return null;
  if (typeof val === 'number') {
    // Sheets fractional day: multiply by 24*60 and round
    return Math.round(val * 24 * 60);
  }
  if (val instanceof Date) {
    // Apps Script may return a Date with the time component set
    return val.getHours() * 60 + val.getMinutes();
  }
  if (typeof val === 'string') {
    return parseTimeToMinutes(val);
  }
  return null;
}

/** Returns sort priority for a monitor name (lower = higher priority). */
function getMonitorPriority(name) {
  const idx = MONITOR_PRIORITY_ORDER.indexOf(name);
  return idx === -1 ? MONITOR_PRIORITY_ORDER.length : idx;
}

/** Converts minutes-since-midnight to a "HH:MM" string for use with localDateTimeToUTC */
function minutesToTimeStr(minutes) {
  const h = Math.floor(minutes / 60) % 24;
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** Parses session PST time range "HH:MM - HH:MM" → { start, end } in minutes */
function parseSessionPSTRange(timePSTStr) {
  if (!timePSTStr) return null;
  const parts = timePSTStr.toString().split(' - ');
  if (parts.length !== 2) return null;
  const start = parseTimeToMinutes(parts[0].trim());
  const end = parseTimeToMinutes(parts[1].trim());
  if (start === null || end === null) return null;
  return { start, end };
}

/** Reads monitor availability from the Avails sheet */
function readAvailsData(availsSheet) {
  const lastRow = availsSheet.getLastRow();
  if (lastRow < 3) return []; // row 1 = header, row 2 = example

  const data = availsSheet.getRange(3, 1, lastRow - 2, AVAILS_HEADERS.length).getValues();
  const result = [];

  data.forEach((row) => {
    const name = (row[0] || '').toString().trim();
    const timezone = (row[1] || 'America/Los_Angeles').toString().trim();
    const dateVal = row[2];
    const maxHours = parseFloat(row[5]);

    if (!name || !dateVal) return;

    // Times may arrive as a decimal fraction (0.375 = 09:00), a Date, or a "HH:MM" string
    const fromMinLocal = timeValueToMinutes(row[3]);
    const toMinLocal = timeValueToMinutes(row[4]);
    if (fromMinLocal === null || toMinLocal === null) return;

    const date = dateVal instanceof Date ? dateVal : new Date(dateVal);
    if (isNaN(date.getTime())) return;

    const fromUTC = localDateTimeToUTC(date, minutesToTimeStr(fromMinLocal), timezone);
    const toUTC = localDateTimeToUTC(date, minutesToTimeStr(toMinLocal), timezone);
    if (!fromUTC || !toUTC) return;

    // Get PST date string from the start UTC time
    const pstDateStr = Utilities.formatDate(fromUTC, 'America/Los_Angeles', 'MMM-d');
    const pstStartMin = parseInt(Utilities.formatDate(fromUTC, 'America/Los_Angeles', 'HH'), 10) * 60 +
                        parseInt(Utilities.formatDate(fromUTC, 'America/Los_Angeles', 'mm'), 10);
    const pstEndMin = parseInt(Utilities.formatDate(toUTC, 'America/Los_Angeles', 'HH'), 10) * 60 +
                      parseInt(Utilities.formatDate(toUTC, 'America/Los_Angeles', 'mm'), 10);

    result.push({
      name,
      timezone,
      pstDateStr,
      pstStartMin,
      pstEndMin,
      maxHoursPerDay: isNaN(maxHours) ? 8 : Math.min(maxHours, 8)
    });
  });

  return result;
}

/**
 * Auto-assigns monitors to sessions based on Avails sheet.
 * Rules:
 *   - Monitor must be available during the full session window (PST)
 *   - Monitor cannot be in two overlapping sessions
 *   - Monitor cannot exceed 8 hrs or their stated max hours per day
 * Overwrites column U (Monitor) for all processed sessions.
 * Flags unassigned sessions with a warning style and shows a summary popup.
 */
function autoAssignMonitors() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const scheduleSheet = ss.getActiveSheet();
  const availsSheet = ss.getSheetByName(AVAILS_SHEET_NAME);

  if (!availsSheet) {
    SpreadsheetApp.getUi().alert(`Please create the "${AVAILS_SHEET_NAME}" sheet first via the menu.`);
    return;
  }

  const ui = SpreadsheetApp.getUi();

  const avails = readAvailsData(availsSheet);
  if (avails.length === 0) {
    ui.alert(`No availability data found in the "${AVAILS_SHEET_NAME}" sheet (data starts on row 3).`);
    return;
  }

  // ── Date range prompt ──
  const startResp = ui.prompt(
    'Auto-Assign Monitors — Step 1 of 2',
    'Assign sessions FROM date (yyyy-mm-dd, e.g. 2026-06-17):',
    ui.ButtonSet.OK_CANCEL
  );
  if (startResp.getSelectedButton() !== ui.Button.OK) return;

  const endResp = ui.prompt(
    'Auto-Assign Monitors — Step 2 of 2',
    'Assign sessions TO date (yyyy-mm-dd, e.g. 2026-07-09):',
    ui.ButtonSet.OK_CANCEL
  );
  if (endResp.getSelectedButton() !== ui.Button.OK) return;

  const filterStart = new Date(startResp.getResponseText().trim());
  const filterEnd = new Date(endResp.getResponseText().trim());
  if (isNaN(filterStart.getTime()) || isNaN(filterEnd.getTime())) {
    ui.alert('Invalid date. Please use yyyy-mm-dd format (e.g. 2026-06-17).');
    return;
  }

  const lastRow = scheduleSheet.getLastRow();
  if (lastRow < 4) return;

  const numRows = lastRow - 3;
  const numCols = Math.max(scheduleSheet.getLastColumn(), TOTAL_MANAGED_COLUMNS);
  const allValues = scheduleSheet.getRange(4, 1, numRows, numCols).getValues();
  const backgrounds = scheduleSheet.getRange(4, 1, numRows, 1).getBackgrounds();

  // Collect sessions within the requested date range
  const sessions = [];
  allValues.forEach((row, i) => {
    const va = (row[IDX_VA] || '').toString();
    if (NO_SESSION_VA_TEXTS.has(va)) return;
    if (backgrounds[i][0].toLowerCase() === CANCELLED_BG.toLowerCase()) return;

    const dateStr = formatDateToPST(row[IDX_DATE]);
    if (!dateStr) return;

    // Skip sessions outside the chosen date range
    if (!parseDateInRange(dateStr, filterStart, filterEnd)) return;

    const timePST = (row[IDX_TIME_PST] || '').toString();
    const timeRange = parseSessionPSTRange(timePST);
    if (!timeRange) return;

    // Preserve manual entries — only touch empty cells or previous auto-assign warnings
    const currentMonitor = (row[IDX_MONITOR] || '').toString().trim();
    if (currentMonitor !== '' && currentMonitor !== '⚠️ UNASSIGNED') return;

    sessions.push({
      rowIndex: i + 4,
      dateStr,
      timePST,
      startMin: timeRange.start,
      endMin: timeRange.end,
      durationHours: (timeRange.end - timeRange.start) / 60
    });
  });

  if (sessions.length === 0) {
    ui.alert('No assignable sessions found in that date range.');
    return;
  }

  // Sort by date then start time for greedy assignment
  sessions.sort((a, b) => {
    const dc = a.dateStr.localeCompare(b.dateStr);
    return dc !== 0 ? dc : a.startMin - b.startMin;
  });

  // Per-day tracking (overlap + daily cap)
  const monitorHoursUsed = {};  // `${name}|${date}` → hours used today
  const monitorSlots = {};       // `${name}|${date}` → [{start, end}]
  // Global tracking (for even distribution across the full period)
  const monitorTotalHours = {}; // name → total hours assigned so far

  const assignments = {};
  const unassigned = [];

  sessions.forEach(session => {
    const { dateStr, startMin, endMin, durationHours, rowIndex } = session;

    const candidates = avails.filter(avail => {
      if (avail.pstDateStr !== dateStr) return false;
      if (avail.pstStartMin > startMin || avail.pstEndMin < endMin) return false;

      const key = `${avail.name}|${dateStr}`;
      if ((monitorHoursUsed[key] || 0) + durationHours > avail.maxHoursPerDay) return false;

      const slots = monitorSlots[key] || [];
      if (slots.some(s => s.start < endMin && s.end > startMin)) return false;

      return true;
    });

    if (candidates.length > 0) {
      candidates.sort((a, b) => {
        // Primary: fewest total hours across the whole period (even distribution)
        const totalDiff = (monitorTotalHours[a.name] || 0) - (monitorTotalHours[b.name] || 0);
        if (Math.abs(totalDiff) > 0.001) return totalDiff;
        // Tiebreaker: priority order (Gabe first, then others equally)
        return getMonitorPriority(a.name) - getMonitorPriority(b.name);
      });

      const chosen = candidates[0];
      const key = `${chosen.name}|${dateStr}`;
      assignments[rowIndex] = chosen.name;
      monitorHoursUsed[key] = (monitorHoursUsed[key] || 0) + durationHours;
      monitorTotalHours[chosen.name] = (monitorTotalHours[chosen.name] || 0) + durationHours;
      if (!monitorSlots[key]) monitorSlots[key] = [];
      monitorSlots[key].push({ start: startMin, end: endMin });
    } else {
      unassigned.push(session);
    }
  });

  // Write results to col U (1-indexed = IDX_MONITOR + 1 = 21)
  const MONITOR_COL_1BASED = IDX_MONITOR + 1;

  // Clear existing values + styling for all processed rows
  sessions.forEach(session => {
    scheduleSheet.getRange(session.rowIndex, MONITOR_COL_1BASED)
      .setValue('')
      .setBackground(null)
      .setFontColor('#000000')
      .setFontWeight('normal');
  });

  // Write successful assignments (names are in the dropdown so no validation warning)
  Object.entries(assignments).forEach(([rowIndex, name]) => {
    scheduleSheet.getRange(parseInt(rowIndex), MONITOR_COL_1BASED).setValue(name);
  });

  // Flag unassigned sessions with warning styling
  unassigned.forEach(session => {
    scheduleSheet.getRange(session.rowIndex, MONITOR_COL_1BASED)
      .setValue('⚠️ UNASSIGNED')
      .setBackground(WARNING_BG)
      .setFontColor(WARNING_FONT)
      .setFontWeight('bold');
  });

  // Summary popup — include workload breakdown
  const workloadLines = Object.entries(monitorTotalHours)
    .sort((a, b) => b[1] - a[1])
    .map(([name, hrs]) => `  ${name}: ${Math.round(hrs * 10) / 10} hrs`)
    .join('\n');

  let msg = `✅ Auto-assignment complete!\n\nAssigned: ${Object.keys(assignments).length} session(s)`;
  if (workloadLines) msg += `\n\nWorkload:\n${workloadLines}`;
  if (unassigned.length > 0) {
    msg += `\n\n⚠️ Could not assign monitor to ${unassigned.length} session(s):\n`;
    unassigned.forEach(s => { msg += `  • ${s.dateStr}  ${s.timePST}\n`; });
    msg += '\nCheck the Avails sheet — no monitor was available for these slots.';
  }

  ui.alert(msg);
}

// ========== 辅助 ==========

function formatDateToPST(dateValue) {
  if (!dateValue) return '';
  try {
    if (typeof dateValue === 'string' && dateValue.match(/^[A-Za-z]{3}-\d{1,2}$/)) {
      return dateValue;
    }
    const date = dateValue instanceof Date ? dateValue : new Date(dateValue);
    if (isNaN(date.getTime())) return dateValue.toString();
    return Utilities.formatDate(date, 'America/Los_Angeles', 'MMM-d');
  } catch (error) {
    console.log(`❌ 日期格式化错误: ${dateValue}`);
    return dateValue ? dateValue.toString() : '';
  }
}

function isPSTWeekend(date) {
  if (!date) return false;
  try {
    const dateObj = date instanceof Date ? date : new Date(date);
    const isoDow = parseInt(Utilities.formatDate(dateObj, 'America/Los_Angeles', 'u'), 10);
    return isoDow === 6 || isoDow === 7;
  } catch (error) {
    return false;
  }
}

function parseDateInRange(dateStr, startDate, endDate) {
  if (dateStr instanceof Date) {
    if (isNaN(dateStr.getTime())) return null;
    const sLo = stripTime(startDate);
    const eHi = endOfDay(endDate);
    const d = new Date(dateStr.getFullYear(), dateStr.getMonth(), dateStr.getDate());
    return (d >= sLo && d <= eHi) ? d : null;
  }
  if (!dateStr || typeof dateStr !== 'string') return null;
  const match = dateStr.match(/^([A-Za-z]{3})-(\d{1,2})$/);
  if (!match) return null;
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const month = monthNames.indexOf(match[1]);
  if (month < 0) return null;
  const day = parseInt(match[2], 10);
  if (isNaN(day)) return null;

  const startY = startDate.getFullYear();
  const endY = endDate.getFullYear();
  const sLo = stripTime(startDate);
  const eHi = endOfDay(endDate);
  for (let y = startY; y <= endY; y++) {
    const d = new Date(y, month, day);
    if (d >= sLo && d <= eHi) return d;
  }
  return null;
}

function parseDateForSort(dateStr, startDate, endDate) {
  if (dateStr instanceof Date) {
    if (isNaN(dateStr.getTime())) return null;
    return new Date(dateStr.getFullYear(), dateStr.getMonth(), dateStr.getDate());
  }
  const d = parseDateInRange(dateStr, startDate, endDate);
  if (d) return d;
  if (!dateStr || typeof dateStr !== 'string') return null;
  const match = dateStr.match(/^([A-Za-z]{3})-(\d{1,2})$/);
  if (!match) return null;
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const month = monthNames.indexOf(match[1]);
  const day = parseInt(match[2], 10);
  if (month < 0 || isNaN(day)) return null;
  return new Date(startDate.getFullYear(), month, day);
}

function stripTime(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
}

function endOfDay(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
}

function formatTimeRange(start, end, timeZone) {
  const fmt = 'HH:mm';
  return `${Utilities.formatDate(start, timeZone, fmt)} - ${Utilities.formatDate(end, timeZone, fmt)}`;
}

function formatDuration(start, end) {
  return Math.round((end - start) / 3600000 * 100) / 100;
}

function extractZoomLink(desc) {
  if (!desc) return '';
  const match = desc.match(/https:\/\/[\w./?=-]*zoom\.us\/[^\s]*/i);
  return match ? match[0] : '';
}

function parseTitleDetails(title) {
  const parts = (title || '').split('::').map(s => s.trim());
  let voiceActor = '', character = '';
  if (parts.length >= 3) {
    if (parts.length > 3) {
      console.log(`ℹ️ 标题有 ${parts.length} 段 "::"，仅取最后两段为 VA/Character: "${title}"`);
    }
    voiceActor = parts[parts.length - 2];
    character = parts[parts.length - 1];
  } else if (parts.length === 2) {
    voiceActor = parts[0];
    character = parts[1];
  } else {
    const dashParts = (title || '').split(' - ');
    voiceActor = dashParts[0]?.trim() || '';
    character = dashParts[1]?.trim() || '';
  }
  return { voiceActor, character };
}

function emptyManualData() {
  return new Array(MANUAL_COL_COUNT).fill('');
}

// ========== 调试/管理 ==========

function getManualDataStats(sheet) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 4) return { totalRows: 0, manualDataRows: 0, cancelledRows: 0 };

  const numRows = lastRow - 3;
  const numCols = Math.max(sheet.getLastColumn(), TOTAL_MANAGED_COLUMNS);
  const values = sheet.getRange(4, 1, numRows, numCols).getValues();
  const backgrounds = sheet.getRange(4, 1, numRows, 1).getBackgrounds();

  let manualCount = 0;
  let cancelledCount = 0;
  values.forEach((row, i) => {
    const hasManual = row
      .slice(MANUAL_DATA_START_COLUMN - 1, MANUAL_DATA_END_COLUMN)
      .some(cell => cell !== '' && cell != null);
    if (hasManual) manualCount++;
    if (backgrounds[i][0].toLowerCase() === CANCELLED_BG.toLowerCase()) cancelledCount++;
  });

  return { totalRows: numRows, manualDataRows: manualCount, cancelledRows: cancelledCount };
}

function debugExistingData() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  const stats = getManualDataStats(sheet);
  const rows = readExistingRows(sheet);
  const withEventId = rows.filter(r => r.eventId).length;
  const noSession = rows.filter(r => r.isNoSession).length;
  const orphans = rows.filter(r => !r.eventId && !r.isNoSession).length;

  console.log('=== 📊 数据统计 ===');
  console.log(`总数据行: ${stats.totalRows}`);
  console.log(`  含 Event ID: ${withEventId}`);
  console.log(`  no-session 占位: ${noSession}`);
  console.log(`  手动添加（无ID）: ${orphans}`);
  console.log(`含手动数据（P-Z）: ${stats.manualDataRows}`);
  console.log(`取消行: ${stats.cancelledRows}`);
  console.log(`列布局: A-O 系统基础 (15) | P-Z 手动数据 (11) | AA Event ID`);
}

function validateDataIntegrity() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  const rows = readExistingRows(sheet);
  const issues = [];
  const seenEventIds = new Map();

  rows.forEach(row => {
    const r = row.originalRowIndex;
    if (!row.basicData[IDX_DATE]) issues.push(`第${r}行：缺少日期`);
    if (!row.basicData[IDX_VA]) issues.push(`第${r}行：缺少 VA`);
    const dateStr = (row.basicData[IDX_DATE] || '').toString();
    if (dateStr && !dateStr.match(/^[A-Za-z]{3}-\d{1,2}$/)) {
      issues.push(`第${r}行：日期格式错误 (${dateStr})`);
    }
    if (row.eventId) {
      if (seenEventIds.has(row.eventId)) {
        issues.push(`第${r}行：Event ID 重复（另一行 ${seenEventIds.get(row.eventId)}）`);
      } else {
        seenEventIds.set(row.eventId, r);
      }
    }
  });

  if (issues.length === 0) {
    console.log('✅ 数据完整');
  } else {
    console.log(`❌ 发现 ${issues.length} 个问题：`);
    issues.forEach(msg => console.log('  - ' + msg));
  }
}

function backupCurrentData() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  const timestamp = Utilities.formatDate(new Date(), 'America/Los_Angeles', 'yyyyMMdd_HHmmss');
  const backupSheetName = `Backup_${timestamp}`;

  try {
    const backupSheet = sheet.copyTo(SpreadsheetApp.getActiveSpreadsheet());
    backupSheet.setName(backupSheetName);
    SpreadsheetApp.getUi().alert(`已备份到: ${backupSheetName}`);
    return backupSheetName;
  } catch (error) {
    SpreadsheetApp.getUi().alert(`备份失败: ${error.message}`);
    return null;
  }
}

function exportDataToJSON() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  const lastRow = sheet.getLastRow();

  if (lastRow < 4) {
    SpreadsheetApp.getUi().alert('无数据可导出');
    return;
  }

  const lastCol = Math.max(sheet.getLastColumn(), TOTAL_MANAGED_COLUMNS);
  const headerRow = sheet.getRange(3, 1, 1, lastCol).getValues()[0];
  const data = sheet.getRange(4, 1, lastRow - 3, lastCol).getValues();

  const jsonData = data.map(row => {
    const obj = {};
    headerRow.forEach((header, index) => {
      const key = header || `col_${index + 1}`;
      obj[key] = row[index];
    });
    return obj;
  });

  try {
    const doc = DocumentApp.create(
      `VO_Export_${Utilities.formatDate(new Date(), 'America/Los_Angeles', 'yyyyMMdd_HHmmss')}`
    );
    doc.getBody().setText(JSON.stringify(jsonData, null, 2));
    SpreadsheetApp.getUi().alert(`已导出到: ${doc.getName()}`);
  } catch (error) {
    SpreadsheetApp.getUi().alert(`导出失败: ${error.message}`);
  }
}

function updateStatusBatch() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  const ui = SpreadsheetApp.getUi();

  const response = ui.prompt('批量更新状态', '请输入状态:', ui.ButtonSet.OK_CANCEL);
  if (response.getSelectedButton() !== ui.Button.OK) return;

  const newStatus = response.getResponseText().trim();
  if (!newStatus) {
    ui.alert('请输入有效状态');
    return;
  }

  if (SYSTEM_MANAGED_STATUSES.has(newStatus)) {
    const confirm = ui.alert(
      '注意',
      `"${newStatus}" 是系统管理的状态，下次刷新时可能被自动重置。\n确认继续吗？`,
      ui.ButtonSet.YES_NO
    );
    if (confirm !== ui.Button.YES) return;
  }

  const selection = sheet.getSelection();
  const ranges = selection.getActiveRangeList();
  if (!ranges) {
    ui.alert('请先选择行');
    return;
  }

  let updatedCount = 0;
  ranges.getRanges().forEach(range => {
    for (let i = 0; i < range.getNumRows(); i++) {
      const rowNum = range.getRow() + i;
      if (rowNum >= 4) {
        sheet.getRange(rowNum, IDX_STATUS + 1).setValue(newStatus);
        updatedCount++;
      }
    }
  });

  ui.alert(`已更新 ${updatedCount} 行状态为 "${newStatus}"`);
}
