# Style guide

Free-form prose describing the English writing conventions for this project.
Edit this file, then reload the extension at `chrome://extensions` to pick up changes.

This whole file is sent to Claude verbatim (minus this header block), so keep it under
roughly 2000 words — long guides cost tokens on every Glossary and Consistency run.

Used by: Glossary extraction (shapes the reasoning behind the three translation options)
and Consistency Check (shapes the Recommended line).

Everything above the `---` line is stripped before the guide is sent. Write your real
content below it and delete the examples.

---

## Register and tone

Dialogue is contemporary and colloquial. Contractions are expected in speech
("don't", "we're"); avoid them in UI strings and item descriptions, which read as
written text rather than spoken lines.

## Punctuation

Use an em dash without surrounding spaces for interruptions ("Wait—"). Use an ellipsis
character (…) rather than three periods. Chinese full-width punctuation must never
survive into English lines.

## Names and honorifics

Romanize character names in Hanyu Pinyin without tone marks unless the name already has
an established English rendering in the term base. Do not carry Chinese kinship terms
through literally — see `terms-of-address.tsv`.

## Numbers and units

Spell out numbers one through nine in dialogue; use digits for 10 and above, and for all
stat values, damage numbers, and timers.
