import { AnnotationRegion } from '../../types';
import { OCRResult, OCRWord } from './ocrTypes';

type OptionLetter = 'A' | 'B' | 'C' | 'D' | 'E';

interface DetectedOptionMarker {
  letter: OptionLetter;
  word: OCRWord;
  y: number;
  confidence: number;
}

function matchOptionLetter(text: string): OptionLetter | null {
  const cleaned = text.replace(/[\u200E\u200F\u202A-\u202E\u2066-\u2069]/g, '').trim();

  const latinMatch = cleaned.match(/^[\(\[]?([A-Ea-e])[\)\.\:\-\]]?$/);
  if (latinMatch) return latinMatch[1].toUpperCase() as OptionLetter;

  const prefixMatch = cleaned.match(/^[\(\[]?([A-Ea-e])[\)\.\:\-\]]\s*/);
  if (prefixMatch) return prefixMatch[1].toUpperCase() as OptionLetter;

  if (/^[\(\[]?[أا][\)\.\:\-\]]?$/.test(cleaned)) return 'A';
  if (/^[\(\[]?[ب][\)\.\:\-\]]?$/.test(cleaned)) return 'B';
  if (/^[\(\[]?[ج][\)\.\:\-\]]?$/.test(cleaned)) return 'C';
  if (/^[\(\[]?[د][\)\.\:\-\]]?$/.test(cleaned)) return 'D';
  if (/^[\(\[]?[هـه][\)\.\:\-\]]?$/.test(cleaned)) return 'E';

  return null;
}

function addCandidate(
  list: DetectedOptionMarker[],
  letter: OptionLetter,
  word: OCRWord,
  confidenceBonus = 0
) {
  // Header/body noise frequently contains isolated A-E characters. YDT answer
  // choices are expected below the opening question area.
  if (word.y < 0.14 || word.y > 0.98) return;

  const confidence = Math.max(0, Math.min(100, word.confidence + confidenceBonus));
  const duplicate = list.some(
    (c) => c.letter === letter && Math.abs(c.y - word.y) < Math.max(0.008, word.height * 0.6)
  );
  if (!duplicate) list.push({ letter, word, y: word.y, confidence });
}

function collectMarkerCandidates(ocr: OCRResult): DetectedOptionMarker[] {
  const candidates: DetectedOptionMarker[] = [];

  // Word-level markers are the most precise source.
  for (const word of [...(ocr.optionMarkers || []), ...(ocr.words || [])]) {
    const letter = matchOptionLetter(word.text);
    if (letter) addCandidate(candidates, letter, word, 5);
  }

  // Tesseract occasionally merges "A)" with the option text. In that case the
  // line itself still starts with the marker, so use its first word / line bbox.
  for (const line of ocr.lines || []) {
    const letter = matchOptionLetter(line.text);
    if (!letter) continue;

    // RTL output order is not physical order. Never attach A to the first
    // Arabic word of a full-width line containing both A and B.
    const firstWord = line.words?.find(word => matchOptionLetter(word.text) === letter);
    if (!firstWord) continue;
    const pseudoWord: OCRWord = firstWord || {
      text: line.text,
      confidence: line.confidence,
      x: line.x,
      y: line.y,
      width: Math.min(line.width, 0.08),
      height: line.height,
      pixelX: Math.round(line.x * ocr.imageWidth),
      pixelY: Math.round(line.y * ocr.imageHeight),
      pixelWidth: Math.round(Math.min(line.width, 0.08) * ocr.imageWidth),
      pixelHeight: Math.round(line.height * ocr.imageHeight),
    };
    addCandidate(candidates, letter, pseudoWord, 12);
  }

  // A damaged Latin C is commonly recognized as 0) in the supplied slide.
  // Recover its label only when three explicit labels prove the 2-column grid;
  // retain the actual OCR box. Without that evidence the option stays missing.
  if (!candidates.some((candidate) => candidate.letter === 'C')) {
    const a = candidates.find((candidate) => candidate.letter === 'A');
    const b = candidates.find((candidate) => candidate.letter === 'B');
    const d = candidates.find((candidate) => candidate.letter === 'D');
    if (a && b && d && Math.abs(a.y - b.y) < 0.025 &&
        Math.abs(b.word.x - d.word.x) < 0.035 && d.y > a.y + 0.03) {
      const damaged = (ocr.words || []).find((word) =>
        /^[0O©][).]$/.test(word.text.replace(/[\u200E\u200F]/g, '').trim()) &&
        Math.abs(word.x - a.word.x) < 0.035 && Math.abs(word.y - d.y) < 0.025);
      if (damaged) addCandidate(candidates, 'C', damaged);
    }
  }

  return candidates.sort((a, b) => (a.y - b.y) || (b.confidence - a.confidence));
}

/** Select labels by spatial evidence; A/B and C/D may share a row. */
function chooseMarkers(candidates: DetectedOptionMarker[]): Map<OptionLetter, DetectedOptionMarker> {
  const selected = new Map<OptionLetter, DetectedOptionMarker>();
  for (const letter of ['A', 'B', 'C', 'D', 'E'] as OptionLetter[]) {
    const options = candidates.filter((candidate) => candidate.letter === letter);
    options.sort((a, b) => {
      const score = (candidate: DetectedOptionMarker) => {
        const peers = candidates.filter((other) => other.letter !== letter &&
          Math.abs(other.y - candidate.y) < 0.36);
        const marked = /[)\].:]/.test(candidate.word.text) ? 20 : 0;
        return candidate.confidence + marked + new Set(peers.map((peer) => peer.letter)).size * 8;
      };
      return score(b) - score(a);
    });
    if (options[0]) selected.set(letter, options[0]);
  }
  return selected;
}

const LETTER_ORDER: OptionLetter[] = ['A', 'B', 'C', 'D', 'E'];

/** Rows by visual baseline; used for reading-order label assignment. */
function rowsOf<T extends { word: OCRWord }>(items: T[]): T[][] {
  const rows: T[][] = [];
  for (const item of [...items].sort((a, b) => a.word.y - b.word.y)) {
    const row = rows.find(group => Math.abs(group[0].word.y + group[0].word.height / 2 - item.word.y - item.word.height / 2)
      < Math.max(group[0].word.height, item.word.height) * .6);
    if (row) row.push(item); else rows.push([item]);
  }
  return rows;
}

/**
 * Scanned labels are often misread ("B)" → "(5", "C)" → "0", "E)" → "3").
 * Labels share one font size, so tokens with the size of the letters OCR did
 * read are label candidates. Letters are then assigned in reading order
 * (A B / C D / E, a single row, or a single column) and accepted only when
 * every confidently read label keeps its own letter.
 */
function inferMarkersFromLayout(selected: Map<OptionLetter, DetectedOptionMarker>, words: OCRWord[]) {
  const anchors = [...selected.values()];
  if (!anchors.length || anchors.length >= 5) return selected;
  const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
  const h = median(anchors.map(a => a.word.height));
  const w = median(anchors.map(a => a.word.width));
  const overlaps = (a: OCRWord, b: OCRWord) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
  const pool: DetectedOptionMarker[] = [];
  for (const word of words) {
    const text = word.text.replace(/[\u200E\u200F\u202A-\u202E\u2066-\u2069]/g, '').trim();
    if (!text || text.length > 3 || word.y < .14 || word.y > .94) continue;
    if (Math.abs(word.height - h) > h * .18 || word.width < w * .5 || word.width > w * 1.7) continue;
    // A label always introduces option text on its right.
    if (!words.some(other => other !== word && other.x >= word.x + word.width - .002 && other.x - word.x - word.width < w * 3
      && Math.abs(other.y + other.height / 2 - word.y - word.height / 2) < h)) continue;
    if (anchors.some(a => overlaps(a.word, word)) || pool.some(c => overlaps(c.word, word))) continue;
    pool.push({ letter: 'A', word, y: word.y, confidence: 50 });
  }
  const slotted = fitLabelSlots(anchors, pool, words, h, w);
  if (slotted) return slotted;
  const all = [...anchors, ...pool];
  for (const count of [5, 4]) {
    if (all.length < count || anchors.some(a => LETTER_ORDER.indexOf(a.letter) >= count)) continue;
    // Extra candidates are dropped from the top (question numbers, instructions) first.
    const kept = [...anchors, ...pool.sort((a, b) => b.y - a.y).slice(0, count - anchors.length)];
    if (kept.length !== count) continue;
    const rowMajor = rowsOf(kept).flatMap(row => row.sort((a, b) => a.word.x - b.word.x));
    const columns: DetectedOptionMarker[][] = [];
    for (const item of [...kept].sort((a, b) => a.word.x - b.word.x)) {
      const column = columns.find(group => Math.abs(group[0].word.x - item.word.x) < w * 1.5);
      if (column) column.push(item); else columns.push([item]);
    }
    const columnMajor = columns.flatMap(column => column.sort((a, b) => a.y - b.y));
    for (const order of [rowMajor, columnMajor]) {
      if (!anchors.every(a => order.indexOf(a) === LETTER_ORDER.indexOf(a.letter))) continue;
      return new Map(order.map((item, index) => [LETTER_ORDER[index], { ...item, letter: LETTER_ORDER[index] }]));
    }
  }
  return selected;
}

/**
 * Labels sit on a regular lattice: one row (A B C D E), one column, or the
 * A B / C D / E grid. Two read labels fix the lattice; each slot takes a real
 * label-sized token, or - when OCR merged the label into its text - a label
 * box is placed only if option text really exists right of that slot.
 */
function fitLabelSlots(anchors: DetectedOptionMarker[], pool: DetectedOptionMarker[], words: OCRWord[], h: number, w: number) {
  if (anchors.length < 2) return null;
  const idx = (m: DetectedOptionMarker) => LETTER_ORDER.indexOf(m.letter);
  const sorted = [...anchors].sort((a, b) => idx(a) - idx(b));
  const first = sorted[0], last = sorted[sorted.length - 1];
  const cy = (m: DetectedOptionMarker | OCRWord) => 'word' in m ? m.word.y + m.word.height / 2 : m.y + m.height / 2;
  const layouts: Array<(k: number) => { x?: number; y: number } | null> = [];
  const span = idx(last) - idx(first);
  if (span > 0 && anchors.every(a => Math.abs(cy(a) - cy(first)) < h * .6)) {
    const d = (last.word.x - first.word.x) / span;
    if (d > w * 1.5) layouts.push(k => ({ x: first.word.x + (k - idx(first)) * d, y: cy(first) }));
  }
  if (span > 0 && anchors.every(a => Math.abs(a.word.x - first.word.x) < w * .9)) {
    const d = (cy(last) - cy(first)) / span;
    if (d > h * 1.2) layouts.push(k => ({ x: first.word.x, y: cy(first) + (k - idx(first)) * d }));
  }
  // A B / C D / E
  const colOf = (k: number) => k === 4 ? 2 : k % 2, rowOf = (k: number) => Math.floor(k / 2);
  const colX = new Map<number, number>(), rowY = new Map<number, number>();
  for (const a of anchors) { if (colOf(idx(a)) < 2) colX.set(colOf(idx(a)), a.word.x); rowY.set(rowOf(idx(a)), cy(a)); }
  for (const c of pool) for (const r of [0, 1]) {
    // A pool label in a known row but unknown column fixes that column.
    if (rowY.has(r) && Math.abs(cy(c) - rowY.get(r)!) < h * .6) {
      const known = colX.get(0) ?? colX.get(1);
      if (known !== undefined && Math.abs(c.word.x - known) > w * 3) colX.set(colX.has(0) ? 1 : 0, c.word.x);
    }
  }
  if (rowY.has(0) && rowY.has(1)) rowY.set(2, rowY.get(1)! * 2 - rowY.get(0)!);
  else if (rowY.has(1) && rowY.has(2)) rowY.set(0, rowY.get(1)! * 2 - rowY.get(2)!);
  const gridOk = anchors.every(a => colOf(idx(a)) === 2 || !colX.has(1 - colOf(idx(a))) || Math.abs(colX.get(1 - colOf(idx(a)))! - a.word.x) > w * 3);
  if (gridOk && rowY.has(0) && rowY.has(1) && (colX.has(0) || colX.has(1)) && Math.abs(rowY.get(0)! - rowY.get(1)!) > h * 1.2)
    layouts.push(k => { const y = rowY.get(rowOf(k)); const x = colOf(k) < 2 ? colX.get(colOf(k)) : undefined;
      return y === undefined || (colOf(k) < 2 && x === undefined) ? null : { x, y }; });

  const gridLeft = Math.min(...anchors.map(a => a.word.x)) - w * 2, gridRight = Math.max(...anchors.map(a => a.word.x)) + w * 4;
  let best: Map<OptionLetter, DetectedOptionMarker> | null = null, bestReal = 0;
  for (const slotAt of layouts) {
    const result = new Map<OptionLetter, DetectedOptionMarker>();
    let real = 0, ok = true;
    const used = new Set<DetectedOptionMarker>();
    LETTER_ORDER.forEach((letter, k) => {
      if (!ok) return;
      const anchor = anchors.find(a => a.letter === letter);
      const slot = slotAt(k);
      if (anchor) {
        if (slot && ((slot.x !== undefined && Math.abs(anchor.word.x - slot.x) > w * 1.2) || Math.abs(cy(anchor) - slot.y) > h * .7)) ok = false;
        else { result.set(letter, anchor); real++; }
        return;
      }
      if (!slot || slot.y > .93) return;
      // E under the A B / C D grid has no column of its own, but it is never outside the grid
      // (a stray token in a passage beside the options is not E).
      const inGrid = (x: number) => x >= gridLeft && x <= gridRight;
      const hit = pool.filter(c => !used.has(c) && Math.abs(cy(c) - slot.y) < h * .7 && (slot.x === undefined ? inGrid(c.word.x) : Math.abs(c.word.x - slot.x) < w * 1.2))
        .sort((a, b) => Math.abs(a.word.x - (slot.x ?? a.word.x)) - Math.abs(b.word.x - (slot.x ?? b.word.x)))[0];
      if (hit) { used.add(hit); result.set(letter, { ...hit, letter }); real++; return; }
      let sx = slot.x;
      if (sx === undefined) {
        // No label read for E: it stands just left of the first option text on its row inside the grid.
        const row = words.filter(word => word.height > h * .5 && Math.abs(cy(word) - slot.y) < h * .7 && inGrid(word.x))
          .sort((p, q) => p.x - q.x);
        if (!row.length) return;
        const first = row[0], short = first.text.replace(/[\u200E\u200F]/g, '').trim().length <= 3 && row.length > 1;
        const label: OCRWord = short ? { ...first, text: `${letter})` }
          : { text: `${letter})`, confidence: 40, x: Math.max(0, first.x - w * 1.3), y: slot.y - h / 2, width: w, height: h, pixelX: 0, pixelY: 0, pixelWidth: 0, pixelHeight: 0 };
        result.set(letter, { letter, word: label, y: label.y, confidence: 40 });
        return;
      }
      const text = words.some(word => word.y < .94 && word.height > h * .5 && Math.abs(cy(word) - slot.y) < h
        && word.x + word.width > sx + w && word.x < sx + w * 4);
      if (!text) return;
      const label: OCRWord = { text: `${letter})`, confidence: 40, x: sx, y: slot.y - h / 2, width: w, height: h,
        pixelX: 0, pixelY: 0, pixelWidth: 0, pixelHeight: 0 };
      result.set(letter, { letter, word: label, y: label.y, confidence: 40 });
    });
    // Options are contiguous from A; a trailing missing E is a four-option (LGS) question.
    const count = result.size;
    if (!ok || count < 4 || !LETTER_ORDER.slice(0, count).every(l => result.has(l))) continue;
    if (real > bestReal || (real === bestReal && best && count > best.size)) { best = result; bestReal = real; }
  }
  return best && best.size > anchors.length ? best : null;
}

/** Tall Arabic harakat can push neighbouring boxes into each other; split the shared gap. */
function separateOptionBoxes(regions: AnnotationRegion[]) {
  const options = regions.filter(r => /^option-[a-e]$/.test(r.id));
  const markerY = new Map(options.map(r => [r.id, r.markerAnchor ? r.y + r.markerAnchor.y * r.height : undefined]));
  const markerX = new Map(options.map(r => [r.id, r.markerAnchor ? r.x + r.markerAnchor.x * r.width : undefined]));
  const gap = .004;
  for (const a of options) for (const b of options) {
    if (a === b) continue;
    const xOverlap = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
    const yOverlap = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
    if (xOverlap <= 0 || yOverlap <= -gap) continue;
    if (b.y > a.y && yOverlap < Math.min(a.height, b.height) * .9) {
      const split = (Math.max(a.y + a.height - yOverlap, b.y) + Math.min(a.y + a.height, b.y + b.height)) / 2;
      const bottom = b.y + b.height;
      a.height = Math.max(.01, split - gap / 2 - a.y);
      b.y = split + gap / 2; b.height = Math.max(.01, bottom - b.y);
    } else if (b.x > a.x && Math.abs(a.y - b.y) < Math.max(a.height, b.height) * .5) {
      const split = (a.x + a.width + b.x) / 2;
      const right = b.x + b.width;
      a.width = Math.max(.01, split - gap / 2 - a.x);
      b.x = split + gap / 2; b.width = Math.max(.01, right - b.x);
    }
  }
  for (const r of options) {
    const y = markerY.get(r.id), x = markerX.get(r.id);
    if (y !== undefined && x !== undefined)
      r.markerAnchor = { x: Math.max(0, Math.min(1, (x - r.x) / r.width)), y: Math.max(0, Math.min(1, (y - r.y) / r.height)) };
  }
}

/**
 * Options stacked in one column end at about the same right edge. A box that reaches far past
 * most others took in text from beside the column: a reading passage printed next to the options,
 * which also runs on above them or beside the other options (a long option's own text does
 * neither). The words right of the column are left out and the box is fitted to the rest.
 */
function trimToOptionColumn(regions: AnnotationRegion[], words: OCRWord[]) {
  const options = regions.filter(r => r.type.startsWith('option-'));
  if (options.length < 3) return;
  // Only for one column: in a grid ("A) …  B) …") the right-hand options reach past the median edge by design.
  const labels = options.map(r => r.x + (r.markerAnchor?.x ?? 0) * r.width);
  if (Math.max(...labels) - Math.min(...labels) > .05) return;
  const right = (r: AnnotationRegion) => r.x + r.width;
  const edges = options.map(right).sort((a, b) => a - b);
  const column = edges[Math.floor((edges.length - 1) / 2)];
  const top = Math.min(...options.map(r => r.y));
  // A passage runs on for several lines above the options; a question stem is one or two.
  const above = words.filter(w => w.x > column + .01 && w.y + w.height < top && w.y > top - .25);
  const aboveRows = new Set(above.map(w => Math.round((w.y + w.height / 2) / .02)));
  // A passage set beside the options can start level with the question stem, so only a line or two
  // of it is above them; then it shows beside the options that stayed in the column.
  const beside = options.filter(o => right(o) <= column + .02 && words.some(w => w.x > column + .03
    && w.y + w.height / 2 > o.y && w.y + w.height / 2 < o.y + o.height));
  if (aboveRows.size < 3 && beside.length < 2) return;
  for (const option of options) {
    if (right(option) <= column + .08) continue;
    const kept = words.filter(w => w.x >= option.x && w.x + w.width <= column + .02
      && w.y >= option.y && w.y + w.height <= option.y + option.height);
    if (!kept.length) continue;
    const anchorX = option.x + (option.markerAnchor?.x ?? 0) * option.width;
    const anchorY = option.y + (option.markerAnchor?.y ?? 0) * option.height;
    const newRight = Math.min(1, Math.max(...kept.map(w => w.x + w.width)) + .007);
    option.width = Math.max(.01, newRight - option.x);
    // The passage's lines below the option's own text are not the option's either.
    const bottom = Math.min(option.y + option.height, Math.max(...kept.map(w => w.y + w.height)) + .006);
    option.height = Math.max(.01, bottom - option.y);
    if (option.markerAnchor) option.markerAnchor = { x: (anchorX - option.x) / option.width, y: Math.min(1, (anchorY - option.y) / option.height) };
    option.content = kept.sort((a, b) => a.y - b.y || a.x - b.x).map(w => w.text).join(' ');
  }
}

/**
 * A numeral opening a numbered statement ("I.", "II)", "IV."), also as OCR misreads it ("l.", "Il", "|", "1.",
 * and with the Arabic reader "٠.", "١." or "ا." — only before a Turkish word, see `opens`).
 */
const PREMISE_LABEL = /^(?:IV|V|[Il|1\u0660\u0661\u0627]{1,3})\s*[.)]$|^(?:IV|II|III)$/;
/** The numeral was lost and only its dot (or bracket) was read. */
const BARE_MARK = /^[.)]$/;
const ROMAN = ['I', 'II', 'III', 'IV', 'V'];
const ARABIC = /[\u0600-\u06FF]/;

/**
 * Numbered statements (I, II, III…) above the options. Each starts on a line opened by its numeral
 * (or the numeral's lone dot when the numeral itself was not read), all numerals in one column; it
 * runs until the next one. The last one ends at a wider gap or where a line starts left of the
 * numerals (the question sentence: "Yukarıdaki ifadelerden hangileri…").
 */
function detectPremises(words: OCRWord[], cutoffY: number): AnnotationRegion[] {
  const center = (w: OCRWord) => w.y + w.height / 2;
  const lines: OCRWord[][] = [];
  for (const word of words.filter(w => center(w) < cutoffY - 0.006 && w.y > 0.035).sort((a, b) => center(a) - center(b))) {
    const line = lines.find(l => Math.abs(center(l[0]) - center(word)) < Math.max(l[0].height, word.height) * .6);
    if (line) line.push(word); else lines.push([word]);
  }
  for (const line of lines) line.sort((a, b) => a.x - b.x);
  const opens = (line: OCRWord[]) => {
    const [first, next] = line;
    if (!next) return false;
    const text = first.text.trim();
    // A label stands apart from its statement: it ends before the statement's first word.
    if (first.x + first.width > next.x + .002 || next.x - first.x - first.width > .05) return false;
    // A lone dot at the left of an Arabic line is that line's full stop, not a lost numeral.
    // A numeral read as an Arabic letter or digit counts only before a Turkish word.
    const arabicNext = /[\u0600-\u06FF]/.test(next.text);
    if (PREMISE_LABEL.test(text)) return !arabicNext || !/[\u0600-\u06FF]/.test(text);
    return BARE_MARK.test(text) && first.width < .01 && !arabicNext;
  };
  const starts = lines.map((line, i) => (opens(line) ? i : -1)).filter(i => i >= 0);
  if (starts.length < 2) return [];
  const xs = starts.map(i => lines[i][0].x).sort((a, b) => a - b);
  const column = xs[Math.floor(xs.length / 2)];
  const found = starts.filter(i => Math.abs(lines[i][0].x - column) < .02);
  if (found.length < 2) return [];
  const heights = lines.map(l => Math.max(...l.map(w => w.height))).sort((a, b) => a - b);
  const lineHeight = heights[Math.floor(heights.length / 2)];
  const top = (line: OCRWord[]) => Math.min(...line.map(w => w.y));
  const bottom = (line: OCRWord[]) => Math.max(...line.map(w => w.y + w.height));
  // The first numeral can be lost with its dot: lines right above the first found statement, in the
  // statements' text column (where the intro above them does not start), are statement I, so the
  // numbers spoken in the solution still land on the right boxes.
  const textColumn = found.map(i => lines[i][1].x).sort((a, b) => a - b)[Math.floor(found.length / 2)];
  let first = found[0];
  while (first > 0 && Math.abs(lines[first - 1][0].x - textColumn) < .006 && top(lines[first]) - bottom(lines[first - 1]) < lineHeight * 1.1) first--;
  const items = (first < found[0] ? [first, ...found] : found).slice(0, ROMAN.length);
  return items.map((startLine, k) => {
    const block = [lines[startLine]];
    const stop = items[k + 1] ?? lines.length;
    for (let i = startLine + 1; i < stop; i++) {
      // The last statement keeps only lines that follow on closely, inside its column.
      if (items[k + 1] === undefined && (top(lines[i]) - bottom(block[block.length - 1]) > lineHeight * 1.1 || lines[i][0].x < column - .005)) break;
      block.push(lines[i]);
    }
    const all = block.flat();
    const label = lines[startLine][0];
    const labelled = found.includes(startLine);
    // A lost numeral sits just left of its dot (or of its text, when the dot was lost too).
    const x = Math.max(0, Math.min(...all.map(w => w.x)) - (!labelled ? textColumn - column + .02 : BARE_MARK.test(label.text.trim()) ? .02 : .007));
    const y = Math.max(0, Math.min(...all.map(w => w.y)) - .006);
    const right = Math.min(1, Math.max(...all.map(w => w.x + w.width)) + .007);
    const low = Math.min(1, Math.max(...all.map(w => w.y + w.height)) + .006);
    return { id: `premise-${k + 1}`, label: `${ROMAN[k]}. madde`, type: 'premise' as const, x, y, width: right - x, height: low - y,
      content: all.filter(w => !labelled || w !== label).map(w => w.text).join(' ') };
  });
}

export function detectYdtQuestionRegions(ocr: OCRResult): {
  regions: AnnotationRegion[];
  detectedOptions: string[];
  questionPromptRegion?: AnnotationRegion;
} {
  const regions: AnnotationRegion[] = [];
  const words = ocr.words || [];
  if (!words.length) return { regions, detectedOptions: [] };
  const markers = [...inferMarkersFromLayout(chooseMarkers(collectMarkerCandidates(ocr)),
    [...(ocr.optionMarkers || []), ...words]).values()];
  const rows: DetectedOptionMarker[][] = [];
  for (const marker of markers.sort((a, b) => a.y - b.y)) {
    const row = rows.find((group) => Math.abs(
      group[0].word.y + group[0].word.height / 2 - marker.word.y - marker.word.height / 2
    ) < Math.max(group[0].word.height, marker.word.height) * 0.85);
    if (row) row.push(marker); else rows.push([marker]);
  }
  const cutoffY = rows[0]?.[0].y ?? 0.48;
  // Arabic stem only: decorative slide headers and page numbers are not targets.
  const promptWords = words.filter((word) => word.y + word.height / 2 < cutoffY - 0.006 &&
    word.y > 0.035 && /[\u0621-\u064A]|[-ـ]{2,}/.test(word.text));
  // Arabic misread as Latin ("يقرأ" → "JA") stays part of the stem when it touches a stem line.
  for (let grew = true; grew;) {
    grew = false;
    for (const word of words) {
      if (promptWords.includes(word) || word.y + word.height / 2 >= cutoffY - 0.006 || word.y <= 0.035 || /^[\d.)(]+$/.test(word.text.trim())) continue;
      if (promptWords.some(p => Math.abs(p.y + p.height / 2 - word.y - word.height / 2) < Math.max(p.height, word.height) * .6
        && Math.max(p.x - word.x - word.width, word.x - p.x - p.width) < .03)) { promptWords.push(word); grew = true; }
    }
  }
  const bounds = (items: OCRWord[], padX = 0.007, padY = 0.006) => {
    const x = Math.max(0, Math.min(...items.map((word) => word.x)) - padX);
    const y = Math.max(0, Math.min(...items.map((word) => word.y)) - padY);
    const right = Math.min(1, Math.max(...items.map((word) => word.x + word.width)) + padX);
    const bottom = Math.min(1, Math.max(...items.map((word) => word.y + word.height)) + padY);
    return { x, y, width: right - x, height: bottom - y };
  };
  if (promptWords.length >= 1) {
    regions.push({ id: 'question-root', label: 'Soru Kökü / Metin', type: 'paragraph',
      ...bounds(promptWords), content: promptWords.map((word) => word.text).join(' ') });
  }
  const heights = words.map(w => w.height).sort((p, q) => p - q);
  const textLine = heights[Math.floor(heights.length / 2)] ?? 0;
  // Options stacked one per row, labels in one column (not a grid with a label missed).
  const labelXs = rows.flat().map(m => m.word.x);
  const oneColumn = rows.length >= 3 && rows.every(r => r.length === 1) && Math.max(...labelXs) - Math.min(...labelXs) < .05;
  for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
    const row = rows[rowIndex].sort((a, b) => a.word.x - b.word.x);
    const top = Math.min(...row.map((marker) => marker.y));
    const rowHeight = Math.max(...row.map((marker) => marker.word.height));
    // The last option may wrap onto three lines (measured in text lines: a label like "E" can be read short).
    const nextTop = rows[rowIndex + 1]?.[0].y ?? Math.min(1, top + Math.max(rowHeight, textLine) * 4.6);
    // Partition by label columns, not by full-width stripes. The next marker is
    // the hard right edge of a cell, so a neighbouring choice can never enter it.
    for (let column = 0; column < row.length; column++) {
      const marker = row[column];
      const left = column === 0 ? Math.max(0, marker.word.x - 0.035) : marker.word.x - 0.015;
      const right = row[column + 1] ? row[column + 1].word.x - 0.02 : 1;
      const candidates = words.filter((word) => {
        const cy = word.y + word.height / 2;
        const cx = word.x + word.width / 2;
        return cy >= top - rowHeight * 0.35 && cy < nextTop - rowHeight * 0.15 &&
          cx >= left && cx < right && word.x + word.width <= right + .005 && word.height >= rowHeight * 0.25;
      });
      // Stop at a whitespace gutter even if the neighbouring label was missed.
      // Keep successive lines only while their baselines remain contiguous.
      const optionWords: OCRWord[] = [];
      // The page reading has its own copy of the label ("\u200eA)\u200f") beside the marker: not the option's text.
      const label = (w: OCRWord) => w === marker.word || (!ARABIC.test(w.text)
        && Math.min(w.x + w.width, marker.word.x + marker.word.width) - Math.max(w.x, marker.word.x) > Math.min(w.width, marker.word.width) / 2);
      const lineGroups: OCRWord[][] = [];
      for (const word of candidates.sort((a, b) => a.y - b.y)) {
        const group = lineGroups.find(g => Math.abs(g[0].y + g[0].height / 2 - word.y - word.height / 2) < Math.max(g[0].height, word.height) * .8);
        if (group) group.push(word); else lineGroups.push([word]);
      }
      let lastBottom = marker.y + marker.word.height;
      for (const group of lineGroups) {
        if (Math.min(...group.map(w => w.y)) > lastBottom + rowHeight * .9) break;
        const sorted = group.sort((a,b) => a.x - b.x);
        let edge = marker.word.x + marker.word.width;
        // The option's text so far: a later line inside it belongs to the option even when it is
        // short and right-aligned (Arabic), far from the label.
        const text = optionWords.filter(w => !label(w));
        const span = text.length ? { from: Math.min(...text.map(w => w.x)) - .01, to: Math.max(...text.map(w => w.x + w.width)) + .01 } : null;
        // A page footer under an Arabic option ("2021 – YDT / ARAPÇA") is a line of Latin words with no
        // Arabic; a lone Latin word is the reader's misreading of the option's own next line.
        const footer = text.filter(w => ARABIC.test(w.text)).length * 2 > text.length
          && !sorted.some(w => ARABIC.test(w.text)) && sorted.length >= 2;
        const gutter = Math.max(.08, rowHeight * ocr.imageHeight / ocr.imageWidth * 2.4);
        const line = sorted.filter(w => !label(w) && w.x >= edge - .005);
        for (const word of sorted) {
          if (word.x + word.width < left) continue;
          if (span) {
            // A wrapped line never reaches past the lines above it: text beside it (a page footer,
            // a passage) is not the option's.
            // (it starts within them; a short option's last word may reach a little past its first line).
            if (word.x >= span.from && word.x < span.to && word.x + word.width / 2 <= span.to + .01 && !footer) {
              optionWords.push(word);
              lastBottom = Math.max(lastBottom, word.y + word.height);
            }
            continue;
          }
          const gap = word.x - edge;
          if (gap > gutter) break;
          optionWords.push(word);
          edge = Math.max(edge, word.x + word.width);
          lastBottom = Math.max(lastBottom, word.y + word.height);
        }
        if (!span && oneColumn && optionWords.every(label) && line.length
          && line.filter(w => ARABIC.test(w.text)).length * 2 > line.length) {
          // Arabic runs right to left: a short option is set to the right, far from its label. Its words
          // are the first run after the label without a wide gap; a passage printed beside the options
          // starts after such a gap.
          let to = 0;
          while (to < line.length - 1 && line[to + 1].x - (line[to].x + line[to].width) <= .045) to++;
          for (const word of line.slice(0, to + 1)) {
            optionWords.push(word);
            lastBottom = Math.max(lastBottom, word.y + word.height);
          }
        }
      }
      // The detected label itself is always real OCR evidence, never a guessed box.
      if (!optionWords.includes(marker.word)) optionWords.push(marker.word);
      const box = bounds(optionWords);
      regions.push({ id: `option-${marker.letter.toLowerCase()}`, label: `${marker.letter} Seçeneği`,
        type: ('option-' + marker.letter.toLowerCase()) as AnnotationRegion['type'], ...box,
        markerAnchor: { x: (marker.word.x - box.x) / box.width,
          y: (marker.word.y + marker.word.height / 2 - box.y) / box.height },
        content: optionWords.map((word) => word.text).join(' ') });
    }
  }
  trimToOptionColumn(regions, words);
  separateOptionBoxes(regions);
  if (rows.length) regions.push(...detectPremises(words, cutoffY));
  const detectedOptions = ['A', 'B', 'C', 'D', 'E'].filter((letter) =>
    regions.some((region) => region.id === `option-${letter.toLowerCase()}`));
  return { regions, detectedOptions, questionPromptRegion: regions.find((region) => region.id === 'question-root') };
}

