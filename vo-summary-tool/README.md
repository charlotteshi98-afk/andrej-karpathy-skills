# VO Script Summary Tool

A Chrome browser extension for game localization teams. Analyzes Chinese VO scripts and English VO trackers using Claude AI to generate summaries, structured tables, glossaries, and QA reviews.

---

## Installation (5 steps)

1. **Download the extension folder**
   Save the `vo-summary-tool` folder to your computer (keep all files together).

2. **Open Chrome Extensions**
   In Chrome, go to `chrome://extensions` in the address bar.

3. **Enable Developer Mode**
   Toggle the "Developer mode" switch in the top-right corner of the Extensions page.

4. **Load the extension**
   Click "Load unpacked", then select the `vo-summary-tool` folder you saved in step 1.

5. **Enter your API key**
   Click the extension icon in your toolbar. Paste your Anthropic API key (`sk-ant-…`) into the key field and click **Save**.

---

## Usage

### CN Script (all tabs except EN Review)
- Drop your Chinese master script `.xlsx` file into the upload zone.
- The file must contain a sheet with "总台本" in the name (or use the first sheet).
- The header row must include a "PerformID" column.

### General Tab
- Choose summary length, toggle content options (Characters, Plot, Themes, VO), and select language.
- Click **Generate Summary** to produce an AI summary.

### Structured Tab
- Click **Generate Table** to build a scene-by-scene breakdown.
- GAL/Galge scenes receive an additional story summary (processed per-scene).
- Export the result as CSV or TSV.

### Reference files
Three files inside the extension folder hold your project's standing reference material. There is
no upload step — edit the file, then reload the extension at `chrome://extensions`.

| File | What goes in it |
|---|---|
| `reference/term-base.tsv` | Approved CN → EN translations, one per line, tab-separated |
| `reference/terms-of-address.tsv` | How characters address one another: CN, EN, who says it to whom, notes |
| `reference/style-guide.md` | Free prose on register, punctuation, names, numbers |

Blank lines and lines starting with `#` are ignored, so each file documents its own format at the
top. The term base feeds the English summaries, the structured table in English mode, and the
Glossary and Consistency tabs; the style guide and terms of address feed the Glossary and
Consistency tabs. The Glossary tab shows a one-line status of what loaded — check it there if a
file looks like it isn't being picked up.

### Glossary Tab
- Click **Extract Terms** to identify localization terms and generate 3 English translation options each.
- Terms already in `reference/term-base.tsv` are skipped.
- An Excel file is automatically downloaded.
- A preview of the first 12 terms is shown in the popup.

### EN Review Tab
- Upload your EN VO tracker `.xlsx` (must contain a "VO ID" column).
- **EN Summary** — AI overview of the English script.
- **EN Table** — groups lines by Perform ID with brief summaries.
- **Review** — requires both CN and EN files; produces a QA report covering accuracy, tone, and performance notes.

---

## Requirements

- Chrome 88+ (Manifest V3 support)
- An [Anthropic API key](https://console.anthropic.com/) with access to `claude-sonnet-4-20250514`
- CN script `.xlsx` with a "总台本" sheet and "PerformID" column header
- EN tracker `.xlsx` with a "VO ID" column header (for EN Review features)
