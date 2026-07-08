// ============================================================================
// Shibb Pseudolocalizer — main thread (sandboxed Figma plugin environment)
// ============================================================================

// Tracked so the collision-avoidance repositioning logic (section 6c, below)
// knows the panel's actual current on-screen footprint — updated every time
// a "resize" message comes in from the UI's self-measuring resize pattern.
let currentPanelWidthPx = 320;
let currentPanelHeightPx = 380;

// ----------------------------------------------------------------------------
// 0. Settings persistence. figma.clientStorage is scoped per plugin ID, per
//    user — it persists across every file this user opens on this machine,
//    but does NOT sync across different machines/devices for the same user.
// ----------------------------------------------------------------------------

const SETTINGS_KEY = "shibbSettings";
const DEFAULT_SETTINGS = { includeRTL: false, verticalEdgeCase: false, alwaysShowSummary: false };

async function loadSettings() {
  try {
    const saved = await figma.clientStorage.getAsync(SETTINGS_KEY);
    return saved ? Object.assign({}, DEFAULT_SETTINGS, saved) : DEFAULT_SETTINGS;
  } catch (e) {
    return DEFAULT_SETTINGS; // no saved settings yet, or storage unavailable — defaults apply, not an error
  }
}

// Two commands, declared in manifest.json's "menu": "run" (default, headless
// unless there's something worth showing) and "settings" (always visible,
// checkboxes only, no Run/selection concept at all). figma.command tells us
// which one fired; anything that isn't explicitly "settings" is treated as
// "run", for robustness against invocation paths that might not carry
// command info consistently.
async function main() {
  if (figma.command === "settings") {
    figma.showUI(__html__, { width: 320, height: 300 });
    const settings = await loadSettings();
    figma.ui.postMessage({ type: "init", view: "settings", settings: settings });
    return;
  }

  // "run" — genuinely headless unless the result has something worth a
  // human's attention. UI starts hidden; only figma.ui.show() reveals it.
  figma.showUI(__html__, { width: 320, height: 380, visible: false });
  const settings = await loadSettings();
  const result = await run(settings.includeRTL, settings.verticalEdgeCase);

  if (result.notice) {
    figma.notify(result.notice);
    figma.closePlugin();
    return;
  }

  function showPanel() {
    figma.ui.show();
    figma.ui.postMessage({
      type: "init",
      view: "run",
      stats: result.stats,
      issueLog: result.issueLog,
      errorLog: result.errorLog
    });
  }

  if (settings.alwaysShowSummary) {
    showPanel();
    return;
  }

  // Compact native toast instead of the panel. Skipped counts (locked/
  // hidden + empty) are combined into one number here for brevity — the
  // full panel still breaks them out separately if someone opens it.
  const skippedTotal = result.stats.skippedLocked + result.stats.skippedEmpty;
  const parts = [];
  if (result.stats.locIssuesFound > 0) parts.push("Issues: " + result.stats.locIssuesFound);
  if (skippedTotal > 0) parts.push("Skipped: " + skippedTotal);
  if (result.stats.errors > 0) parts.push("Errors: " + result.stats.errors);
  const toastMessage = parts.length > 0 ? parts.join(", ") : "No issues found";

  const hasAnythingToReview = result.stats.locIssuesFound > 0 || result.stats.errors > 0 || skippedTotal > 0;

  if (!hasAnythingToReview) {
    figma.notify(toastMessage);
    figma.closePlugin();
    return;
  }

  // A toast with a custom action button is automatically closed the moment
  // the plugin closes (confirmed via Figma's own API changelog) — so the
  // plugin has to stay alive until either Details is clicked or the toast's
  // own timeout elapses. detailsShown + clearing the pending close timer is
  // what prevents the plugin from force-closing out from under someone who
  // DID click Details and is actively reviewing results.
  let detailsShown = false;
  const TOAST_TIMEOUT = 6000;

  figma.notify(toastMessage, {
    timeout: TOAST_TIMEOUT,
    button: {
      text: "Details",
      action: () => {
        detailsShown = true;
        showPanel();
      }
    }
  });

  setTimeout(() => {
    if (!detailsShown) figma.closePlugin();
  }, TOAST_TIMEOUT + 300);
}

main();

// ----------------------------------------------------------------------------
// 1. Homoglyph tables — visually-similar characters drawn from Latin
//    Extended, Greek, and Cyrillic (all covered by core "Noto Sans", so
//    these render as intended rather than tofu). Each letter maps to a
//    small array of candidates; one is picked at random per occurrence so
//    repeated letters in a string don't all get the same substitution.
// ----------------------------------------------------------------------------

const HOMOGLYPHS = {
  a: ["á", "а", "ạ"],           A: ["Á", "А", "Α"],
  b: ["ḃ", "β"],                 B: ["Ḃ", "Β", "В"],
  c: ["ç", "с"],                 C: ["Ç", "Ϲ"],
  d: ["ď", "đ"],                 D: ["Ď", "Đ"],
  e: ["é", "е", "ė"],            E: ["É", "Е", "Ε"],
  f: ["f̃", "ƒ"],                 F: ["F̃", "Ƒ"],
  g: ["ğ", "ġ"],                 G: ["Ğ", "Ġ"],
  h: ["ĥ", "һ"],                 H: ["Ĥ", "Η", "Н"],
  i: ["í", "і", "ı"],            I: ["Í", "І", "Ι"],
  j: ["ĵ", "ј"],                 J: ["Ĵ", "Ј"],
  k: ["ķ", "κ"],                 K: ["Ķ", "Κ", "К"],
  l: ["ĺ", "ł"],                 L: ["Ĺ", "Ł"],
  m: ["ṁ", "m̃"],                 M: ["Μ", "М"],
  n: ["ñ", "ń"],                 N: ["Ń", "Ñ"],
  o: ["ő", "о", "ο", "ω"],       O: ["Ő", "О", "Ο", "Ω"],
  p: ["p̀", "р"],                 P: ["P̀", "Ρ", "Р"],
  q: ["q̃", "ԛ"],                 Q: ["Q̃", "Ǫ"],
  r: ["ř", "ŕ"],                 R: ["Ř", "Ŕ"],
  s: ["š", "ѕ"],                 S: ["Š", "Ѕ"],
  t: ["ť", "ţ"],                 T: ["Ť", "Τ", "Т"],
  u: ["ü", "υ"],                 U: ["Ü", "Ú"],
  v: ["ṽ", "ν"],                 V: ["Ṽ", "Ѵ"],
  w: ["ŵ", "ẃ"],                 W: ["Ŵ", "Ẃ"],
  x: ["x̂", "х"],                 X: ["X̂", "Χ", "Х"],
  y: ["ý", "у", "γ"],            Y: ["Ý", "Υ", "У"],
  z: ["ž", "ᴢ"],                 Z: ["Ž", "Ζ"]
};

const FULLWIDTH_DIGITS = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"];

// Padding pools, split by script so the font-assignment pass (section 4)
// can tag each run correctly. These get appended to hit the target
// expansion length.
const PAD_POOL_BASE = [
  // Thai consonants
  "ก","ข","ค","ง","จ","ช","ซ","ฐ","ณ","ด","ต","ถ","ท","ธ","น","บ","ป","ผ","ฝ",
  "พ","ฟ","ภ","ม","ย","ร","ล","ว","ศ","ษ","ส","ห","อ","ฮ",
  // Thai vowels
  "ำ","ะ","า","ิ","ี","ึ","ื","ุ","ู","เ","แ","โ","ใ","ไ",
  // Thai tone marks / combining (stack above/below base — height edge case)
  "่","้","๊","๋","็","์",
  // Cyrillic lower/upper
  "а","б","в","г","д","е","ж","з","и","й","к","л","м","н","о","п","р","с","т",
  "у","ф","х","ц","ч","ш","щ","ъ","ы","ь","э","ю","я",
  "А","Б","В","Г","Д","Е","Ж","З","И","Й","К","Л","М","Н","О","П","Р","С","Т",
  "У","Ф","Х","Ц","Ч","Ш","Щ","Ъ","Ы","Ь","Э","Ю","Я",
  // Vietnamese multi-diacritic stacks (base + tone + modifier)
  "ệ","ẫ","ả","ữ","ỳ","ộ","ẵ","ẳ","ỗ",
  // Fullwidth Latin (double-width edge case)
  "Ｗ","Ｍ","Ｑ","Ｇ",
  // CJK — generic, non-brand Han characters + kana, for glyph density/joining
  "山","水","火","木","金","土","人","大","小","中","日","月","年","光","風",
  "雲","星","花","川","石",
  "あ","い","う","え","お","か","き","く","け","こ",
  "ア","イ","ウ","エ","オ","カ","キ","ク","ケ","コ"
];

// RTL pool — only mixed in when the user enables the RTL toggle. Arabic
// harakat and Hebrew niqqud are combining marks (stack on the base letter),
// and Arabic-Indic digits are included deliberately since numerals inside
// RTL text are a classic bidi edge case.
const PAD_POOL_RTL = [
  // Arabic letters
  "ا","ب","ت","ث","ج","ح","خ","د","ذ","ر","ز","س","ش","ص","ض","ط","ظ","ع","غ",
  "ف","ق","ك","ل","م","ن","ه","و","ي",
  // Arabic harakat (combining diacritics)
  "ً","ٌ","ٍ","َ","ُ","ِ","ّ","ْ",
  // Arabic-Indic digits
  "٠","١","٢","٣","٤","٥","٦","٧","٨","٩",
  // Hebrew letters
  "א","ב","ג","ד","ה","ו","ז","ח","ט","י","כ","ל","מ","נ","ס","ע","פ","צ","ק",
  "ר","ש","ת",
  // Hebrew niqqud (combining diacritics)
  "ָ","ֶ","ִ","ֹ","ֻ","ְ","ּ"
];

// Strong-directional letters ONLY (no combining marks, no digits — those are
// weak/neutral per the Unicode Bidirectional Algorithm and don't establish
// paragraph direction). Per UAX#9 rule P2, a paragraph's base direction is
// set by its first STRONG L/AL/R character — bidi embedding-control
// characters are explicitly excluded from that determination. So actually
// flipping a line's overall direction requires a genuine strong RTL letter
// at the very start, not just an embedding mark buried inside brackets.
const RTL_STRONG_LETTERS = [
  "ا","ب","ت","ث","ج","ح","خ","د","ذ","ر","ز","س","ش","ص","ض","ط","ظ","ع","غ",
  "ف","ق","ك","ل","م","ن","ه","و","ي",
  "א","ב","ג","ד","ה","ו","ז","ח","ט","י","כ","ל","מ","נ","ס","ע","פ","צ","ק",
  "ר","ש","ת"
];

// Vertical edge-case pool — only mixed in when the "vertical edge case
// characters" toggle is on. Unlike PAD_POOL_BASE (which includes Thai/
// Vietnamese characters individually), these are pre-assembled MULTI-MARK
// SEQUENCES — a Thai consonant with a vowel AND a tone mark stacked
// together, a Vietnamese base letter with two combining marks at once —
// since true vertical stress comes from marks compounding on one base
// character, not from isolated marks scattered through padding. Per
// Google's Material Design language categories, Thai and Vietnamese are
// both in the "Tall" script tier (extra line height required); Arabic
// multi-harakat stacks are included as a second tier, only when RTL is
// ALSO enabled, since Arabic script isn't touched at all otherwise.
const PAD_POOL_VERTICAL = [
  // Thai: consonant + vowel + tone mark stacked on one base
  "กี้", "ปั๊", "มื่", "นี๊", "ลั๋", "วุ้", "ทึ่", "หู้",
  // Vietnamese: base + two combining marks at once (already in PAD_POOL_BASE
  // individually; repeated here as the "always include these" priority set)
  "ệ", "ữ", "ẫ", "ộ", "ẵ"
];

const PAD_POOL_VERTICAL_RTL = [
  // Arabic: consonant + shadda (gemination) + a vowel harakat stacked together
  "بّ", "دّ", "سّ", "لّ", "نّ"
];

const SIGNAL_PALETTE = ["#FF1493", "#FF4500", "#39FF14", "#00E5FF", "#FFD700"];
const VERTICAL_OVERFLOW_COLOR = "#FF00E5"; // fixed magenta stroke — visually distinct from the fill-color overflow signal

// ----------------------------------------------------------------------------
// 2. Grapheme-aware length helper (falls back gracefully — Figma's plugin
//    sandbox doesn't always ship full Intl.Segmenter support depending on
//    app version, so this degrades to Array.from() if unavailable).
// ----------------------------------------------------------------------------

function graphemeLength(str) {
  try {
    if (typeof Intl !== "undefined" && Intl.Segmenter) {
      const seg = new Intl.Segmenter(undefined, { granularity: "grapheme" });
      return Array.from(seg.segment(str)).length;
    }
  } catch (e) {
    // fall through to the simpler count below
  }
  return Array.from(str).length;
}

// ----------------------------------------------------------------------------
// 3. Pseudolocalization string transform
//
//    IMPORTANT: every random choice below is driven by a per-node SEEDED
//    generator (mulberry32, seeded from a hash of the node's id + its
//    original text), not raw Math.random(). This was a real bug, not a
//    stylistic choice: unseeded randomness meant the exact pseudolocalized
//    output — and therefore whether a borderline element crossed its
//    overflow threshold — differed on every single run, even against a
//    completely unchanged design. Seeding makes results reproducible: same
//    node, same source text, same output, every time. If the source text
//    changes, the seed changes too (by design), so a stale pseudo-output
//    never lingers after a real content edit.
// ----------------------------------------------------------------------------

function hashStringToSeed(str) {
  // Simple, fast string hash (a common xmur3-style variant) — doesn't need
  // to be cryptographically anything, just needs to spread different
  // strings across the 32-bit seed space reasonably evenly.
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return h >>> 0;
  };
}

function mulberry32(seed) {
  let a = seed;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Creates a deterministic RNG (a function behaving like Math.random(),
// returning [0, 1)) seeded from the given string.
function createSeededRng(seedString) {
  const seedFn = hashStringToSeed(seedString);
  return mulberry32(seedFn());
}

function decorateChar(ch, rng) {
  if (HOMOGLYPHS[ch]) {
    const options = HOMOGLYPHS[ch];
    return options[Math.floor(rng() * options.length)];
  }
  if (ch >= "0" && ch <= "9") return FULLWIDTH_DIGITS[Number(ch)];
  return ch; // spaces, punctuation, anything else: left as-is
}

function decorate(str, rng) {
  return Array.from(str).map((ch) => decorateChar(ch, rng)).join("");
}

// Interpolation/placeholder tokens must survive pseudolocalization untouched
// — real production strings carry these ({{name}}, %s, {count}, ${var}) and
// corrupting them breaks the string rather than just stress-testing its
// layout. Matches, in priority order: double-mustache ({{...}}), JS template
// interpolation (${...}), single-brace ICU-style ({...}), and printf-style
// (%s, %d, %1$s, %@, etc). Single capture group so String.split() below
// alternates [plain, placeholder, plain, placeholder, ...] in the result.
const PLACEHOLDER_REGEX = /(\{\{[^{}]*\}\}|\$\{[^{}]*\}|\{[^{}]*\}|%\d*\$?[sdfotxX@])/g;

function protectedDecorate(line, counter, rng) {
  const parts = line.split(PLACEHOLDER_REGEX);
  counter.count += Math.floor(parts.length / 2); // odd-indexed entries are placeholder matches
  return parts.map((part, idx) => (idx % 2 === 0 ? decorate(part, rng) : part)).join("");
}

// Stepped expansion function, banded to match IBM's "Guidelines to design
// global solutions" table (as reproduced by W3C i18n: see
// https://www.w3.org/International/articles/article-text-size.en.html).
// That table expresses expansion as a RATIO of final-to-original length
// (e.g. "200-300%" = translated text ends up 2-3x the source). This
// function is ADDITIVE instead (2.0 means +200% on top of the original,
// i.e. final = 3x), so each band below uses the TOP of IBM's published
// range, converted to additive by subtracting 100%. That intentionally
// biases toward the more aggressive end of real-world expansion — a
// reasonable choice for a stress-testing tool, where over-simulating is
// safer than under-simulating.
//
// IBM's bands, for reference (source chars -> ratio range -> additive top):
//   <=10   : 200-300% ratio -> 200% additive  (used as-is)
//   11-20  : 180-200% ratio -> 100% additive  (used as-is)
//   21-30  : 160-180% ratio ->  80% additive  (used as-is)
//   31-50  : 140-160% ratio ->  60% additive  (used as-is)
//   51-70  : IBM's published "151-170%" breaks the otherwise-monotonic
//            trend (widely believed to be a typo in the original table).
//            We use 40% additive instead, interpolated to preserve a
//            smooth decline between the 31-50 and >70 bands.
//   >70    : 130% ratio -> 30% additive       (used as-is)
//
// Operates on grapheme count, not raw UTF-16 length.
function expansionRatio(len) {
  if (len <= 10) return 2.0;   // +200%
  if (len <= 20) return 1.0;   // +100%
  if (len <= 30) return 0.8;   // +80%
  if (len <= 50) return 0.6;   // +60%
  if (len <= 70) return 0.4;   // +40% (interpolated — see note above)
  return 0.3;                  // +30%
}

function randomPadWord(pool, minLen, maxLen, rng) {
  const len = minLen + Math.floor(rng() * (maxLen - minLen + 1));
  let out = "";
  for (let i = 0; i < len; i++) {
    out += pool[Math.floor(rng() * pool.length)];
  }
  return out;
}

// Builds padding text. includeRTL mixes in Arabic/Hebrew word-chunks
// (~35% of words). verticalEdgeCase mixes in pre-assembled multi-mark
// stacked sequences (~30% of words) — Thai/Vietnamese always available,
// Arabic multi-harakat stacks only when RTL is ALSO enabled. The two
// toggles are independent and compose rather than gating each other.
function buildPadding(targetExtraLength, includeRTL, verticalEdgeCase, rng) {
  let out = "";
  while (graphemeLength(out) < targetExtraLength) {
    if (out.length > 0) out += " ";
    const roll = rng();
    if (verticalEdgeCase && includeRTL && roll < 0.15) {
      out += randomPadWord(PAD_POOL_VERTICAL_RTL, 2, 3, rng);
    } else if (verticalEdgeCase && roll < 0.40) {
      out += randomPadWord(PAD_POOL_VERTICAL, 2, 4, rng);
    } else if (includeRTL && roll < 0.70) {
      out += randomPadWord(PAD_POOL_RTL, 3, 8, rng);
    } else {
      out += randomPadWord(PAD_POOL_BASE, 3, 8, rng);
    }
  }
  return out;
}

function pseudolocalizeLine(line, includeRTL, verticalEdgeCase, counter, rng) {
  if (line.trim().length === 0) return line; // preserve blank lines / pure whitespace
  const decorated = protectedDecorate(line, counter, rng);
  const lineLen = graphemeLength(line);
  const targetExtra = Math.round(lineLen * expansionRatio(lineLen));
  const padding = targetExtra > 0 ? buildPadding(targetExtra, includeRTL, verticalEdgeCase, rng) : "";
  const body = padding ? decorated + " " + padding : decorated;
  // A strong RTL letter must be the line's very first character for the
  // paragraph's base direction to actually flip (see RTL_STRONG_LETTERS
  // comment above) — everything after it, including the bracket and the
  // decorated Latin text, then renders as an embedded LTR island within an
  // overall RTL flow, which mirrors how real RTL-locale UI actually looks
  // (product names, emails, etc. staying LTR inside RTL surroundings).
  const rtlPrefix = includeRTL ? randomPadWord(RTL_STRONG_LETTERS, 3, 6, rng) + " " : "";
  return rtlPrefix + "[" + body + "]";
}

function pseudolocalize(text, includeRTL, verticalEdgeCase, counter, rng) {
  return text.split("\n").map((line) => pseudolocalizeLine(line, includeRTL, verticalEdgeCase, counter, rng)).join("\n");
}

// ----------------------------------------------------------------------------
// 4. Script detection + per-range font assignment.
//    Noto Sans (core) only covers Latin/Greek/Cyrillic. Thai, Arabic,
//    Hebrew, and CJK each need their own Noto family. We tag every
//    character by script, group into contiguous runs, load whatever fonts
//    are actually needed, and apply them per-range so nothing renders as
//    tofu. Failed font loads fall back to Noto Sans (Latin-only rendering
//    for that run) and are counted as an "issue" for the results summary.
// ----------------------------------------------------------------------------

const SCRIPT_FONT = {
  thai: { family: "Noto Sans Thai" },
  arabic: { family: "Noto Sans Arabic" },
  hebrew: { family: "Noto Sans Hebrew" },
  cjk: { family: "Noto Sans JP" },
  latin: { family: "Noto Sans" } // also covers Greek + Cyrillic ranges below
};

// Direct links to each font family's Google Fonts page, for the error log's
// "specific links to relevant resources" requirement when a font fails to
// load — a plain family name isn't actionable, a page to install it from is.
const FONT_DOWNLOAD_LINKS = {
  "Noto Sans": "https://fonts.google.com/noto/specimen/Noto+Sans",
  "Noto Sans Thai": "https://fonts.google.com/noto/specimen/Noto+Sans+Thai",
  "Noto Sans Arabic": "https://fonts.google.com/noto/specimen/Noto+Sans+Arabic",
  "Noto Sans Hebrew": "https://fonts.google.com/noto/specimen/Noto+Sans+Hebrew",
  "Noto Sans JP": "https://fonts.google.com/noto/specimen/Noto+Sans+JP"
};

function detectScript(ch) {
  const cp = ch.codePointAt(0);
  if (cp >= 0x0e00 && cp <= 0x0e7f) return "thai";
  if ((cp >= 0x0600 && cp <= 0x06ff) || (cp >= 0x0750 && cp <= 0x077f) ||
      (cp >= 0xfb50 && cp <= 0xfdff) || (cp >= 0xfe70 && cp <= 0xfeff)) return "arabic";
  if (cp >= 0x0590 && cp <= 0x05ff) return "hebrew";
  if ((cp >= 0x4e00 && cp <= 0x9fff) || (cp >= 0x3040 && cp <= 0x30ff) ||
      (cp >= 0x3400 && cp <= 0x4dbf)) return "cjk";
  return "latin"; // Latin, Latin Extended, Greek, Cyrillic, digits, punctuation
}

function buildScriptRuns(text) {
  const chars = Array.from(text);
  const runs = [];
  let currentScript = null;
  let start = 0;
  let offset = 0;
  for (const ch of chars) {
    const script = detectScript(ch);
    if (currentScript === null) {
      currentScript = script;
      start = offset;
    } else if (script !== currentScript) {
      runs.push({ script: currentScript, start: start, end: offset });
      currentScript = script;
      start = offset;
    }
    offset += ch.length; // ch.length handles any surrogate pairs robustly
  }
  if (currentScript !== null) runs.push({ script: currentScript, start: start, end: offset });
  return runs;
}

// Loads and applies the correct font family per script run. Returns the
// list of font family names that failed to load (empty array if none) —
// used to build specific, linkable entries in the error log rather than
// just an opaque count.
async function applyScriptFonts(node, runs, isBold) {
  const failedFamilies = [];
  const resolved = {};
  const uniqueScripts = Array.from(new Set(runs.map((r) => r.script)));

  for (const script of uniqueScripts) {
    const family = SCRIPT_FONT[script].family;
    let chosen = { family: family, style: "Regular" };
    try {
      await figma.loadFontAsync({ family: family, style: "Regular" });
      if (isBold) {
        try {
          await figma.loadFontAsync({ family: family, style: "Bold" });
          chosen.style = "Bold";
        } catch (e) {
          // Bold not available for this family — Regular already loaded, keep it
        }
      }
    } catch (e) {
      failedFamilies.push(family);
      chosen = { family: "Noto Sans", style: "Regular" }; // fallback (already loaded elsewhere)
    }
    resolved[script] = chosen;
  }

  for (const run of runs) {
    node.setRangeFontName(run.start, run.end, resolved[run.script]);
  }
  return failedFamilies;
}

async function loadAllFontsInNode(node) {
  const fonts = node.getRangeAllFontNames(0, node.characters.length);
  for (const font of fonts) {
    await figma.loadFontAsync(font);
  }
  return fonts;
}

// ----------------------------------------------------------------------------
// 5. Color / contrast helpers for the overflow signal color (unchanged)
// ----------------------------------------------------------------------------

function hexToRgbObj(hex) {
  const clean = hex.replace("#", "");
  return {
    r: parseInt(clean.substring(0, 2), 16) / 255,
    g: parseInt(clean.substring(2, 4), 16) / 255,
    b: parseInt(clean.substring(4, 6), 16) / 255
  };
}

function relLuminance(c) {
  const t = (v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
  const R = t(c.r), G = t(c.g), B = t(c.b);
  return 0.2126 * R + 0.7152 * G + 0.0722 * B;
}

function contrastRatio(c1, c2) {
  const L1 = relLuminance(c1);
  const L2 = relLuminance(c2);
  const lighter = Math.max(L1, L2);
  const darker = Math.min(L1, L2);
  return (lighter + 0.05) / (darker + 0.05);
}

function getBackgroundColor(node) {
  let current = node.parent;
  while (current && current.type !== "PAGE" && current.type !== "DOCUMENT") {
    if ("fills" in current && Array.isArray(current.fills)) {
      const solid = current.fills.find((f) => f.type === "SOLID" && f.visible !== false);
      if (solid) return solid.color;
    }
    current = current.parent;
  }
  return { r: 1, g: 1, b: 1 }; // default Figma canvas white
}

// ----------------------------------------------------------------------------
// 6. Auto-layout overflow detection.
//    Fixed-size text nodes (textAutoResize: NONE) self-clip — that's what
//    the measurement block in run() catches. Auto-layout / "hug" text nodes
//    (HEIGHT or WIDTH_AND_HEIGHT) are DESIGNED to grow, so a fixed-size-style
//    check doesn't apply to them. Instead, growth is a problem when it
//    escapes a CLIPPING ancestor further up the tree — a fixed-size parent
//    frame, an auto-layout frame with a maxWidth/maxHeight ceiling, a
//    section, etc. Figma exposes exactly this via `clipsContent`: any
//    frame-like node with clipsContent === true visually clips whatever
//    doesn't fit inside its absoluteBoundingBox. Rather than reverse-engineer
//    every sizing-mode combination ourselves, we just ask Figma's own layout
//    engine (which has already reflowed everything live, the moment
//    node.characters was set) whether the text node's rendered box still
//    fits inside every clipping ancestor between it and the page.
// ----------------------------------------------------------------------------

function checkAncestorClipOverflow(node) {
  const nodeBox = node.absoluteBoundingBox;
  const result = { horizontal: false, vertical: false, ancestorName: null };
  if (!nodeBox) return result;

  let current = node.parent;
  while (current && current.type !== "PAGE" && current.type !== "DOCUMENT") {
    if ("clipsContent" in current && current.clipsContent === true) {
      const ancestorBox = current.absoluteBoundingBox;
      if (ancestorBox) {
        const escapesLeft = nodeBox.x < ancestorBox.x - 0.5;
        const escapesRight = nodeBox.x + nodeBox.width > ancestorBox.x + ancestorBox.width + 0.5;
        const escapesTop = nodeBox.y < ancestorBox.y - 0.5;
        const escapesBottom = nodeBox.y + nodeBox.height > ancestorBox.y + ancestorBox.height + 0.5;
        const escapesHorizontally = escapesLeft || escapesRight;
        const escapesVertically = escapesTop || escapesBottom;
        if (escapesHorizontally) result.horizontal = true;
        if (escapesVertically) result.vertical = true;
        if ((escapesHorizontally || escapesVertically) && !result.ancestorName) {
          result.ancestorName = current.name;
        }
      }
    }
    current = current.parent;
  }
  return result;
}

// Vertical diacritic / glyph-ink overflow. absoluteBoundingBox is the
// node's nominal layout box; absoluteRenderBounds is Figma's own accounting
// of the actual rendered ink extent, including anything — diacritics,
// ascenders, descenders — that falls outside that nominal box. Comparing
// the two catches tall marks poking above the first line or dropping below
// the last line.
//
// Known limitation, stated plainly: this catches ink escaping the node's
// OWN outer box. It does NOT catch a diacritic on one interior line visually
// colliding with a descender on the line above it inside a multi-line
// block — Figma's Plugin API doesn't expose per-line bounding boxes, and
// catching that specific case would require rendering to an image and doing
// pixel-level analysis, a meaningfully heavier feature than this check.
function checkVerticalOverflow(node) {
  const nominal = node.absoluteBoundingBox;
  const rendered = node.absoluteRenderBounds;
  if (!nominal || !rendered) return false;

  const overflowsTop = rendered.y < nominal.y - 0.5;
  const overflowsBottom = rendered.y + rendered.height > nominal.y + nominal.height + 0.5;
  return overflowsTop || overflowsBottom;
}

function pickSignalColor(bg) {
  let best = null;
  let bestRatio = 0;
  for (const hex of SIGNAL_PALETTE) {
    const rgb = hexToRgbObj(hex);
    const ratio = contrastRatio(rgb, bg);
    if (ratio > bestRatio) {
      bestRatio = ratio;
      best = rgb;
    }
  }
  return best;
}

// ----------------------------------------------------------------------------
// 5b. Implied-container overflow — a fallback for cases where neither the
//     fixed-box self-check nor the ancestor-clipsContent check applies. Two
//     distinct real patterns land here:
//
//     1. Sibling pattern: a decorative rectangle drawn as a "text field" or
//        "chip," with the actual text sitting on top of it as an unrelated,
//        unclipped sibling — never structurally parented, so Figma's own
//        layout engine has no containment relationship to enforce.
//
//     2. Parent pattern (found via real testing — a status bar clock that
//        overflowed a 54×18 "Time" frame without being flagged): the text's
//        DIRECT PARENT has an explicit, deliberately-set size but isn't
//        clipping — e.g. a plain (non-auto-layout) frame, which always has
//        a manually-set size, or an auto-layout frame with at least one
//        axis NOT set to hug. This is a genuinely different case from the
//        sibling pattern: containment against a parent doesn't need an
//        overlap-ratio threshold the way sibling-matching does, since a
//        child's original box is inherently within its parent's box in any
//        normal, non-overflowing layout — any qualifying parent is treated
//        as an implied container immediately, checked first, before
//        falling back to the sibling search.
//
//     Both are inference, not certainty (Figma itself enforces neither), so
//     both get labeled distinctly from the structural checks rather than
//     presented with the same confidence.
// ----------------------------------------------------------------------------

const CONTAINER_LIKE_TYPES = ["RECTANGLE", "FRAME", "COMPONENT", "INSTANCE", "ELLIPSE"];

// True if a frame-like node has a deliberate, explicit size on at least one
// axis rather than purely hugging its content. Plain (non-auto-layout)
// frames always qualify — there's no "hug" concept without layoutMode, so
// any size they have was manually set. Auto-layout frames only qualify if
// at least one axis isn't set to AUTO (hug).
function frameHasExplicitSize(frame) {
  if (!frame || !("absoluteBoundingBox" in frame)) return false;
  if (!("layoutMode" in frame)) return true; // not auto-layout-capable at all — treat as explicit
  if (frame.layoutMode === "NONE") return true; // plain frame — size is always manually set
  return frame.primaryAxisSizingMode !== "AUTO" || frame.counterAxisSizingMode !== "AUTO";
}

function findImpliedContainer(node, originalBox) {
  if (!originalBox) return null;

  // Priority 1: the direct parent, if it has a deliberate size and isn't
  // structurally clipping (if it WERE clipping, checkAncestorClipOverflow
  // already would have caught this before we ever get here).
  const parent = node.parent;
  if (parent && CONTAINER_LIKE_TYPES.indexOf(parent.type) !== -1 &&
      parent.clipsContent !== true && frameHasExplicitSize(parent)) {
    return parent;
  }

  // Priority 2 (fallback): sibling shapes that geometrically contained the
  // original text by more than 80% overlap — the decorative "text drawn
  // over an unrelated shape" pattern. Only reachable if the parent didn't
  // already qualify above.
  if (!parent || !("children" in parent)) return null;

  const textArea = originalBox.width * originalBox.height;
  if (textArea <= 0) return null;

  let bestCandidate = null;
  let bestRatio = 0;

  for (const sibling of parent.children) {
    if (sibling === node) continue;
    if (CONTAINER_LIKE_TYPES.indexOf(sibling.type) === -1) continue;
    if (sibling.visible === false) continue;
    const sibBox = sibling.absoluteBoundingBox;
    if (!sibBox) continue;

    const overlapLeft = Math.max(originalBox.x, sibBox.x);
    const overlapTop = Math.max(originalBox.y, sibBox.y);
    const overlapRight = Math.min(originalBox.x + originalBox.width, sibBox.x + sibBox.width);
    const overlapBottom = Math.min(originalBox.y + originalBox.height, sibBox.y + sibBox.height);
    if (overlapRight <= overlapLeft || overlapBottom <= overlapTop) continue; // no overlap at all

    const overlapArea = (overlapRight - overlapLeft) * (overlapBottom - overlapTop);
    const overlapRatio = overlapArea / textArea;

    if (overlapRatio > 0.8 && overlapRatio > bestRatio) {
      bestRatio = overlapRatio;
      bestCandidate = sibling;
    }
  }

  return bestCandidate;
}

function checkImpliedContainerOverflow(node, originalBox) {
  const result = { horizontal: false, vertical: false, containerName: null };
  const container = findImpliedContainer(node, originalBox);
  if (!container) return result;

  const newBox = node.absoluteBoundingBox;
  const containerBox = container.absoluteBoundingBox;
  if (!newBox || !containerBox) return result;

  const escapesLeft = newBox.x < containerBox.x - 0.5;
  const escapesRight = newBox.x + newBox.width > containerBox.x + containerBox.width + 0.5;
  const escapesTop = newBox.y < containerBox.y - 0.5;
  const escapesBottom = newBox.y + newBox.height > containerBox.y + containerBox.height + 0.5;

  result.horizontal = escapesLeft || escapesRight;
  result.vertical = escapesTop || escapesBottom;
  if (result.horizontal || result.vertical) result.containerName = container.name;
  return result;
}

// ----------------------------------------------------------------------------
// 6. Main run routine
// ----------------------------------------------------------------------------

function collectTextNodes(nodes) {
  const result = [];
  function walk(node) {
    if (node.type === "TEXT") {
      result.push(node);
    } else if ("children" in node) {
      node.children.forEach(walk);
    }
  }
  nodes.forEach(walk);
  return result;
}

async function run(includeRTL, verticalEdgeCase) {
  const selection = figma.currentPage.selection;

  if (selection.length === 0) {
    return { stats: null, issueLog: [], errorLog: [], notice: "Select a text layer or a frame containing text layers." };
  }

  const textNodes = collectTextNodes(selection);

  if (textNodes.length === 0) {
    return { stats: null, issueLog: [], errorLog: [], notice: "No text layers found in the selection." };
  }

  // Simplified to exactly four summary rows. Everything more granular
  // (which axis, structural vs. inferred, which font failed) still gets
  // captured — just in issueLog/errorLog for the expandable review and the
  // log file, rather than as its own top-level stat.
  const stats = {
    processed: 0,
    locIssuesFound: 0,
    skippedLocked: 0,
    skippedEmpty: 0,
    errors: 0
  };
  const issueLog = []; // { nodeName, messages: [...] } — one entry per flagged node
  const errorLog = [];  // { nodeName, message, link } — for the "View Log" .txt export

  for (const node of textNodes) {
    try {
      if (node.locked || node.visible === false) {
        stats.skippedLocked++;
        continue;
      }
      if (node.characters.length === 0) {
        stats.skippedEmpty++;
        continue;
      }

      const originalFonts = await loadAllFontsInNode(node);
      const isBold = !!(originalFonts[0] && /bold/i.test(originalFonts[0].style));

      // Capture original styling before we touch anything, so we can both
      // measure accurately and re-approximate the source typeface's density
      // on the Noto Sans replacement afterward. x/y matter here too: when
      // textAutoResize switches to WIDTH_AND_HEIGHT below, Figma grows the
      // box from its text-alignment anchor (e.g. center-aligned text grows
      // symmetrically in both directions), which shifts the node's position
      // — not just its size. Restoring width/height alone leaves the node
      // correctly sized but wrongly placed, so position must be restored too.
      const originalStyle = {
        fontSize: node.getRangeFontSize(0, 1),
        letterSpacing: node.getRangeLetterSpacing(0, 1),
        lineHeight: node.getRangeLineHeight(0, 1),
        textAutoResize: node.textAutoResize,
        width: node.width,
        height: node.height,
        x: node.x,
        y: node.y
      };
      const originalBox = node.absoluteBoundingBox; // captured pre-edit, for the implied-container fallback below

      const originalText = node.characters;
      const placeholderCounter = { count: 0 };
      // Seeded by node id + original text — deterministic per node, so
      // re-running against an unchanged design reproduces the same output
      // and the same overflow verdicts. Changes automatically if the source
      // text itself is edited.
      const rng = createSeededRng(node.id + "::" + originalText);
      const pseudo = pseudolocalize(originalText, includeRTL, verticalEdgeCase, placeholderCounter, rng);

      // Set the new text while still in the ORIGINAL font. This lets us
      // measure overflow against the real typeface's metrics (kerning,
      // average advance width) rather than Noto Sans's, which may be
      // narrower or wider than whatever ships to production.
      node.characters = pseudo;

      let horizontalOverflow = false;
      let verticalOverflow = false;
      let horizontalDelta = 0;
      let verticalDelta = 0;
      let clipAncestorName = null;
      const isAutoSized = originalStyle.textAutoResize !== "NONE";
      if (!isAutoSized) {
        try {
          node.textAutoResize = "WIDTH_AND_HEIGHT";
          const measuredW = node.width;
          const measuredH = node.height;
          horizontalOverflow = measuredW > originalStyle.width + 0.5;
          verticalOverflow = measuredH > originalStyle.height + 0.5;
          horizontalDelta = Math.round(measuredW - originalStyle.width);
          verticalDelta = Math.round(measuredH - originalStyle.height);
        } finally {
          node.textAutoResize = "NONE";
          node.resizeWithoutConstraints(originalStyle.width, originalStyle.height);
          node.x = originalStyle.x;
          node.y = originalStyle.y;
        }
      }

      // Now assign the correct Noto family per script range so every
      // injected character actually renders.
      const runs = buildScriptRuns(pseudo);
      const failedFonts = await applyScriptFonts(node, runs, isBold);
      if (failedFonts.length > 0) {
        stats.errors += failedFonts.length;
        for (const family of failedFonts) {
          errorLog.push({
            nodeName: node.name,
            message: "Could not load \"" + family + "\" \u2014 those characters fell back to Noto Sans and may render as missing-glyph boxes instead of the intended script.",
            link: FONT_DOWNLOAD_LINKS[family] || null
          });
        }
      }

      // Re-approximate the original typeface's density on the Noto Sans
      // replacement: same size, same tracking, same explicit leading.
      const len = node.characters.length;
      node.setRangeFontSize(0, len, originalStyle.fontSize);
      node.setRangeLetterSpacing(0, len, originalStyle.letterSpacing);
      if (originalStyle.lineHeight.unit !== "AUTO") {
        node.setRangeLineHeight(0, len, originalStyle.lineHeight);
      }

      // Ancestor-clip check runs AFTER font/size/spacing reapplication above,
      // since those edits can themselves shift wrapping and final dimensions
      // — checking any earlier would measure a transitional, not final, state.
      let isImpliedContainer = false;
      if (isAutoSized) {
        const clip = checkAncestorClipOverflow(node);
        horizontalOverflow = clip.horizontal;
        verticalOverflow = clip.vertical;
        clipAncestorName = clip.ancestorName;

        // Fallback: no structural clipping ancestor caught anything — check
        // whether this text was originally sitting inside an unrelated,
        // unclipped decorative shape (the classic "text over a drawn input
        // box" pattern) that it may now be escaping.
        if (!horizontalOverflow && !verticalOverflow) {
          const implied = checkImpliedContainerOverflow(node, originalBox);
          if (implied.horizontal || implied.vertical) {
            horizontalOverflow = implied.horizontal;
            verticalOverflow = implied.vertical;
            clipAncestorName = implied.containerName;
            isImpliedContainer = true;
          }
        }
      }

      stats.processed++;

      // Three genuinely distinct failure modes at the detection level, still
      // disambiguated internally (different messages, different signal
      // colors) — but rolled up into ONE "LOC issues found" count per node
      // for the summary, since a node with both a horizontal and a vertical
      // issue is one problem to review, not two.
      const messages = [];

      if (horizontalOverflow) {
        messages.push({
          color: "#FF6A00",
          text: isImpliedContainer
            ? "Horizontal overflow (inferred) \u2014 escapes the bounds of \"" + clipAncestorName + "\", a container it visually sits inside but isn't structurally clipped by. Consider enabling \"Clip content\" on it, or confirm this text is meant to be unconstrained. Verify visually."
            : isAutoSized
            ? "Horizontal overflow \u2014 escapes " + (clipAncestorName || "a clipping ancestor") + "."
            : "Horizontal overflow \u2014 exceeds container width by " + horizontalDelta + "px."
        });
      }
      if (verticalOverflow) {
        messages.push({
          color: "#0088FF",
          text: isImpliedContainer
            ? "Vertical overflow (inferred) \u2014 escapes the bounds of \"" + clipAncestorName + "\", a container it visually sits inside but isn't structurally clipped by. Consider enabling \"Clip content\" on it, or confirm this text is meant to be unconstrained. Verify visually."
            : isAutoSized
            ? "Vertical overflow \u2014 escapes " + (clipAncestorName || "a clipping ancestor") + "."
            : "Vertical overflow \u2014 exceeds container height by " + verticalDelta + "px."
        });
      }
      if (horizontalOverflow || verticalOverflow) {
        const bg = getBackgroundColor(node);
        const signal = pickSignalColor(bg);
        node.fills = [{ type: "SOLID", color: signal }];
      }

      // Vertical diacritic/ink overflow — always checked, not gated behind
      // any toggle (only the character INCLUSION is optional; detection
      // isn't). Uses a stroke rather than a fill color so it stays visually
      // distinguishable from the box/ancestor overflow signal above, even
      // when both fire on the same node.
      if (checkVerticalOverflow(node)) {
        node.strokes = [{ type: "SOLID", color: hexToRgbObj(VERTICAL_OVERFLOW_COLOR) }];
        node.strokeWeight = 2;
        messages.push({
          color: VERTICAL_OVERFLOW_COLOR,
          text: "Possible line collision \u2014 glyph ink (diacritics/marks) extends beyond this box vertically. Approximation only, since Figma's plugin API doesn't expose per-line bounds \u2014 verify visually."
        });
      }

      if (messages.length > 0) {
        stats.locIssuesFound++;
        issueLog.push({ nodeId: node.id, nodeName: node.name, messages: messages });
      }
    } catch (err) {
      stats.errors++;
      errorLog.push({
        nodeName: node.name,
        message: "This layer could not be pseudolocalized. " + (err && err.message ? err.message : String(err)),
        link: null
      });
      console.error("Pseudolocalize error on node:", node.name, err);
    }
  }

  return { stats: stats, issueLog: issueLog, errorLog: errorLog, notice: null };
}

// ----------------------------------------------------------------------------
// 6c. Collision-avoidance repositioning for the review panel. When Back/Next
//     jumps the canvas to a flagged node, the panel itself doesn't move —
//     it can end up sitting directly on top of the exact issue it's
//     describing. This checks for that overlap and nudges the panel just
//     clear of it, choosing whichever of four candidate positions (push
//     right / left / down / up) requires the LEAST movement from the
//     panel's current spot, and does nothing at all if no candidate keeps
//     the panel within the visible viewport (per spec: don't move it rather
//     than push it somewhere worse).
//
//     KNOWN LIMITATION, confirmed via multiple independent Figma forum
//     reports: figma.ui.reposition() silently stops having any effect the
//     first time a user manually drags the panel — no error, it just quietly
//     no-ops from then on. This is a real, currently-unresolved bug in
//     Figma's own plugin API, not something fixable from plugin code. If
//     this feature appears to "stop working" partway through a session,
//     that's almost certainly why.
// ----------------------------------------------------------------------------

function avoidCoveringNode(node) {
  try {
    const nodeBox = node.absoluteBoundingBox;
    if (!nodeBox) return;

    const zoom = figma.viewport.zoom;
    const pos = figma.ui.getPosition(); // throws if no UI is available
    const panelBox = {
      x: pos.canvasSpace.x,
      y: pos.canvasSpace.y,
      width: currentPanelWidthPx / zoom,
      height: currentPanelHeightPx / zoom
    };

    const overlaps = !(
      panelBox.x + panelBox.width < nodeBox.x ||
      panelBox.x > nodeBox.x + nodeBox.width ||
      panelBox.y + panelBox.height < nodeBox.y ||
      panelBox.y > nodeBox.y + nodeBox.height
    );
    if (!overlaps) return; // nothing to do — most common case

    const viewBounds = figma.viewport.bounds; // {x, y, width, height} in canvas space
    const margin = 16 / zoom; // ~16px visual gap between panel and node, in canvas units

    const candidates = [
      { x: nodeBox.x + nodeBox.width + margin, y: panelBox.y }, // push right
      { x: nodeBox.x - panelBox.width - margin, y: panelBox.y }, // push left
      { x: panelBox.x, y: nodeBox.y + nodeBox.height + margin }, // push down
      { x: panelBox.x, y: nodeBox.y - panelBox.height - margin }  // push up
    ];

    const valid = candidates.filter((c) => {
      return (
        c.x + panelBox.width > viewBounds.x &&
        c.x < viewBounds.x + viewBounds.width &&
        c.y + panelBox.height > viewBounds.y &&
        c.y < viewBounds.y + viewBounds.height
      );
    });

    if (valid.length === 0) return; // impossible to clear the node without leaving the visible area — leave the panel alone, per spec

    let best = valid[0];
    let bestDist = Math.hypot(best.x - panelBox.x, best.y - panelBox.y);
    for (const c of valid) {
      const dist = Math.hypot(c.x - panelBox.x, c.y - panelBox.y);
      if (dist < bestDist) {
        bestDist = dist;
        best = c;
      }
    }

    figma.ui.reposition(best.x, best.y);
  } catch (e) {
    // getPosition()/reposition() can throw, or silently no-op per the known
    // Figma bug described above — fail silently either way rather than
    // break the review flow over a cosmetic positioning nicety.
  }
}

figma.ui.onmessage = (msg) => {
  if (msg.type === "settingsChanged") {
    const settings = {
      includeRTL: !!msg.includeRTL,
      verticalEdgeCase: !!msg.verticalEdgeCase,
      alwaysShowSummary: !!msg.alwaysShowSummary
    };
    figma.clientStorage.setAsync(SETTINGS_KEY, settings).catch(() => {
      // Non-fatal — the checkbox state just won't persist this time.
    });
  } else if (msg.type === "selectNode") {
    // Next/Back in the issue review — jump canvas selection + viewport to
    // the flagged node. getNodeByIdAsync (not the sync getNodeById) is
    // required under "documentAccess": "dynamic-page".
    figma.getNodeByIdAsync(msg.nodeId).then((node) => {
      if (node && "type" in node) {
        figma.currentPage.selection = [node];
        figma.viewport.scrollAndZoomIntoView([node]);
        avoidCoveringNode(node);
      }
    }).catch(() => {
      // Node may have been deleted/modified since the run — non-fatal, just don't jump.
    });
  } else if (msg.type === "close") {
    figma.closePlugin();
  } else if (msg.type === "resize") {
    currentPanelWidthPx = msg.width;
    currentPanelHeightPx = msg.height;
    figma.ui.resize(msg.width, msg.height);
  }
};
