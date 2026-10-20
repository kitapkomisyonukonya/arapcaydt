import { findPassages } from '../ocr/passageMatcher';
import { VideoAction, NarrationWord } from '../../types';
import { SemanticParsedEvent } from './solutionParser';
import { underlineSpanFor } from '../../features/video/engine/timeline';

export interface SourceNarrationWord extends NarrationWord {
  sourceStart: number;
  sourceEnd: number;
  matched: boolean;
}
export interface AlignedCaption { text: string; start: number; end: number; words?: Array<{ from: number; to: number; start: number; end: number }> }
export interface SolutionNarrationAlignment {
  words: SourceNarrationWord[];
  captions: AlignedCaption[];
  quality: 'word-aligned' | 'anchored' | 'approximate';
  matchedRatio: number;
}

function normalize(text: string): string {
  return text.toLocaleLowerCase('tr-TR').normalize('NFD').replace(/\p{M}/gu, '')
    .replace(/ı/g, 'i').replace(/ـ/g, '').replace(/[إأآٱ]/g, 'ا').replace(/ى/g, 'ي');
}

function tokens(text: string) {
  return Array.from(text.matchAll(/[\p{L}\p{N}][\p{L}\p{N}\p{M}'’]*/gu), match => ({
    text: match[0], norm: normalize(match[0]).replace(/['’]/g, ''),
    sourceStart: match.index!, sourceEnd: match.index! + match[0].length,
  }));
}

function matches(a: string, b: string): boolean {
  if (a === b) return true;
  if (['b','c','d'].some(letter => (a === letter && b === letter+'e') || (b === letter && a === letter+'e'))) return true;
  if ((a === '1' && b === 'bir') || (b === '1' && a === 'bir')) return true;
  return Math.min(a.length, b.length) >= 5 && (a.startsWith(b) || b.startsWith(a));
}

/** Tokenize chunk timestamps too. Chunk subdivision remains an estimate. */
/**
 * How long a word can really be said. A transcript that leaves a read Arabic sentence out stretches
 * the word before it over the whole sentence ("okuyalım." 0.9–11.4 s): that word is cut back to
 * its own length, so the left-out sentence is timed in the time it really took.
 */
export function spokenLength(text: string): number {
  return .5 + .14 * normalize(text).replace(/\s/g, '').length;
}

function spokenTokens(words: NarrationWord[], duration: number) {
  return words.filter(w => Number.isFinite(w.start) && Number.isFinite(w.end) && w.end >= w.start && w.start < duration)
    .map(w => w.end - w.start > 2.5 ? { ...w, end: w.start + Math.min(w.end - w.start, spokenLength(w.text)) } : w)
    .flatMap(word => {
      const parts = tokens(word.text);
      const weight = parts.reduce((sum, part) => sum + part.norm.length, 0) || 1;
      let consumed = 0;
      return parts.map(part => {
        const start = Math.max(0, word.start + (word.end - word.start) * consumed / weight);
        consumed += part.norm.length;
        return { ...part, start, end: Math.min(duration, word.start + (word.end - word.start) * consumed / weight), exact: parts.length === 1 };
      });
    }).sort((a, b) => a.start - b.start);
}

/**
 * Monotonic word matches (script index → spoken index). Bound memory for accidentally
 * book-length input: such inputs fall back to approximate timing rather than freezing the browser.
 */
function sequenceAnchors(source: Array<{ norm: string }>, spoken: Array<{ norm: string }>): Map<number, number> {
  const anchors = new Map<number, number>();
  if (!source.length || !spoken.length || source.length * spoken.length > 8_000_000) return anchors;
  const cols = spoken.length + 1;
  const table = new Uint16Array((source.length + 1) * cols);
  for (let i = source.length - 1; i >= 0; i--) {
    for (let j = spoken.length - 1; j >= 0; j--) {
      table[i * cols + j] = matches(source[i].norm, spoken[j].norm)
        ? 1 + table[(i + 1) * cols + j + 1]
        : Math.max(table[(i + 1) * cols + j], table[i * cols + j + 1]);
    }
  }
  let i = 0; let j = 0;
  while (i < source.length && j < spoken.length) {
    if (matches(source[i].norm, spoken[j].norm)) { anchors.set(i++, j++); }
    else if (table[(i + 1) * cols + j] > table[i * cols + j + 1]) i++;
    else j++;
  }
  return anchors;
}

/**
 * About how long a passage takes to say: 0.07 s per letter (Arabic vowel marks and signs do not
 * count). Turkish and Arabic speech run at about 12–16 letters a second.
 */
export function speechSeconds(text: string): number {
  return (text.replace(/[\u064B-\u065F\u0670\u0640]/g, '').match(/[\p{L}\p{N}]/gu)?.length ?? 0) * 0.07;
}
/**
 * A passage the transcript missed was still spoken when the audio between the words around it
 * is long enough to hold it: the transcript often misses or rewrites Arabic (Latin letters,
 * other spellings) that the voice read correctly.
 */
/** Inside a long Arabic passage: the share of its speaking time that must be missing to call it skipped. */
const PASSAGE_HEARD_SHARE = .15;
export const HEARD_SHARE = 0.4;

const ARABIC = /[\u0600-\u06FF]/;
export interface NarrationDrift {
  /** Spoken passages with no counterpart in the script (the voice added words). */
  added: Array<{ text: string; start: number }>;
  /** Script passages the voice skipped. */
  skipped: Array<{ text: string; start: number }>;
}

/**
 * Where a generated voice left the script, read from the word transcript already taken for
 * timing. Only clear gaps count: a word heard differently (Arabic transcribed in Latin letters)
 * is a substitution, not an addition, so a gap is reported only when one side is at least
 * `minWords` longer than the other.
 */
export function narrationDrift(solutionText: string, narration: NarrationWord[] = [], duration = 3600, minWords = 3): NarrationDrift {
  const source = tokens(solutionText);
  const spoken = spokenTokens(narration, duration);
  const drift: NarrationDrift = { added: [], skipped: [] };
  const anchors = sequenceAnchors(source, spoken);
  if (!source.length || !spoken.length || anchors.size / source.length < 0.5) return drift;
  // Inside a long Arabic passage the transcript often writes little of the Arabic, and a stray
  // match can leave a short gap: there only a stretch with almost no room at all is "skipped".
  const passages = findPassages(solutionText).map(p => ({ from: p[0].from, to: p[p.length - 1].to }));
  const inPassage = (from: number, to: number) => passages.some(p => from >= p.from && to <= p.to);
  let si = -1, sj = -1;
  for (const [i, j] of [...anchors, [source.length, spoken.length] as [number, number]]) {
    const heard = spoken.slice(sj + 1, j), written = source.slice(si + 1, i);
    if (heard.length - written.length >= minWords)
      drift.added.push({ text: heard.map(w => w.text).join(' '), start: heard[0].start });
    else if (written.length - heard.length >= minWords + 1) {
      const passage = (from: typeof written) => solutionText.slice(from[0].sourceStart, from[from.length - 1].sourceEnd);
      const room = (spoken[j]?.start ?? duration) - (spoken[sj]?.end ?? 0);
      // Only a gap too short for the passage means the voice left something out.
      if (room < HEARD_SHARE * speechSeconds(passage(written))) {
        // The transcript writes Turkish reliably but often misses Arabic: unheard Turkish is what
        // was skipped; Arabic counts only when there is not even room for the Arabic itself.
        const arabic = written.filter(w => ARABIC.test(w.text));
        const latin = written.filter(w => !ARABIC.test(w.text));
        const share = arabic.length && inPassage(arabic[0].sourceStart, arabic[arabic.length - 1].sourceEnd) ? PASSAGE_HEARD_SHARE : HEARD_SHARE;
        const skippedArabic = arabic.length > 0 && room < share * speechSeconds(passage(arabic));
        // Turkish on both sides of a spoken Arabic line is reported as separate passages.
        const runs: typeof written[] = [];
        if (skippedArabic) runs.push(written);
        else if (latin.length - heard.length >= minWords + 1) for (const w of latin) {
          const last = runs[runs.length - 1];
          if (last && !ARABIC.test(solutionText.slice(last[last.length - 1].sourceEnd, w.sourceStart))) last.push(w);
          else runs.push([w]);
        }
        for (const run of runs) drift.skipped.push({ text: passage(run), start: spoken[sj]?.end ?? 0 });
      }
    }
    si = i; sj = j;
  }
  return drift;
}

/**
 * Align the complete supplied script, not just animation triggers. A monotonic
 * sequence match prevents repeated phrases from jumping to the first occurrence.
 * Unrecognized Arabic stays original Unicode; Turkish anchors estimate its time.
 */
export function alignSolutionNarration(
  solutionText: string,
  narration: NarrationWord[] = [],
  totalDuration = 15,
): SolutionNarrationAlignment {
  const duration = Number.isFinite(totalDuration) && totalDuration > 0 ? totalDuration : 15;
  const source = tokens(solutionText);
  const spoken = spokenTokens(narration, duration);
  const anchors = sequenceAnchors(source, spoken);
  const matchedRatio = source.length ? anchors.size / source.length : 0;
  if (matchedRatio < 0.18) anchors.clear();
  const words: SourceNarrationWord[] = source.map(part => ({ ...part, start: 0, end: 0, matched: false }));
  for (const [i, j] of anchors) {
    words[i].start = spoken[j].start;
    words[i].end = Math.max(spoken[j].start, spoken[j].end);
    words[i].matched = true;
  }
  let previous = -1;
  for (const next of [...anchors.keys(), source.length]) {
    const start = previous >= 0 ? words[previous].end : 0;
    const end = next < source.length ? Math.max(start, words[next].start) : duration;
    const weight = source.slice(previous + 1, next).reduce((sum, part) => sum + Math.max(2, part.norm.length), 0) || 1;
    let consumed = 0;
    for (let i = previous + 1; i < next; i++) {
      words[i].start = start + (end - start) * consumed / weight;
      consumed += Math.max(2, source[i].norm.length);
      words[i].end = start + (end - start) * consumed / weight;
    }
    previous = next;
  }

  // Captions are slices of the original script, never ASR's phonetic Arabic.
  const captions: AlignedCaption[] = [];
  let first = 0;
  let captionStart = 0;
  for (let i = 0; i < words.length; i++) {
    const next = words[i + 1];
    const trailing = solutionText.slice(words[i].sourceEnd, next?.sourceStart ?? solutionText.length);
    const length = words[i].sourceEnd - words[first].sourceStart;
    const split = !next || /[.!?;\n]/.test(trailing) || length >= 85
      || words[i].end - words[first].start >= 5.5;
    if (!split) continue;
    let textEnd = next?.sourceStart ?? solutionText.length;
    if (next) while (textEnd > words[i].sourceEnd && !/\s/.test(solutionText[textEnd - 1])) textEnd--;
    const raw = solutionText.slice(captionStart, textEnd);
    const offset = captionStart + raw.length - raw.trimStart().length;
    captions.push({
      text: raw.trim(),
      start: words[first].start,
      end: Math.min(duration, Math.max(words[i].end, words[first].start + 0.1)),
      words: words.slice(first, i + 1).map(word => ({ from: word.sourceStart - offset, to: word.sourceEnd - offset,
        start: word.start, end: word.end })),
    });
    captionStart = textEnd;
    first = i + 1;
  }
  return {
    words, captions,
    quality: anchors.size === 0 ? 'approximate'
      : matchedRatio >= 0.95 && spoken.every(word => word.exact) ? 'word-aligned' : 'anchored',
    matchedRatio: anchors.size ? matchedRatio : 0,
  };
}

function spanTime(words: SourceNarrationWord[], start: number, end: number) {
  const selected = words.filter(word => word.sourceEnd > start && word.sourceStart < end);
  return selected.length ? { start: selected[0].start, end: selected[selected.length - 1].end } : null;
}

/** An underline is drawn over the spoken phrase, never faster than 0.6 s nor slower than 2.5 s. */
const underlineDraw = (item: { start: number; triggerEnd?: number }) =>
  Math.min(2.5, Math.max(.6, (item.triggerEnd ?? item.start + .6) - item.start));
/** Letters that take width on screen: vowel marks and tatweel are left out. */
const visibleLength = (text: string) => Math.max(1, text.replace(/[\u064B-\u065F\u0670\u06D6-\u06ED\u0640]/g, '').replace(/[^\p{L}\p{N}]/gu, '').length);

/**
 * Word by word: the line reaches the end of each spoken word as it is said, each word taking
 * its share of the box by its letters. Needs at least two timed words; seconds are from `start`.
 */
export function underlineSteps(words: NarrationWord[], start: number): Array<{ at: number; to: number }> | undefined {
  const timed = words.filter(w => Number.isFinite(w.start) && Number.isFinite(w.end) && w.end > w.start);
  if (timed.length < 2) return undefined;
  const total = timed.reduce((sum, w) => sum + visibleLength(w.text), 0);
  const steps: Array<{ at: number; to: number }> = [];
  let reached = 0, at = 0;
  for (const word of timed) {
    const from = Math.max(at, word.start - start);
    if (from > at) steps.push({ at: Math.round(from * 1000) / 1000, to: reached });
    reached += visibleLength(word.text) / total;
    at = Math.max(from, word.end - start);
    steps.push({ at: Math.round(at * 1000) / 1000, to: Math.min(1, Math.round(reached * 10000) / 10000) });
  }
  steps[steps.length - 1].to = 1;
  return steps;
}


/** Marks that judge a box and stay to the end: an option's ✗ / ✓ and a statement's plain ✓ / ✗. */
const VERDICTS: SemanticParsedEvent['actionType'][] = ['reject', 'correct', 'tick', 'cross'];

/** Preserves the legacy three-argument call; new callers should pass the script. */
export function alignEventsWithNarration(
  events: SemanticParsedEvent[],
  words: NarrationWord[] = [],
  totalDuration = 15,
  solutionText?: string,
): VideoAction[] {
  if (!events.length) return [];
  const duration = Number.isFinite(totalDuration) && totalDuration > 0 ? totalDuration : 15;
  const sourceText = solutionText || events.find(event => event.sourceText)?.sourceText
    || [...new Set(events.map(event => event.sentenceText))].join(' ');
  const alignment = alignSolutionNarration(sourceText, words, duration);
  const timed = events.map(event => {
    const sourceStart = event.sourceStart ?? Math.max(0, sourceText.indexOf(event.semanticTriggerPhrase));
    const sourceEnd = event.sourceEnd ?? sourceStart + event.semanticTriggerPhrase.length;
    const trigger = spanTime(alignment.words, sourceStart, sourceEnd);
    const sentence = spanTime(alignment.words, event.sentenceStart ?? sourceStart, event.sentenceEnd ?? sourceEnd);
    const spoken = alignment.words.filter(word => word.sourceEnd > sourceStart && word.sourceStart < sourceEnd);
    return { event, start: Math.min(duration, Math.max(0, (trigger?.start ?? 0) - 0.04)),
      triggerEnd: trigger?.end, end: sentence?.end ?? trigger?.end ?? duration, spoken };
  }).sort((a, b) => a.start - b.start || a.event.order - b.event.order);

  return timed.map((item, index) => {
    const { event } = item;
    let start = item.start;
    // Only a genuinely shared answer phrase gets a tiny focus/check stagger.
    // A rejection in a later sentence is tied to that later sentence.
    if (event.actionType === 'correct' && timed.some(other => other.event.actionType === 'focus'
      && other.event.targetRegionId === event.targetRegionId && other.event.sourceStart === event.sourceStart)) {
      start = Math.min(duration, start + 0.18);
    }
    // One judgment for several options ("diğer şıklar elenir") draws the marks in sequence, not as one flash.
    if (VERDICTS.includes(event.actionType)) {
      const siblings = timed.filter(other => VERDICTS.includes(other.event.actionType)
        && other.event.sourceStart === event.sourceStart && other.event.sourceEnd === event.sourceEnd);
      start = Math.min(duration, start + 0.14 * siblings.indexOf(item));
    }
    let end = item.end;
    // An underline follows its words as they are read; without word timings it sweeps at a readable pace.
    const steps = event.actionType === 'underline' ? underlineSteps(item.spoken, start) : undefined;
    const draw = steps ? Math.max(.3, steps[steps.length - 1].at) : underlineDraw(item);
    if (VERDICTS.includes(event.actionType)) end = duration;
    else if (event.actionType === 'focus') {
      // Options named together ("A ve B şıkları") share the frame instead of cancelling each other.
      const next = timed.slice(index + 1).find(other =>
        (other.event.actionType === 'focus' && other.event.targetRegionId !== event.targetRegionId && other.start > item.start + 0.05)
        || (other.event.targetRegionId === event.targetRegionId && VERDICTS.includes(other.event.actionType)));
      end = next ? next.start + (next.event.actionType === 'correct' && next.event.sourceStart === event.sourceStart ? 0.18 : 0) : duration;
    } else if (event.actionType === 'highlight' || event.actionType === 'underline') {
      const next = timed.find(other => other.start > start + 0.05
        && ['highlight', 'underline', 'focus'].includes(other.event.actionType));
      end = Math.min(Math.max(item.end, start + 0.7), next?.start ?? duration);
      // The mark is as long as its drawing: the line keeps pace with the words, then shows a moment.
      if (event.actionType === 'underline') end = start + underlineSpanFor(draw);
    }
    end = Math.min(duration, Math.max(start, end));
    return {
      id: `act-${index + 1}-${event.targetRegionId}-${event.actionType}`,
      targetRegionId: event.targetRegionId, regionId: event.targetRegionId,
      type: event.actionType, start, startTime: start, duration: end - start,
      label: `${event.actionType}: ${event.semanticTriggerPhrase}`,
      ...(steps ? {drawSteps: steps} : {}),
    };
  }).filter(action => action.duration > 0).sort((a, b) => a.start - b.start);
}
