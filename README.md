# Shibb — a pseudolocalization plugin for Figma (v2)

# Test how designs will handle translations, before you deliver.

## Details
- Shibb replaces each string in your selection with **visually-similar homoglyphs** (Greek, Cyrillic, and accented Latin look-alikes — e.g. Latin `O` → Greek
  `Ο`/`Ω` or Cyrillic `О`), then pads these with a mix of Thai, Cyrillic, CJK,
  and Vietnamese (multi-diacritic-stack) characters to hit a target
  expansion length. Expansion is banded by source string length, calibrated
  against IBM's "Guidelines to design global solutions" table (as
  reproduced by [W3C i18n](https://www.w3.org/International/articles/article-text-size.en.html)):
  short strings (≤10 chars) get +200%, tapering down to +30% for strings
  over 70 characters. These expansion targets are
  computed on **grapheme count** (`Intl.Segmenter`, with a plain-character-count fallback if that API isn't available in a given Figma app version), not raw string length — so combining marks don't inflate the sizing math.
- This new pseudoLOC is rewrapped in `[ ]` — a standard pseudoloc convention that
  makes clipped/truncated brackets easy to spot visually.
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
  NONE`).
- **Auto-layout / "hug" text nodes get a different, complementary check.**
  These are designed to grow with content, so a fixed-size-style measurement
  doesn't apply — instead, growth is a problem when it escapes a *clipping*
  ancestor further up the tree (a fixed-size parent frame, an auto-layout
  frame with a maxWidth/maxHeight ceiling, a section, etc). The plugin walks
  the ancestor chain after Figma's own layout engine has reflowed everything
  live, and flags any node whose rendered box escapes the bounds of an
  ancestor with `clipsContent: true`. Both mechanisms roll up into the same
  "LOC issues found" count in the summary.
- **Three overflow signals, disambiguated rather than collapsed into one.**
  Earlier versions reported a single "overflowed" boolean covering both axes
  and both detection mechanisms. Now split into: **horizontal overflow**
  (box/ancestor width exceeded — orange), **vertical overflow** (box/
  ancestor height exceeded — blue), and **possible line collision**
  (vertical ink escaping the node's own box — magenta, the same mechanism
  described above under vertical diacritic overflow). Each gets its own
  stat count and its own color, surfaced in the expandable "LOC issues
  found" review in the results panel.
- **Vertical diacritic/ink overflow — always checked, not optional.** Compares
  each text node's nominal layout box (`absoluteBoundingBox`) against
  Figma's own accounting of the actual rendered ink extent
  (`absoluteRenderBounds`), which includes anything — tall diacritics,
  ascenders, descenders — that falls outside the nominal box. Flagged nodes
  get a magenta stroke, kept visually distinct from the fill-color box/
  ancestor overflow signal so both can be seen at once on the same node.
  **Known limitation, stated plainly**: this catches ink escaping the node's
  own outer box (a mark poking above the first line, or dropping below the
  last one) — it does *not* catch a diacritic on one interior line visually
  colliding with a descender on the line above it, inside a multi-line
  block. Figma's Plugin API doesn't expose per-line bounding boxes; catching
  that specific case would need image export and pixel-level analysis, a
  meaningfully heavier feature than what's built here.
- **Optional "vertical edge-case characters" toggle.** Off by default. When
  on, padding draws more heavily from pre-assembled multi-mark sequences —
  a Thai consonant with a vowel *and* tone mark stacked together, Vietnamese
  base letters with two combining marks at once, Arabic consonant+shadda
  gemination stacks (the last only when RTL is also enabled, since Arabic
  script isn't touched otherwise) — rather than isolated marks scattered
  through ordinary padding. The checkbox label names Thai, Vietnamese, and
  Arabic as the recommended scripts, per Google's Material Design language
  categories, which classify scripts into English-like / Tall / Dense tiers
  for exactly this purpose (`m2.material.io/design/typography/language-support`).
  Thai, Vietnamese, and Arabic are in the "Tall" tier — Hindi (Devanagari)
  and Telugu are too, but aren't yet in this plugin's character pools or
  font-assignment logic, so they're named in the label as known gaps rather
  than silently omitted. Worth noting since it's counterintuitive: Hebrew,
  despite having niqqud vowel points, is classified as "English-like" by
  Google, not "Tall" — it's included in the RTL toggle for bidi testing, not
  because it needs the vertical-stress treatment.
- **Implied-container overflow — a fallback for a real, common gap, covering
  two distinct patterns.** Neither the fixed-box self-check nor the
  ancestor-`clipsContent` check has any way to catch either of these:
  (1) **Sibling pattern**: a decorative rectangle drawn as a "text field" or
  "chip," with the actual text sitting on top of it as an unrelated,
  unclipped sibling layer — never structurally parented, so nothing is
  actually being clipped from Figma's own point of view, even though it
  visually should be. Found by testing against a real login-screen design
  where genuine overflow went completely unflagged. (2) **Parent pattern**:
  the text's *direct parent* has a deliberate, explicit size but isn't set
  to clip — found via a second real test, a status-bar clock ("9:27")
  sitting in a plain, non-auto-layout "Time" frame sized to 54×18px with
  `Clip content` off. The frame's size was clearly intentional (that's the
  whole reason it has explicit dimensions), but nothing enforced it, so the
  pseudolocalized clock overflowed the frame with zero detection. This is a
  meaningfully different case from the sibling pattern — containment against
  a direct parent doesn't need the 80% overlap threshold sibling-matching
  uses, since a child's original box is inherently within its parent's box
  in any normal, non-overflowing layout, so a qualifying parent (plain frame,
  or auto-layout frame with at least one axis not set to hug) is treated as
  an implied container immediately, checked before falling back to the
  sibling search. Both patterns infer containment geometrically instead of
  structurally, and both are labeled as inference, not certainty, in the
  issue message ("(inferred)") — including a direct suggestion to enable
  `Clip content` on the container or confirm the text is meant to be
  unconstrained.
- **Worth a real design-practice note, not just a technical one**: a sized-
  but-non-clipping frame is a genuinely mixed bag depending on context. For
  ordinary translatable content, it's a real risk — it looks bounded but
  enforces nothing, which is exactly the failure mode this tool exists to
  catch. But "Status Bar," "Time," "Battery," "Connections" are the standard
  layer names from official iOS/Android device-mockup UI kits, representing
  OS-rendered chrome that no translator ever actually touches — a reasonable
  pattern in that specific context.
- **Toggle settings persist across every Run, set from the separate
  Settings command.** RTL, vertical edge-case, and always-show-summary save
  via `figma.clientStorage` the moment you change them in **Settings...**
  (no Save button — autosaves on change), and every subsequent **Run**
  invocation reads them automatically. Scoped per plugin, per user:
  persists across every file you open on this machine, but does **not**
  sync across different machines if you use more than one.
- **Compact native toast by default, full panel only when asked for.**
  With "Always show summary" off (the default), a completed Run shows a
  one-line Figma toast instead of opening the panel — e.g. "Issues: 3,
  Skipped: 1, Errors: 2," with each segment appearing only if its count is
  above zero, or "No issues found" if everything's clean. If there's
  anything worth reviewing, the toast includes a **Details** button that
  opens the full panel on demand. Real lifecycle subtlety worth knowing:
  Figma automatically closes any toast with a custom action button the
  moment the plugin itself closes, so the plugin has to stay alive — not
  call `closePlugin()` — until either Details is clicked or the toast's own
  timeout elapses, with the pending auto-close explicitly cancelled if
  Details *was* clicked (otherwise the plugin would force-close out from
  under someone actively reviewing results). Turning "Always show summary"
  on skips the toast entirely and always opens the full panel instead, even
  on a completely clean run.
- **Pseudolocalized output is now deterministic per node, not random every
  run.** Real bug, found by testing: every homoglyph pick, padding-word
  selection, and script-mix roll ran on unseeded `Math.random()`, so the
  exact pseudolocalized string — and therefore whether a borderline element
  crossed its overflow threshold — differed on every single run, even
  against a completely unchanged design. `buildPadding()`'s loop makes this
  concrete: it appends random 3–8 character words until the total *meets or
  exceeds* the target length, so the final overshoot varies by several
  characters run to run. An element sitting right at the edge of overflow
  would sometimes get just enough extra padding to tip over and sometimes
  wouldn't — invisible to the detection logic itself (which is fully
  deterministic given a fixed input), but very visible as "the plugin
  randomly ignores clear overflow issues" from the outside. Fixed with a
  seeded PRNG (mulberry32, seeded from a hash of `node.id + "::" +
  originalText`) threaded through the entire generation chain in place of
  `Math.random()`. Same node, same source text, same output, every time —
  verified directly (not just asserted): two independent calls with an
  identical seed produce byte-for-byte identical strings, a different node
  id produces different output, and editing the source text changes the
  seed automatically so a stale pseudo-output never lingers after a real
  content edit.
- **The issue review section is always visible when there are any issues —
  no click-to-expand.** Auto-expands the moment the run-results panel
  displays, immediately showing issue 1 of N rather than requiring a click
  on the summary row first.
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
- On completion, the plugin defaults to a **compact native toast rather
  than opening a panel at all** — see the toast/Details behavior described
  above under settings persistence. The full panel (four-row summary:
  strings with LOC issues found, locked/hidden layers skipped, empty layers
  skipped, errors) only opens via the toast's Details button, or always, if
  "Always show summary" is on. The panel measures its own rendered content
  and resizes the plugin window to fit, so it never requires scrolling.

## Deliberately out of scope (by design)
- **Full sentence-level RTL** isn't implemented — the RTL toggle embeds
  Arabic/Hebrew word-chunks within otherwise-LTR strings. Testing a fully
  mirrored RTL layout (icon flipping, alignment reversal, direction-aware
  components) is a different, larger test surface than what this plugin
  covers, and probably deserves its own dedicated toggle later.
- **Whole-page / whole-file scanning has no dedicated feature.** `Ctrl+A`
  (or `Cmd+A`) on a page selects everything at the top level, and the
  plugin's collector already recurses into every child of whatever's
  selected — frames, groups, sections, component instances. So a page-wide
  run doesn't need new code, just that keyboard shortcut before hitting Run.
  No whole-*file* (multi-page) option is offered by design.


## Files
- `manifest.json` — plugin config, including the two-command menu (`Run`
  and `Settings...`)
- `code.js` — main thread logic (runs in Figma's plugin sandbox)
- `ui.html` — the plugin UI panel. Renders one of two views depending on
  which command launched it: the settings checkboxes, or the run-results
  summary (only shown at all if there's something worth reviewing).

## Easy tuning points if you want to adjust behavior later
- `expansionRatio()` in `code.js` — change the five IBM-calibrated expansion bands.
- `HOMOGLYPHS` — adjust which look-alike characters get used per letter.
- `PAD_POOL_BASE` / `PAD_POOL_RTL` — swap in/out which scripts get used for padding.
- `SCRIPT_FONT` — change which Noto family is used per detected script.
- `SIGNAL_PALETTE` — change the candidate overflow-flag colors.
- `buildPadding()` — adjust the ~35% RTL word-mix rate.
