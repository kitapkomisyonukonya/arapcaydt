import type { AnnotationRegion } from '../../types';
import type { OCRWord } from '../ocr/ocrTypes';
import { extractArabicPhrases, findBestArabicMatches, groupOcrWordsIntoLines, normalizeArabic, type ArabicMatchResult } from '../ocr/arabicMatcher';
import { findPassageMatches, findTolerantly, withPassageReferences, withTolerantPhrases, type PassageMatch } from '../ocr/passageMatcher';

/** The words whose middle is outside every given box (the question text without its options). */
export function wordsOutside(words: OCRWord[], boxes: Pick<AnnotationRegion, 'x' | 'y' | 'width' | 'height'>[]): OCRWord[] {
  return words.filter(w => !boxes.some(r => w.x + w.width / 2 >= r.x && w.x + w.width / 2 <= r.x + r.width
    && w.y + w.height / 2 >= r.y && w.y + w.height / 2 <= r.y + r.height));
}

/** Where `phrase` is read in the solution, each time. */
const occurrences = (text: string, phrase: string) => {
  const at: number[] = [];
  for (let i = text.indexOf(phrase); i >= 0; i = text.indexOf(phrase, i + 1)) at.push(i);
  return at;
};
/**
 * The option being read at `at`: named just before it on the same line or the line above ("A) …",
 * "A şıkkı: …", "C seçeneğinde şöyle deniyor:" then the sentence). Null when it is not an option's.
 */
export function optionReadAt(text: string, at: number): string | null {
  const before = text.slice(Math.max(0, at - 160), at).split('\n').slice(-2).join('\n');
  const named = [...before.matchAll(/(?:^|[\s(“"])([A-E])\s*(?:[).:-]|[Şş]ıkk|[Ss]eçene)/g)].pop();
  return named ? named[1] : null;
}
const readAsOption = (text: string, at: number) => !!optionReadAt(text, at);
/** Pointed at the passage ("parçada …", "metinde …") just before it. */
const pointsAtPassage = (text: string, at: number) => /(?:parça|metin|paragraf)[^\n]{0,60}$/i.test(text.slice(Math.max(0, at - 80), at));

/**
 * An option's own sentence read aloud is shown by the option's frame, not underlined where the same
 * words happen to stand in the passage: a phrase is left out when every time it is read it is read
 * as an option, or when it mostly is an option's text and the solution never points at the passage for it.
 */
export function isOptionQuote(text: string, phrase: string, options: Pick<AnnotationRegion, 'content'>[]): boolean {
  const at = occurrences(text, phrase);
  if (!at.length) return false;
  if (at.every(i => readAsOption(text, i))) return true;
  const words = normalizeArabic(phrase).split(' ').filter(Boolean);
  if (words.length < 3 || at.some(i => pointsAtPassage(text, i))) return false;
  return options.some(option => {
    const own = new Set(normalizeArabic(option.content || '').split(' '));
    return words.filter(w => own.has(w)).length >= words.length * .7;
  });
}

/** Arabic words in a text (normalized), for comparing a read sentence with an option's text. */
const arabicWords = (text: string) => normalizeArabic(text).split(' ').filter(w => /[\u0621-\u064A]/.test(w));
/** Options with this many Arabic words or more are underlined while they are read; shorter ones are framed only. */
export const LONG_OPTION_WORDS = 5;

/**
 * The printed lines of an option (its words grouped into rows, top to bottom), each with the share
 * of `phrase` that falls on it by its width: the sentence read as it runs across the lines.
 */
function optionRows(phrase: string, own: OCRWord[], id: string): ArabicMatchResult[] {
  const said = phrase.split(/\s+/).filter(Boolean);
  const heard = new Set(arabicWords(phrase).filter(w => w.length > 2));
  const box = (row: OCRWord[]) => {
    const x = Math.max(0, Math.min(...row.map(w => w.x)) - .005), y = Math.max(0, Math.min(...row.map(w => w.y)) - .004);
    const right = Math.min(1, Math.max(...row.map(w => w.x + w.width)) + .005), bottom = Math.min(1, Math.max(...row.map(w => w.y + w.height)) + .004);
    return { row, x, y, width: right - x, height: bottom - y };
  };
  // A broken-up word (its dots read apart) can start a row of its own: inside another row it is that row.
  const boxes = groupOcrWordsIntoLines(own).map(box).sort((a, b) => a.y - b.y).reduce<ReturnType<typeof box>[]>((all, b) => {
    const last = all[all.length - 1];
    if (last && Math.abs(b.y + b.height / 2 - last.y - last.height / 2) < last.height * .4) all[all.length - 1] = box([...last.row, ...b.row]); else all.push(b);
    return all;
  }, []).filter(b => b.row.some(w => arabicWords(w.text).some(t => heard.has(t)))); // only lines with words of the sentence
  if (!boxes.length || boxes.length > said.length) return [];
  const total = boxes.reduce((n, b) => n + b.width, 0);
  let used = 0, start = 0;
  return boxes.map((box, k) => {
    used += box.width;
    const end = k === boxes.length - 1 ? said.length : Math.max(start + 1, Math.min(said.length - (boxes.length - 1 - k), Math.round(said.length * used / total)));
    const text = said.slice(start, end).join(' ');
    start = end;
    return { phrase: text, matchedWords: box.row, region: {
      id: `${id}-line-${k + 1}`, label: `Arapça: "${phrase}"${boxes.length > 1 ? ` (${k + 1})` : ''}`, type: 'phrase',
      x: box.x, y: box.y, width: box.width, height: box.height, content: text,
    } } as ArabicMatchResult;
  });
}

/**
 * A long Arabic option read aloud is underlined in the option itself, line by line as it is read:
 * the option named just before the sentence (or, failing that, the one option whose text it mostly
 * is) and only its own words, never the passage or another option.
 */
export function optionLineMarks(text: string, words: OCRWord[], options: AnnotationRegion[]): ArabicMatchResult[] {
  const marks: ArabicMatchResult[] = [];
  extractArabicPhrases(text).forEach((phrase, index) => {
    const said = arabicWords(phrase);
    if (said.length < LONG_OPTION_WORDS) return;
    const named = [...new Set(occurrences(text, phrase).map(at => optionReadAt(text, at)))];
    const share = (o: AnnotationRegion) => { const own = new Set(arabicWords(o.content || '')); return said.filter(w => own.has(w)).length / said.length; };
    const likely = options.filter(o => share(o) >= .7);
    const option = named.length === 1 && named[0] ? options.find(o => o.id === `option-${named[0]!.toLowerCase()}`)
      : likely.length === 1 ? likely[0] : undefined;
    if (!option || arabicWords(option.content || '').length < LONG_OPTION_WORDS) return;
    const own = words.filter(w => !/^[([]?[A-E][)\].:]?$/.test(w.text.replace(/[\u200e\u200f]/g, '').trim())
      && w.x + w.width / 2 >= option.x && w.x + w.width / 2 <= option.x + option.width
      && w.y + w.height / 2 >= option.y && w.y + w.height / 2 <= option.y + option.height);
    // Each line is drawn while its own words are read: its place in the solution, like a passage line.
    const at = occurrences(text, phrase).find(i => optionReadAt(text, i)) ?? occurrences(text, phrase)[0];
    const id = `${option.id}-read-${index + 1}`;
    let found = findTolerantly(phrase, own, id);
    // Read right after its letter ("D) …"), the sentence is the option itself: when the reader garbled
    // too many of its words to find them one by one, each printed line of the option is underlined in turn.
    const whole = /(?:[A-E]\s*[).:-]|[Şş]ıkk\S*|[Ss]eçene\S*)[\s:"“«]*$/.test(text.slice(Math.max(0, at - 24), at));
    if (!found.length && whole && named.length === 1 && named[0] && share(option) >= .5) found = optionRows(phrase, own, id);
    let from = 0;
    for (const line of found) {
      const local = phrase.indexOf(line.phrase, from);
      if (local < 0) { marks.push(line); continue; }
      from = local + line.phrase.length;
      marks.push({ ...line, sourceStart: at + local, sourceEnd: at + local + line.phrase.length });
    }
  });
  return marks;
}

/**
 * Where the solution's Arabic is underlined on the question. A passage read in full is found as a
 * whole (one underline per printed line); the shorter phrases are looked for without it, and a
 * later mention of its words points into it. A long option read aloud is underlined in the option.
 * Removed marks stay removed, except passage lines.
 */
export function planArabicMarks(solutionText: string, stemWords: OCRWord[], arabicStemWords?: OCRWord[], suppressed: ReadonlySet<string> = new Set(),
  options: AnnotationRegion[] = [], words: OCRWord[] = []) {
  // An option's own sentence read under its letter ("A) لَمْ يَتَّفِقِ …") that shares most of its words
  // with the question's passage is found again on the passage's lines; it is the option's, not a second
  // reading of the passage (optionLineMarks underlines it in the option), and its words are not looked
  // for on the question either. Found anywhere else (an option box the reader missed) it stays.
  const found = findPassageMatches(solutionText, stemWords, arabicStemWords);
  const startOf = (end: number) => Math.min(...found.filter(o => o.passageEnd === end).map(o => o.sourceStart));
  const optionsOwn = (m: PassageMatch) => !!optionReadAt(solutionText, startOf(m.passageEnd));
  const passageWords = new Set(found.filter(m => !optionsOwn(m)).flatMap(m => m.matchedWords));
  const onPassage = new Set(found.filter(m => optionsOwn(m) && m.matchedWords.some(w => passageWords.has(w))).map(m => m.passageEnd));
  const passageMatches = found.filter(m => !onPassage.has(m.passageEnd));
  const passageRanges = [...new Set(found.map(m => m.passageEnd))].map(end => [startOf(end), end] as const);
  const withoutPassages = passageRanges.reduce((text, [from, to]) => text.slice(0, from) + ' '.repeat(to - from) + text.slice(to), solutionText);
  const lines = new Set<object>(passageMatches);
  const arabicMatches = [
    ...passageMatches,
    ...withTolerantPhrases(withoutPassages, withPassageReferences(withoutPassages,
      findBestArabicMatches(withoutPassages, stemWords, arabicStemWords, passageMatches.flatMap(m => m.matchedWords)), passageMatches), stemWords),
  ].filter(m => !suppressed.has(m.region.id) || m.region.id.startsWith('arabic-passage-'))
    // Passage lines (the passage read in full) stay; other marks never stand for an option's own text.
    .filter(m => lines.has(m) || !isOptionQuote(solutionText, m.phrase, options));
  arabicMatches.push(...optionLineMarks(solutionText, words, options).filter(m => !suppressed.has(m.region.id)));
  return { passageMatches, arabicMatches };
}
