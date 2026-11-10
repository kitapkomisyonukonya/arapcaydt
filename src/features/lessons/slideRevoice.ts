import type { SpokenSpan } from '../../services/narration/revoice';

/** One sentence of a slide's text and where it sits in that text (split the same way as `sentences`). */
export interface SentencePiece { from: number; to: number; text: string }

export function sentencePieces(text: string): SentencePiece[] {
  const pieces: SentencePiece[] = [];
  for (const m of text.matchAll(/[^.!?؟…\n]+[.!?؟…]*/g)) {
    const raw = m[0], lead = raw.length - raw.trimStart().length;
    const sentence = raw.trim();
    if (!/[\p{L}\p{N}]/u.test(sentence)) continue;
    const from = (m.index ?? 0) + lead;
    pieces.push({ from, to: from + sentence.length, text: sentence });
  }
  return pieces;
}

/**
 * The sentences of a slide's voice, each with what the text box says now. When the teacher changed
 * a sentence or two (same number of sentences), that sentence can be voiced again on its own; when
 * sentences were added or removed, each row keeps the voiced sentence.
 */
export interface SentenceRow { said: string; now: string; changed: boolean }
export function sentenceRows(spokenText: string, text: string): SentenceRow[] {
  const said = sentencePieces(spokenText), now = sentencePieces(text);
  const paired = said.length === now.length;
  return said.map((s, i) => {
    const next = paired ? now[i].text : s.text;
    return { said: s.text, now: next, changed: next !== s.text };
  });
}

/** The voiced text with one sentence swapped for its new wording (the rest exactly as it was). */
export function withSentence(spokenText: string, index: number, sentence: string): string {
  const piece = sentencePieces(spokenText)[index];
  return piece ? spokenText.slice(0, piece.from) + sentence + spokenText.slice(piece.to) : spokenText;
}

/**
 * Where a sentence is cut out of the slide's voice: its estimated start and end (from the voice's
 * pauses), with room around each so the cut lands in a real pause (cutAtPauses).
 */
export function sentenceSpan(times: Array<{ start: number; end: number }>, index: number, duration: number): SpokenSpan | null {
  const t = times[index];
  if (!t) return null;
  const room = (a: number, b: number) => Math.min(.8, Math.max(.15, (b - a) / 3));
  const start = index === 0 ? 0 : t.start, end = index === times.length - 1 ? duration : t.end;
  const before = index > 0 ? room(times[index - 1].start, t.start) : 0, inside = room(start, end);
  const after = index < times.length - 1 ? room(t.end, times[index + 1].end) : 0;
  return {
    start, end, skipped: false,
    startGuess: start, startWindow: [Math.max(0, start - before), Math.min(end, start + inside)],
    endGuess: end, endWindow: [Math.max(start, end - inside), Math.min(duration, end + after)],
  };
}
