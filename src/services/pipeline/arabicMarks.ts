import type { AnnotationRegion } from '../../types';
import type { OCRWord } from '../ocr/ocrTypes';
import { extractArabicPhrases, findBestArabicMatches, normalizeArabic, type ArabicMatchResult } from '../ocr/arabicMatcher';
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
    const own = words.filter(w => !/^[([]?[A-E][)\].:]?$/.test(w.text.trim())
      && w.x + w.width / 2 >= option.x && w.x + w.width / 2 <= option.x + option.width
      && w.y + w.height / 2 >= option.y && w.y + w.height / 2 <= option.y + option.height);
    // Each line is drawn while its own words are read: its place in the solution, like a passage line.
    const at = occurrences(text, phrase).find(i => optionReadAt(text, i)) ?? occurrences(text, phrase)[0];
    let from = 0;
    for (const line of findTolerantly(phrase, own, `${option.id}-read-${index + 1}`)) {
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
