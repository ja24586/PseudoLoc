# Pseudolocalizer — Figma Plugin (v0.2)
©2026 Joel Arellano

## What it does
- Select one or more text layers, or a frame/group containing them.
- Each string's Latin letters are swapped for **visually-similar homoglyphs**
  (Greek, Cyrillic, and accented Latin look-alikes — e.g. Latin `O` → Greek
  `Ο`/`Ω` or Cyrillic `О`), then padded with a mix of Thai, Cyrillic, CJK,
  and Vietnamese (multi-diacritic-stack) characters to hit a target
  expansion length. Expansion is banded by source string length, calibrated
  against IBM's "Guidelines to design global solutions" table (as
  reproduced by [W3C i18n](https://www.w3.org/International/articles/article-text-size.en.html)):
  short strings (≤10 chars) get +200%, tapering down to +30% for strings
  over 70 characters. IBM's table expresses expansion as a *ratio* of
  final-to-original length; this plugin is additive instead, so each band
  uses the *top* of IBM's published range converted to additive — a
  deliberate bias toward the more aggressive end of real-world expansion,
  appropriate for a stress-testing tool. (One band, 51–70 characters, uses
  an interpolated value rather than IBM's literal published figure, which
  breaks the otherwise-monotonic trend and is widely believed to be a typo
  in the original table.) See the comment above `expansionRatio()` in
  `code.js` for the full band-by-band mapping. Expansion targets are
  computed on **grapheme count**
  (`Intl.Segmenter`, with a plain-character-count fallback if that API isn't
  available in a given Figma app version), not raw string length — so
  combining marks don't inflate the sizing math.
- Text is rewrapped in `[ ]` — a standard pseudoloc convention that makes
  clipped/truncated brackets easy to spot visually.
- Optional **RTL toggle**: mixes Arabic and Hebrew word-chunks (including
  Arabic-Indic digits and combining harakat/niqqud) into the padding,
  roughly one word in three, so strings end up with embedded RTL runs
  rather than a segregated block — closer to how real bidi bugs show up in
  mixed-language product copy.
- **Per-script font assignment**: Noto Sans (the "default" swap font) only
  actually covers Latin, Greek, and Cyrillic — Thai, Arabic, Hebrew, and CJK
  each ship as separate font families in Google's Noto system. The plugin
  detects the script of every character run in the pseudolocalized string
  and assigns `Noto Sans Thai`, `Noto Sans Arabic`, `Noto Sans Hebrew`, or
  `Noto Sans JP` accordingly, so nothing renders as tofu. If a specific
  family fails to load (rare, but possible on network-restricted Figma
  installs), that run falls back to Noto Sans and is counted as a "font-load
  fallback" in the results summary.
- **Overflow detection measures against the original typeface**, not Noto
  Sans. Before swapping fonts, the plugin temporarily auto-resizes the text
  node (still in its original font) to measure what size the pseudolocalized
  string would actually need, compares that against the original fixed
  dimensions, then restores the original box size. This means overflow
  results reflect the real production typeface's metrics (kerning, average
  character width) rather than Noto Sans's — which may be meaningfully
  narrower or wider. Only applies to fixed-size text nodes (`textAutoResize:
  NONE`); auto-width/auto-height nodes aren't eligible for this check and
  are counted separately in the summary.
- **Placeholder/interpolation tokens are protected.** Real production
  strings carry variable tokens — `{{name}}`, `${username}`, `{count}`,
  `%s`/`%d`/`%1$s` — and earlier versions of this plugin would corrupt them
  during homoglyph substitution, breaking the string rather than just
  stress-testing its layout. Tokens are now detected and passed through
  untouched; only the surrounding text gets pseudolocalized. The count of
  protected tokens per run shows in the results summary.
- **Style preservation**: font size, letter spacing, and (if explicitly set,
  i.e. not `AUTO`) line height are captured from the original typeface before
  the swap and reapplied to the Noto Sans replacement, so the replacement
  text approximates the source typeface's density rather than defaulting to
  Noto's own spacing.
- Locked or hidden text layers are skipped automatically and counted in the
  results summary, rather than being silently edited.
- On completion, the plugin can show a **results summary** in-panel (toggle
  it off if you'd rather it just close silently with a one-line toast):
  strings pseudolocalized, containers flagged for overrun, locked/hidden
  layers skipped, auto-sized layers not checked, empty layers skipped,
  font-load fallbacks, errors, and average length growth actually applied.
  The panel measures its own rendered content and resizes the plugin window
  to fit, so it never requires scrolling.

## Deliberately out of scope (by design)
- **No revert/undo feature.** Figma's native undo (Cmd/Ctrl+Z) covers a
  single plugin run, but there's no "restore original text" button. The
  intent is that designers duplicate a design specifically for
  pseudolocalization testing rather than relying on the plugin to be safely
  reversible — keeps the plugin dependency-free and avoids the storage/
  restore logic entirely.
- **Auto-layout frame overflow** (frames that grow/reflow when text expands)
  isn't detected — only fixed-size text node overflow is. Worth a v3 if
  reflow-triggered layout breakage becomes the more common failure mode
  you're chasing.
- **Full sentence-level RTL** isn't implemented — the RTL toggle embeds
  Arabic/Hebrew word-chunks within otherwise-LTR strings. Testing a fully
  mirrored RTL layout (icon flipping, alignment reversal, direction-aware
  components) is a different, larger test surface than what this plugin
  covers, and probably deserves its own dedicated toggle later.

## Known caveats worth knowing about
- **Fixed (was a real bug through the first working test)**: overflow
  measurement temporarily switches a node to `textAutoResize:
  WIDTH_AND_HEIGHT` to measure the pseudolocalized string against the
  original typeface, then restores `NONE` and the original width/height.
  Text-alignment anchors (e.g. center-aligned text) mean that auto-resize
  can grow a box asymmetrically, shifting its x/y position — restoring size
  alone left the node correctly *sized* but wrongly *placed*, which is what
  caused containers to visibly jump off-frame during testing. `node.x` /
  `node.y` are now captured and restored alongside width/height.
- **Mixed-style text nodes**: if a single text node has multiple font sizes/
  weights within it, the plugin captures styling from the *first character*
  as representative for the whole node, and applies one uniform Noto style
  (Bold or Regular) across it. Fully mixed-run preservation would require
  per-run style capture, which adds real complexity for a case that's
  relatively rare in production UI copy — flag if this matters more than
  expected in your usage.
- **Brief visual flicker during measurement**: because overflow is measured
  by temporarily auto-resizing the actual node (then restoring it), you may
  see a quick flash on canvas as each node is processed. It self-corrects
  immediately and doesn't persist, but it's a visible side effect of how the
  measurement works.
- **`Intl.Segmenter` availability**: the grapheme-aware sizing math depends
  on this API being present in Figma's plugin JS sandbox. It's included as a
  best-effort — if unavailable, sizing falls back to a simpler per-character
  count, which is slightly less accurate for strings containing a lot of
  combining marks but doesn't fail or error.

## How to load it in Figma (development / unpublished plugin)
1. Open the **Figma desktop app** (plugin development requires desktop, not browser).
2. Go to **Menu → Plugins → Development → Import plugin from manifest…**
3. Select `manifest.json` from this folder.
4. Open any file, select some text layers, then run it via
   **Menu → Plugins → Development → Pseudolocalizer**.

## Files
- `manifest.json` — plugin config
- `code.js` — main thread logic (runs in Figma's plugin sandbox)
- `ui.html` — the plugin UI panel (RTL toggle, run button, results summary)

## Tuning points
- `expansionRatio()` in `code.js` — change the five IBM-calibrated expansion bands.
- `HOMOGLYPHS` — adjust which look-alike characters get used per letter.
- `PAD_POOL_BASE` / `PAD_POOL_RTL` — swap in/out which scripts get used for padding.
- `SCRIPT_FONT` — change which Noto family is used per detected script.
- `SIGNAL_PALETTE` — change the candidate overflow-flag colors.
- `buildPadding()` — adjust the ~35% RTL word-mix rate.
