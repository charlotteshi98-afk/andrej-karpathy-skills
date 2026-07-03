# VO Script Summary Tool — Feature Reference

This document describes how each feature parses data, builds its input, and what is sent to Claude.

---

## Data Sources

### CN Script (`.xlsx`)

Parsed by `parseCNScript(arrayBuffer)`. Supports two sheet layouts:

**MASTER layout** (`总台本` in the sheet name)
- A row with a numeric value in the `PerformID` column starts a new scene.
- `Name` = scene type, `Textmap` = scene description.
- Subsequent rows until the next numeric PID are dialogue lines.

**VOICED layout** (all other sheet names)
- A row with a numeric `PerformID` in column 8 is a scene header.
- If that header row also has a valid `VOID` value → single-line scene (Tips/ongoing one-liner).
- If the header has no `VOID` → multi-line GAL scene; dialogue continues until the next scene header.

**Column resolution** (both layouts)  
Columns are found by exact label first, then by fuzzy matching (case-, space- and full-width-punctuation-insensitive, with CN/EN synonyms such as 角色/Speaker, 台词/Textmap, 演出ID/PerformID), with numeric fallbacks if nothing matches. If the header row cannot be found at all — or parsing yields 0 scenes/lines — a **manual column-mapping panel** appears under the upload zone: it guesses the header row (the densest of the first 10 rows), lists each column as `A: label`, and lets you assign the required fields, then reparses.

| Field | Labels searched | Fallback col |
|---|---|---|
| Speaker / Scene type | `Name` | 1 |
| Dialogue / Scene title | `Textmap` | 2 |
| Comment | `Comment` | 4 |
| PerformID | `PerformID` | 7 |
| VO ID | `VOID` → `音频序号（通用）` → `音频序号` | 23 |

**VO ID validity rule**: a cell is treated as a valid VO ID if it is non-empty AND does not start with a Chinese character (CJK range `一–鿿`). This prevents Chinese header labels that bleed into data rows from being counted as VO IDs.

Each parsed scene is:
```
{ performId, type, description, lines: [{ speaker, text, hasVO, comment }] }
```

---

### EN Tracker (`.xlsx` upload or Google Sheets scan)

Parsed by `parseENTracker(arrayBuffer)`. Works on the first sheet (upload) or a specific gid (scan).

- Finds the header row by scanning for a cell containing `"VO ID"`.
- Column resolution by label, with numeric fallbacks:

| Field | Labels searched | Fallback col |
|---|---|---|
| VO ID | `VO ID` | 1 |
| Character (CN) | `角色（中文）`, `CharCHS` | 2 |
| Character (EN) | `Character` | 3 |
| Performance Notes | `Performance Notes`, `性能备注` | 8 |
| Chinese Script | `Chinese Script`, `中文台词` | 9 |
| English Script | `English Script`, `英文台词` | 10 |
| Latest EN | `Latest EN`, `最新英文` | 19 |
| VOID | `VOID`, `音频序号（通用）`, `音频序号` | 23 |
| PerformID | `PerformID` | 25 |

- Rows where `VO ID` is empty or starts with a Chinese character are skipped.

Each parsed line is:
```
{ voId, charCHS, character, chineseScript, englishScript, latestEN, performanceNotes, performId }
```

---

### Term Base (`.xlsx` upload)

Read from the first sheet. Column A = CN term, Column B = EN translation.  
Stored as `termBaseMap: Map<cnTerm, enTerm>` and **persisted in `chrome.storage.local`** — it survives closing the panel and is restored automatically on open. Used in:
- Glossary extraction (CN keys excluded from extracted terms; filtered from results)
- All English summary/analysis generation (Summary and Comprehensive, with or without an EN tracker)
- Consistency Check (used as authoritative translations; deviations flagged first)

To save tokens, only glossary entries whose CN or EN term actually appears in the source text are injected into a prompt (capped at 300 entries).

---

### Google Sheets Scan

Because the side panel page is blocked by CORS when fetching `docs.google.com` directly, all Google Sheets access uses `chrome.scripting.executeScript` to run fetch calls inside the active Sheets tab (shared helper `fetchInSheetTab`). The tab's own session cookies are used, so the user must be logged in to Google. Network errors are caught inside the injected script, and every failure mode (blocked injection, closed tab, sign-in redirect, 401/403/404) maps to a specific message with a fix.

The Scan button in the Summary tab fetches only the currently active sheet tab (`gid` read from the URL hash).

---

## Feature 1 — Generate Summary

**Tab**: Summary  
**Button**: Generate Summary

### Input

| Language | EN tracker loaded? | Data used |
|---|---|---|
| 中文 | — | CN scenes → `buildScriptDigest()` |
| English | Yes | EN tracker lines: `[VO ID] Character: Latest EN (or English Script)` |
| English | No (falls back) | CN scenes → `buildScriptDigest()` + term base glossary |

`buildScriptDigest(scenes)` formats each scene as:
```
=== 场景N [PID:xxx] === [type] [description]
[VO]  Speaker: line
      Speaker: line   ← no VO ID
```

### Claude call

1 call. `max_tokens: 4096`.

**System prompt variables**: word length (from dropdown), selected focus pills (Characters & relationships / Key plot events / Themes & tone / VO content summary).

**CN mode prompt summary**:
> You are a senior game localization producer. Write a script analysis brief of ~N words in Simplified Chinese. Focus on: [pills]. Plain text only, flowing prose, section headers as 【…】. No markdown.
> [+ Reference glossary if term base loaded]

**EN with tracker prompt summary**:
> Same role. Write ~N words in English. Focus on: [pills]. Plain text, flowing prose.

**EN without tracker prompt summary**:
> Same role. The source is in Chinese — write the brief in English, translating as you go. Use the reference glossary for established terms. After the brief, add 【Terms needing unified translation】 listing any CN names/terms not covered by the glossary with the provisional English used.

**Post-processing**: `stripMarkdown()` removes any stray `**`, `##` markers.

---

## Feature 2 — Comprehensive Analysis

**Tab**: Summary  
**Button**: Comprehensive Analysis

Two-stage map-reduce. More thorough but slower — makes multiple Claude calls.

### Stage 1 — Segment summaries

Input digest is split into segments of ~9 000 characters, breaking on `\n\n=== ` (scene boundaries) where possible.

For each segment: 1 Claude call.

**Prompt (EN)**:
> You are a script analyst. Summarize this VO script segment in 100–150 English words covering plot, characters, emotional beats, and tone. Plain prose, no markdown.

**Prompt (CN)**:
> 你是一名剧本分析师。请用100–150个中文字总结这段配音剧本片段，涵盖剧情事件、角色、情感节奏与基调。纯文字，不要markdown符号。

When running EN-without-tracker, the CN source is used and the segment prompt says to write the summary in English, including the reference glossary.

### Stage 2 — Final analysis

1 Claude call, using all segment summaries as input.

**Prompt summary** (5 fixed sections):
> You are a master script analyst. Write a comprehensive in-depth analysis from these segment summaries. Sections: 1. Narrative Structure & Plot Progression, 2. Thematic Analysis, 3. Character Development & Psychology, 4. Setting, Atmosphere & Symbolic Elements, 5. Narrative Voice & Stylistic Approach. ~1500–2000 characters, flowing prose, plain text, section headers as 【…】.

**Post-processing**: `stripMarkdown()`.

---

## Feature 3 — Structured Scene Breakdown

**Tab**: Structured  
**Button**: Generate Table

Generates a per-scene table with auto-summarized story notes. Makes 1 + N Claude calls (N = number of scenes).

### Pass 1 — Short descriptions (1 call)

Full script digest sent to Claude.

**Prompt**:
> You are a game localization producer. For each scene (=== 场景N [PID:xxx] ===), output one pipe-delimited line: PerformID|ShortDescription (≤12 Chinese characters). Output ONLY the data lines, no headers.

Result is a `pid → shortDesc` map.

### Pass 2 — Story summaries (batched)

Scenes are grouped into batches of ~8 000 characters and each batch is sent in ONE call (instead of one call per scene — far fewer tokens and rate-limit hits). Each scene block is:
```
[PID:xxx] [type] description
[VO]  Speaker: line
      Speaker: line
```

**Prompt**:
> For EACH scene output exactly one pipe-delimited line: `PID|summary`. The summary is ≤30 Chinese characters for a localization team, focusing on key emotional beats and story developments. Output ONLY the data lines.

Scenes with zero VO lines are prefixed `【无配音场景】`.

**Error handling**: if a batch hits a 429 / rate-limit, the tool waits 30 seconds and retries once. If 2 batches fail consecutively, the table stops and reports the last error. Real error text is shown per row.

**Table columns** (toggleable via Cols pills): PerformID · 类型 · 场景描述 · 台词 · VO · 故事总结.  
Column widths are resizable (CSS `resize: horizontal` on `<th>`). Text wraps in cells.

---

## Feature 4 — Glossary Extraction

**Tab**: Glossary  
**Button**: Extract Terms

### Input

Full CN script digest. If term base is loaded: CN keys are listed in the prompt to skip; extracted results are also post-filtered to remove any term whose CN key is in the term base.

### Claude call

1 call.

**Prompt**:
> You are a game localization linguist. Extract key localization terms from this Chinese VO script. For each term output a pipe-delimited line:
> `CN Term|Category|Context|Option A|Reason A|Option B|Reason B|Option C|Reason C`
> Categories: Character Name / Location / Item / Skill / Faction / Cultural Term / Other
> Options: 3 English translation candidates with brief reasoning
> Output ONLY data lines, no header, no extra text. Extract 20–40 terms.
> [+ Term base: already translated — skip these CN terms]

**Output columns displayed** (preview table, first 12 terms): CN Term · Category · Context · Option A · Option B · Option C.  
Full data (all 9 columns) is included in the TSV/XLSX export.

---

## Feature 5 — Consistency Check

**Tab**: Consistency  
**Button**: Check Consistency

Checks all numbered tabs (e.g. `1. 主线`, `2. 支线`) of the Google Sheet open in the active browser tab for translation inconsistencies.

### Step 1 — Read tab list from DOM

`chrome.scripting.executeScript` injects into the Sheets tab:
```js
document.querySelectorAll('.docs-sheet-tab')
  .map(el => ({ name: el.querySelector('.docs-sheet-tab-name')?.textContent, gid: el.id.replace('sheet-tab-','') }))
```

Tabs are filtered to those whose names start with digits followed by `.` or space.

### Step 2 — Fetch each tab's CSV

For each numbered tab: `executeScript` injects a `fetch(exportUrl, { credentials:'include' })` inside the Sheets tab. The response is validated (checks for HTML login-redirect). Tabs that return errors are skipped with a warning in the progress note.

Export URL format: `https://docs.google.com/spreadsheets/d/{id}/export?format=csv&gid={gid}`

### Step 3 — Build term map

All tabs' lines are parsed via `parseENTracker`. A map is built:
```
CN text → Map<EN text, Set<tab name>>
```
De-duplication is per-tab (identical CN+EN pairs within a tab are counted once).

Any CN text that maps to 2+ distinct EN texts is flagged as a direct conflict before Claude is involved.

### Step 4 — Claude analysis

Up to 800 unique `[Tab Name] CN → EN` pairs are sent to Claude.

**System prompt**:
> You are a professional game localization translator and QA reviewer. Identify every case where the same Chinese term or expression — exact match or highly similar in meaning — has 2 or more substantively different English translations across tabs. Ignore trivial differences (punctuation, capitalisation, articles).
>
> For each inconsistency output:
> ```
> CN: [term]
> Variants: "EN version 1" (Tab X) | "EN version 2" (Tab Y)
> Recommended: [preferred translation and one-sentence reason]
> ```
> After all entries: `SUMMARY: X inconsistencies found. [One-sentence assessment.]`
>
> Plain text, no markdown symbols.
> [+ Established glossary if term base is loaded — deviations flagged first]
> [+ Pre-detected exact-match conflicts as a hint]

**Post-processing**: `stripMarkdown()`.

---

## Shared Utilities

### `callClaude(systemPrompt, userPrompt)`
- Model: `claude-sonnet-4-5`
- `max_tokens: 4096`
- Header: `anthropic-dangerous-direct-browser-access: true`
- Error mapping: 401 → key invalid, 429 → rate limit (wait ~1 min), 529/503 → overloaded

### `stripMarkdown(text)`
Removes `##`/`###` heading markers, `**bold**`, `*italic*` asterisks. Converts `- ` / `* ` list markers to `· `. Applied to all Claude output before display.

### `autoResize(textarea)`
Sets `height: auto` then `height = scrollHeight` inside a `requestAnimationFrame` so the measurement happens after the layout paint.

### Archive
All generated outputs have a **Save** button (visible after generation). Each saved entry stores: timestamp, source tag (CN / EN / Glossary / Structured / Consistency), label, full content. Entries persist in `chrome.storage.local`. Viewable/deletable in the Archive tab.
