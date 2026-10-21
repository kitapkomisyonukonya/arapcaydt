/**
 * "Telaffuz sözlüğü": before a text goes to the voice, every word the shared list names is
 * swapped for how it should be read. Only the spoken copy changes; the solution text the
 * teacher wrote (screen, captions, video) is never touched.
 */
export interface Pronunciation { written: string; spoken: string }

const HARAKAT = '[\\u064B-\\u065F\\u0670\\u0640]*';
const ARABIC_LETTER = /[ء-يٱ-ۓ]/;
const MARK = /[ً-ٰٟـ]/;
const escape = (c: string) => c.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');

/**
 * One spelling for the same marks: composed form, shadda and vowel in one order, and a mark
 * typed twice (شِِِمَالَ) counted once. Only the spoken copy is tidied this way.
 */
export function tidyMarks(text: string): string {
  return text.normalize('NFC').replace(/([\u064B-\u0652])\1+/g, '$1');
}

/**
 * An Arabic entry written without vowel marks also matches the word with its marks; `loose`
 * matches the letters whatever the marks are.
 */
function pattern(written: string, loose = false): string {
  const plainArabic = ARABIC_LETTER.test(written) && (loose || !MARK.test(written));
  return [...(loose ? written.replace(new RegExp(MARK.source, 'g'), '') : written)]
    .map(c => /\s/.test(c) ? '\\s+' : escape(c) + (plainArabic && ARABIC_LETTER.test(c) ? HARAKAT : '')).join('');
}

/**
 * Whole words only, case-insensitive, longest entry first, one pass (a replacement is not replaced again).
 * An Arabic entry written with its marks is used for the word with exactly those marks first and
 * otherwise for the same word marked differently (another last vowel, a mark missing or doubled).
 */
export function applyPronunciations(text: string, entries: Pronunciation[]): string {
  const clean = entries
    .map(e => ({ written: tidyMarks(e.written.trim()), spoken: e.spoken.trim() }))
    .filter(e => e.written && e.spoken);
  const spoken = tidyMarks(text);
  if (!clean.length) return spoken;
  const letters = (s: string) => s.replace(new RegExp(MARK.source, 'g'), '').length;
  const forms = clean.flatMap(e => [{ ...e, source: pattern(e.written), exact: true },
    ...(ARABIC_LETTER.test(e.written) && MARK.test(e.written) ? [{ ...e, source: pattern(e.written, true), exact: false }] : [])])
    .sort((a, b) => letters(b.written) - letters(a.written) || Number(b.exact) - Number(a.exact) || b.written.length - a.written.length);
  const regex = new RegExp(`(?<![\\p{L}\\p{N}\\p{M}])(?:${forms.map(f => `(${f.source})`).join('|')})(?![\\p{L}\\p{N}\\p{M}])`, 'giu');
  return spoken.replace(regex, (...match) => {
    const index = match.slice(1, forms.length + 1).findIndex(group => group !== undefined);
    return index >= 0 ? forms[index].spoken : match[0];
  });
}

/** Option letters by their Turkish names. */
const LETTER_NAMES: Record<string, string> = { A: 'A', B: 'Be', C: 'Ce', D: 'De', E: 'E' };

/**
 * An option's label right before Arabic text ("D) يَا وَالِدَتِي") is read as an Arabic letter
 * (D as "dal", E as "he"). The spoken copy spells it the Turkish way and closes it with a comma.
 */
export function spokenOptionLetters(text: string): string {
  return text.replace(/(^|\n)([ \t]*)([A-E])\)(?=[ \t]*[\u0600-\u06FF])/g, (_, start, space, letter) => `${start}${space}${LETTER_NAMES[letter]},`);
}

/** The shared list; empty (never an error) before the migration is run or when it cannot be read. */
export async function loadPronunciations(db: any): Promise<Pronunciation[]> {
  try {
    const { data, error } = await db.from('pronunciations').select('written, spoken').limit(1000);
    return error || !Array.isArray(data) ? [] : data;
  } catch {
    return [];
  }
}
