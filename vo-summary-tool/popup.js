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
let termBaseCN = new Set();

/* ── Structured table data store ────────────────────────────── */
let structuredRows = [];  // [{performId, type, description, lineCount, voCount, storySummary}]

/* ── On load: restore API key ───────────────────────────────── */
chrome.storage.local.get(['apiKey', 'fontSize'], (result) => {
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
document.querySelectorAll('.lang-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.lang-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    selectedLang = btn.dataset.lang;
  });
});

/* ── Pill toggles (General tab) ────────────────────────────── */
document.querySelectorAll('.pill').forEach(pill => {
  pill.addEventListener('click', () => pill.classList.toggle('active'));
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
      setError('enReviewError', err.message);
    }
  };
  reader.readAsArrayBuffer(file);
}

function renderENMeta() {
  const el = document.getElementById('enMeta');
  el.style.display = 'flex';
  el.innerHTML = `
    <span class="meta-chip gold">${enLines.length} VO lines</span>
    <span class="meta-chip">${enFileName}</span>
  `;
}

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
      termBaseCN = new Set(
        rows.slice(1)  // skip header row
          .map(r => String(r[0] || '').trim())
          .filter(Boolean)
      );
      tbZone.classList.add('has-file');
      tbZone.querySelector('.upload-label').textContent = file.name;
      tbZone.querySelector('.upload-icon').textContent = '✓';
      const meta = document.getElementById('tbMeta');
      meta.style.display = 'flex';
      meta.innerHTML = `<span class="meta-chip gold">${termBaseCN.size} terms loaded</span><span class="meta-chip">${file.name}</span>`;
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
    // VOICED layout (no 总台本 sheet): PerformID is filled on every voiced
    // line; group lines into scenes by the PerformID prefix (trailing 3
    // digits are the line number). A row without a numeric PerformID is a
    // label/staging row that describes the scene that follows.
    const sceneByKey = {};
    let pendingLabel = null;
    for (let i = headerIdx + 1; i < rows.length; i++) {
      const row  = rows[i];
      const name = get(row, cName);
      const text = get(row, cText);
      const pid  = get(row, cPID);
      if (isPID(pid)) {
        const key = pid.length > 3 ? pid.slice(0, -3) : pid;
        let scene = sceneByKey[key];
        if (!scene) {
          scene = {
            performId:   key,
            type:        pendingLabel ? pendingLabel.type : '',
            description: pendingLabel ? pendingLabel.description : '',
            lines:       [],
          };
          sceneByKey[key] = scene;
          scenes.push(scene);
        }
        scene.lines.push({
          speaker: name || '[narration]',
          text,
          hasVO:   isValidVOID(get(row, cVOID)),
          comment: get(row, cComment),
        });
      } else if (name || text) {
        pendingLabel = { type: name, description: text };
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
    throw new Error(err.error?.message || `API error ${response.status}`);
  }

  const data = await response.json();
  return data.content[0].text;
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
  if (!cnScenes.length) { setError('generalError', 'Please upload a CN script first.'); return; }
  setError('generalError', '');

  const btn = document.getElementById('generateGeneral');
  setBusy(btn, true);

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

    const langInstruction = selectedLang === 'zh'
      ? 'Respond entirely in Simplified Chinese (简体中文).'
      : 'Respond entirely in English.';

    const systemPrompt = `You are a professional game localization producer.
Summarize the provided VO script digest in approximately ${length} words.
Focus on: ${selectedOptions}.
${langInstruction}
Be concise and useful for a production team. No preamble.`;

    const digest = buildScriptDigest(cnScenes);
    const text   = await callClaude(systemPrompt, digest);

    document.getElementById('generalText').value = text;
    document.getElementById('generalOutput').style.display = 'block';
  } catch (err) {
    setError('generalError', err.message);
  } finally {
    setBusy(btn, false);
  }
});

document.getElementById('copyGeneral').addEventListener('click', () => {
  const txt = document.getElementById('generalText').value;
  navigator.clipboard.writeText(txt).then(() => {
    const btn = document.getElementById('copyGeneral');
    btn.textContent = 'Copied!';
    setTimeout(() => { btn.textContent = 'Copy'; }, 1500);
  });
});

/* ================================================================
   FEATURE 2 — STRUCTURED TABLE
   ================================================================ */
document.getElementById('generateStructured').addEventListener('click', async () => {
  if (!cnScenes.length) { setError('structuredError', 'Please upload a CN script first.'); return; }
  setError('structuredError', '');

  const btn = document.getElementById('generateStructured');
  setBusy(btn, true);

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
    for (const scene of cnScenes) {
      const voCount = scene.lines.filter(l => l.hasVO).length;
      const idx = structuredRows.findIndex(r => r.performId === scene.performId);

      if (voCount === 0) {
        if (idx !== -1) structuredRows[idx].storySummary = '无配音场景';
        tableDiv.innerHTML = renderStructuredTable(structuredRows);
        continue;
      }

      const sceneDigest = `[PID:${scene.performId}] [${scene.type}] ${scene.description}\n` +
        scene.lines.map(l => (l.hasVO ? '[VO]  ' : '      ') + l.speaker + ': ' + l.text).join('\n');

      const sysP2 = `Summarize this scene in ≤30 Chinese characters for a localization team. Focus on key emotional beats and story developments. Return ONLY the summary, no extra text.`;

      try {
        const summary = await callClaude(sysP2, sceneDigest);
        if (idx !== -1) structuredRows[idx].storySummary = summary.trim();
      } catch (_e) {
        if (idx !== -1) structuredRows[idx].storySummary = '(error)';
      }

      // Re-render progressively
      tableDiv.innerHTML = renderStructuredTable(structuredRows);
    }

    document.getElementById('structuredExportBtns').style.display = 'flex';
  } catch (err) {
    setError('structuredError', err.message);
  } finally {
    setBusy(btn, false);
  }
});

function renderStructuredTable(rows) {
  const headers = ['PerformID', '类型', '场景描述', '台词', 'VO', '故事总结'];
  const ths = headers.map(h => `<th>${h}</th>`).join('');
  const trs = rows.map(r => {
    const summaryCell = r.storySummary === null
      ? `<span class="shimmer">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span>`
      : escapeHtml(r.storySummary);
    return `<tr>
      <td style="font-family:'Space Mono',monospace;font-size:10px">${escapeHtml(r.performId)}</td>
      <td>${typeBadge(r.type)}</td>
      <td title="${escapeHtml(r.description)}">${escapeHtml(r.shortDesc || r.description)}</td>
      <td style="text-align:center">${r.lineCount}</td>
      <td style="text-align:center;color:var(--accent)">${r.voCount}</td>
      <td>${summaryCell}</td>
    </tr>`;
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
  setBusy(btn, true);

  try {
    const digest = buildScriptDigest(cnScenes);
    const systemPrompt = `You are a game localization linguist.
Extract key localization terms from this Chinese VO script. For each term output a pipe-delimited line:
CN Term|Category|Context|Option A|Reason A|Option B|Reason B|Option C|Reason C
- Category: one of: Character Name, Place Name, Skill/Ability, Item, Faction, Concept, Other
- Context: brief usage note (≤15 chars)
- Options: 3 English translation candidates with brief reasoning
Output ONLY data lines, no header, no extra text. Extract 20-40 terms.`;

    const tbList = termBaseCN.size > 0
      ? `\n\nTerm base (already translated — skip these CN terms):\n${[...termBaseCN].join(', ')}`
      : '';
    const raw  = await callClaude(systemPrompt, digest + tbList);
    const terms = raw.split('\n')
      .map(line => parsePipeRow(line))
      .filter(cols => cols.length >= 9 && cols[0]);

    const filteredTerms = termBaseCN.size > 0
      ? terms.filter(cols => !termBaseCN.has(cols[0].trim()))
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
  } catch (err) {
    setError('glossaryError', err.message);
  } finally {
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
   FEATURE 4 — EN REVIEW
   ================================================================ */

/* ── EN Summary ─────────────────────────────────────────────── */
document.getElementById('generateEnSummary').addEventListener('click', async () => {
  if (!enLines.length) { setError('enReviewError', 'Please upload an EN VO tracker first.'); return; }
  setError('enReviewError', '');

  const btn = document.getElementById('generateEnSummary');
  setBusy(btn, true);

  try {
    const digest = enLines.slice(0, 200).map(l =>
      `[${l.voId}] ${l.character}: ${l.latestEN || l.englishScript}`
    ).join('\n');

    const systemPrompt = `You are a game localization producer reviewing English VO scripts.
Summarize the key content, character voices, tone, and any localization concerns in ~200 words.
Be practical and production-focused.`;

    const text = await callClaude(systemPrompt, digest);
    document.getElementById('enOutputLabel').textContent = 'EN Summary';
    document.getElementById('enReviewContent').innerHTML = `<pre style="white-space:pre-wrap;font-size:12px">${escapeHtml(text)}</pre>`;
    document.getElementById('enReviewOutput').style.display = 'block';
  } catch (err) {
    setError('enReviewError', err.message);
  } finally {
    setBusy(btn, false);
  }
});

/* ── EN Table ───────────────────────────────────────────────── */
document.getElementById('generateEnTable').addEventListener('click', async () => {
  if (!enLines.length) { setError('enReviewError', 'Please upload an EN VO tracker first.'); return; }
  setError('enReviewError', '');

  const btn = document.getElementById('generateEnTable');
  setBusy(btn, true);

  try {
    document.getElementById('enOutputLabel').textContent = 'EN Table';
    const outputArea = document.getElementById('enReviewOutput');
    outputArea.style.display = 'block';
    const contentDiv = document.getElementById('enReviewContent');

    // Group by PerformID (4th segment of VO ID split by _)
    const groups = {};
    enLines.forEach(l => {
      const parts = l.voId.split('_');
      const pid = parts.length >= 4 ? parts.slice(0, 4).join('_') : (l.performId || l.voId);
      if (!groups[pid]) groups[pid] = [];
      groups[pid].push(l);
    });

    const pids = Object.keys(groups);
    const rows = [];

    for (const pid of pids) {
      const group = groups[pid];
      const chars = [...new Set(group.map(l => l.character).filter(Boolean))].join(', ');

      // Ask Claude to summarize this group
      const snippet = group.slice(0, 20).map(l =>
        `${l.character}: ${l.latestEN || l.englishScript}`
      ).join('\n');

      const sysEn = `Summarize this EN VO group in ≤20 English words for a production table. Return ONLY the summary.`;
      let summary = '…';
      try {
        summary = await callClaude(sysEn, snippet);
        summary = summary.trim();
      } catch (_) { summary = '(error)'; }

      rows.push({ pid, count: group.length, chars, summary });
      contentDiv.innerHTML = renderENTable(rows, pids.length);
    }
  } catch (err) {
    setError('enReviewError', err.message);
  } finally {
    setBusy(btn, false);
  }
});

function renderENTable(rows, total) {
  const headers = ['Perform ID', 'Lines', 'Characters', 'Summary'];
  const ths = headers.map(h => `<th>${h}</th>`).join('');
  const trs = rows.map(r => `<tr>
    <td style="font-family:'Space Mono',monospace;font-size:10px">${escapeHtml(r.pid)}</td>
    <td style="text-align:center">${r.count}</td>
    <td>${escapeHtml(r.chars)}</td>
    <td>${escapeHtml(r.summary)}</td>
  </tr>`).join('');
  const progress = rows.length < total
    ? `<div style="padding:6px 10px;font-size:10px;color:var(--text-dim);font-family:'Space Mono',monospace">Processing ${rows.length}/${total} groups…</div>`
    : '';
  return `${progress}<table class="data-table"><thead><tr>${ths}</tr></thead><tbody>${trs}</tbody></table>`;
}

/* ── Review (requires both files) ──────────────────────────── */
document.getElementById('generateReview').addEventListener('click', async () => {
  if (!cnScenes.length || !enLines.length) {
    setError('enReviewError', 'Please upload both the CN script and EN tracker first.');
    return;
  }
  setError('enReviewError', '');

  const btn = document.getElementById('generateReview');
  setBusy(btn, true);

  try {
    // Build a side-by-side sample
    const sample = enLines.slice(0, 80).map(l =>
      `[${l.voId}]\nCN: ${l.chineseScript}\nEN: ${l.latestEN || l.englishScript}\nNotes: ${l.performanceNotes || '—'}`
    ).join('\n---\n');

    const systemPrompt = `You are a senior game localization QA reviewer.
Review the provided CN-EN VO pairs and identify:
## Translation Accuracy Issues
## Tone & Character Voice Issues
## Performance Notes Quality
## Overall Recommendation

Format with ## headers and be specific. Reference VO IDs where relevant.`;

    const text = await callClaude(systemPrompt, sample);
    document.getElementById('enOutputLabel').textContent = 'Review';
    document.getElementById('enReviewContent').innerHTML = markdownToHtml(text);
    document.getElementById('enReviewOutput').style.display = 'block';
  } catch (err) {
    setError('enReviewError', err.message);
  } finally {
    setBusy(btn, false);
  }
});

document.getElementById('copyEnReview').addEventListener('click', () => {
  const text = document.getElementById('enReviewContent').innerText;
  navigator.clipboard.writeText(text).then(() => {
    const btn = document.getElementById('copyEnReview');
    btn.textContent = 'Copied!';
    setTimeout(() => { btn.textContent = 'Copy'; }, 1500);
  });
});

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
