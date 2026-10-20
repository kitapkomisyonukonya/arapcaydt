import type { NarrationWord, VideoAction, VideoCaption } from '../../types';
import { HEARD_SHARE, alignSolutionNarration, speechSeconds } from '../analysis/timelineAligner';
import { splitNarration } from './narrationParts';

/**
 * Re-voicing only a wrong or skipped place: the teacher picks sentences (or a part of a long
 * solution), only that text is voiced again, and the new audio replaces that stretch of the
 * narration. Everything after it moves by the difference; the rest of the voice stays as it is.
 */

export interface TextRange { from: number; to: number; text: string }

/** The solution's sentences (and lines), with their place in the text. */
export function sentenceRanges(text: string): TextRange[] {
  const ranges: TextRange[] = [];
  let start = 0;
  const close = (end: number) => {
    const raw = text.slice(start, end);
    const from = start + raw.length - raw.trimStart().length, to = start + raw.trimEnd().length;
    if (/[\p{L}\p{N}]/u.test(raw)) ranges.push({ from, to, text: text.slice(from, to) });
    start = end;
  };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '\n') { close(i + 1); continue; }
    if (!'.!?؟…'.includes(c)) continue;
    let j = i;
    while (j + 1 < text.length && '.!?؟…'.includes(text[j + 1])) j++;
    if (j + 1 < text.length && !/\s/.test(text[j + 1])) { i = j; continue; }
    // "3." or "I." (a number or a single capital before the dot) does not end a sentence.
    const word = /(\S+)$/.exec(text.slice(start, i))?.[1] ?? '';
    if (c === '.' && j === i && (/^\d+$/.test(word) || /^[IVX]+$|^[A-ZÇĞİÖŞÜ]$/u.test(word))) { i = j; continue; }
    close(j + 1);
    i = j;
  }
  close(text.length);
  return ranges;
}

/** Each sentence's time on the narration, from its first to its last spoken word (null: not found in the voice). */
export function sentenceTimes(text: string, words: NarrationWord[], duration: number, sentences = sentenceRanges(text)) {
  const aligned = alignSolutionNarration(text, words, duration).words;
  return sentences.map(s => {
    const inside = aligned.filter(w => w.sourceStart >= s.from && w.sourceEnd <= s.to);
    return inside.length ? { start: inside[0].start, end: Math.max(inside[0].start + .2, inside[inside.length - 1].end) } : null;
  });
}

/** The parts a long solution is voiced in (as in narrationParts), with their place in the text. */
export function partRanges(text: string): TextRange[] {
  const ranges: TextRange[] = [];
  let at = 0;
  for (const part of splitNarration(text)) {
    const words = part.split(/\s+/);
    const from = text.indexOf(words[0], at);
    const lastWord = words[words.length - 1];
    const to = text.indexOf(lastWord, Math.max(from, from + part.length - lastWord.length - 50)) + lastWord.length;
    if (from < 0 || to < from) return [];
    ranges.push({ from, to, text: text.slice(from, to) });
    at = to;
  }
  return ranges;
}

/** Sentences touched by a stretch of text, as one range from the first to the last. */
export function wholeSentences(text: string, from: number, to: number): TextRange | null {
  const hit = sentenceRanges(text).filter(s => s.to > from && s.from < Math.max(to, from + 1));
  if (!hit.length) return null;
  const start = hit[0].from, end = hit[hit.length - 1].to;
  return { from: start, to: end, text: text.slice(start, end) };
}

/**
 * The selection after a click on sentence `i` (in the Ses şeridi): a click outside it adds the sentences up to `i`; a
 * click on its first or last sentence takes that one out (so clicking back through a selection
 * undoes it); a click inside cuts it there.
 */
export function nextPick(pick: [number, number] | null, i: number): [number, number] | null {
  if (!pick) return [i, i];
  const [a, b] = pick;
  if (i < a || i > b) return [Math.min(a, i), Math.max(b, i)];
  if (a === b) return null;
  if (i === b) return [a, b - 1];
  if (i === a) return [a + 1, b];
  return [a, i];
}
export interface SpokenSpan {
  /** Where the new audio goes in (seconds): in the pauses around the sentences. */
  start: number;
  end: number;
  /** No word of the range was heard: the new audio is inserted, nothing is taken out. */
  skipped: boolean;
  /**
   * Where each cut is looked for in the audio: between the last word heard before the range and
   * the first heard inside it (and likewise at the end), near the estimated boundary. Words the
   * transcript did not write (often Arabic) lie in between, so the cut is set in a real pause
   * there (see cutAtPauses), not halfway between heard words, which could fall inside them.
   */
  startWindow?: [number, number];
  endWindow?: [number, number];
  startGuess?: number;
  endGuess?: number;
}

/**
 * Where a stretch of the solution is in the narration, from the word timings: cut in the middle
 * of the pause before its first heard word and after its last. A stretch the voice skipped gets
 * a single point between the words around it.
 */
export function spokenSpan(solutionText: string, words: NarrationWord[], duration: number, range: { from: number; to: number }): SpokenSpan | null {
  const aligned = alignSolutionNarration(solutionText, words, duration).words;
  if (!aligned.length || !aligned.some(w => w.matched)) return null;
  const words_ = aligned.filter(w => w.sourceStart >= range.from && w.sourceEnd <= range.to);
  const inside = words_.filter(w => w.matched);
  const before = [...aligned].reverse().find(w => w.sourceEnd <= range.from && w.matched);
  const after = aligned.find(w => w.sourceStart >= range.to && w.matched);
  const mid = (a: number, b: number) => (a + b) / 2;
  if (!inside.length) {
    const from = before?.end ?? 0, to = after?.start ?? duration;
    // The transcript missed these words but they were spoken: replace that stretch, do not add a
    // copy. Arabic the transcript often writes differently or not at all: there is room for it in
    // the audio. Turkish it writes reliably: heard words (just spelled differently) fill the gap.
    const text = solutionText.slice(range.from, range.to);
    const spokenThere = /[\u0600-\u06FF]/.test(text)
      ? to - from >= HEARD_SHARE * speechSeconds(text)
      : words.filter(w => w.start >= from - 0.01 && w.end <= to + 0.01).length >= Math.max(1, text.split(/\s+/).length / 2);
    if (spokenThere) return { start: from, end: to, skipped: false,
      startWindow: [from, to], endWindow: [from, to], startGuess: words_[0]?.start ?? from, endGuess: words_[words_.length - 1]?.end ?? to };
    // Really left out: it goes in after whatever was spoken between the words around it
    // (an Arabic line the transcript did not write, for example), not in the middle of that.
    const before_ = speechSeconds(solutionText.slice(before?.sourceEnd ?? 0, range.from));
    const at = Math.max(from, Math.min(to - 0.05, from + before_ + 0.1));
    return { start: at, end: at, skipped: true, startWindow: [from, to], endWindow: [from, to], startGuess: at, endGuess: at };
  }
  const first = inside[0], last = inside[inside.length - 1];
  return {
    start: before ? mid(before.end, first.start) : Math.max(0, first.start - 0.05),
    end: after ? mid(last.end, after.start) : duration,
    skipped: false,
    startWindow: [before?.end ?? 0, first.start], endWindow: [last.end, after?.start ?? duration],
    // The range's own first and last words, timed between the heard ones when unheard.
    startGuess: words_[0].start, endGuess: words_[words_.length - 1].end,
  };
}

/** A stretch of silence in the narration (seconds). */
export interface Pause { start: number; end: number }

/**
 * The silences of a narration: 10 ms frames well below its loud level, at least 80 ms long.
 */
export function findPauses(samples: Float32Array, rate: number): Pause[] {
  const frame = Math.max(1, Math.round(rate * .01));
  const levels: number[] = [];
  for (let i = 0; i < samples.length; i += frame) {
    let sum = 0;
    const end = Math.min(samples.length, i + frame);
    for (let j = i; j < end; j++) sum += samples[j] * samples[j];
    levels.push(Math.sqrt(sum / Math.max(1, end - i)));
  }
  const loud = [...levels].sort((a, b) => a - b)[Math.floor(levels.length * .95)] || 0;
  const quiet = Math.max(.004, loud * .08);
  const pauses: Pause[] = [];
  let from = -1;
  levels.forEach((level, i) => {
    if (level < quiet) { if (from < 0) from = i; return; }
    if (from >= 0 && i - from >= 8) pauses.push({ start: from * frame / rate, end: i * frame / rate });
    from = -1;
  });
  if (from >= 0 && levels.length - from >= 8) pauses.push({ start: from * frame / rate, end: levels.length * frame / rate });
  return pauses;
}

/**
 * The best place to cut near `guess` within [lo, hi]: the middle of a pause there, a long one
 * (a sentence end) preferred over a short one, a near one over a far one. Without a pause, the guess.
 */
export function snapToPause(pauses: Pause[], guess: number, lo: number, hi: number): number {
  let best = Math.max(lo, Math.min(hi, guess)), bestScore = -Infinity;
  for (const p of pauses) {
    const middle = (p.start + p.end) / 2;
    if (middle < lo - .05 || middle > hi + .05) continue;
    const score = Math.min(.6, p.end - p.start) - .5 * Math.abs(middle - guess);
    if (score > bestScore) { bestScore = score; best = middle; }
  }
  return best;
}

/** Where to cut the narration for a span: in the real pauses around it (see SpokenSpan). */
export function cutAtPauses(samples: Float32Array, rate: number, span: SpokenSpan): { start: number; end: number } {
  if (!span.startWindow || !span.endWindow) return { start: span.start, end: span.end };
  const pauses = findPauses(samples, rate);
  const start = snapToPause(pauses, span.startGuess ?? span.start, ...span.startWindow);
  // A left-out stretch goes into a pause between the words around it; nothing is taken out.
  if (span.skipped) return { start, end: start };
  const end = snapToPause(pauses, span.endGuess ?? span.end, Math.max(start, span.endWindow[0]), span.endWindow[1]);
  return end > start ? { start, end } : { start: span.start, end: span.end };
}

/** Loudness of the spoken parts only (10 ms frames above silence), so pauses do not lower it. */
function speechLevel(samples: Float32Array, rate: number, from = 0, to = samples.length): number {
  const frame = Math.max(1, Math.round(rate * .01));
  let sum = 0, count = 0;
  for (let i = Math.max(0, from); i + frame <= Math.min(samples.length, to); i += frame) {
    let energy = 0;
    for (let j = i; j < i + frame; j++) energy += samples[j] * samples[j];
    const rms = Math.sqrt(energy / frame);
    if (rms >= QUIET) { sum += rms * rms; count++; }
  }
  return count ? Math.sqrt(sum / count) : 0;
}

/**
 * The new piece at the loudness of the narration around it (6 s on each side of the cut), so a
 * fixed sentence does not stand out louder or quieter. Never more than twice or half, never clipping.
 */
export function matchLoudness(insert: Float32Array, base: Float32Array, rate: number, start: number, end: number): Float32Array {
  const around = Math.round(6 * rate), a = Math.round(start * rate), b = Math.round(end * rate);
  const before = speechLevel(base, rate, a - around, a), after = speechLevel(base, rate, b, b + around);
  const target = before && after ? (before + after) / 2 : before || after;
  const level = speechLevel(insert, rate);
  if (!target || !level) return insert;
  let gain = Math.max(.5, Math.min(2, target / level));
  let peak = 0;
  for (const v of insert) peak = Math.max(peak, Math.abs(v));
  if (peak * gain > .98) gain = .98 / peak;
  if (Math.abs(gain - 1) < .03) return insert;
  return insert.map(v => v * gain);
}

/** Samples below this level (about 1% of full scale) count as silence. */
const QUIET = 0.012;
const PAUSE = 0.18;
const FADE = 0.012;

function trimSilence(samples: Float32Array, rate: number): Float32Array {
  let a = 0, b = samples.length;
  while (a < b && Math.abs(samples[a]) < QUIET) a++;
  while (b > a && Math.abs(samples[b - 1]) < QUIET) b--;
  // Keep a breath of the fade-in and fade-out.
  const keep = Math.round(0.03 * rate);
  return samples.subarray(Math.max(0, a - keep), Math.min(samples.length, b + keep));
}

/**
 * The narration with [start, end] replaced by the new audio (its own silences trimmed, a short
 * pause on each side, soft edges so no click is heard). Returns where the new audio sits and
 * how much everything after `end` moved.
 */
export function spliceAudio(base: Float32Array, insert: Float32Array, rate: number, start: number, end: number) {
  const cutA = Math.max(0, Math.min(base.length, Math.round(start * rate)));
  const cutB = Math.max(cutA, Math.min(base.length, Math.round(end * rate)));
  const voice = trimSilence(insert, rate);
  const pause = Math.round(PAUSE * rate), fade = Math.round(FADE * rate);
  const out = new Float32Array(cutA + pause + voice.length + pause + (base.length - cutB));
  out.set(base.subarray(0, cutA), 0);
  out.set(voice, cutA + pause);
  out.set(base.subarray(cutB), cutA + pause + voice.length + pause);
  const soften = (at: number, rising: boolean) => {
    for (let i = 0; i < fade; i++) {
      const k = at + (rising ? i : -i - 1);
      if (k >= 0 && k < out.length) out[k] *= i / fade;
    }
  };
  soften(cutA, false); soften(cutA + pause, true); soften(cutA + pause + voice.length, false);
  soften(cutA + pause + voice.length + pause, true);
  const newStart = cutA / rate, newEnd = (cutA + pause * 2 + voice.length) / rate;
  return { samples: out, newStart, newEnd, shift: newEnd - cutB / rate };
}

/** A time on the old narration, placed on the new one. */
export function movedTime(t: number, start: number, end: number, newStart: number, newEnd: number): number {
  if (t <= start) return t;
  if (t >= end) return t + (newEnd - end);
  return end > start ? newStart + ((t - start) / (end - start)) * (newEnd - newStart) : newStart;
}

/** Marks, captions and word timings moved to the new narration; the teacher's edits stay. */
export function moveTimeline(
  change: { start: number; end: number; newStart: number; newEnd: number },
  actions: VideoAction[] = [], captions: VideoCaption[] = [], words: NarrationWord[] = [],
) {
  const at = (t: number) => movedTime(t, change.start, change.end, change.newStart, change.newEnd);
  return {
    actions: actions.map(a => {
      const start = at(a.start);
      const end = at(a.start + a.duration);
      return { ...a, start, ...(a.startTime !== undefined ? { startTime: start } : {}), duration: Math.max(0.3, end - start) };
    }),
    captions: captions.map(c => ({ ...c, start: at(c.start), end: at(c.end), words: c.words?.map(w => ({ ...w, start: at(w.start), end: at(w.end) })) })),
    // Words of the replaced stretch are dropped; the new timing is taken from the whole narration.
    words: words.filter(w => w.end <= change.start || w.start >= change.end).map(w => ({ ...w, start: at(w.start), end: at(w.end) })),
  };
}
