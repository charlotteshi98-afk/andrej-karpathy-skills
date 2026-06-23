---
name: google-sheets-pronunciation-guide
description: Google Apps Script that scans new rows in a Google Sheet column for words and annotates cells with notes linking to matching audio pronunciation files stored in a Shared Drive folder. Runs on a time-based trigger and only processes rows added since the last run.
license: MIT
---

# Google Sheets Pronunciation Guide

Automatically adds pronunciation audio links to cells in a Google Sheet by matching words against audio files in a Google Drive folder.

## How it works

1. On each scheduled run, the script reads only **new rows** in column T (since the last run).
2. Each cell's text is tokenized into words.
3. For each word, it checks if an audio file with that name (case-insensitive, any extension) exists in the configured Drive folder.
4. If a match is found, a **cell note** is added containing `word: <Drive link>` for each matched word in that cell.
5. The last-processed row index is saved via Script Properties so only new rows are processed on subsequent runs.

## Setup

### 1. Copy the script

Open your Google Sheet → **Extensions → Apps Script** → paste the contents of `pronunciation-guide.gs` into a new `.gs` file.

### 2. Enable the Drive Advanced Service

In the Apps Script editor: **Services (+ icon) → Drive API → Add**.

### 3. Set your folder ID

Replace `YOUR_SHARED_DRIVE_FOLDER_ID` at the top of the script with your Shared Drive folder ID.  
(Get it from the folder URL: `https://drive.google.com/drive/folders/<FOLDER_ID>`)

### 4. Set up the trigger

Run `createTrigger()` once from the Apps Script editor to register the daily trigger.  
Or: **Triggers (clock icon) → Add Trigger** and point it at `addPronunciationNotes`.

## Audio file naming

Files should be named after the word they pronounce, with any audio extension:
- `hello.mp3` → matches the word "hello"
- `Bonjour.m4a` → matches "bonjour" (case-insensitive)

## Configuration

| Variable | Default | Description |
|---|---|---|
| `SHARED_DRIVE_FOLDER_ID` | *(required)* | ID of the Drive folder containing audio files |
| `COLUMN_T` | `20` | Column index to scan (20 = column T) |
| `LAST_ROW_KEY` | `'lastProcessedRow'` | Script Properties key for tracking progress |
