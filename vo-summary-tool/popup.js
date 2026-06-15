/* ============================================================
   VO Script Summary Tool — popup.js
   ============================================================ */

'use strict';

/* ── State ─────────────────────────────────────────────────── */
let cnScenes   = [];
let cnFileName = '';
let enLines    = [];
let enFileName = '';
let isCollapsed = false;
let termBaseMap = new Map(); // CN term → EN term

/* ── Structured table data store ────────────────────────────── */
let structuredRows = [];  // [{performId, type, description, lineCount, voCount, storySummary}]
let structuredCols = [0,1,2,3,4,5];
let archives = [];

/* ── On load: restore API key ───────────────────────────────── */
chrome.storage.local.get(['apiKey', 'fontSize', 'structuredCols', 'archives'], (result) => {
  if (result.apiKey) {
    document.getElementById('apiKeyInput').value = result.apiKey;
    updateKeyStatus(true);
  }
  if (result.fontSize) {
    const size = result.fontSize;
    document.documentElement.style.setProperty('--output-font-size', size + 'px');
    document.querySelectorAll('.fsz-btn').forEach(b => {
      b.classList.toggle('active', Number(b.dataset.size) === size);
    });
  }
  if (result.structuredCols) {
    structuredCols = result.structuredCols;
    document.querySelectorAll('#structuredColSelector .col-pill').forEach(p => {
      p.classList.toggle('active', structuredCols.includes(Number(p.dataset.col)));
    });
  }
  archives = result.archives || [];
  renderArchive();
});

document.querySelectorAll('.fsz-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const size = Number(btn.dataset.size);
    document.querySelectorAll('.fsz-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    document.documentElement.style.setProperty('--output-font-size', size + 'px');
    chrome.storage.local.set({ fontSize: size });
  });
});

/* ── Save API key ───────────────────────────────────────────── */
document.getElementById('saveApiKey').addEventListener('click', () => {
  const key = document.getElementById('apiKeyInput').value.trim();
  if (!key) { updateKeyStatus(false); return; }
  chrome.storage.local.set({ apiKey: key }, () => updateKeyStatus(true));
});

function updateKeyStatus(ok) {
  const el = document.getElementById('apiKeyStatus');
  el.textContent = ok ? '✓ saved' : '✗ cleared';
  el.className   = 'key-status ' + (ok ? 'ok' : 'err');
}

/* ── Collapse / expand ──────────────────────────────────────── */
document.getElementById('toggleCollapse').addEventListener('click', () => {
  isCollapsed = !isCollapsed;
  document.getElementById('mainBody').style.display = isCollapsed ? 'none' : '';
  document.getElementById('toggleCollapse').textContent = isCollapsed ? '+' : '−';
});

/* ── Tabs ────────────────────────────────────────────────────── */
document.querySelectorAll('.tab').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    btn.classList.add('active');
    const id = 'tab-' + btn.dataset.tab;
    document.getElementById(id).classList.add('active');
  });
});

/* ── Language toggle (General tab) ─────────────────────────── */
let selectedLang = 'zh';
document.querySelectorAll('.lang-toggle .lang-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    btn.closest('.lang-toggle').querySelectorAll('.lang-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    selectedLang = btn.dataset.lang;
    document.getElementById('enUploadInGeneral').style.display =
      selectedLang === 'en' ? 'block' : 'none';
  });
});

/* ── Pill toggles (General tab) ────────────────────────────── */
document.querySelectorAll('#summaryOptions .pill').forEach(pill => {
  pill.addEventListener('click', () => pill.classList.toggle('active'));
});

/* ── Tooltip positioning (fixed, avoids overflow clipping) ──── */
document.querySelectorAll('.has-tooltip').forEach(wrapper => {
  const popup = wrapper.querySelector('.tooltip-popup');
  if (!popup) return;
  wrapper.addEventListener('mouseenter', () => {
    popup.style.display = 'block';
    const rect = wrapper.getBoundingClientRect();
    const popupWidth = 200;
    let left = rect.left + rect.width / 2 - popupWidth / 2;
    left = Math.max(6, Math.min(left, window.innerWidth - popupWidth - 6));
    popup.style.left = left + 'px';
    popup.style.top  = (rect.top - popup.offsetHeight - 10) + 'px';
  });
  wrapper.addEventListener('mouseleave', () => {
    popup.style.display = 'none';
  });
});

/* ── Column selector (Structured tab) ──────────────────────── */
document.getElementById('structuredColSelector').addEventListener('click', e => {
  const pill = e.target.closest('.col-pill');
  if (!pill) return;
  pill.classList.toggle('active');
  structuredCols = [...document.querySelectorAll('#structuredColSelector .col-pill.active')]
    .map(p => Number(p.dataset.col));
  chrome.storage.local.set({ structuredCols });
  if (structuredRows.length) {
    document.getElementById('structuredTable').innerHTML = renderStructuredTable(structuredRows);
  }
});


/* ── Archive helpers ─────────────────────────────────────────── */
function saveToArchive(source, label, content) {
  const entry = {
    id: Date.now() + Math.random().toString(36).slice(2),
    timestamp: new Date().toISOString(),
    source,
    label,
    content,
  };
  archives.unshift(entry);
  chrome.storage.local.set({ archives });
  renderArchive();
}

function renderArchive() {
  const list  = document.getElementById('archiveList');
  const empty = document.getElementById('archiveEmpty');
  if (!archives.length) {
    list.innerHTML = '';
    empty.style.display = 'block';
    return;
  }
  empty.style.display = 'none';
  const srcClass = { CN: 'cn', EN: 'en', Glossary: 'gls', Structured: 'cn' };
  list.innerHTML = archives.map(e => {
    const ts      = new Date(e.timestamp).toLocaleString();
    const preview = e.content.slice(0, 80).replace(/\n/g, ' ');
    const cls     = srcClass[e.source] || 'cn';
    return `<div class="archive-entry">
      <div class="archive-meta">
        <span class="archive-ts">${ts}</span>
        <span class="archive-source ${cls}">${escapeHtml(e.source)}</span>
        <span class="archive-label" title="${escapeHtml(e.label)}">${escapeHtml(e.label)}</span>
      </div>
      <div class="archive-preview">${escapeHtml(preview)}${e.content.length > 80 ? '…' : ''}</div>
      <div class="archive-full" id="af-${e.id}">${escapeHtml(e.content)}</div>
      <div class="archive-actions">
        <button class="btn-copy archive-view-btn" data-id="${e.id}">View</button>
        <button class="btn-copy archive-del-btn" data-id="${e.id}" style="color:var(--accent3)">Delete</button>
      </div>
    </div>`;
  }).join('');
}

document.getElementById('archiveList').addEventListener('click', e => {
  const viewBtn = e.target.closest('.archive-view-btn');
  const delBtn  = e.target.closest('.archive-del-btn');
  if (viewBtn) {
    const full    = document.getElementById('af-' + viewBtn.dataset.id);
    const showing = full.style.display === 'block';
    full.style.display = showing ? 'none' : 'block';
    viewBtn.textContent = showing ? 'View' : 'Hide';
  }
  if (delBtn) {
    archives = archives.filter(a => a.id !== delBtn.dataset.id);
    chrome.storage.local.set({ archives });
    renderArchive();
  }
});

/* ================================================================
   CN FILE UPLOAD
   ================================================================ */
const cnZone  = document.getElementById('cnUploadZone');
const cnInput = document.getElementById('cnFileInput');

cnZone.addEventListener('click', () => cnInput.click());
cnInput.addEventListener('change', () => {
  if (cnInput.files[0]) handleCNFile(cnInput.files[0]);
});

cnZone.addEventListener('dragover', e => { e.preventDefault(); cnZone.classList.add('drag-over'); });
cnZone.addEventListener('dragleave', () => cnZone.classList.remove('drag-over'));
cnZone.addEventListener('drop', e => {
  e.preventDefault();
  cnZone.classList.remove('drag-over');
  const f = e.dataTransfer.files[0];
  if (f) handleCNFile(f);
});

function handleCNFile(file) {
  cnFileName = file.name;
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      cnScenes = parseCNScript(e.target.result);
      cnZone.classList.add('has-file');
      cnZone.querySelector('.upload-label').textContent = file.name;
      cnZone.querySelector('.upload-icon').textContent = '✓';
      renderCNMeta();
    } catch (err) {
      showError('cnUploadZone', err.message);
    }
  };
  reader.readAsArrayBuffer(file);
}

function renderCNMeta() {
  const el = document.getElementById('cnMeta');
  el.style.display = 'flex';
  const totalVO = cnScenes.reduce((s, sc) => s + sc.lines.filter(l => l.hasVO).length, 0);
  const totalLines = cnScenes.reduce((s, sc) => s + sc.lines.length, 0);
  el.innerHTML = `
    <span class="meta-chip gold">${cnScenes.length} scenes</span>
    <span class="meta-chip gold">${totalLines} lines</span>
    <span class="meta-chip gold">${totalVO} VO lines</span>
    <span class="meta-chip">${cnFileName}</span>
  `;
}

/* ================================================================
   EN FILE UPLOAD
   ================================================================ */
const enZone  = document.getElementById('enUploadZone');
const enInput = document.getElementById('enFileInput');

enZone.addEventListener('click', () => enInput.click());
enInput.addEventListener('change', () => {
  if (enInput.files[0]) handleENFile(enInput.files[0]);
});

enZone.addEventListener('dragover', e => { e.preventDefault(); enZone.classList.add('drag-over'); });
enZone.addEventListener('dragleave', () => enZone.classList.remove('drag-over'));
enZone.addEventListener('drop', e => {
  e.preventDefault();
  enZone.classList.remove('drag-over');
  const f = e.dataTransfer.files[0];
  if (f) handleENFile(f);
});

function handleENFile(file) {
  enFileName = file.name;
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      enLines = parseENTracker(e.target.result);
      enZone.classList.add('has-file');
      enZone.querySelector('.upload-label').textContent = file.name;
      enZone.querySelector('.upload-icon').textContent = '✓';
      renderENMeta();
    } catch (err) {
      setError('generalError', err.message);
    }
  };
  reader.readAsArrayBuffer(file);
}

function renderENMeta() {
  const el = document.getElementById('enMeta');
  el.style.display = 'flex';
  el.innerHTML = `
    <span class="meta-chip gold">${enLines.length} VO lines</span>
    <span class="meta-chip">${escapeHtml(enFileName)}</span>
  `;
}

/* ── Scan EN tracker from the Google Sheet in the current tab ── */
document.getElementById('scanSheetBtn').addEventListener('click', async () => {
  setError('generalError', '');
  const btn = document.getElementById('scanSheetBtn');
  setBusy(btn, true);
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const idMatch = tab && tab.url
      ? tab.url.match(/docs\.google\.com\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/)
      : null;
    if (!idMatch) {
      throw new Error('The current tab is not a Google Sheet. Open the EN tracker sheet in the active tab, then click Scan again.');
    }
    const sheetId  = idMatch[1];
    const gidMatch = tab.url.match(/[#?&]gid=(\d+)/);
    const gid      = gidMatch ? gidMatch[1] : '0';

    // Fetch the CSV by injecting a fetch() call inside the Google Sheets tab itself.
    // This avoids the CORS restriction that blocks the same request from the side panel.
    const csvUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&gid=${gid}`;
    let injected;
    try {
      injected = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: async (url) => {
          const r = await fetch(url, { credentials: 'include' });
          if (!r.ok) return { ok: false, status: r.status };
          const text = await r.text();
          if (/^\s*<(!DOCTYPE|html)/i.test(text)) return { ok: false, status: 401 };
          return { ok: true, text };
        },
        args: [csvUrl],
      });
    } catch (e) {
      throw new Error(`Could not inject into the Google Sheet tab: ${e.message}. Fix: make sure the tab is fully loaded and the extension has been reloaded at chrome://extensions after the latest update.`);
    }

    const result = injected[0]?.result;
    if (!result || !result.ok) {
      if (result?.status === 401 || result?.status === 403) {
        throw new Error('Google denied access to this sheet (HTTP ' + result.status + '). Fix: make sure you are signed in to Google in this browser and your account can open the sheet, then try again.');
      }
      if (result?.status === 404) {
        throw new Error('Sheet not found (HTTP 404). Fix: check the sheet still exists and the tab URL is correct.');
      }
      throw new Error(`Could not read sheet data (HTTP ${result?.status ?? '?'}). Fix: reload the sheet tab, then try again.`);
    }
    enLines = parseENTracker(new TextEncoder().encode(result.text).buffer);
    if (!enLines.length) {
      throw new Error('No VO lines found on this sheet tab. Check that the visible tab contains the EN tracker with a "VO ID" column.');
    }
    enFileName = (tab.title || 'Google Sheet').replace(/ - Google (Sheets|表格)$/, '');
    renderENMeta();
  } catch (err) {
    setError('generalError', err.message);
  } finally {
    setBusy(btn, false);
  }
});

/* ================================================================
   TERM BASE UPLOAD
   ================================================================ */
const tbZone  = document.getElementById('tbUploadZone');
const tbInput = document.getElementById('tbFileInput');

tbZone.addEventListener('click', () => tbInput.click());
tbInput.addEventListener('change', () => { if (tbInput.files[0]) handleTBFile(tbInput.files[0]); });
tbZone.addEventListener('dragover', e => { e.preventDefault(); tbZone.classList.add('drag-over'); });
tbZone.addEventListener('dragleave', () => tbZone.classList.remove('drag-over'));
tbZone.addEventListener('drop', e => {
  e.preventDefault();
  tbZone.classList.remove('drag-over');
  const f = e.dataTransfer.files[0];
  if (f) handleTBFile(f);
});

function handleTBFile(file) {
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const wb = XLSX.read(e.target.result, { type: 'array' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
      termBaseMap = new Map(
        rows.slice(1)  // skip header row
          .map(r => [String(r[0] || '').trim(), String(r[1] || '').trim()])
          .filter(([cn]) => cn)
      );
      tbZone.classList.add('has-file');
      tbZone.querySelector('.upload-label').textContent = file.name;
      tbZone.querySelector('.upload-icon').textContent = '✓';
      const meta = document.getElementById('tbMeta');
      meta.style.display = 'flex';
      meta.innerHTML = `<span class="meta-chip gold">${termBaseMap.size} terms loaded</span><span class="meta-chip">${file.name}</span>`;
    } catch (err) {
      setError('glossaryError', 'Term base parse error: ' + err.message);
    }
  };
  reader.readAsArrayBuffer(file);
}

/* ================================================================
   PARSERS
   ================================================================ */
function parseCNScript(arrayBuffer) {
  const wb = XLSX.read(arrayBuffer, { type: 'array' });
  const sheetName = wb.SheetNames.find(n => n.includes('总台本')) || wb.SheetNames[0];
  const ws = wb.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

  // Locate the header row (the one whose cells include the label "PerformID").
  let headerIdx = -1;
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].some(cell => String(cell).trim() === 'PerformID')) { headerIdx = i; break; }
  }
  if (headerIdx === -1) {
    for (let i = 0; i < rows.length; i++) {
      if (rows[i].some(cell => String(cell).includes('PerformID'))) { headerIdx = i; break; }
    }
  }
  if (headerIdx === -1) throw new Error('Could not find header row with PerformID');

  // Map column labels -> indices so we adapt to layouts where columns shift
  // (e.g. the voiced 【配音部分】 sheet has an extra VOID column that pushes
  // Textmap from C to D). Fall back to the documented positions if a label
  // is missing.
  const colMap = {};
  rows[headerIdx].forEach((cell, j) => {
    const label = String(cell).trim();
    if (label && !(label in colMap)) colMap[label] = j;
  });
  const col = (label, fallback) => (label in colMap ? colMap[label] : fallback);
  const cName    = col('Name', 1);
  const cText    = col('Textmap', 2);
  const cComment = col('Comment', 4);
  const cPID     = col('PerformID', 7);
  const cVOID    = col('VOID', col('音频序号（通用）', col('音频序号', 23)));

  const get = (row, idx) =>
    String(idx != null && row[idx] != null ? row[idx] : '').trim();
  const isPID = pid => /^\d+$/.test(pid);
  // A VO ID cell is valid only if non-empty and not a Chinese label (header bleed)
  const isValidVOID = val => val !== '' && !/^[一-鿿]/.test(val);

  const scenes = [];

  if (sheetName.includes('总台本')) {
    // MASTER layout: a numeric PerformID marks a new scene-header row.
    let currentScene = null;
    for (let i = headerIdx + 1; i < rows.length; i++) {
      const row  = rows[i];
      const name = get(row, cName);
      const text = get(row, cText);
      const pid  = get(row, cPID);
      if (isPID(pid)) {
        currentScene = { performId: pid, type: name, description: text, lines: [] };
        scenes.push(currentScene);
      } else if (currentScene && (name || text)) {
        currentScene.lines.push({
          speaker: name || '[narration]',
          text,
          hasVO:   isValidVOID(get(row, cVOID)),
          comment: get(row, cComment),
        });
      }
    }
  } else {
    // VOICED layout: a row with a numeric PerformID in col 8 is a scene
    // header whose Name=type and Textmap=title. If the header row itself
    // has a VOID it is a single-line scene (Tips/Ongoing one-liners) and
    // no following rows belong to it. If the header has no VOID it is a
    // multi-line scene (GAL) and subsequent non-PID rows are its lines.
    let currentScene = null;
    let multiLine    = false;
    for (let i = headerIdx + 1; i < rows.length; i++) {
      const row     = rows[i];
      const name    = get(row, cName);
      const text    = get(row, cText);
      const pid     = get(row, cPID);
      const voidVal = get(row, cVOID);
      if (isPID(pid)) {
        const hasVO = isValidVOID(voidVal);
        currentScene = { performId: pid, type: name, description: text, lines: [] };
        scenes.push(currentScene);
        if (hasVO) {
          // Single-line scene: the header row IS the only voiced line
          currentScene.lines.push({
            speaker: name || '[narration]',
            text,
            hasVO:   true,
            comment: get(row, cComment),
          });
          multiLine = false;
        } else {
          multiLine = true;
        }
      } else if (currentScene && multiLine && (name || text)) {
        currentScene.lines.push({
          speaker: name || '[narration]',
          text,
          hasVO:   isValidVOID(voidVal),
          comment: get(row, cComment),
        });
      }
    }
  }

  return scenes;
}

function parseENTracker(arrayBuffer) {
  const wb = XLSX.read(arrayBuffer, { type: 'array' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

  let headerIdx = -1;
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].some(cell => String(cell).includes('VO ID'))) {
      headerIdx = i;
      break;
    }
  }

  const colMap = {};
  if (headerIdx !== -1) {
    rows[headerIdx].forEach((cell, j) => {
      const label = String(cell).trim();
      if (label && !(label in colMap)) colMap[label] = j;
    });
  }
  const col = (label, fallback) => (label in colMap ? colMap[label] : fallback);
  const isValidVOID = val => val !== '' && !/^[一-鿿]/.test(val);

  const cVoId  = col('VO ID', 1);
  const cCharCHS = col('角色（中文）', col('CharCHS', 2));
  const cChar  = col('Character', 3);
  const cNotes = col('Performance Notes', col('性能备注', 8));
  const cCN    = col('Chinese Script', col('中文台词', 9));
  const cEN    = col('English Script', col('英文台词', 10));
  const cLatestEN = col('Latest EN', col('最新英文', 19));
  const cVOID  = col('VOID', col('音频序号（通用）', col('音频序号', 23)));
  const cPID   = col('PerformID', 25);

  const lines = [];
  const start = headerIdx === -1 ? 1 : headerIdx + 1;
  const get = (row, idx) => String(idx != null && row[idx] != null ? row[idx] : '').trim();
  for (let i = start; i < rows.length; i++) {
    const row  = rows[i];
    const voId = get(row, cVoId);
    if (!voId || !isValidVOID(voId)) continue;
    lines.push({
      voId,
      charCHS:          get(row, cCharCHS),
      character:        get(row, cChar),
      chineseScript:    get(row, cCN),
      englishScript:    get(row, cEN),
      latestEN:         get(row, cLatestEN),
      performanceNotes: get(row, cNotes),
      performId:        get(row, cPID),
    });
  }
  return lines;
}

/* ================================================================
   UTILITIES
   ================================================================ */
function buildScriptDigest(scenes) {
  return scenes.map((scene, idx) => {
    const lines = scene.lines.map(l => {
      const prefix = l.hasVO ? '[VO]  ' : '      ';
      return `${prefix}${l.speaker}: ${l.text}`;
    }).join('\n');
    return `=== 场景${idx + 1} [PID:${scene.performId}] ===\n[${scene.type}] ${scene.description}\n${lines}`;
  }).join('\n\n');
}

function setError(id, msg) {
  const el = document.getElementById(id);
  if (!msg) { el.style.display = 'none'; el.textContent = ''; return; }
  el.textContent = msg;
  el.style.display = 'block';
}

function setBusy(btn, busy, originalHTML) {
  if (busy) {
    btn._originalHTML = btn.innerHTML;
    btn.innerHTML = '<span class="btn-spinner"></span>Generating…';
    btn.disabled  = true;
  } else {
    btn.innerHTML = originalHTML !== undefined ? originalHTML : btn._originalHTML;
    btn.disabled  = false;
  }
}

/* ── Claude API ─────────────────────────────────────────────── */
async function callClaude(systemPrompt, userPrompt) {
  const { apiKey } = await chrome.storage.local.get(['apiKey']);
  if (!apiKey) throw new Error('No API key saved. Please enter your key above.');

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model:      'claude-sonnet-4-5',
      max_tokens: 4096,
      system:     systemPrompt,
      messages:   [{ role: 'user', content: userPrompt }],
    }),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    const detail = err.error?.message || '';
    if (response.status === 401) {
      throw new Error('API key rejected (401). Fix: re-enter a valid Anthropic API key in the bar above and click Save.');
    }
    if (response.status === 429) {
      throw new Error('Rate limit reached (429). Fix: wait about a minute, then try again. For large scripts, generate one feature at a time.');
    }
    if (response.status === 529 || response.status === 503) {
      throw new Error('Claude API is overloaded right now. Fix: wait a moment and try again.');
    }
    throw new Error(`Claude API error ${response.status}${detail ? `: ${detail}` : ''}. Fix: try again; if it persists, check your API key and network.`);
  }

  const data = await response.json();
  return data.content[0].text;
}

/* Strip markdown decoration (asterisks, pound headers) the model may emit */
function stripMarkdown(text) {
  return text
    .replace(/^#{1,6}\s*/gm, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*\n]+)\*/g, '$1')
    .replace(/^\s*[-*]\s+/gm, '· ');
}

/* ── Type badge helper ──────────────────────────────────────── */
function typeBadge(type) {
  if (!type) return '<span class="type-badge type-other">—</span>';
  const t = type.toLowerCase();
  let cls = 'type-other';
  if (/^gal/i.test(t))    cls = 'type-gal';
  else if (/bubble/i.test(t)) cls = 'type-bubble';
  else if (/主城/.test(type))  cls = 'type-main';
  return `<span class="type-badge ${cls}">${escapeHtml(type)}</span>`;
}

function autoResize(textarea) {
  textarea.style.height = 'auto';
  textarea.style.height = textarea.scrollHeight + 'px';
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function parsePipeRow(line) {
  return line.split('|').map(s => s.trim());
}

/* ================================================================
   FEATURE 1 — GENERAL SUMMARY
   ================================================================ */
document.getElementById('generateGeneral').addEventListener('click', async () => {
  const usingEN = selectedLang === 'en';
  // English without a tracker falls back to translating from the CN script
  const enFromCN = usingEN && !enLines.length;
  if ((!usingEN || enFromCN) && !cnScenes.length) {
    setError('generalError', usingEN
      ? 'No EN tracker loaded and no CN script uploaded. Fix: scan/upload the EN tracker, or upload the CN script so the summary can be translated from it.'
      : 'Please upload a CN script first.');
    return;
  }
  setError('generalError', '');

  const btn = document.getElementById('generateGeneral');
  const genProgress = document.getElementById('generalProgress');
  setBusy(btn, true);
  genProgress.textContent = 'Generating summary…';
  genProgress.style.display = 'block';

  try {
    const length  = document.getElementById('summaryLength').value;
    const activePills = [...document.querySelectorAll('#summaryOptions .pill.active')]
      .map(p => p.dataset.opt);
    const optionLabels = {
      characters: 'Characters & relationships',
      plot:        'Key plot events',
      themes:      'Themes & tone',
      vo:          'VO content summary',
    };
    const selectedOptions = activePills.map(k => optionLabels[k]).join(', ') || 'general overview';

    const styleRules = `- Plain text only: no markdown, no asterisks, no pound signs. Mark section headers with a line like 【Section Name】
- Write in natural, flowing prose — full sentences and short paragraphs, not fragmented bullet lists
- Be specific and actionable — avoid vague or generic observations
- No preamble, no meta-commentary`;

    let digest, systemPrompt;
    if (usingEN && !enFromCN) {
      digest = enLines.map(l => `[${l.voId}] ${l.character}: ${l.latestEN || l.englishScript}`).join('\n');
      systemPrompt = `You are a senior game localization producer and expert script analyst specializing in English voice-over production. Your task is to write a concise, production-ready script analysis brief for professional voice actors and directors preparing for a recording session.

Analyze the provided VO script digest and summarize the key content in approximately ${length} words.

Focus exclusively on: ${selectedOptions}.

Output requirements:
- Write entirely in English
${styleRules}`;
    } else if (enFromCN) {
      digest = buildScriptDigest(cnScenes);
      const glossaryRef = termBaseMap.size > 0
        ? `\n\nReference glossary — always use these established English translations:\n${[...termBaseMap.entries()].map(([cn, en]) => `${cn} → ${en}`).join('\n')}`
        : '\n\nNote: no reference glossary is loaded, so name and term translations are provisional and may need unification later.';
      systemPrompt = `You are a senior game localization producer and expert script analyst specializing in English voice-over production. The source script is in Chinese; no English translation exists yet. Write the analysis brief in English, translating names and terms as you go.

Analyze the provided VO script digest and summarize the key content in approximately ${length} words.

Focus exclusively on: ${selectedOptions}.

Output requirements:
- Write entirely in English
${styleRules}
- After the brief, add a final section 【Terms needing unified translation】 listing every character name or key term that is NOT covered by the reference glossary, one per line as: CN term — provisional English translation used. If everything is covered, write "None".${glossaryRef}`;
    } else {
      digest = buildScriptDigest(cnScenes);
      systemPrompt = `You are a senior game localization producer and expert script analyst specializing in English voice-over production. Your task is to write a comprehensive script analysis brief for professional voice actors and directors preparing for a recording session.

Analyze the provided VO script digest and produce a structured report of approximately ${length} words.

Focus exclusively on: ${selectedOptions}.

Output requirements:
- Write entirely in Simplified Chinese (简体中文)
${styleRules}

The analysis should help a recording team immediately understand performance expectations, character nuances, and any technical or narrative considerations relevant to the session.`;
    }

    const text = stripMarkdown(await callClaude(systemPrompt, digest));
    const ta = document.getElementById('generalText');
    ta.value = text;
    document.getElementById('generalOutputLabel').textContent = 'Summary';
    document.getElementById('generalOutput').style.display = 'block';
    requestAnimationFrame(() => autoResize(ta));
    document.getElementById('saveGeneralToArchive').style.display = '';
  } catch (err) {
    setError('generalError', err.message);
  } finally {
    genProgress.style.display = 'none';
    setBusy(btn, false);
  }
});

document.getElementById('saveGeneralToArchive').addEventListener('click', () => {
  const src   = selectedLang === 'en' ? 'EN' : 'CN';
  const fname = selectedLang === 'en' ? enFileName : cnFileName;
  const kind  = document.getElementById('generalOutputLabel').textContent || 'Summary';
  saveToArchive(src, `${fname} — ${kind}`, document.getElementById('generalText').value);
});

document.getElementById('copyGeneral').addEventListener('click', () => {
  const txt = document.getElementById('generalText').value;
  navigator.clipboard.writeText(txt).then(() => {
    const btn = document.getElementById('copyGeneral');
    btn.textContent = 'Copied!';
    setTimeout(() => { btn.textContent = 'Copy'; }, 1500);
  });
});

/* ── Comprehensive Analysis (two-stage map-reduce) ──────────── */

// Split a long digest into segments of roughly maxChars, breaking on
// scene boundaries (=== markers) where possible, otherwise on newlines.
function splitIntoSegments(digestText, maxChars = 6000) {
  const blocks = digestText.includes('=== ')
    ? digestText.split(/\n\n(?==== )/)
    : digestText.split('\n');
  const segments = [];
  let current = '';
  for (const block of blocks) {
    if (current && current.length + block.length > maxChars) {
      segments.push(current);
      current = block;
    } else {
      current = current ? current + '\n\n' + block : block;
    }
  }
  if (current) segments.push(current);
  return segments;
}

document.getElementById('generateComprehensive').addEventListener('click', async () => {
  const usingEN = selectedLang === 'en';
  // English without a tracker falls back to translating from the CN script
  const enFromCN = usingEN && !enLines.length;
  if ((!usingEN || enFromCN) && !cnScenes.length) {
    setError('generalError', usingEN
      ? 'No EN tracker loaded and no CN script uploaded. Fix: scan/upload the EN tracker, or upload the CN script so the analysis can be translated from it.'
      : 'Please upload a CN script first.');
    return;
  }
  setError('generalError', '');

  const btn      = document.getElementById('generateComprehensive');
  const progress = document.getElementById('comprehensiveProgress');
  setBusy(btn, true);

  try {
    const digest = (usingEN && !enFromCN)
      ? enLines.map(l => `[${l.voId}] ${l.character}: ${l.latestEN || l.englishScript}`).join('\n')
      : buildScriptDigest(cnScenes);

    const glossaryRef = enFromCN && termBaseMap.size > 0
      ? `\n\nReference glossary — always use these established English translations:\n${[...termBaseMap.entries()].map(([cn, en]) => `${cn} → ${en}`).join('\n')}`
      : '';

    // Stage 1: summarize each segment
    const segments = splitIntoSegments(digest);
    const segPrompt = usingEN
      ? `You are a script analyst. Summarize this voice-over script segment in 100-150 English words, covering plot events, characters, emotional beats, and tone. Write in plain prose with no markdown formatting. Return ONLY the summary.${enFromCN ? ' The segment is in Chinese; write the summary in English.' + glossaryRef : ''}`
      : '你是一名剧本分析师。请用100-150个中文字总结这段配音剧本片段，涵盖剧情事件、角色、情感节奏与基调。使用自然流畅的纯文本，不要使用任何markdown符号。只输出总结内容。';

    const segSummaries = [];
    progress.style.display = 'block';
    for (let i = 0; i < segments.length; i++) {
      progress.textContent = `Analyzing segment ${i + 1}/${segments.length}…`;
      segSummaries.push(await callClaude(segPrompt, segments[i]));
    }

    // Stage 2: comprehensive analysis from segment summaries
    progress.textContent = 'Writing comprehensive analysis…';
    const langLine = usingEN
      ? '- Output in English to match the segment summaries'
      : '- Output in Chinese to match the segment summaries';
    const storyPrompt = `You are a master script analyst creating a comprehensive, in-depth analysis of a voice-over script for professional actors, directors, and literature scholars.

Create a detailed analytical summary from these segment summaries that thoroughly examines:

1. Narrative Structure and Plot Progression:
   - Analyze the complete narrative arc with all key plot points
   - Identify inciting incidents, rising action, climax, falling action, and resolution
   - Map the causal relationships between events
   - Examine narrative techniques (flashbacks, foreshadowing, parallel storylines)

2. Thematic Analysis:
   - Identify and explore all major and minor themes
   - Analyze how themes develop, intersect, and evolve
   - Examine philosophical questions or moral dilemmas posed
   - Connect themes to broader cultural, historical, or existential contexts

3. Character Development and Psychology:
   - Analyze the psychological complexity of major characters
   - Map character arcs, transformations, and internal conflicts
   - Examine relationship dynamics and interpersonal tensions
   - Identify character motivations, desires, fears, and contradictions

4. Setting, Atmosphere, and Symbolic Elements:
   - Analyze the worldbuilding and environmental elements
   - Examine how setting influences character and plot
   - Identify symbolic imagery, motifs, and recurring patterns
   - Explore atmospheric elements that create emotional resonance

5. Narrative Voice and Stylistic Approach:
   - Analyze the narrative perspective and tonal qualities
   - Identify distinctive stylistic features or linguistic patterns
   - Examine dialogue characteristics and communication styles
   - Discuss artistic influences or genre conventions

IMPORTANT:
${langLine}
- Provide a comprehensive, richly detailed analysis (maximum 1500-2000 characters)
- Include nuanced interpretations that go beyond surface-level observations
- Ensure all your sentences are complete with proper conclusions
- Structure your analysis with clear sections and logical progression
- Plain text only: no markdown, no asterisks, no pound signs. Mark section headers with a line like 【Section Name】
- Write in natural, flowing prose — full sentences and readable paragraphs, not fragmented bullet lists${glossaryRef}`;

    const segmentInput = segSummaries
      .map((s, i) => `[Segment ${i + 1}]\n${s.trim()}`)
      .join('\n\n');
    const text = stripMarkdown(await callClaude(storyPrompt, segmentInput));

    const ta = document.getElementById('generalText');
    ta.value = text;
    document.getElementById('generalOutputLabel').textContent = 'Comprehensive Analysis';
    document.getElementById('generalOutput').style.display = 'block';
    requestAnimationFrame(() => autoResize(ta));
    document.getElementById('saveGeneralToArchive').style.display = '';
  } catch (err) {
    setError('generalError', err.message);
  } finally {
    progress.style.display = 'none';
    setBusy(btn, false);
  }
});

/* ================================================================
   FEATURE 2 — STRUCTURED TABLE
   ================================================================ */
document.getElementById('generateStructured').addEventListener('click', async () => {
  if (!cnScenes.length) { setError('structuredError', 'Please upload a CN script first.'); return; }
  setError('structuredError', '');

  const btn = document.getElementById('generateStructured');
  const structProgress = document.getElementById('structuredProgress');
  setBusy(btn, true);
  structProgress.textContent = 'Analyzing scenes…';
  structProgress.style.display = 'block';

  const outputArea = document.getElementById('structuredOutput');
  const tableDiv   = document.getElementById('structuredTable');
  outputArea.style.display = 'block';
  document.getElementById('structuredExportBtns').style.display = 'none';
  structuredRows = [];

  // Render skeleton table
  tableDiv.innerHTML = renderStructuredTable(cnScenes.map(s => ({
    performId:    s.performId,
    type:         s.type,
    description:  s.description,
    lineCount:    s.lines.length,
    voCount:      s.lines.filter(l => l.hasVO).length,
    storySummary: null,  // null = shimmer
  })));

  try {
    // Pass 1: all scenes — basic info is already from parsed data
    // Use one API call to get short descriptions / bullet per scene
    const digest = buildScriptDigest(cnScenes);
    const systemP1 = `You are a game localization producer analyzing a VO script.
For each scene (marked === 场景N [PID:xxx] ===), output one pipe-delimited line:
PerformID|ShortDescription
ShortDescription should be ≤12 Chinese characters summarizing what happens.
Output ONLY the data lines, no headers, no extra text.`;

    const pass1Text = await callClaude(systemP1, digest);
    const descMap = {};
    pass1Text.split('\n').forEach(line => {
      const [pid, desc] = parsePipeRow(line);
      if (pid && desc) descMap[pid.trim()] = desc.trim();
    });

    // Build base rows
    structuredRows = cnScenes.map(s => ({
      performId:    s.performId,
      type:         s.type,
      description:  s.description,
      lineCount:    s.lines.length,
      voCount:      s.lines.filter(l => l.hasVO).length,
      shortDesc:    descMap[s.performId] || s.description,
      storySummary: null,
    }));

    // Render after pass 1 (all scenes still shimmer)
    tableDiv.innerHTML = renderStructuredTable(structuredRows);

    // Pass 2: story summary for all scenes
    let consecutiveFailures = 0;
    for (let si = 0; si < cnScenes.length; si++) {
      const scene = cnScenes[si];
      structProgress.textContent = `Summarizing scene ${si + 1}/${cnScenes.length}…`;
      const voCount = scene.lines.filter(l => l.hasVO).length;
      const idx = structuredRows.findIndex(r => r.performId === scene.performId);

      const sceneDigest = `[PID:${scene.performId}] [${scene.type}] ${scene.description}\n` +
        scene.lines.map(l => (l.hasVO ? '[VO]  ' : '      ') + l.speaker + ': ' + l.text).join('\n');

      const sysP2 = `Summarize this scene in ≤30 Chinese characters for a localization team. Focus on key emotional beats and story developments. Return ONLY the summary, no extra text.`;

      try {
        let summary;
        try {
          summary = await callClaude(sysP2, sceneDigest);
        } catch (e1) {
          // One retry after a pause — per-scene calls often trip the rate limit
          if (!/429|Rate limit|overloaded/i.test(e1.message)) throw e1;
          structProgress.textContent = `Rate limited — pausing 30s, then retrying scene ${si + 1}/${cnScenes.length}…`;
          await new Promise(r => setTimeout(r, 30000));
          structProgress.textContent = `Summarizing scene ${si + 1}/${cnScenes.length}…`;
          summary = await callClaude(sysP2, sceneDigest);
        }
        consecutiveFailures = 0;
        const label = voCount === 0 ? '【无配音场景】' : '';
        if (idx !== -1) structuredRows[idx].storySummary = label + summary.trim();
      } catch (e) {
        consecutiveFailures++;
        if (idx !== -1) structuredRows[idx].storySummary = '⚠ ' + e.message;
        if (consecutiveFailures >= 3) {
          tableDiv.innerHTML = renderStructuredTable(structuredRows);
          throw new Error(`Stopped after 3 consecutive failed scenes. Last error: ${e.message}`);
        }
      }

      // Re-render progressively
      tableDiv.innerHTML = renderStructuredTable(structuredRows);
    }

    document.getElementById('structuredExportBtns').style.display = 'flex';
    const tsvRows = structuredRows.map(r =>
      [r.performId, r.type, r.description, r.lineCount, r.voCount, r.storySummary || ''].join('\t')
    );
    const tsvContent = ['PerformID\t类型\t场景描述\t台词数\tVO数\t故事总结', ...tsvRows].join('\n');
    document.getElementById('saveStructuredToArchive').style.display = '';
    document.getElementById('saveStructuredToArchive').onclick = () => {
      saveToArchive('Structured', `${cnFileName} — Scene Breakdown`, tsvContent);
    };
  } catch (err) {
    setError('structuredError', err.message);
  } finally {
    structProgress.style.display = 'none';
    setBusy(btn, false);
  }
});

function renderStructuredTable(rows) {
  const allHeaders = ['PerformID', '类型', '场景描述', '台词', 'VO', '故事总结'];
  const ths = allHeaders
    .filter((_, i) => structuredCols.includes(i))
    .map(h => `<th>${h}</th>`).join('');
  const trs = rows.map(r => {
    const summaryCell = r.storySummary === null
      ? `<span class="shimmer">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span>`
      : escapeHtml(r.storySummary);
    const allCells = [
      `<td style="font-family:'Space Mono',monospace;font-size:10px">${escapeHtml(r.performId)}</td>`,
      `<td>${typeBadge(r.type)}</td>`,
      `<td title="${escapeHtml(r.description)}">${escapeHtml(r.shortDesc || r.description)}</td>`,
      `<td style="text-align:center">${r.lineCount}</td>`,
      `<td style="text-align:center;color:var(--accent)">${r.voCount}</td>`,
      `<td>${summaryCell}</td>`,
    ];
    const cells = allCells.filter((_, i) => structuredCols.includes(i)).join('');
    return `<tr>${cells}</tr>`;
  }).join('');
  return `<table class="data-table"><thead><tr>${ths}</tr></thead><tbody>${trs}</tbody></table>`;
}

/* ── Structured CSV / TSV export ────────────────────────────── */
document.getElementById('exportCsv').addEventListener('click', () => exportStructured('csv'));
document.getElementById('exportTsv').addEventListener('click', () => exportStructured('tsv'));

function exportStructured(fmt) {
  const sep = fmt === 'csv' ? ',' : '\t';
  const headers = ['PerformID', '类型', '场景描述', '台词数', 'VO数', '故事总结'];
  const csvEsc  = (v) => fmt === 'csv' ? `"${String(v).replace(/"/g, '""')}"` : String(v);
  const rows    = [headers.map(csvEsc).join(sep)];
  structuredRows.forEach(r => {
    rows.push([r.performId, r.type, r.description, r.lineCount, r.voCount, r.storySummary || ''].map(csvEsc).join(sep));
  });
  const BOM  = '﻿';
  const blob = new Blob([BOM + rows.join('\n')], { type: 'text/plain;charset=utf-8' });
  downloadBlob(blob, `${baseName(cnFileName)}_structured.${fmt}`);
}

/* ================================================================
   FEATURE 3 — GLOSSARY
   ================================================================ */
document.getElementById('generateGlossary').addEventListener('click', async () => {
  if (!cnScenes.length) { setError('glossaryError', 'Please upload a CN script first.'); return; }
  setError('glossaryError', '');

  const btn = document.getElementById('generateGlossary');
  const glsProgress = document.getElementById('glossaryProgress');
  setBusy(btn, true);
  glsProgress.textContent = 'Extracting terms…';
  glsProgress.style.display = 'block';

  try {
    const digest = buildScriptDigest(cnScenes);
    const systemPrompt = `You are a game localization linguist.
Extract key localization terms from this Chinese VO script. For each term output a pipe-delimited line:
CN Term|Category|Context|Option A|Reason A|Option B|Reason B|Option C|Reason C
- Category: one of: Character Name, Place Name, Skill/Ability, Item, Faction, Concept, Other
- Context: brief usage note (≤15 chars)
- Options: 3 English translation candidates with brief reasoning
Output ONLY data lines, no header, no extra text. Extract 20-40 terms.`;

    const tbList = termBaseMap.size > 0
      ? `\n\nTerm base (already translated — skip these CN terms):\n${[...termBaseMap.keys()].join(', ')}`
      : '';
    const raw  = await callClaude(systemPrompt, digest + tbList);
    const terms = raw.split('\n')
      .map(line => parsePipeRow(line))
      .filter(cols => cols.length >= 9 && cols[0]);

    const filteredTerms = termBaseMap.size > 0
      ? terms.filter(cols => !termBaseMap.has(cols[0].trim()))
      : terms;

    // Sort by Category then CN Term
    filteredTerms.sort((a, b) => {
      const catCmp = a[1].localeCompare(b[1]);
      return catCmp !== 0 ? catCmp : a[0].localeCompare(b[0]);
    });

    // Auto-download Excel
    downloadGlossaryExcel(filteredTerms);

    // Preview first 12
    renderGlossaryPreview(filteredTerms.slice(0, 12));

    // Plain text summary
    const cats = {};
    filteredTerms.forEach(t => { cats[t[1]] = (cats[t[1]] || 0) + 1; });
    const summary = `${filteredTerms.length} terms extracted.\n` +
      Object.entries(cats).map(([k, v]) => `  ${k}: ${v}`).join('\n');
    document.getElementById('glossarySummary').textContent = summary;
    document.getElementById('glossaryOutput').style.display = 'block';
    const glossaryTsv = ['CN Term\tCategory\tContext\tOption A\tOption B\tOption C',
      ...filteredTerms.map(cols => [cols[0],cols[1],cols[2],cols[3],cols[5],cols[7]].join('\t'))
    ].join('\n');
    document.getElementById('saveGlossaryToArchive').style.display = '';
    document.getElementById('saveGlossaryToArchive').onclick = () => {
      saveToArchive('Glossary', `${cnFileName} — Glossary`, glossaryTsv);
    };
  } catch (err) {
    setError('glossaryError', err.message);
  } finally {
    glsProgress.style.display = 'none';
    setBusy(btn, false);
  }
});

function renderGlossaryPreview(terms) {
  const headers = ['CN Term', 'Category', 'Context', 'Option A', 'Option B', 'Option C'];
  const ths = headers.map(h => `<th>${h}</th>`).join('');
  const trs = terms.map(cols => `<tr>
    <td><strong style="color:var(--accent)">${escapeHtml(cols[0])}</strong></td>
    <td><span class="meta-chip">${escapeHtml(cols[1])}</span></td>
    <td>${escapeHtml(cols[2])}</td>
    <td>${escapeHtml(cols[3])}</td>
    <td>${escapeHtml(cols[5])}</td>
    <td>${escapeHtml(cols[7])}</td>
  </tr>`).join('');
  document.getElementById('glossaryTable').innerHTML =
    `<table class="data-table"><thead><tr>${ths}</tr></thead><tbody>${trs}</tbody></table>`;
}

function downloadGlossaryExcel(terms) {
  const headers = ['CN Term', 'Category', 'Context', 'Option A', 'Reason A', 'Option B', 'Reason B', 'Option C', 'Reason C', 'Recommended', 'Notes'];
  const data = [headers, ...terms.map(cols => [
    cols[0], cols[1], cols[2],
    cols[3], cols[4], cols[5], cols[6], cols[7], cols[8],
    '', '',
  ])];
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(data);
  XLSX.utils.book_append_sheet(wb, ws, 'Glossary');
  XLSX.writeFile(wb, `${baseName(cnFileName)}_glossary.xlsx`);
}


/* ================================================================
   MARKDOWN → HTML (minimal)
   ================================================================ */
function markdownToHtml(md) {
  let html = escapeHtml(md);
  // ## headers
  html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
  html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
  // bold
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  // italic
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
  // bullet
  html = html.replace(/^[*-] (.+)$/gm, '<li style="margin-left:14px;list-style:disc">$1</li>');
  // line breaks
  html = html.replace(/\n/g, '<br>');
  return html;
}

/* ================================================================
   DOWNLOAD HELPER
   ================================================================ */
function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a   = document.createElement('a');
  a.href    = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function baseName(filename) {
  return filename ? filename.replace(/\.[^.]+$/, '') : 'export';
}
