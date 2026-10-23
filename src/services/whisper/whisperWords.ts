import { NarrationWord } from '../../types';

/** Whisper hears at most 30 seconds at a time. */
const WINDOW_S = 30;
/** A longer narration is cut in the quietest moment of this stretch of each window. */
const CUT_FROM_S = 15;
const CUT_TO_S = 28;
const FRAME_S = 0.2;

/**
 * Start/end sample of each piece of audio Whisper transcribes on its own: one piece when it fits
 * in a window, otherwise cuts in the quietest pause (the narration pauses between sentences),
 * so no word is split and no piece overlaps another.
 */
export function speechWindows(audio: Float32Array, sampleRate: number): [number, number][] {
  const windows: [number, number][] = [];
  const frame = Math.round(FRAME_S * sampleRate);
  let start = 0;
  while (audio.length - start > WINDOW_S * sampleRate) {
    let cut = start + CUT_TO_S * sampleRate;
    let quietest = Infinity;
    for (let at = start + CUT_FROM_S * sampleRate; at + frame <= start + CUT_TO_S * sampleRate; at += frame / 2) {
      let energy = 0;
      for (let i = at; i < at + frame; i++) energy += audio[i] * audio[i];
      if (energy < quietest) { quietest = energy; cut = at + Math.round(frame / 2); }
    }
    windows.push([start, cut]);
    start = cut;
  }
  windows.push([start, audio.length]);
  return windows;
}

const key = (word: NarrationWord) => word.text.toLocaleLowerCase('tr').replace(/[^\p{L}\p{N}]/gu, '');

/**
 * Words as they were spoken, in order: Whisper sometimes gets stuck repeating the same few words
 * (kept at most twice in a row), often all on one instant at the end of a piece (no two words share
 * the exact same time), and a word may never start before the previous one ended.
 */
export function cleanWhisperWords(words: NarrationWord[]): NarrationWord[] {
  const out: NarrationWord[] = [];
  for (const word of words) {
    const last = out[out.length - 1];
    if (last && (word.start < last.end - 0.05 || (word.start === last.start && word.end === last.end))) continue;
    out.push(word);
    for (let n = 1; n <= 4; n++) {
      while (out.length >= 3 * n && [...Array(n).keys()].every(i => {
        const at = out.length - n + i;
        return key(out[at]) === key(out[at - n]) && key(out[at]) === key(out[at - 2 * n]);
      })) out.splice(out.length - n, n);
    }
  }
  return out;
}
