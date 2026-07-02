# Shibb — a pseudolocalization plugin for Figma
©2026 Joel Arellano - Creative Commons Zero v1.0 Universal
## Summary
Sense-check your Figma designs by reviewing how they might expand, transform,
or break upon localization. Just make a selection and run the plugin to
replace all selected copy with edge-case estimates for translated strings.

- Dynamic expansion rate respond to original string length-- measured in
  **graphemes, not CharLength**. 
- Content-aware alert color applied to flag text that breaks its container
- Summary reports available
- RTL transformation available with Hebrew & Arabic

## How To
1. Open the **Figma desktop app** (plugin development requires desktop, not browser).
2. Go to **Menu → Plugins → Development → Import plugin from manifest…**
3. Select `manifest.json` from this folder.
4. Open any file, select some text layers, then run it via
   **Menu → Plugins → Development → Pseudolocalizer**.
   
## Details
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
- Expansion rate is dynamic based by source string **grapheme length**, based
  on IBM's "Guidelines to design global solutions" table (as reproduced by
  [W3C i18n](https://www.w3.org/International/articles/article-text-size.en.html)),
  so short strings get +200% expansion, and strings
  over 70 characters get +30%.
- **Per-script font assignment**: Noto Sans (the "default" swap font) only
  actually covers Latin, Greek, and Cyrillic — Thai, Arabic, Hebrew, and CJK
  each ship as separate font families in Google's Noto system. The plugin
  detects the script of every character run in the pseudolocalized string
  and assigns `Noto Sans Thai`, `Noto Sans Arabic`, `Noto Sans Hebrew`, or
  `Noto Sans JP` accordingly, so nothing renders as tofu. If a specific
  family fails to load (rare, but possible on network-restricted Figma
  installs), that run falls back to Noto Sans and is counted as a "font-load
  fallback" in the results summary.
- Text is rewrapped in `[ ]` — a standard pseudoloc convention that makes
  clipped/truncated brackets easy to spot visually.
- Optional **RTL toggle**: mixes Arabic and Hebrew word-chunks (including
  Arabic-Indic digits and combining harakat/niqqud) into the padding,
  roughly one word in three, so strings end up with embedded RTL runs
  rather than a segregated block — closer to how real bidi bugs show up in
  mixed-language product copy.
- Each string's Latin letters are swapped for **visually-similar homoglyphs**
  (Greek, Cyrillic, and accented Latin look-alikes — e.g. Latin `O` → Greek
  `Ο`/`Ω` or Cyrillic `О`), then padded with a mix of Thai, Cyrillic, CJK,
  and Vietnamese (multi-diacritic-stack) characters to hit a target
  expansion length.
- **Style preservation**: font size, letter spacing, and (if explicitly set,
  i.e. not `AUTO`) line height are captured from the original typeface before
  the swap and reapplied to the Noto Sans replacement, so the replacement
  text approximates the source typeface's density rather than defaulting to
  Noto's own spacing.
- Locked or hidden text layers are skipped automatically and counted in the
  results Summary, rather than being silently edited.
- **Summary** option lists strings pseudolocalized, containers overrun,
  locked/hidden layers skipped, auto-sized layers not checked, empty layers
  skipped, font-load fallbacks, errors, and average length growth actually
  applied.

## FYI
- **Mixed-style text nodes**: if a single text node has multiple font sizes/
  weights within it, the plugin captures styling from the *first character*
  as representative for the whole node, and applies one uniform Noto style
  (Bold or Regular) across it. Fully mixed-run preservation would require
  per-run style capture, which adds real complexity for a case that's
  relatively rare in production UI copy — flag if this matters more than
  expected in your usage.
- **Flicker**: because overflow is measured by temporarily auto-resizing the
  actual node (then restoring it), you may see a quick flash on canvas as each
  node is processed. It self-corrects immediately and doesn't persist, but
  it's a visible side effect of how the measurement works.
- **`Intl.Segmenter` availability**: the grapheme-aware sizing math depends
  on this API being present in Figma's plugin JS sandbox. It's included as a
  best-effort — if unavailable, sizing falls back to a simpler per-character
  count, which is slightly less accurate for strings containing a lot of
  combining marks but doesn't fail or error.


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
