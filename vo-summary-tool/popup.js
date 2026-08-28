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
let structuredActs = [];  // [{n, title, beat, pids: [performId,…]}] — story roadmap grouping
let structuredCols = [0,1,2,3,4,5];
let archives = [];

/* ── On load: restore API key, term base, prefs ─────────────── */
chrome.storage.local.get(['apiKey', 'fontSize', 'structuredCols', 'archives', 'termBase', 'termBaseName'], (result) => {
  if (result.apiKey) {
    document.getElementById('apiKeyInput').value = result.apiKey;
    updateKeyStatus(true);
    setApiBarCollapsed(true);
  }
  if (result.termBase && result.termBase.length) {
    applyTermBase(new Map(result.termBase), result.termBaseName || 'saved term base', false);
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
    requestAnimationFrame(autoResizeAllOutputs);
  });
});

/* ── Save API key ───────────────────────────────────────────── */
document.getElementById('saveApiKey').addEventListener('click', () => {
  const key = document.getElementById('apiKeyInput').value.trim();
  if (!key) { updateKeyStatus(false); return; }
  chrome.storage.local.set({ apiKey: key }, () => {
    updateKeyStatus(true);
    setApiBarCollapsed(true);
  });
});

/* ── Company API endpoint settings ──────────────────────────── */
document.getElementById('toggleEndpoint').addEventListener('click', async () => {
  const bar = document.getElementById('endpointBar');
  const showing = bar.style.display === 'none';
  bar.style.display = showing ? '' : 'none';
  if (showing) {
    const s = await chrome.storage.local.get(['apiEndpoint', 'apiModel', 'authStyle']);
    document.getElementById('endpointInput').value = s.apiEndpoint || '';
    document.getElementById('modelInput').value    = s.apiModel || '';
    document.getElementById('authStyleSelect').value = s.authStyle || 'auto';
  }
});

function setEndpointStatus(msg, kind) {
  const el = document.getElementById('endpointStatus');
  el.textContent = msg;
  el.style.display = msg ? 'block' : 'none';
  el.style.color = kind === 'err' ? 'var(--accent3)'
                 : kind === 'ok'  ? 'var(--accent2)' : 'var(--text-dimmer)';
}

/* Ask the endpoint which models this key may use. Anthropic and
   OpenAI-style gateways both answer {data: [{id}, …]}. */
async function fetchModelList(cfg) {
  const base = cfg.url.replace(/\/v\d+\/messages$/, '');
  const errs = [];
  for (const path of ['/v1/models', '/models']) {
    const res = await chrome.runtime.sendMessage({
      type: 'callClaude', method: 'GET', url: base + path, headers: buildAuthHeaders(cfg),
    });
    if (!res || res.error) { errs.push(res?.error || 'no response'); continue; }
    if (!res.ok) { errs.push(`HTTP ${res.status}`); continue; }
    try {
      const list = JSON.parse(res.text);
      const ids = (list.data || list.models || [])
        .map(m => (typeof m === 'string' ? m : m.id || m.name))
        .filter(Boolean);
      if (ids.length) return ids;
      errs.push('empty list');
    } catch (e) { errs.push('unreadable response'); }
  }
  throw new Error(`Could not list models (${errs.join('; ')}).`);
}

/* A model is "recommended" if it looks like Sonnet 5 or DeepSeek V4 Pro —
   the two the tool has been verified against. Anything else still works,
   it just isn't singled out. */
function isRecommendedModel(id) {
  return /claude.*sonnet.*5(?!\d)|sonnet.5(?!\d)/i.test(id) || /deepseek.*v4.*pro/i.test(id);
}

function renderModelList(ids) {
  const listEl = document.getElementById('modelList');
  const recommended = ids.filter(isRecommendedModel);
  const rest = ids.filter(id => !isRecommendedModel(id));
  const row = (id, tag) => `<button type="button" class="model-item" data-id="${escapeHtml(id)}">${tag}${escapeHtml(id)}</button>`;
  listEl.innerHTML =
    recommended.map(id => row(id, '★ ')).join('') +
    rest.map(id => row(id, '')).join('');
  listEl.style.display = ids.length ? 'block' : 'none';
  return recommended;
}

document.getElementById('modelList').addEventListener('click', async (e) => {
  const btn = e.target.closest('.model-item');
  if (!btn) return;
  document.getElementById('modelInput').value = btn.dataset.id;
  await chrome.storage.local.set({ apiModel: btn.dataset.id });
  document.querySelectorAll('#modelList .model-item').forEach(b => b.classList.toggle('active', b === btn));
  setEndpointStatus(`Selected "${btn.dataset.id}". Now click Save & Test.`);
});

document.getElementById('findModels').addEventListener('click', async () => {
  const raw = document.getElementById('endpointInput').value.trim();
  if (!(await ensureHostPermission(raw))) return;
  await chrome.storage.local.set({
    apiEndpoint: raw,
    authStyle: document.getElementById('authStyleSelect').value,
  });
  setEndpointStatus('Asking the endpoint which models you can use…');
  try {
    const cfg = await getApiConfig();
    if (!cfg.apiKey) { setEndpointStatus('Save your API key first (the box at the top).', 'err'); return; }
    const ids = await fetchModelList(cfg);

    const recommended = renderModelList(ids);
    const pick = recommended[0] || ids[0];
    document.getElementById('modelInput').value = pick;
    await chrome.storage.local.set({ apiModel: pick });
    document.querySelectorAll('#modelList .model-item').forEach(b => b.classList.toggle('active', b.dataset.id === pick));

    setEndpointStatus(
      `✓ ${ids.length} model${ids.length > 1 ? 's' : ''} available — all listed below (★ = recommended: Sonnet 5 or DeepSeek V4 Pro). ` +
      `Selected "${pick}". Click a different one to switch, or click Save & Test to use this.`, 'ok');
  } catch (err) {
    setEndpointStatus('✗ ' + err.message + ' Ask your IT team which model name to use, and type it into the Model box.', 'err');
  }
});

document.getElementById('resetEndpoint').addEventListener('click', () => {
  chrome.storage.local.set({ apiEndpoint: '', apiModel: '', authStyle: 'auto' }, () => {
    document.getElementById('endpointInput').value = '';
    document.getElementById('modelInput').value = '';
    document.getElementById('authStyleSelect').value = 'auto';
    document.getElementById('modelList').style.display = 'none';
    document.getElementById('modelList').innerHTML = '';
    setEndpointStatus('Reset — using the public Anthropic API.', 'ok');
  });
});

/* Reaching a new host needs its permission granted at runtime (the background
   worker's static host_permissions only cover api.anthropic.com). Returns
   true if the host is reachable, false (with a status message) otherwise —
   shared by Save & Test and Find models so neither can skip the prompt. */
async function ensureHostPermission(raw) {
  if (!raw) return true;
  let parsed;
  try { parsed = new URL(raw); } catch (e) {
    setEndpointStatus('That is not a valid URL. Example: https://llm.mycompany.com', 'err');
    return false;
  }
  if (parsed.protocol !== 'https:') {
    setEndpointStatus('The Base URL must start with https:// — Chrome blocks plain http from extensions.', 'err');
    return false;
  }
  const origin = `${parsed.origin}/*`;
  const has = await chrome.permissions.contains({ origins: [origin] });
  if (has) return true;
  setEndpointStatus('Waiting for permission to contact that host…');
  const granted = await chrome.permissions.request({ origins: [origin] });
  if (!granted) {
    setEndpointStatus(`Permission denied for ${parsed.origin}. The tool cannot call it without that.`, 'err');
    return false;
  }
  return true;
}

document.getElementById('saveEndpoint').addEventListener('click', async () => {
  const raw   = document.getElementById('endpointInput').value.trim();
  const model = document.getElementById('modelInput').value.trim();
  const style = document.getElementById('authStyleSelect').value;

  if (!(await ensureHostPermission(raw))) return;

  await chrome.storage.local.set({ apiEndpoint: raw, apiModel: model, authStyle: style });
  setEndpointStatus('Saved — testing…');

  const ping = () => callClaude('Reply with the single word: ok', 'ping');
  try {
    await ping();
    setEndpointStatus('✓ Connected. The endpoint answered correctly.', 'ok');
    return;
  } catch (err) {
    // A 404 means the host is right but the API is mounted elsewhere; try the
    // usual gateway prefixes rather than making the user guess paths.
    if (!raw || !/\(404\)|error 404|Endpoint not found/i.test(err.message)) {
      setEndpointStatus('✗ ' + err.message, 'err');
      return;
    }
    const root = raw.replace(/\/+$/, '');
    const candidates = ['/anthropic', '/api/anthropic', '/api', '/claude', '/anthropic/v1'];
    for (let i = 0; i < candidates.length; i++) {
      const candidate = root + candidates[i];
      setEndpointStatus(`Not found at that path — trying ${candidate}… (${i + 1}/${candidates.length})`);
      await chrome.storage.local.set({ apiEndpoint: candidate });
      try {
        await ping();
        document.getElementById('endpointInput').value = candidate;
        setEndpointStatus(`✓ Connected — the API lives at ${candidate}. Saved that for you.`, 'ok');
        return;
      } catch (e2) { /* try the next prefix */ }
    }
    await chrome.storage.local.set({ apiEndpoint: raw });
    setEndpointStatus(`✗ Reached ${root}, but could not find the Claude API there. Ask your IT team for the exact endpoint path and model name.`, 'err');
  }
});

/* Collapse the key input once saved; "Key" button re-expands it */
function setApiBarCollapsed(collapsed) {
  document.getElementById('apiKeyInput').style.display = collapsed ? 'none' : '';
  document.getElementById('saveApiKey').style.display  = collapsed ? 'none' : '';
  document.getElementById('changeApiKey').style.display = collapsed ? '' : 'none';
}
document.getElementById('changeApiKey').addEventListener('click', () => setApiBarCollapsed(false));

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

/* ── Language toggle (Structured tab) ──────────────────────── */
let structuredLang = 'zh';
document.querySelectorAll('#structuredLangToggle .lang-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('#structuredLangToggle .lang-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    structuredLang = btn.dataset.lang;
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
      if (!cnScenes.length) throw new Error('No scenes found — the header layout was not recognized.');
      hideColMap('cn');
      cnZone.classList.add('has-file');
      cnZone.querySelector('.upload-label').textContent = file.name;
      cnZone.querySelector('.upload-icon').textContent = '✓';
      renderCNMeta();
      setError('generalError', '');
    } catch (err) {
      setError('generalError', 'CN script: ' + err.message + ' You can map the columns manually below.');
      showColMapPanel('cn');
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
      if (!enLines.length) throw new Error('No VO lines found — the header layout was not recognized.');
      hideColMap('en');
      enZone.classList.add('has-file');
      enZone.querySelector('.upload-label').textContent = file.name;
      enZone.querySelector('.upload-icon').textContent = '✓';
      renderENMeta();
      setError('generalError', '');
    } catch (err) {
      setError('generalError', 'EN tracker: ' + err.message + ' You can map the columns manually below.');
      showColMapPanel('en');
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

/* ── Fetch sheet CSV, trying every transport that can work ──
   Two URLs (same-origin gviz endpoint, then the export endpoint) crossed
   with two transports:
   1. Background service worker fetch — uses the extension's
      host_permissions, immune to the Sheets page's CSP, but relies on
      Google auth cookies being sent from the extension context.
   2. Fetch injected into the Sheets tab — always has the page's cookies,
      but subject to the page's own security policy.
   Returns the first success; throws the last error otherwise. */
async function fetchSheetCsv(tabId, sheetId, gid) {
  const urls = [
    `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:csv&gid=${gid}`,
    `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&gid=${gid}`,
  ];
  let lastErr;
  for (const url of urls) {
    try {
      return await fetchViaBackground(url);
    } catch (e) {
      lastErr = e;
    }
    try {
      return await fetchInSheetTab(tabId, url);
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr;
}

/* ── Fetch via the background service worker ── */
async function fetchViaBackground(url) {
  const result = await chrome.runtime.sendMessage({ type: 'fetchSheetCsv', url });
  if (!result) throw new Error('Background fetch did not respond. Fix: reload the extension at chrome://extensions.');
  if (result.ok) return result;
  if (result.error) throw new Error(`Network error while fetching sheet data: ${result.error}. Fix: check your connection.`);
  if (result.status === 401 || result.status === 403) {
    throw new Error(`Google denied access to this sheet (HTTP ${result.status}). Fix: sign in to Google in this browser with an account that can open the sheet, then try again.`);
  }
  if (result.status === 404) throw new Error('Sheet not found (HTTP 404). Fix: check the sheet still exists and the tab URL is correct.');
  throw new Error(`Could not read sheet data (HTTP ${result.status ?? '?'}). Fix: reload the sheet tab, then try again.`);
}

/* ── Fetch a URL from inside the Google Sheets tab (avoids CORS) ──
   All errors are caught inside the injected function and translated
   into actionable messages here. */
async function fetchInSheetTab(tabId, url) {
  let injected;
  try {
    injected = await chrome.scripting.executeScript({
      target: { tabId },
      func: async (u) => {
        try {
          const r = await fetch(u, { credentials: 'include' });
          if (!r.ok) return { ok: false, status: r.status };
          const text = await r.text();
          if (/^\s*<(!DOCTYPE|html)/i.test(text)) return { ok: false, status: 401 };
          return { ok: true, text };
        } catch (e) {
          return { ok: false, netErr: String(e && e.message || e) };
        }
      },
      args: [url],
    });
  } catch (e) {
    const m = e.message || '';
    if (/Cannot access|cannot be scripted|chrome:\/\//i.test(m)) {
      throw new Error('Chrome blocked access to this tab. Fix: open chrome://extensions, click Reload on the VO Script Summary Tool, accept the new permission prompt, then reload the Google Sheet tab and try again.');
    }
    if (/No tab with id|Frame with ID|not exist/i.test(m)) {
      throw new Error('The Google Sheet tab could not be reached (it may have been closed or is still loading). Fix: make sure the sheet is the active tab and fully loaded, then try again.');
    }
    throw new Error(`Could not run inside the Google Sheet tab: ${m}. Fix: reload the extension at chrome://extensions and reload the sheet tab.`);
  }
  const result = injected && injected[0] && injected[0].result;
  if (!result) {
    throw new Error('The Google Sheet tab did not respond. Fix: reload the sheet tab and try again once it is fully loaded.');
  }
  if (!result.ok) {
    if (result.netErr) {
      throw new Error(`Network error while fetching sheet data: ${result.netErr}. Fix: check your connection and reload the sheet tab.`);
    }
    if (result.status === 401 || result.status === 403) {
      throw new Error(`Google denied access to this sheet (HTTP ${result.status}). Fix: sign in to Google in this browser with an account that can open the sheet, then try again.`);
    }
    if (result.status === 404) {
      throw new Error('Sheet not found (HTTP 404). Fix: check the sheet still exists and the tab URL is correct.');
    }
    throw new Error(`Could not read sheet data (HTTP ${result.status ?? '?'}). Fix: reload the sheet tab, then try again.`);
  }
  return result;
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
    const result = await fetchSheetCsv(tab.id, sheetId, gid);
    enLines = parseENTracker(new TextEncoder().encode(result.text).buffer);
    enFileName = (tab.title || 'Google Sheet').replace(/ - Google (Sheets|表格)$/, '');
    if (!enLines.length) {
      showColMapPanel('en');
      throw new Error('The sheet was fetched, but no VO lines were recognized (no "VO ID" column found). Fix: map the columns manually below, or check that the visible sheet tab is the EN tracker.');
    }
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
      const map = new Map(
        rows.slice(1)  // skip header row
          .map(r => [String(r[0] || '').trim(), String(r[1] || '').trim()])
          .filter(([cn]) => cn)
      );
      applyTermBase(map, file.name, true);
    } catch (err) {
      setError('glossaryError', 'Term base parse error: ' + err.message);
    }
  };
  reader.readAsArrayBuffer(file);
}

/* Apply a term base to the UI; persist=true saves it to chrome.storage so it
   survives closing the panel. */
function applyTermBase(map, name, persist) {
  termBaseMap = map;
  tbZone.classList.add('has-file');
  tbZone.querySelector('.upload-label').textContent = name;
  tbZone.querySelector('.upload-icon').textContent = '✓';
  const meta = document.getElementById('tbMeta');
  meta.style.display = 'flex';
  meta.innerHTML = `<span class="meta-chip gold">${termBaseMap.size} terms loaded</span><span class="meta-chip">${escapeHtml(name)}</span>`;
  if (persist) {
    chrome.storage.local.set({ termBase: [...termBaseMap.entries()], termBaseName: name });
  }
}

/* Build a glossary reference block for a prompt, limited to terms that
   actually appear in the given source text (saves tokens on large TBs). */
function buildGlossaryRef(sourceText, maxTerms = 300) {
  if (!termBaseMap.size) return '';
  const relevant = [...termBaseMap.entries()]
    .filter(([cn, en]) => sourceText.includes(cn) || (en && sourceText.includes(en)))
    .slice(0, maxTerms);
  if (!relevant.length) return '';
  return `\n\nReference glossary — always use these established English translations:\n${relevant.map(([cn, en]) => `${cn} → ${en}`).join('\n')}`;
}

/* ================================================================
   PARSERS
   ================================================================ */
/* Fuzzy header matching: labels are compared case-, space- and
   full-width-punctuation-insensitively, against synonym lists. */
function normLabel(s) {
  return String(s).toLowerCase().replace(/[\s_　（）()：:【】\[\]]/g, '');
}

function makeColResolver(headerRow) {
  const exact = {}, fuzzy = {};
  (headerRow || []).forEach((cell, j) => {
    const label = String(cell).trim();
    if (!label) return;
    if (!(label in exact)) exact[label] = j;
    const n = normLabel(label);
    if (n && !(n in fuzzy)) fuzzy[n] = j;
  });
  return (labels, fallback) => {
    for (const l of labels) if (l in exact) return exact[l];
    for (const l of labels) {
      const n = normLabel(l);
      if (n in fuzzy) return fuzzy[n];
    }
    for (const l of labels) {
      const n = normLabel(l);
      if (n.length >= 3) {
        const hit = Object.keys(fuzzy).find(k => k.includes(n));
        if (hit !== undefined) return fuzzy[hit];
      }
    }
    return fallback;
  };
}

// Last-loaded raw rows, kept so the manual column-mapping panel can reparse.
let lastCN = null; // { rows, sheetName }
let lastEN = null; // { rows }

function parseCNScript(arrayBuffer, overrides) {
  const wb = XLSX.read(arrayBuffer, { type: 'array' });
  // Prefer the 总台本 sheet; otherwise take the sheet with the most rows.
  let sheetName = wb.SheetNames.find(n => n.includes('总台本'));
  if (!sheetName) {
    sheetName = wb.SheetNames
      .map(n => ({ n, rows: XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1 }).length }))
      .sort((a, b) => b.rows - a.rows)[0].n;
  }
  const ws = wb.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
  lastCN = { rows, sheetName };
  return parseCNRows(rows, sheetName, overrides);
}

function parseCNRows(rows, sheetName, overrides = {}) {
  const PID_LABELS = ['PerformID', '演出ID', '演出序号', 'PID'];
  // Locate the header row: any row containing a PerformID-like label.
  let headerIdx = overrides.headerIdx;
  if (headerIdx == null) {
    headerIdx = rows.findIndex(r =>
      r.some(cell => PID_LABELS.some(l => normLabel(cell) === normLabel(l))));
    if (headerIdx === -1) {
      headerIdx = rows.findIndex(r =>
        r.some(cell => normLabel(cell).includes('performid')));
    }
  }
  if (headerIdx === -1) throw new Error('Could not find a header row with PerformID (or 演出ID).');

  const resolve = makeColResolver(rows[headerIdx]);
  const cName    = overrides.cName    ?? resolve(['Name', '角色', '角色名', 'Speaker', '说话人'], 1);
  const cText    = overrides.cText    ?? resolve(['Textmap', '台词', '中文台词', '文本', '内容'], 2);
  const cComment = overrides.cComment ?? resolve(['Comment', '备注', '注释'], 4);
  const cPID     = overrides.cPID     ?? resolve(PID_LABELS, 7);
  const cVOID    = overrides.cVOID    ?? resolve(['VOID', '音频序号（通用）', '音频序号', 'VoiceID', '音频ID'], 23);

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

function parseENTracker(arrayBuffer, overrides) {
  const wb = XLSX.read(arrayBuffer, { type: 'array' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
  lastEN = { rows };
  return parseENRows(rows, overrides);
}

function parseENRows(rows, overrides = {}) {
  let headerIdx = overrides.headerIdx;
  if (headerIdx == null) {
    headerIdx = rows.findIndex(r => r.some(cell => String(cell).includes('VO ID')));
    if (headerIdx === -1) {
      headerIdx = rows.findIndex(r => {
        const n = r.map(normLabel);
        return n.includes('void') || n.includes('void通用') || n.includes('音频序号');
      });
    }
  }

  const resolve = makeColResolver(headerIdx === -1 ? [] : rows[headerIdx]);
  const isValidVOID = val => val !== '' && !/^[一-鿿]/.test(val);

  const cVoId     = overrides.cVoId     ?? resolve(['VO ID'], 1);
  const cCharCHS  = overrides.cCharCHS  ?? resolve(['角色（中文）', 'CharCHS', '角色'], 2);
  const cChar     = overrides.cChar     ?? resolve(['Character'], 3);
  const cNotes    = overrides.cNotes    ?? resolve(['Performance Notes', '性能备注', '演出备注'], 8);
  const cCN       = overrides.cCN       ?? resolve(['Chinese Script', '中文台词', '中文'], 9);
  const cEN       = overrides.cEN       ?? resolve(['English Script', '英文台词'], 10);
  const cLatestEN = overrides.cLatestEN ?? resolve(['Latest EN', '最新英文'], 19);
  const cPID      = overrides.cPID      ?? resolve(['PerformID', '演出ID'], 25);

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
   MANUAL COLUMN MAPPING (fallback when headers aren't recognized)
   ================================================================ */
function colLetter(j) {
  let s = '';
  j += 1;
  while (j > 0) { s = String.fromCharCode(64 + ((j - 1) % 26) + 1) + s; j = Math.floor((j - 1) / 26); }
  return s;
}

function hideColMap(kind) {
  document.getElementById(kind === 'cn' ? 'cnColMap' : 'enColMap').style.display = 'none';
}

function showColMapPanel(kind) {
  const data = kind === 'cn' ? lastCN : lastEN;
  if (!data || !data.rows.length) return;
  const panel = document.getElementById(kind === 'cn' ? 'cnColMap' : 'enColMap');

  // Pick the most likely header row: the one with the most non-empty cells
  // among the first 10 rows.
  let hi = 0, best = -1;
  for (let i = 0; i < Math.min(10, data.rows.length); i++) {
    const c = data.rows[i].filter(x => String(x).trim()).length;
    if (c > best) { best = c; hi = i; }
  }
  const header = data.rows[hi] || [];
  const sample = data.rows[hi + 1] || [];
  const ncols  = Math.max(header.length, sample.length);

  let options = '<option value="">—</option>';
  for (let j = 0; j < ncols; j++) {
    const lbl = String(header[j] || '').trim() || String(sample[j] || '').trim().slice(0, 12) || '(empty)';
    options += `<option value="${j}">${colLetter(j)}: ${escapeHtml(lbl)}</option>`;
  }

  const fields = kind === 'cn'
    ? [['cPID', 'PerformID *'], ['cName', 'Speaker / Name'], ['cText', 'Dialogue / Text'], ['cVOID', 'VO ID'], ['cComment', 'Comment']]
    : [['cVoId', 'VO ID *'], ['cChar', 'Character'], ['cCN', 'Chinese Script'], ['cEN', 'English Script'], ['cLatestEN', 'Latest EN']];

  panel.innerHTML =
    `<div class="colmap-title">Headers not recognized — map the columns manually (using row ${hi + 1} as header):</div>` +
    fields.map(([k, l]) =>
      `<div class="colmap-row"><label>${l}</label><select data-field="${k}">${options}</select></div>`).join('') +
    `<div class="colmap-row"><button class="btn-teal btn-sm colmap-apply">Apply mapping</button></div>`;
  panel.style.display = 'block';

  panel.querySelector('.colmap-apply').addEventListener('click', () => {
    const overrides = { headerIdx: hi };
    panel.querySelectorAll('select[data-field]').forEach(s => {
      if (s.value !== '') overrides[s.dataset.field] = Number(s.value);
    });
    try {
      if (kind === 'cn') {
        cnScenes = parseCNRows(lastCN.rows, lastCN.sheetName, overrides);
        if (!cnScenes.length) throw new Error('Still no scenes with this mapping — check the PerformID column (it must contain numeric scene IDs).');
        hideColMap('cn');
        cnZone.classList.add('has-file');
        cnZone.querySelector('.upload-label').textContent = cnFileName;
        cnZone.querySelector('.upload-icon').textContent = '✓';
        renderCNMeta();
      } else {
        enLines = parseENRows(lastEN.rows, overrides);
        if (!enLines.length) throw new Error('Still no VO lines with this mapping — check the VO ID column.');
        hideColMap('en');
        enZone.classList.add('has-file');
        enZone.querySelector('.upload-label').textContent = enFileName;
        enZone.querySelector('.upload-icon').textContent = '✓';
        renderENMeta();
      }
      setError('generalError', '');
    } catch (e) {
      setError('generalError', e.message);
    }
  });
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

/* ── Pause / Resume controller for multi-call generations ───────
   Pausing takes effect between API calls: the current call finishes,
   then the loop waits until Resume is clicked. */
function createPauseCtl(btnId) {
  const btn = document.getElementById(btnId);
  const ctl = { paused: false };
  btn.addEventListener('click', () => {
    ctl.paused = !ctl.paused;
    btn.textContent = ctl.paused ? 'Resume' : 'Pause';
  });
  ctl.show = () => { ctl.paused = false; btn.textContent = 'Pause'; btn.style.display = ''; };
  ctl.hide = () => { btn.style.display = 'none'; };
  ctl.wait = async (progressEl) => {
    if (!ctl.paused) return;
    const prev = progressEl ? progressEl.textContent : '';
    if (progressEl) progressEl.textContent = 'Paused — click Resume to continue…';
    while (ctl.paused) await new Promise(r => setTimeout(r, 300));
    if (progressEl) progressEl.textContent = prev;
  };
  return ctl;
}
const pauseComprehensive = createPauseCtl('pauseComprehensive');
const pauseStructured    = createPauseCtl('pauseStructured');
const pauseConsistency   = createPauseCtl('pauseConsistency');

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
const DEFAULT_ENDPOINT = 'https://api.anthropic.com';
const DEFAULT_MODEL    = 'claude-sonnet-4-5';

/* Endpoint config: blank/absent settings mean the public Anthropic API, so
   existing users are unaffected. A company gateway supplies its own base URL,
   model name and auth header style. */
async function getApiConfig() {
  const s = await chrome.storage.local.get(['apiKey', 'apiEndpoint', 'apiModel', 'authStyle']);
  const base = (s.apiEndpoint || DEFAULT_ENDPOINT).trim().replace(/\/+$/, '');
  return {
    apiKey:    s.apiKey,
    // Gateways are usually mounted at a prefix; only append the path if the
    // saved URL does not already end in one.
    url:       /\/v\d+\/messages$/.test(base) ? base : `${base}/v1/messages`,
    model:     (s.apiModel || DEFAULT_MODEL).trim(),
    authStyle: s.authStyle || 'auto',
    isDefault: base === DEFAULT_ENDPOINT,
  };
}

function buildAuthHeaders(cfg) {
  const h = {
    'Content-Type': 'application/json',
    'anthropic-version': '2023-06-01',
    'anthropic-dangerous-direct-browser-access': 'true',
  };
  if (cfg.authStyle === 'bearer') {
    h['Authorization'] = `Bearer ${cfg.apiKey}`;
  } else if (cfg.authStyle === 'x-api-key') {
    h['x-api-key'] = cfg.apiKey;
  } else {
    // auto: gateways differ in which header they read; send both.
    h['x-api-key'] = cfg.apiKey;
    if (!cfg.isDefault) h['Authorization'] = `Bearer ${cfg.apiKey}`;
  }
  return h;
}

async function callClaude(systemPrompt, userPrompt) {
  const cfg = await getApiConfig();
  if (!cfg.apiKey) throw new Error('No API key saved. Please enter your key above.');

  const res = await chrome.runtime.sendMessage({
    type: 'callClaude',
    url: cfg.url,
    headers: buildAuthHeaders(cfg),
    body: {
      model:      cfg.model,
      max_tokens: 4096,
      system:     systemPrompt,
      messages:   [{ role: 'user', content: userPrompt }],
    },
  });

  const where = cfg.isDefault ? 'Anthropic API' : `company endpoint (${cfg.url})`;
  if (!res) throw new Error('The extension background did not respond. Fix: reload the extension at chrome://extensions.');
  if (res.error) {
    throw new Error(`Could not reach the ${where}: ${res.error}. Fix: check the Base URL under "Endpoint", your network/VPN, and that the host permission was granted.`);
  }

  let data = {};
  try { data = JSON.parse(res.text); } catch (e) { /* non-JSON error body handled below */ }

  if (!res.ok) {
    const detail = data.error?.message || (res.text || '').slice(0, 200);
    // A model-permission 403 means the key and URL are fine — only the model
    // name is wrong. Saying "key rejected" here sends people down a dead end.
    if (/model/i.test(detail) && (res.status === 403 || res.status === 404 || res.status === 400)) {
      throw new Error(`The endpoint rejected the model "${cfg.model}": ${detail}. Fix: click "Find models" under "Endpoint" to see which models your key can use, then pick one.`);
    }
    if (res.status === 401 || res.status === 403) {
      throw new Error(`API key rejected (${res.status}) by the ${where}${detail ? `: ${detail}` : ''}. Fix: check the key is valid for this endpoint, and that the auth header style under "Endpoint" matches what your gateway expects.`);
    }
    if (res.status === 404) {
      throw new Error(`Endpoint not found (404): ${cfg.url}. Fix: check the Base URL under "Endpoint" — most gateways want the root URL, not the /v1/messages path.`);
    }
    if (res.status === 429) {
      throw new Error('Rate limit reached (429). Fix: wait about a minute, then try again. For large scripts, generate one feature at a time.');
    }
    if (res.status === 529 || res.status === 503) {
      throw new Error('The API is overloaded right now. Fix: wait a moment and try again.');
    }
    throw new Error(`API error ${res.status}${detail ? `: ${detail}` : ''}. Fix: try again; if it persists, check your key and endpoint settings.`);
  }

  // Anthropic shape: content is a list of blocks (text / thinking / …).
  // With extended thinking on, the first block is "thinking", not the
  // answer — find the actual text block instead of assuming index 0.
  if (Array.isArray(data.content)) {
    const textBlock = data.content.find(b => b && b.type === 'text' && typeof b.text === 'string');
    if (textBlock) return textBlock.text;
  }
  // Some gateways answer an Anthropic-format request with an OpenAI-format
  // body (choices[0].message.content) — read that instead of failing.
  if (typeof data.choices?.[0]?.message?.content === 'string') return data.choices[0].message.content;

  const snippet = (res.text || '').replace(/\s+/g, ' ').trim().slice(0, 300);
  throw new Error(`Unexpected response from the ${where}. It answered but not in a recognized format. Fix: send this to your IT team so they can check the endpoint — raw response: ${snippet || '(empty)'}`);
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
  if (!textarea) return;
  textarea.style.height = 'auto';
  textarea.style.height = textarea.scrollHeight + 'px';
}

/* Re-fit every output box — content height changes with font size and width. */
function autoResizeAllOutputs() {
  document.querySelectorAll('.output-text').forEach(autoResize);
}
window.addEventListener('resize', autoResizeAllOutputs);

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
${styleRules}${buildGlossaryRef(digest)}`;
    } else if (enFromCN) {
      digest = buildScriptDigest(cnScenes);
      const glossaryRef = buildGlossaryRef(digest)
        || '\n\nNote: no reference glossary is loaded, so name and term translations are provisional and may need unification later.';
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
function splitIntoSegments(digestText, maxChars = 9000) {
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

    const glossaryRef = usingEN ? buildGlossaryRef(digest) : '';

    // Stage 1: summarize each segment
    const segments = splitIntoSegments(digest);
    const segPrompt = usingEN
      ? `You are a script analyst. Summarize this voice-over script segment in 100-150 English words, covering plot events, characters, emotional beats, and tone. Write in plain prose with no markdown formatting. Return ONLY the summary.${enFromCN ? ' The segment is in Chinese; write the summary in English.' + glossaryRef : ''}`
      : '你是一名剧本分析师。请用100-150个中文字总结这段配音剧本片段，涵盖剧情事件、角色、情感节奏与基调。使用自然流畅的纯文本，不要使用任何markdown符号。只输出总结内容。';

    const segSummaries = [];
    progress.style.display = 'block';
    pauseComprehensive.show();
    for (let i = 0; i < segments.length; i++) {
      progress.textContent = `Analyzing segment ${i + 1}/${segments.length}…`;
      await pauseComprehensive.wait(progress);
      segSummaries.push(await callClaude(segPrompt, segments[i]));
    }

    // Stage 2: comprehensive analysis from segment summaries
    progress.textContent = 'Writing comprehensive analysis…';
    await pauseComprehensive.wait(progress);
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
    pauseComprehensive.hide();
    setBusy(btn, false);
  }
});

/* ================================================================
   FEATURE 2 — STRUCTURED TABLE
   ================================================================ */
document.getElementById('generateStructured').addEventListener('click', () => runStructured(false));
document.getElementById('generateRoadmap').addEventListener('click', () => runStructured(true));

/* withRoadmap=false → plain scene table.
   withRoadmap=true  → same table grouped under story-act band rows. */
async function runStructured(withRoadmap) {
  if (!cnScenes.length) { setError('structuredError', 'Please upload a CN script first.'); return; }
  setError('structuredError', '');

  const btn = document.getElementById(withRoadmap ? 'generateRoadmap' : 'generateStructured');
  const structProgress = document.getElementById('structuredProgress');
  setBusy(btn, true);
  structProgress.textContent = 'Analyzing scenes…';
  structProgress.style.display = 'block';

  const outputArea = document.getElementById('structuredOutput');
  const tableDiv   = document.getElementById('structuredTable');
  outputArea.style.display = 'block';
  document.getElementById('structuredExportBtns').style.display = 'none';
  structuredRows = [];
  structuredActs = [];

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
    const useEN = structuredLang === 'en';
    pauseStructured.show();

    // Pass 1: all scenes — basic info is already from parsed data
    // Use one API call to get short descriptions / bullet per scene
    const digest = buildScriptDigest(cnScenes);
    const structGlossary = useEN ? buildGlossaryRef(digest) : '';
    const systemP1 = `You are a game localization producer analyzing a VO script.
For each scene (marked === 场景N [PID:xxx] ===), output one pipe-delimited line:
PerformID|ShortDescription
${useEN
    ? 'ShortDescription must be ≤8 words in ENGLISH summarizing what happens. The script and its scene descriptions are in Chinese: TRANSLATE them, never copy Chinese text through. Every ShortDescription must contain only English — no Chinese characters, even for names not in the glossary (romanize those).'
    : 'ShortDescription should be ≤12 Chinese characters summarizing what happens.'}
Output one line for EVERY scene given, including scenes with no dialogue — never skip a scene.
Output ONLY the data lines, no headers, no extra text.${structGlossary}`;

    await pauseStructured.wait(structProgress);
    const pass1Text = await callClaude(systemP1, digest);
    const descMap = {};
    const collectDescs = (text) => text.split('\n').forEach(line => {
      const [pid, desc] = parsePipeRow(line);
      if (pid && desc) descMap[pid.replace(/^\[?PID:?/i, '').replace(/\]$/, '').trim()] = desc.trim();
    });
    collectDescs(pass1Text);

    /* Scenes the model skipped would otherwise fall back to the raw Chinese
       description — visibly untranslated in English mode. Retry just those,
       in chunks, before giving up on them. */
    let missing = cnScenes.filter(s => !descMap[s.performId]);
    for (let attempt = 0; attempt < 2 && missing.length; attempt++) {
      structProgress.textContent = `Describing ${missing.length} remaining scene${missing.length > 1 ? 's' : ''}…`;
      await pauseStructured.wait(structProgress);
      const chunks = [];
      for (let i = 0; i < missing.length; i += 40) chunks.push(missing.slice(i, i + 40));
      for (const chunk of chunks) {
        try {
          collectDescs(await callClaude(systemP1, buildScriptDigest(chunk)));
        } catch (e) { /* keep whatever we have; loop re-checks below */ }
      }
      missing = cnScenes.filter(s => !descMap[s.performId]);
    }

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

    // Pass 1b: story roadmap — group scenes into acts with a milestone beat
    if (withRoadmap) {
    structProgress.textContent = 'Mapping story acts…';
    await pauseStructured.wait(structProgress);
    const sysActs = `You are a game localization producer building a story roadmap of a VO script.
Group the scenes (marked === 场景N [PID:xxx] ===) into 3–6 sequential story acts/arcs, keeping scenes in script order.
For each act output one pipe-delimited line:
ACT|number|title|beat|PID1,PID2,PID3
${useEN
    ? 'title is ≤5 English words; beat is one English sentence (≤15 words) stating the milestone this act reaches.'
    : 'title 不超过8个汉字；beat 是一句不超过20个汉字的话，说明这一幕推进到的剧情节点。'}
Every PID must appear in exactly one act. Output ONLY the ACT lines, no headers, no extra text.${structGlossary}`;
    try {
      const actsText = await callClaude(sysActs, digest);
      structuredActs = [];
      actsText.split('\n').forEach(line => {
        const parts = line.split('|').map(p => p.trim());
        if (parts[0] !== 'ACT' || parts.length < 5) return;
        structuredActs.push({ n: parts[1], title: parts[2], beat: parts[3], pids: parts[4].split(',').map(p => p.trim()).filter(Boolean) });
      });
    } catch (e) {
      structuredActs = [];   // roadmap is an enhancement — table still works without it
    }
    tableDiv.innerHTML = renderStructuredTable(structuredRows);
    }

    // Pass 2: story summaries — scenes are batched into a few calls
    // (instead of one call per scene) to save tokens and avoid rate limits.
    const sceneDigestOf = scene =>
      `[PID:${scene.performId}] [${scene.type}] ${scene.description}\n` +
      scene.lines.map(l => (l.hasVO ? '[VO]  ' : '      ') + l.speaker + ': ' + l.text).join('\n');

    const batches = [];
    let cur = [], curLen = 0;
    for (const scene of cnScenes) {
      const d = sceneDigestOf(scene);
      if (cur.length && curLen + d.length > 8000) { batches.push(cur); cur = []; curLen = 0; }
      cur.push({ scene, d });
      curLen += d.length;
    }
    if (cur.length) batches.push(cur);

    const sysP2 = `You will receive several scene blocks, each starting with [PID:xxx]. For EACH scene output exactly one pipe-delimited line:
PID|summary
${useEN
    ? 'The summary is ≤20 words in ENGLISH for a localization team, focusing on key emotional beats and story developments. The scenes are in Chinese: TRANSLATE, never copy Chinese text through — summaries must contain no Chinese characters.'
    : 'The summary is ≤30 Chinese characters for a localization team, focusing on key emotional beats and story developments.'}
Output ONLY the data lines, one per scene, no headers, no extra text.${structGlossary}`;

    let consecutiveFailures = 0;
    let done = 0;
    for (let bi = 0; bi < batches.length; bi++) {
      const batch = batches[bi];
      structProgress.textContent = `Summarizing scenes ${done + 1}–${done + batch.length}/${cnScenes.length}…`;
      await pauseStructured.wait(structProgress);
      const input = batch.map(b => b.d).join('\n\n');
      try {
        let raw;
        try {
          raw = await callClaude(sysP2, input);
        } catch (e1) {
          if (!/429|Rate limit|overloaded/i.test(e1.message)) throw e1;
          structProgress.textContent = `Rate limited — pausing 30s, then retrying batch ${bi + 1}/${batches.length}…`;
          await new Promise(r => setTimeout(r, 30000));
          raw = await callClaude(sysP2, input);
        }
        consecutiveFailures = 0;
        const sumMap = {};
        raw.split('\n').forEach(line => {
          const [pid, ...rest] = parsePipeRow(line);
          if (pid && rest.length) sumMap[pid.replace(/^\[?PID:?/i, '').replace(/\]$/, '').trim()] = rest.join('|').trim();
        });
        for (const { scene } of batch) {
          const idx = structuredRows.findIndex(r => r.performId === scene.performId);
          if (idx === -1) continue;
          const voCount = scene.lines.filter(l => l.hasVO).length;
          const label = voCount === 0 ? (useEN ? '[No VO] ' : '【无配音场景】') : '';
          const summary = sumMap[scene.performId];
          structuredRows[idx].storySummary = summary
            ? label + summary
            : '⚠ No summary returned for this scene';
        }
      } catch (e) {
        consecutiveFailures++;
        for (const { scene } of batch) {
          const idx = structuredRows.findIndex(r => r.performId === scene.performId);
          if (idx !== -1) structuredRows[idx].storySummary = '⚠ ' + e.message;
        }
        if (consecutiveFailures >= 2) {
          tableDiv.innerHTML = renderStructuredTable(structuredRows);
          throw new Error(`Stopped after ${consecutiveFailures} consecutive failed batches. Last error: ${e.message}`);
        }
      }
      done += batch.length;
      tableDiv.innerHTML = renderStructuredTable(structuredRows);
    }

    document.getElementById('structuredExportBtns').style.display = 'flex';
    const tsvRows = structuredRows.map(r =>
      [r.performId, actLabelOf(r.performId), r.type, sceneDescOf(r), r.lineCount, r.voCount, r.storySummary || ''].join('\t')
    );
    const tsvContent = ['PerformID\t幕\t类型\t场景描述\t台词数\tVO数\t故事总结', ...tsvRows].join('\n');
    document.getElementById('saveStructuredToArchive').style.display = '';
    document.getElementById('saveStructuredToArchive').onclick = () => {
      saveToArchive('Structured', `${cnFileName} — Scene Breakdown`, tsvContent);
    };
  } catch (err) {
    setError('structuredError', err.message);
  } finally {
    structProgress.style.display = 'none';
    pauseStructured.hide();
    setBusy(btn, false);
  }
}

function renderStructuredTable(rows) {
  const allHeaders = ['PerformID', '类型', '场景描述', '台词', 'VO', '故事总结'];
  const ths = allHeaders
    .filter((_, i) => structuredCols.includes(i))
    .map(h => `<th>${h}</th>`).join('');
  const renderRow = (r) => {
    const summaryCell = r.storySummary === null
      ? `<span class="shimmer">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span>`
      : escapeHtml(r.storySummary);
    const allCells = [
      `<td style="font-family:'Space Mono',monospace;font-size:10px">${escapeHtml(r.performId)}</td>`,
      `<td>${typeBadge(r.type)}</td>`,
      `<td title="${escapeHtml(r.description)}">${escapeHtml(sceneDescOf(r))}</td>`,
      `<td style="text-align:center">${r.lineCount}</td>`,
      `<td style="text-align:center;color:var(--accent)">${r.voCount}</td>`,
      `<td>${summaryCell}</td>`,
    ];
    const cells = allCells.filter((_, i) => structuredCols.includes(i)).join('');
    return `<tr>${cells}</tr>`;
  };
  const colCount = structuredCols.length || 1;
  let trs;
  if (structuredActs.length) {
    const rowByPid = new Map(rows.map(r => [r.performId, r]));
    const placed = new Set();
    const parts = [];
    structuredActs.forEach(act => {
      const label = /^\d+$/.test(act.n) ? (typeof structuredLang !== 'undefined' && structuredLang === 'en' ? `Act ${act.n}` : `第${act.n}幕`) : act.n;
      parts.push(`<tr class="act-row"><td colspan="${colCount}">▸ ${escapeHtml(label)} · ${escapeHtml(act.title)}<span class="act-beat"> — ${escapeHtml(act.beat)}</span></td></tr>`);
      act.pids.forEach(pid => {
        const r = rowByPid.get(pid);
        if (r && !placed.has(pid)) { placed.add(pid); parts.push(renderRow(r)); }
      });
    });
    const leftover = rows.filter(r => !placed.has(r.performId));
    if (leftover.length) parts.push(...leftover.map(renderRow));
    trs = parts.join('');
  } else {
    trs = rows.map(renderRow).join('');
  }
  return `<table class="data-table"><thead><tr>${ths}</tr></thead><tbody>${trs}</tbody></table>`;
}

/* ── Structured CSV / TSV export ────────────────────────────── */
document.getElementById('exportCsv').addEventListener('click', () => exportStructured('csv'));
document.getElementById('exportTsv').addEventListener('click', () => exportStructured('tsv'));

/* Scene description as shown/exported: the generated (translated in EN mode)
   short description, falling back to the raw script description. */
function sceneDescOf(r) {
  return r.shortDesc || r.description;
}

/* "第2幕 · 决裂" / "Act 2 · The Break" for a scene, '' if no roadmap */
function actLabelOf(performId) {
  const act = structuredActs.find(a => a.pids.includes(performId));
  if (!act) return '';
  const en = structuredLang === 'en';
  const num = /^\d+$/.test(act.n) ? (en ? `Act ${act.n}` : `第${act.n}幕`) : act.n;
  return `${num} · ${act.title}`;
}

function exportStructured(fmt) {
  const sep = fmt === 'csv' ? ',' : '\t';
  const headers = ['PerformID', '幕', '类型', '场景描述', '台词数', 'VO数', '故事总结'];
  const csvEsc  = (v) => fmt === 'csv' ? `"${String(v).replace(/"/g, '""')}"` : String(v);
  const rows    = [headers.map(csvEsc).join(sep)];
  structuredRows.forEach(r => {
    rows.push([r.performId, actLabelOf(r.performId), r.type, sceneDescOf(r), r.lineCount, r.voCount, r.storySummary || ''].map(csvEsc).join(sep));
  });
  const BOM  = '﻿';
  const blob = new Blob([BOM + rows.join('\n')], { type: 'text/plain;charset=utf-8' });
  downloadBlob(blob, `${baseName(cnFileName)}_structured.${fmt}`);
}

/* ── Copy for Tracker: PerformID-keyed story context, TSV ──────
   Paste into the recording tracker as a "story context" column so
   directors read the roadmap next to each line. */
document.getElementById('copyTracker').addEventListener('click', async (e) => {
  const en = structuredLang === 'en';
  const lines = [(en ? 'PerformID\tStory context' : 'PerformID\t剧情备注')];
  structuredRows.forEach(r => {
    const act = actLabelOf(r.performId);
    const ctx = [act, r.storySummary || ''].filter(Boolean).join(' | ');
    lines.push(`${r.performId}\t${ctx}`);
  });
  await navigator.clipboard.writeText(lines.join('\n'));
  const btn = e.currentTarget;
  const old = btn.textContent;
  btn.textContent = 'Copied ✓';
  setTimeout(() => { btn.textContent = old; }, 1500);
});

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
   FEATURE 5 — CONSISTENCY CHECK
   ================================================================ */
document.getElementById('runConsistency').addEventListener('click', async () => {
  setError('consistencyError', '');
  const btn      = document.getElementById('runConsistency');
  const progress = document.getElementById('consistencyProgress');
  setBusy(btn, true);
  progress.style.display = 'block';
  pauseConsistency.show();

  try {
    // Step 1: validate active tab is a Google Sheet
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.url?.includes('docs.google.com/spreadsheets')) {
      throw new Error('The active tab is not a Google Sheet. Open the EN tracker sheet in the active browser tab, then click Check Consistency.');
    }
    const sheetIdMatch = tab.url.match(/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
    if (!sheetIdMatch) throw new Error('Could not extract spreadsheet ID from the URL.');
    const sheetId = sheetIdMatch[1];

    // Step 2: read all sheet tab names + gids from the Sheets DOM
    progress.textContent = 'Reading sheet tabs from DOM…';
    let tabsResult;
    try {
      tabsResult = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => {
          const els = document.querySelectorAll('.docs-sheet-tab');
          return [...els].map(el => {
            const name = el.querySelector('.docs-sheet-tab-name')?.textContent?.trim() || '';
            const gid  = (el.id || '').replace('sheet-tab-', '');
            return { name, gid };
          });
        },
      });
    } catch (e) {
      throw new Error(`Could not read sheet tabs from the page: ${e.message}. Fix: make sure the sheet is fully loaded and the extension was reloaded after the latest update.`);
    }

    const allTabs = tabsResult[0]?.result || [];
    // Numbered tabs: name starts with one or more digits followed by . or space
    const numberedTabs = allTabs.filter(t => /^\d+[.\s]/.test(t.name) && t.gid !== '');
    if (!numberedTabs.length) {
      throw new Error(`No numbered tabs found (e.g. "1. Scene Name"). Found tabs: ${allTabs.map(t => `"${t.name}"`).join(', ') || 'none'}. Make sure the sheet is fully loaded.`);
    }

    // Step 3: fetch CSV for each numbered tab
    const tabData = [];
    for (let i = 0; i < numberedTabs.length; i++) {
      const { name, gid } = numberedTabs[i];
      progress.textContent = `Fetching tab ${i + 1}/${numberedTabs.length}: ${name}…`;
      await pauseConsistency.wait(progress);
      let res;
      try {
        res = await fetchSheetCsv(tab.id, sheetId, gid);
      } catch (e) {
        progress.textContent = `Skipping "${name}": ${e.message}`;
        await new Promise(r => setTimeout(r, 600));
        continue;
      }
      const lines = parseENTracker(new TextEncoder().encode(res.text).buffer);
      if (lines.length) tabData.push({ name, lines });
    }

    if (!tabData.length) {
      throw new Error('No EN tracker data found in any numbered tab. Check that the tabs contain VO ID, Chinese Script, and English columns.');
    }

    // Step 4: build unique (CN → EN) pair map across all tabs
    progress.textContent = `Building term map across ${tabData.length} tab(s)…`;

    // cnText → Map<enText, Set<tabName>>
    const termMap = new Map();
    for (const { name, lines } of tabData) {
      const seen = new Set();
      for (const line of lines) {
        const cn = (line.chineseScript || '').trim();
        const en = (line.latestEN || line.englishScript || '').trim();
        if (!cn || !en) continue;
        const key = cn + '|||' + en;
        if (seen.has(key)) continue;
        seen.add(key);
        if (!termMap.has(cn)) termMap.set(cn, new Map());
        const variants = termMap.get(cn);
        if (!variants.has(en)) variants.set(en, new Set());
        variants.get(en).add(name);
      }
    }

    // Pre-detect exact CN matches with 2+ EN translations
    const directConflicts = [];
    for (const [cn, variants] of termMap) {
      if (variants.size > 1) {
        directConflicts.push({
          cn,
          variants: [...variants.entries()].map(([en, tabs]) => `"${en}" (${[...tabs].join(', ')})`),
        });
      }
    }

    // Step 5: build input for Claude
    progress.textContent = 'Sending to Claude for analysis…';
    await pauseConsistency.wait(progress);

    // Collect all unique (CN, EN, tab) pairs, capped at 800 to avoid context overflow
    const allPairs = [];
    for (const { name, lines } of tabData) {
      const seen = new Set();
      for (const line of lines) {
        const cn = (line.chineseScript || '').trim();
        const en = (line.latestEN || line.englishScript || '').trim();
        if (!cn || !en) continue;
        const key = cn + '|||' + en;
        if (seen.has(key)) continue;
        seen.add(key);
        allPairs.push(`[${name}] ${cn} → ${en}`);
      }
    }

    const pairsText = allPairs.slice(0, 800).join('\n');
    const tbRef = buildGlossaryRef(pairsText)
      .replace('Reference glossary — always use these established English translations:',
               'Established glossary (authoritative — flag any row deviating from these):');
    const directHint = directConflicts.length
      ? `\n\nPre-detected exact-match conflicts (definitely include these):\n${directConflicts.map(c => `· ${c.cn}: ${c.variants.join(' | ')}`).join('\n')}`
      : '';

    const systemPrompt = `You are a professional game localization translator and QA reviewer specializing in translation consistency.

You are reviewing an EN VO tracker spreadsheet that covers multiple story tabs. Each entry is: [Tab Name] Chinese source → English translation.

Your task:
1. Identify every case where the same Chinese term, name, or expression — whether an exact match or highly similar/synonymous in meaning — has been given 2 or more substantively different English translations across different tabs. Ignore trivial differences (punctuation, capitalisation, articles).
2. For each inconsistency, output in exactly this format:

CN: [the Chinese term or expression]
Variants: [English version 1] (Tab X) | [English version 2] (Tab Y) | …
Recommended: [your preferred translation and why, in one sentence]

3. After all inconsistency entries, add:

SUMMARY: X inconsistencies found. [One-sentence overall assessment of consistency quality.]

Write in plain prose, no markdown symbols.${tbRef}${directHint}`;

    const report = await callClaude(systemPrompt, `Translation pairs by tab (${allPairs.length} unique pairs across ${tabData.length} tabs):\n\n${pairsText}`);

    const ta = document.getElementById('consistencyText');
    ta.value = stripMarkdown(report);
    document.getElementById('consistencyOutput').style.display = 'block';
    requestAnimationFrame(() => autoResize(ta));
    document.getElementById('saveConsistencyToArchive').style.display = '';
    document.getElementById('saveConsistencyToArchive').onclick = () => {
      saveToArchive('Consistency', 'Consistency Report', ta.value);
    };
  } catch (err) {
    setError('consistencyError', err.message);
  } finally {
    progress.style.display = 'none';
    pauseConsistency.hide();
    setBusy(btn, false);
  }
});

document.getElementById('copyConsistency').addEventListener('click', () => {
  const txt = document.getElementById('consistencyText').value;
  navigator.clipboard.writeText(txt).then(() => {
    const b = document.getElementById('copyConsistency');
    b.textContent = 'Copied!';
    setTimeout(() => { b.textContent = 'Copy'; }, 1500);
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
