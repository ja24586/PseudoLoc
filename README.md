# Shibb — a pseudolocalization plugin for Figma

# Overview
Find localization bugs before sending copy to vendors or engineering. Shibb
generates realistic pseudolocalized content, automatically detects layout
failures, protects localization placeholders, simulates RTL and multilingual
edge cases, and helps designers catch internationalization issues long before
they reach production.

# Features
- 📦 Finds hidden Auto Layout issues
- ✏️ Checks inferred containers to catch text-nesting errors
- 🌍 Realistic multilingual pseudolocalization- not just Latin with accents
- 🔒 Recognizes and ignores placeholder tokens & regex
- 📏 Applies IBM's dynamic text expansion rules based on visual length, not
charater count
- 📐 Checks for collisions between lines
- 🔤 Script-aware dynamic Noto assignment & missing script check
- 🎯 Deterministic pseudoLOC output persists across runs
- 📋 Summary report describes each issue, with exportable log
- ↔️ RTL (Arabic & Hebrew) option
- 🈳 True edge-case stress testing via CJK, Thai, & Vietnamese charsets

## Details

- Shibb replaces each string in your selection with **visually-similar
  homoglyphs** (Greek, Cyrillic, and accented Latin look-alikes — e.g. Latin
  `O` → Greek `Ο`/`Ω` or Cyrillic `О`), then pads these with a mix of Thai,
  Cyrillic, CJK, and Vietnamese (multi-diacritic-stack) characters to hit a
  target expansion length. Expansion is banded by source string length,
  calibrated against IBM's "Guidelines to design global solutions" table (as
  reproduced by [W3C i18n](https://www.w3.org/International/articles/article-text-size.en.html)):
  short strings (≤10 chars) get +200%, tapering down to +30% for strings
  over 70 characters. Targets are computed on **grapheme count**
  (`Intl.Segmenter`, with a plain-character-count fallback if that API isn't
  available in a given Figma app version), not raw string length, so
  combining marks don't inflate the sizing math.
- Pseudolocalized text is wrapped in `[ ]` — a standard pseudoloc convention
  that makes clipped or truncated brackets easy to spot visually.
- **Output is deterministic per node.** The same text layer, run again with
  unchanged source text, produces the same pseudolocalized string and the
  same overflow verdict every time — seeded per node (from its ID and
  current text), not randomized per run.
- Optional **RTL toggle**: mixes Arabic and Hebrew word-chunks (including
  Arabic-Indic digits and combining harakat/niqqud) into the padding,
  roughly one word in three, so strings end up with embedded RTL runs
  rather than a segregated block — closer to how real bidi bugs show up in
  mixed-language product copy. A genuine strong-RTL character leads the
  line when this is on, so the paragraph's actual reading direction flips,
  with the bracket and source text rendering as an embedded LTR island
  inside it — similar to how real RTL-locale UI often looks.
- Optional **vertical edge-case characters** toggle: draws more heavily from
  pre-assembled multi-mark sequences (a Thai consonant with a vowel *and*
  tone mark stacked together, Vietnamese letters with two combining marks
  at once, Arabic consonant+shadda gemination when RTL is also on) rather
  than isolated marks scattered through ordinary padding. Recommended for
  Thai, Vietnamese, and Arabic — Google's Material Design "Tall" script
  tier also includes Hindi (Devanagari) and Telugu, which aren't in this
  plugin's character set or font-assignment logic yet. Hebrew, despite
  having niqqud, is classified "English-like" by Google, not "Tall" — it's
  in the RTL toggle for bidi testing, not vertical stress.
- **Per-script font assignment**: Thai, Arabic, Hebrew, and CJK characters
  each get their own Noto family (`Noto Sans Thai/Arabic/Hebrew/JP`) rather
  than falling back to core Noto Sans, which only covers Latin, Greek, and
  Cyrillic. A failed font load for a given family falls back to Noto Sans
  for that run and is logged as an error with a direct link to install it.
- **Overflow detection measures against the original typeface**, not Noto
  Sans, for fixed-size text nodes (`textAutoResize: NONE`) — the plugin
  temporarily auto-resizes the node in its original font to measure real
  overflow, then restores the original box exactly (size and position).
- **Auto-layout / "hug" text nodes** get a complementary check: growth is
  flagged when it escapes an ancestor with `clipsContent: true` further up
  the tree.
- **Implied-container detection** catches two patterns neither of the above
  checks can see: (1) a decorative shape drawn as a "text field" with the
  actual text sitting on top as an unrelated, unclipped sibling layer, and
  (2) a direct parent frame with a deliberate, explicit size that isn't set
  to clip (e.g. a plain frame, or an auto-layout frame with at least one
  axis not set to hug). Both infer containment geometrically rather than
  structurally, and both are labeled "(inferred)" in the issue message,
  which also suggests enabling `Clip content` or confirming the text is
  meant to be unconstrained.
- A sized-but-non-clipping frame is a mixed bag depending on context — a
  real risk for ordinary translatable content, but a reasonable pattern for
  system-chrome mockups ("Status Bar," "Time," "Battery," "Connections,"
  the standard layer names from official iOS/Android device-mockup kits)
  representing OS-rendered elements no translator ever touches. **The
  plugin already skips locked layers**, so the simplest way to exclude
  status-bar chrome from testing is to lock those layers in your source
  file — no naming convention or exceptions list required.
- **Placeholder/interpolation tokens are protected.** `{{name}}`,
  `${username}`, `{count}`, `%s`/`%d`/`%1$s` pass through untouched; only
  the surrounding text gets pseudolocalized.
- **Style preservation**: font size, letter spacing, and (if explicitly
  set) line height are captured from the original typeface and reapplied
  to the Noto replacement, so it approximates the source typeface's
  density rather than defaulting to Noto's own spacing.
- Locked and hidden text layers, and empty text layers, are skipped
  automatically and counted in the results.

## How it runs

Two commands, both invoked from the Figma plugin menu:

- **Run** executes immediately against the current selection — no panel,
  no button, no checkboxes to set first. It reports back via a compact
  native toast: "Issues: 3, Skipped: 1, Errors: 2" (each segment only
  appears if its count is above zero), or "No issues found" if the design's
  clean. If there's anything worth reviewing, the toast includes a
  **Details** button that opens the full panel on demand.
- **Settings** opens a separate small panel with three toggles (RTL,
  vertical edge-case characters, always show summary) plus a link to file
  feedback or feature requests. Changes autosave immediately — no Save
  button — and persist across every file you open on this machine (via
  `figma.clientStorage`, scoped per-user and not synced across machines).
  Turning "Always show summary" on skips the toast entirely and opens the
  full panel on every run, even a clean one.

## The Summary report

The post-run Summary displaces:
1. LOC issues found,
2. Locked/hidden layers skipped,
3. Empty layers skipped, and
4. Errors, such as missing typefaces.


Clicking through Back/Next jumps the canvas selection and viewport to the
relevant layer, and the panel checks whether its own on-screen position now
overlaps that layer — if so, it nudges itself to whichever nearby position
(up/down/left/right) requires the least movement while staying fully
visible, or leaves itself alone if no such position exists. **Known
limitation**: Figma's `figma.ui.reposition()` stops having any effect once
the panel has been manually dragged by the user — a Plugin API limitation,
not something fixable from plugin code.

Info icons next to "LOC issues found" and "Errors" show a definition on
hover or keyboard focus (Material 3 plain-tooltip pattern — no click
needed, and the tooltip clamps itself to stay within the panel rather than
running off the edge).

When there's at least one error, a **View Log** button generates a
downloadable `.txt` file listing each one in plain language, with a direct
resource link where relevant (e.g. a font's install page).

The panel follows Figma's own light/dark theme automatically, via
`figma.showUI`'s `themeColors` option and Figma's `.figma-dark` class on
`<html>` — it updates live if the user switches theme mid-session, no
reload needed. Diagnostic colors (the orange/blue/magenta overflow
signals, error red) stay the same in both themes on purpose — those are
meaningful signals, not decorative choices.

## Files

- `manifest.json` — plugin config, including the two-command menu (`Run`
  and `Settings...`)
- `code.js` — main thread logic (runs in Figma's plugin sandbox)
- `ui.html` — the plugin UI panel, rendering either the Settings view or
  the results panel depending on which command launched it

## Easy tuning points

- `expansionRatio()` in `code.js` — the five IBM-calibrated expansion bands
- `HOMOGLYPHS` — which look-alike characters get used per letter
- `PAD_POOL_BASE` / `PAD_POOL_RTL` — which scripts get used for padding
- `SCRIPT_FONT` — which Noto family is used per detected script
- `SIGNAL_PALETTE` — the candidate overflow-flag colors
- `buildPadding()` — the ~35% RTL word-mix rate
