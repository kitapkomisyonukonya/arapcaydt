/**
 * Which part of a lesson slide each spoken sentence is about, and when it is said. Where things are
 * comes from the PDF's own text layer (exact, no OCR); which part a sentence is about comes from the
 * words they share; when, from the pauses of the slide's voice. slideScene.ts turns this into the
 * question editor's marks.
 */

/** A line of text on the slide, as a share (0–1) of the slide picture. */
export interface SlideLine {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rtl?: boolean;
}

/** A piece of text the PDF reports, already as a share of the slide picture. */
export interface TextRun { str: string; x: number; y: number; width: number; height: number }

export type BlockKind = 'title' | 'bullet' | 'line' | 'row';
/** A part of the slide a sentence can be about: a line, a wrapped sentence or a table row. */
export interface SlideBlock {
  kind: BlockKind;
  lines: SlideLine[];
  text: string;
  x: number; y: number; width: number; height: number;
  rtl: boolean;
}

const ARABIC = /[؀-ۿ]/;
const HARAKAT = /[ً-ْٰـ]/g;
// Bullets: signs, numbers, "a)", circled numbers and Wingdings ticks (PowerPoint writes those in a private range).
const BULLET = /^\s*([•●▪■◆\-–*✓✔①-⑳\uF000-\uF0FF]|\d+[.)]|[a-eA-E][.)])\s*/;
const round = (v: number) => Math.round(v * 10000) / 10000;

/**
 * The PDF's text pieces as a share of the page. `toPage` maps a PDF point to the drawn page
 * (pdf.js: Util.transform(viewport.transform, item.transform)).
 */
export function textRuns(
  items: Array<{ str?: string; transform?: number[]; width?: number }>,
  toPage: (transform: number[]) => number[],
  scale: number, pageWidth: number, pageHeight: number,
): TextRun[] {
  return items.flatMap(item => {
    if (!item.str?.trim() || !item.transform) return [];
    const [, , c, d, e, f] = toPage(item.transform);
    const size = Math.hypot(c, d);
    if (!size) return [];
    return [{ str: item.str, x: e / pageWidth, y: (f - size * 0.8) / pageHeight, width: (item.width || 0) * scale / pageWidth, height: size * 1.05 / pageHeight }];
  });
}

interface Group { runs: Array<TextRun & { w: number }>; x0: number; x1: number; y0: number; y1: number; h: number; rtl: boolean }

/**
 * Pieces side by side on one baseline become one line (an Arabic line's harakat sit higher or lower).
 * `aspect` is the slide's height / width: a share of the height is that much wider across.
 */
export function textLines(runs: TextRun[], aspect = 9 / 16): SlideLine[] {
  const pieces = runs.map(r => ({ ...r, str: r.str.replace(/[\u0000-\u001F]/g, ''), w: r.width || r.height * aspect * 0.3 }))
    .filter(r => r.str.trim()).sort((a, b) => (a.y + a.height / 2) - (b.y + b.height / 2) || a.x - b.x);
  const groups: Group[] = [];
  const near = (g: Group, x0: number, x1: number, y0: number, y1: number, rtl: boolean) => {
    const h = Math.max(g.h, y1 - y0);
    const overlap = Math.min(g.y1, y1) - Math.max(g.y0, y0);
    return g.rtl === rtl && overlap > Math.min(g.y1 - g.y0, y1 - y0) * 0.6 && x0 < g.x1 + h * aspect * 1.6 && x1 > g.x0 - h * aspect * 1.6;
  };
  for (const p of pieces) {
    const rtl = ARABIC.test(p.str);
    const g = groups.find(o => near(o, p.x, p.x + p.w, p.y, p.y + p.height, rtl));
    if (g) {
      g.runs.push(p); g.x0 = Math.min(g.x0, p.x); g.x1 = Math.max(g.x1, p.x + p.w);
      g.y0 = Math.min(g.y0, p.y); g.y1 = Math.max(g.y1, p.y + p.height); g.h = Math.max(g.h, p.height);
    } else groups.push({ runs: [p], x0: p.x, x1: p.x + p.w, y0: p.y, y1: p.y + p.height, h: p.height, rtl });
  }
  // Pieces of one line met out of order are joined afterwards.
  for (let joined = true; joined;) {
    joined = false;
    outer: for (const a of groups) for (const b of groups) {
      if (a !== b && near(a, b.x0, b.x1, b.y0, b.y1, b.rtl)) {
        a.runs.push(...b.runs); a.x0 = Math.min(a.x0, b.x0); a.x1 = Math.max(a.x1, b.x1);
        a.y0 = Math.min(a.y0, b.y0); a.y1 = Math.max(a.y1, b.y1); a.h = Math.max(a.h, b.h);
        groups.splice(groups.indexOf(b), 1); joined = true; break outer;
      }
    }
  }
  return groups.map(g => {
    const ordered = [...g.runs].sort((a, b) => g.rtl ? b.x - a.x : a.x - b.x);
    let text = '';
    ordered.forEach((r, i) => {
      const prev = ordered[i - 1];
      // PowerPoint often leaves the spaces out and places each word by itself: a gap wider than a third of a letter is a space.
      const letter = prev && Math.min(prev.w / Math.max(1, prev.str.length), r.w / Math.max(1, r.str.length));
      const gap = prev && !g.rtl && !text.endsWith(' ') && !r.str.startsWith(' ') && r.x - (prev.x + prev.w) > letter! * 0.33;
      text += (gap ? ' ' : '') + r.str;
    });
    // The PDF gives an Arabic line letter by letter with the harakat out of place: kept without them (it only serves matching).
    if (g.rtl) text = text.replace(HARAKAT, '').replace(/[^\u0600-\u06FF\s]/g, '');
    return { text: text.replace(/\s+/g, ' ').trim(), x: round(g.x0), y: round(g.y0), width: round(g.x1 - g.x0), height: round(g.y1 - g.y0), ...(g.rtl ? { rtl: true } : {}) };
  }).filter(l => l.text).sort((a, b) => a.y - b.y || a.x - b.x);
}

function boxOf(kind: BlockKind, lines: SlideLine[], text: string): SlideBlock {
  const x = Math.min(...lines.map(l => l.x)), y = Math.min(...lines.map(l => l.y));
  return { kind, lines, text, x, y, width: Math.max(...lines.map(l => l.x + l.width)) - x, height: Math.max(...lines.map(l => l.y + l.height)) - y, rtl: !!lines[0].rtl };
}

/** The slide's parts: table rows, sentences wrapped over lines joined, the title apart. */
export function slideBlocks(lines: SlideLine[]): SlideBlock[] {
  const blocks: SlideBlock[] = [];
  const used = new Set<SlideLine>();
  for (const l of lines) {
    if (used.has(l) || l.rtl) continue;
    const row = lines.filter(o => !o.rtl && Math.abs(o.y - l.y) < 0.012 && Math.abs(o.height - l.height) < 0.01);
    if (row.length >= 3 && row.every(o => o.width < 0.35)) {
      row.sort((a, b) => a.x - b.x).forEach(o => used.add(o));
      blocks.push(boxOf('row', row, row.map(o => o.text).join(' ')));
    }
  }
  for (const l of lines) {
    if (used.has(l)) continue;
    const prev = [...blocks].reverse().find(b => b.kind !== 'row' && b.kind !== 'title' && Math.abs(b.lines[b.lines.length - 1].x - l.x) < 0.01);
    const p = prev?.lines[prev.lines.length - 1];
    if (prev && p && !l.rtl && !p.rtl && l.y > p.y && l.y - (p.y + p.height) < p.height * 0.9 && Math.abs(p.height - l.height) < 0.01
      && !/[.!?:]$/.test(p.text) && !BULLET.test(l.text)) {
      blocks[blocks.indexOf(prev)] = boxOf(prev.kind, [...prev.lines, l], `${prev.text} ${l.text}`);
      continue;
    }
    // The band at the top (slide title, running header) is never marked.
    blocks.push(boxOf(l.y + l.height / 2 < 0.17 ? 'title' : BULLET.test(l.text) ? 'bullet' : 'line', [l], l.text));
  }
  // Three or more single lines of one size starting at one place are a list even without bullet signs.
  for (const [i, b] of blocks.entries()) {
    if (b.kind !== 'line' || b.rtl || b.lines.length > 1 || b.text.endsWith(':') || b.text.length < 4) continue;
    const same = blocks.filter(o => (o.kind === 'line' || o.kind === 'bullet') && !o.rtl && o.lines.length === 1 && !o.text.endsWith(':')
      && Math.abs(o.x - b.x) < 0.01 && Math.abs(o.height - b.height) < 0.005);
    if (same.length >= 3) blocks[i] = { ...b, kind: 'bullet' };
  }
  return blocks.sort((a, b) => a.y - b.y || a.x - b.x);
}

/** The parts a sentence can point at (everything but the title), in reading order. */
export const markable = (blocks: SlideBlock[]) => blocks.filter(b => b.kind !== 'title');

/** The slide's text in sentences, as it will be spoken. */
export function sentences(text: string): string[] {
  return (text.match(/[^.!?؟…\n]+[.!?؟…]*/g) || []).map(s => s.trim()).filter(s => /[\p{L}\p{N}]/u.test(s));
}

const STOP = new Set(('bu şu o ve ile ya da de ki bir iki ise için olarak gibi çok ama şimdi yani burada son ne her en daha bunu buna bunun onun ona '
  + 'olur olan diyoruz denir deriz bakalım geçelim var dikkat hem değil mi mı').split(' '));
const trNorm = (s: string) => s.toLocaleLowerCase('tr-TR').normalize('NFD').replace(/\p{M}/gu, '').replace(/ı/g, 'i');
const arNorm = (s: string) => s.normalize('NFD').replace(HARAKAT, '').replace(/[إأآٱ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه');
const trWords = (s: string) => [...new Set((trNorm(s.replace(BULLET, '')).match(/[a-z0-9çğöşü]+/g) || []).filter(w => w.length > 1 && !STOP.has(w)))];
/** One word in two forms: "fiil" / "fiillerin", "kök" / "kökten" (Turkish adds its endings). */
const sameWord = (a: string, b: string) => {
  if (a === b) return true;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  return short.length >= 3 && long.startsWith(short) && (short.length >= 5 || long.length - short.length <= 7);
};
const has = (words: string[], w: string) => words.some(o => sameWord(o, w));
const arText = (s: string) => arNorm((s.match(/[؀-ۿ]+/g) || []).join(' '));
function bigrams(s: string) {
  const t = s.replace(/\s+/g, ''), out = new Map<string, number>();
  for (let i = 0; i < t.length - 1; i++) out.set(t.slice(i, i + 2), (out.get(t.slice(i, i + 2)) || 0) + 1);
  return out;
}
function dice(a: string, b: string) {
  const A = bigrams(a), B = bigrams(b);
  let common = 0, n = 0;
  for (const [k, v] of A) { common += Math.min(v, B.get(k) || 0); n += v; }
  for (const v of B.values()) n += v;
  return n ? 2 * common / n : 0;
}

const ORDINALS: Array<[string, number | 'last']> = [['ilk|birinci', 1], ['ikinci', 2], ['üçüncü', 3], ['dördüncü', 4], ['beşinci', 5], ['altıncı', 6], ['son|sonuncu', 'last']];
/** "İlk satır", "ikincisi", "üçüncü cümlede": an ordinal that points at a list item ("ilk iş" does not). */
function ordinal(sentence: string): number | 'last' | null {
  const t = sentence.toLocaleLowerCase('tr-TR');
  for (const [w, n] of ORDINALS)
    if (new RegExp(`(^|\\s)(${w})(\\s+(satır|madde|örnek|parça|kural)\\S*|\\s+cümlede|s[iıuü]\\S*|ki\\S*|nde\\b)`, 'u').test(t)) return n;
  return null;
}
/** The slide's list: table rows (without the header row), else bullets, else the Arabic lines, else plain lines. */
function listItems(targets: SlideBlock[]): SlideBlock[] {
  const rows = targets.filter(b => b.kind === 'row');
  if (rows.length > 1) return rows.slice(1);
  for (const pick of [(b: SlideBlock) => b.kind === 'bullet', (b: SlideBlock) => b.rtl, (b: SlideBlock) => b.kind === 'line']) {
    const list = targets.filter(pick);
    if (list.length > 1) return list;
  }
  return [];
}

/**
 * How telling a word is across the whole presentation: the subject's own words ("kelime" in a
 * vocabulary lesson, on every slide and in the running header) count little.
 */
export type DeckWords = (word: string) => number;
export function deckWords(slides: Array<SlideLine[] | undefined>): DeckWords {
  const pages = slides.map(lines => trWords((lines || []).map(l => l.text).join(' ')));
  const n = Math.max(1, pages.length);
  return word => Math.log(1 + n / (pages.filter(p => has(p, word)).length || 0.5)) / Math.log(1 + n / 0.5);
}

/** Only big type and no list (a cover slide): nothing to point at while the teacher introduces the lesson. */
export const isCover = (blocks: SlideBlock[]) => markable(blocks).every(b => b.kind === 'line' && b.lines.every(l => l.height >= 0.06));

/**
 * For each sentence, the index (in `markable(blocks)`) of the part it talks about, or -1. When in
 * doubt nothing is marked: a missing mark is better than one on the wrong line. A sentence in the
 * same paragraph as a marked one keeps that mark (-1) unless it clearly points at another part.
 */
export function matchSentences(said: string[], blocks: SlideBlock[], options: { paragraphs?: number[]; deck?: DeckWords } = {}): number[] {
  const targets = markable(blocks);
  if (!targets.length || isCover(blocks)) return said.map(() => -1);
  const partWords = targets.map(b => trWords(b.text));
  const idf = (w: string) => Math.log(1 + targets.length / (partWords.filter(p => has(p, w)).length || 0.5)) * (options.deck ? options.deck(w) : 1);
  const weight = (words: string[]) => words.reduce((s, w) => s + idf(w), 0);
  // How much the shared words say on their own: the subject's everyday words ("kelime", "anlam") are not enough.
  const telling = (words: string[]) => words.reduce((s, w) => s + (options.deck ? options.deck(w) : 1), 0);
  let last = -1, held = -1;
  return said.map((sentence, si) => {
    const words = trWords(sentence), arabic = arText(sentence);
    const scored = targets.map((b, i) => {
      let score: number, strength = 1, hit: string[] = [];
      if (b.rtl) score = arabic ? dice(arabic, arNorm(b.text)) : 0;
      else {
        const own = partWords[i];
        hit = own.filter(w => has(words, w));
        const heard = words.filter(w => has(own, w));
        score = 0.6 * weight(hit) / (weight(own) || 1) + 0.4 * weight(heard) / (weight(words) || 1);
        strength = telling(hit);
      }
      if (i === last + 1) score += 0.05; // teachers mostly go top to bottom
      return { i, score, strength, hit };
    }).sort((a, b) => b.score - a.score);
    let [best, second] = scored as Array<{ i: number; score: number; strength: number; hit: string[] } | undefined>;
    const nth = ordinal(sentence);
    if (nth && !(best && best.score >= 0.5 && best.strength >= 0.75)) {
      const list = listItems(targets);
      const item = nth === 'last' ? list[list.length - 1] : list[nth - 1];
      if (item) { best = { i: targets.indexOf(item), score: 0.5, strength: 9, hit: [] }; second = undefined; }
    }
    const paragraph = options.paragraphs?.[si];
    const sure = !!best && best.score >= 0.3 && best.strength >= 0.75 && (!second || best.score - second.score >= 0.05 || best.i === last + 1);
    // The paragraph is still about what it marked: only a strong pointer elsewhere moves the mark.
    const elsewhere = sure && best!.i !== last && (best!.strength === 9
      || (best!.score >= 0.6 && telling(best!.hit.filter(w => last < 0 || !has(partWords[last], w))) >= 1.2));
    if (held >= 0 && paragraph !== undefined && paragraph === held && !elsewhere) return -1;
    if (!sure) { held = -1; return -1; }
    last = best!.i;
    held = paragraph ?? -1;
    return best!.i;
  });
}

/** Arabic examples in one column and their translations in another, as many of each: paired in order. */
export function translationPairs(blocks: SlideBlock[]): Map<SlideBlock, SlideBlock> {
  const ar = blocks.filter(b => b.rtl);
  if (ar.length < 2) return new Map();
  const left = Math.min(...ar.map(a => a.x)), right = Math.max(...ar.map(a => a.x + a.width));
  const tr = blocks.filter(b => !b.rtl && (b.kind === 'line' || b.kind === 'bullet') && (b.x + b.width < left || b.x > right));
  if (tr.length !== ar.length) return new Map();
  return new Map(ar.flatMap((a, i) => [[a, tr[i]], [tr[i], a]] as Array<[SlideBlock, SlideBlock]>));
}

/** What the teacher changed by hand: sentence → part number in `markable` (-1: no mark). */
export type MarkFixes = Record<string, number>;
export const fixKey = (sentence: string) => sentence.replace(/\s+/g, ' ').trim();

export interface SlideMark {
  sentence: string;
  /** Index in `markable(blocks)`, or -1. */
  part: number;
  /** Set by the teacher, not found by the studio. */
  fixed: boolean;
}

/** Each sentence of the slide's text and the part it marks: the teacher's choice first, else the studio's. */
export function slideMarks(text: string, lines: SlideLine[] | undefined, fixes: MarkFixes = {}, deck?: DeckWords): { blocks: SlideBlock[]; marks: SlideMark[] } {
  const blocks = lines?.length ? slideBlocks(lines) : [];
  const said = sentences(text);
  const found = matchSentences(said, blocks, { paragraphs: sentenceParagraphs(text), deck });
  const count = markable(blocks).length;
  return {
    blocks,
    marks: said.map((sentence, i) => {
      const fix = fixes[fixKey(sentence)];
      const valid = typeof fix === 'number' && fix >= -1 && fix < count;
      return { sentence, part: valid ? fix : found[i], fixed: valid };
    }),
  };
}

/** A mark with its time inside the slide's own voice (seconds from the start of that voice). */
export interface TimedMark { start: number; end: number; block: SlideBlock; partner?: SlideBlock }

/** A quiet stretch of a voice, in seconds from its start. */
export interface Pause { start: number; end: number }

/**
 * The quiet stretches of a voice (breaths between sentences and phrases), found from its loudness
 * in 10 ms steps against the voice's own quiet and loud levels. None when it has no clear quiet
 * (a recording with steady background noise).
 */
export function voicePauses(samples: Float32Array, rate: number, shortest = 0.15): Pause[] {
  const step = Math.max(1, Math.round(rate / 100));
  const level: number[] = [];
  for (let i = 0; i + step <= samples.length; i += step) {
    let sum = 0;
    for (let k = i; k < i + step; k++) sum += samples[k] * samples[k];
    level.push(10 * Math.log10(sum / step + 1e-12));
  }
  if (level.length < 10) return [];
  const sorted = [...level].sort((a, b) => a - b);
  const low = sorted[Math.floor(sorted.length * 0.1)], high = sorted[Math.floor(sorted.length * 0.95)];
  if (high - low < 15) return [];
  const quiet = level.map(l => l < low + (high - low) * 0.3);
  // A click inside a quiet stretch (under 40 ms) does not end it.
  for (let i = 0; i < quiet.length;) {
    if (quiet[i]) { i++; continue; }
    let j = i;
    while (j < quiet.length && !quiet[j]) j++;
    if (i > 0 && j < quiet.length && j - i < 4) quiet.fill(true, i, j);
    i = j;
  }
  const pauses: Pause[] = [], seconds = step / rate;
  for (let i = 0; i < quiet.length;) {
    if (!quiet[i]) { i++; continue; }
    let j = i;
    while (j < quiet.length && quiet[j]) j++;
    const atEdge = i === 0 || j === quiet.length;
    if ((j - i) * seconds >= shortest || atEdge) pauses.push({ start: i * seconds, end: j === quiet.length ? samples.length / rate : j * seconds });
    i = j;
  }
  return pauses;
}

/**
 * When each sentence is said. Without the voice's pauses: its length shared out by how long each
 * sentence takes to say (letters, and a short breath at each sentence end). With them: each sentence
 * end is put on the pause the voice really makes there, the longest breath near where it was
 * expected (a sentence ends with a longer breath than a comma). A sentence starts a moment before
 * its first word and lasts until the next one starts.
 */
export function sentenceTimes(said: string[], duration: number, pauses?: Pause[]): Array<{ start: number; end: number }> {
  const cost = said.map(s => 0.35 + s.replace(HARAKAT, '').replace(/\s+/g, ' ').length / 13.5);
  const total = cost.reduce((a, b) => a + b, 0) || 1;
  if (!pauses?.length || said.length < 2) {
    let at = 0;
    return cost.map(c => { const start = at; at += c / total * duration; return { start, end: at }; });
  }
  // The pauses inside the speech, and the speech's own length ("speech time": the pauses left out).
  const first = pauses[0].start <= 0.01 ? pauses[0].end : 0;
  const last = pauses[pauses.length - 1].end >= duration - 0.01 ? pauses[pauses.length - 1].start : duration;
  const inner = pauses.filter(p => p.start > first && p.end < last);
  let quietBefore = 0;
  const spoken = inner.map(p => { const at = p.start - first - quietBefore; quietBefore += p.end - p.start; return at; });
  const speech = Math.max(0.1, last - first - quietBefore);
  const expected = cost.slice(0, -1).map((_, j) => cost.slice(0, j + 1).reduce((a, b) => a + b, 0) / total * speech);
  // Each sentence end takes a later pause than the one before, or (when none fits) stays where expected.
  const spread = Math.max(1, speech * 0.1), MISS = 4;
  const fit = (j: number, p: number) => ((spoken[p] - expected[j]) / spread) ** 2 - 1.5 * Math.log(Math.min(1.2, inner[p].end - inner[p].start) / 0.15);
  const n = expected.length, m = inner.length;
  // best[j][p]: the lowest cost of the first j sentence ends using pauses before p.
  const best = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(Infinity));
  const took = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  best[0].fill(0);
  for (let j = 1; j <= n; j++) {
    for (let p = 0; p <= m; p++) {
      let value = best[j - 1][p] + MISS, how = 0; // 0: no pause; 1: pause p-1; 2: skip pause p-1
      if (p > 0) {
        const use = best[j - 1][p - 1] + fit(j - 1, p - 1);
        if (use < value) { value = use; how = 1; }
        if (best[j][p - 1] < value) { value = best[j][p - 1]; how = 2; }
      }
      best[j][p] = value; took[j][p] = how;
    }
  }
  const ends: Array<Pause | null> = new Array(n).fill(null);
  for (let j = n, p = m; j > 0;) {
    const how = took[j][p];
    if (how === 2) p--;
    else { if (how === 1) ends[j - 1] = inner[--p]; j--; }
  }
  // Speech time back to the voice's own time, for the ends with no pause.
  const real = (at: number) => {
    let t = first + at;
    for (const [k, p] of inner.entries()) if (spoken[k] < at) t += p.end - p.start;
    return t;
  };
  const starts = [0, ...ends.map((p, j) => p ? Math.max(p.start, p.end - 0.15) : real(expected[j]))];
  for (let i = 1; i < starts.length; i++) starts[i] = Math.max(starts[i], starts[i - 1]);
  return starts.map((start, i) => ({ start, end: i + 1 < starts.length ? starts[i + 1] : duration }));
}

/** Which paragraph (blocks of text split by an empty line) each sentence is in. */
export function sentenceParagraphs(text: string): number[] {
  return text.split(/\n\s*\n/).flatMap((p, i) => sentences(p).map(() => i));
}

/**
 * The marks with their times. A mark stays while the teacher keeps talking about it: over the
 * following sentences of its paragraph that point nowhere else, and over a next sentence about the same part.
 */
export function timedMarks(text: string, lines: SlideLine[] | undefined, fixes: MarkFixes | undefined, duration: number, deck?: DeckWords, pauses?: Pause[]): { blocks: SlideBlock[]; marks: TimedMark[] } {
  const { blocks, marks } = slideMarks(text, lines, fixes, deck);
  const parts = markable(blocks), pairs = translationPairs(blocks);
  const times = sentenceTimes(marks.map(m => m.sentence), duration, pauses);
  const paragraph = sentenceParagraphs(text);
  const out: Array<TimedMark & { part: number; paragraph: number }> = [];
  marks.forEach((m, i) => {
    const prev = out[out.length - 1];
    if (m.part < 0) {
      if (prev && prev.paragraph === paragraph[i] && Math.abs(prev.end - times[i].start) < 1e-6) prev.end = times[i].end;
      return;
    }
    if (prev && prev.part === m.part && Math.abs(prev.end - times[i].start) < 1e-6) { prev.end = times[i].end; prev.paragraph = paragraph[i]; return; }
    out.push({ ...times[i], block: parts[m.part], partner: pairs.get(parts[m.part]), part: m.part, paragraph: paragraph[i] });
  });
  return { blocks, marks: out.map(({ part, paragraph, ...mark }) => mark) };
}
