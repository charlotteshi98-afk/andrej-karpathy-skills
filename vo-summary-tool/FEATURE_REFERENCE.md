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

### Reference Assets (bundled files — no upload)

Three files ship inside the extension under `reference/` and are loaded on open by
`loadReferenceAssets()`. There is no upload UI: edit a file, then reload the extension at
`chrome://extensions`. `popup.html` is an extension page, so `chrome.runtime.getURL` + `fetch`
reaches them without `web_accessible_resources`.

| File | Format |
|---|---|
| `reference/term-base.tsv` | `CN Term` ⇥ `EN Term` |
| `reference/terms-of-address.tsv` | `Ver. Added` ⇥ `Character` ⇥ `Refers To` ⇥ `CN Term` ⇥ `EN Term` ⇥ `Notes` ⇥ `Examples` |
| `reference/style-guide.md` | Free prose; everything above the first `---` rule is a format header and is stripped |

`parseTsv(text, headerFirstCell)` drops blank lines, `#` comments, and the header row identified by
its first cell. A missing or comment-only file is not an error — the prompts simply carry no
reference block. The Glossary tab shows a one-line read-only status (`N terms · M address forms ·
style guide loaded`) or the parse error; this is the only place a malformed TSV becomes visible.

**Terms of address & speech habits.** The layout mirrors the source spreadsheet 1:1 so a re-export
drops straight in — `Ver. Added` is carried for provenance and never injected. A row is usable if it
names a `Character`. Two kinds of row:

- **Address term** — has a CN and EN term. Rendered as
  `Character → Refers To: CN → "EN" — Notes e.g. Example`.
- **Speech habit** — has no CN/EN term, only a note describing how that character writes or speaks
  (texts in lowercase, leans on ellipses, omits punctuation entirely). Rendered as
  `Character — speech habit (Refers To): Notes`.

A cell that held a line break in the spreadsheet stores it as a literal `\n` and renders as ` / `,
since TSV is line-oriented.

**Relevance.** Speech habits and rows whose `Character` is `General` apply project-wide and have no
term to match on, so they are **always** included. Every other row must have its CN term, EN term,
`Character`, or `Refers To` appear in the source text. Fully matched, the block runs ~6 KB
(~1,900 tokens); with no matches it is ~2.7 KB of habits and General conventions.

**Term base assembly.** `effectiveTermBase()` merges two sources:
1. `autoGlossaryFromTracker(enLines)` — derived from a loaded EN tracker with no API call:
   character-name pairs (`角色（中文）` → `Character`), plus short term-like rows where the CN cell
   is ≤8 characters with no sentence punctuation and the EN cell is ≤6 words. Full dialogue lines
   are excluded — they are sentences, not terms.
2. `reference/term-base.tsv` — the curated file, which **wins on conflicting CN keys**.

**Where each asset is used**

| Asset | Summary | Comprehensive | Structured | Glossary | Consistency |
|---|---|---|---|---|---|
| Term base | English output only | English output only | English mode only | skip list | skip rule |
| Terms of address & speech habits | — | — | — | flag conflicts | flag conflicts |
| Style guide | — | — | — | option reasoning | Recommended line |

中文-output summaries deliberately receive no glossary — the term base is CN→EN and would only
cost tokens there.

To save tokens, only entries whose CN or EN term actually appears in the source text are injected
(term base capped at 300 entries, terms of address at 200). Because the EN-with-tracker digest is
English only, relevance is matched against `trackerMatchText()` — both sides of the tracker — so CN
keys can still match.

**Consistency Check uses the curated file alone**, not `effectiveTermBase()`: the tracker-derived
glossary is built from the same unverified sheet data being audited, so trusting it would suppress
the very inconsistencies the check exists to find.

---

### Google Sheets Scan

Because the side panel page is blocked by CORS when fetching `docs.google.com` directly, all Google Sheets access uses `chrome.scripting.executeScript` to run fetch calls inside the active Sheets tab (shared helpers `fetchSheetCsv` → `fetchInSheetTab`). The tab's own session cookies are used, so the user must be logged in to Google.

Two CSV endpoints (`…/gviz/tq?tqx=out:csv&gid=N`, then `…/export?format=csv&gid=N`) are each tried over two transports, first success wins:
1. Background service-worker fetch — uses the extension's `host_permissions` (including `*.googleusercontent.com` for the export redirect), immune to the Sheets page's CSP
2. Fetch injected into the Sheets tab — always carries the page's cookies, but subject to the page's own security policy

Network errors are caught inside the injected script, and every failure mode (blocked injection, closed tab, sign-in redirect, 401/403/404) maps to a specific message with a fix.

The Scan button in the Summary tab fetches only the currently active sheet tab (`gid` read from the URL hash).

---

## Feature 1 — Generate Summary

**Tab**: Summary  
**Button**: Generate Summary

### Input

| Language | EN tracker loaded? | Data used |
|---|---|---|
| 中文 | — | CN scenes → `buildScriptDigest()` (no glossary) |
| English | Yes | EN tracker lines: `[VO ID] Character: Latest EN (or English Script)` + glossary |
| English | No (falls back) | CN scenes → `buildScriptDigest()` + glossary |

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

**EN with tracker prompt summary**:
> Same role. Write ~N words in English. Focus on: [pills]. Plain text, flowing prose.
> [+ Reference glossary, matched against `trackerMatchText(enLines)` so CN keys resolve]

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

The reference glossary is appended to the segment prompt in **both** English paths — with a tracker (matched against `trackerMatchText()`) and without one (matched against the CN digest). When running EN-without-tracker, the CN source is used and the segment prompt also says to write the summary in English. 中文 mode gets no glossary.

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
> For EACH scene output exactly one pipe-delimited line: `PID|summary`. The summary is ≤30 Chinese characters (中文 mode) or ≤20 English words (English mode) for a localization team, focusing on key emotional beats and story developments. Output ONLY the data lines.

A 中文/English toggle next to Generate Table selects the output language for both the short descriptions (pass 1) and story summaries (pass 2). In English mode the reference glossary (if any) is injected into both prompts, and into the acts prompt. Scenes with zero VO lines are prefixed `【无配音场景】` (or `[No VO]` in English mode).

### Story roadmap — separate button (pass 1b)
Two buttons share the same pipeline via `runStructured(withRoadmap)`:
- **Generate Table** — the plain scene table, unchanged; the acts pass never runs.
- **Generate Roadmap** — inserts one extra call between passes 1 and 2 that groups scenes into 3–6 sequential acts, each with a short title and a one-sentence milestone beat (`ACT|n|title|beat|PID1,PID2,…`). Each act renders as a highlighted band row above its scenes, reading top-down like a roadmap. Scenes the model leaves out of every act still render after the bands. If the acts call fails, the plain table renders instead.

The act label (`第2幕 · 转折` / `Act 2 · …`) is added as a `幕` column to CSV/TSV exports and the archive copy (empty for plain-table runs).

### Scene description translation
`sceneDescOf(row)` is the single source for the displayed and exported 场景描述: the generated short description (translated in English mode), falling back to the raw script text. Exports previously wrote the raw Chinese `description` regardless of language — they now use this helper too, and the raw text remains the cell tooltip.

Scenes that pass 1 skips would fall back to raw Chinese, so missing PIDs are retried in chunks of 40 for up to two extra rounds before the fallback applies. Both prompts also require one line per scene and forbid passing Chinese through in English mode.

### Copy for Tracker
A **Copy for Tracker** export button copies a two-column TSV (`PerformID`, `剧情备注` / `Story context`) where each row is `act label | scene summary`, keyed by PerformID — paste it into the recording tracker as a story-context column so directors can follow the roadmap next to each line during sessions.

**Error handling**: if a batch hits a 429 / rate-limit, the tool waits 30 seconds and retries once. If 2 batches fail consecutively, the table stops and reports the last error. Real error text is shown per row.

**Table columns** (toggleable via Cols pills): PerformID · 类型 · 场景描述 · 台词 · VO · 故事总结.  
Column widths are resizable (CSS `resize: horizontal` on `<th>`). Text wraps in cells.

---

## Feature 4 — Glossary Extraction

**Tab**: Glossary  
**Button**: Extract Terms

### Input

Full CN script digest. If a term base is loaded: CN keys are listed in the prompt to skip; extracted results are also post-filtered to remove any term whose CN key is in the term base.

Terms of address are **not** skipped this way — the script may use an address form that contradicts the standing convention, which is worth seeing. The table is injected as reference and the prompt asks the model to prefix such a term's `Context` with `⚠ 与称谓表不一致: ` followed by the convention it breaks. The style guide, if present, constrains the reasoning behind the three options.

### Claude call

1 call.

**Prompt**:
> You are a game localization linguist. Extract key localization terms from this Chinese VO script. For each term output a pipe-delimited line:
> `CN Term|Category|Context|Option A|Reason A|Option B|Reason B|Option C|Reason C`
> Categories: Character Name / Location / Item / Skill / Faction / Cultural Term / Other
> Options: 3 English translation candidates with brief reasoning
> Output ONLY data lines, no header, no extra text. Extract 20–40 terms.
> [+ Terms of address — still extract these, but flag script usage that contradicts them]
> [+ Style guide — the option reasoning must comply with it]
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

Any CN text that maps to 2+ distinct EN texts is a candidate direct conflict. A candidate whose CN key is in `reference/term-base.tsv` is then **dropped when every variant agrees with the base** — that term is settled, and reporting it is noise. It is kept only when some variant contradicts the base, tagged `deviatesFromBase` so the prompt can label it `[TERM BASE DEVIATION]` alongside the approved rendering.

`sameTranslation(a, b)` decides agreement, ignoring case, surrounding whitespace, a leading article, and trailing punctuation — the same trivial differences the prompt is told to ignore.

Only the curated `reference/term-base.tsv` counts here, never `effectiveTermBase()`: the tracker-derived glossary is built from this same unverified sheet data, so trusting it would suppress the very inconsistencies the check exists to find.

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
>
> Then, numbered 4/5/6 without gaps — only the rules whose reference file has content:
> 4. Terms in the established glossary are settled. Do NOT report one when the tabs render it the way the glossary says. Report it ONLY when a tab contradicts the glossary, and start that entry's CN line with `[TERM BASE DEVIATION]`.
> 5. A form of address that contradicts the terms of address table is an inconsistency, reported in the same CN / Variants / Recommended format.
> 6. Every `Recommended` line must comply with the style guide.
>
> [+ Established glossary, terms of address, style guide — each relevance-filtered against the pairs text]
> [+ Pre-detected exact-match conflicts as a hint, term-base deviations labelled]

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

### Pause / Resume
Comprehensive Analysis, Structured table, and Consistency Check show a **Pause** button next to their progress note while running. Pausing takes effect between API calls: the current call finishes, then the loop waits until Resume is clicked. (The plain Summary is a single call, so it has no pause.)

### Output boxes fit their content
Result areas size to their data rather than scrolling internally: the three output textareas (`.output-text`) are grown by `autoResize`, re-fitted by `autoResizeAllOutputs()` on window resize and font-size change; `.output-review` and the structured `.table-scroll` no longer cap their height (the table still scrolls horizontally). Script input boxes keep their fixed height, and the archive preview stays capped so the entry list remains navigable.

### `autoResize(textarea)`
Sets `height: auto` then `height = scrollHeight` inside a `requestAnimationFrame` so the measurement happens after the layout paint.

### Archive
All generated outputs have a **Save** button (visible after generation). Each saved entry stores: timestamp, source tag (CN / EN / Glossary / Structured / Consistency), label, full content. Entries persist in `chrome.storage.local`. Viewable/deletable in the Archive tab.

---

## Using a company API endpoint

The tool calls the Anthropic Messages API by default. An **Endpoint** button in the top bar opens settings for routing through a company gateway instead (LiteLLM, Portkey, or any Anthropic-Messages-compatible proxy).

| Setting | Stored as | Blank means |
|---|---|---|
| Base URL | `apiEndpoint` | `https://api.anthropic.com` |
| Model | `apiModel` | `claude-sonnet-4-5` |
| Auth header | `authStyle` | `auto` |

All three default to the public API, so existing setups are unaffected.

**Which key you have.** A key starting with `sk-ant-` is a direct Anthropic key and needs no Base URL. A key starting with `sk-` *without* `ant-` is a gateway virtual key and only works against that gateway's URL.

**URL handling.** `/v1/messages` is appended unless the saved URL already ends in a `/vN/messages` path, so both the root URL and a full endpoint path work. Trailing slashes are stripped. Only `https://` is accepted — Chrome blocks plaintext HTTP from extensions.

**Auth styles.** `auto` sends `x-api-key` and, for non-default endpoints, also `Authorization: Bearer` — gateways differ in which they read. The explicit `x-api-key` and `bearer` options send only that one, for gateways that reject the other.

**Host permissions.** The manifest declares `optional_host_permissions: ["https://*/*"]`. `ensureHostPermission(raw)` calls `chrome.permissions.request()` for the URL's origin and is shared by both Save & Test and Find models — Find models originally skipped this check, so calling it before ever running Save & Test failed both model-list endpoints with an unexplained "Failed to fetch" (the background worker had no permission to reach the host yet).

**CORS.** Claude calls now go through the background service worker (`type: 'callClaude'`), whose `host_permissions` bypass CORS — company gateways rarely send CORS headers for extension origins, which would otherwise fail with "Failed to fetch".

**Path auto-discovery.** If the test returns 404 — host reachable, API mounted elsewhere — Save & Test retries a bounded list of common gateway prefixes (`/anthropic`, `/api/anthropic`, `/api`, `/claude`, `/anthropic/v1`) and saves whichever answers, updating the input box. Non-404 failures (401/403, network) do not trigger probing, since the path is not the problem. If every candidate fails, the URL the user typed is restored and the message directs them to ask their IT team.

**Find models.** Queries `{base}/v1/models`, falling back to `{base}/models`, and reads `data[].id` — the shape both Anthropic and OpenAI-style gateways return. Every returned model renders as a clickable pill in an always-visible list (`#modelList`) — a native `<datalist>` was tried first but Chrome's autocomplete filters suggestions against whatever text is already in the box, which silently hid most of the list once a model name was pre-filled. Models matching Sonnet 5 or DeepSeek V4 Pro (`isRecommendedModel()`) are starred and sorted first, and one is preselected; clicking any pill switches the selection and saves it. Gateways that expose no model listing produce a message directing the user to ask IT.

**Model errors are not auth errors.** A 400/403/404 whose body mentions a model (e.g. `no permission to access model: …`) reports the model as the problem and points at Find models, rather than blaming the key — the key and URL are already proven correct at that point.

**Save & Test** persists the settings then issues a one-token request, reporting either a connection confirmation or the specific failure (404 → wrong Base URL, 401/403 → key or auth-header mismatch, non-Anthropic body → endpoint is not Messages-API compatible).

**Response shape.** Anthropic responses are a list of content blocks, not a single answer — with extended thinking on, the model the gateway routes to may put a `thinking` block before the `text` block, so the reader searches `content[]` for the block with `type: "text"` rather than assuming index 0. Falls back to OpenAI shape (`choices[0].message.content`) for gateways (LiteLLM proxies especially) that reply in chat-completions format. If nothing matches, the error includes a truncated raw snippet of the actual response so the failure can be diagnosed without a browser dev console.
