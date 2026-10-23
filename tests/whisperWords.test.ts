import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { cleanWhisperWords, speechWindows } from '../src/services/whisper/whisperWords';
import type { NarrationWord } from '../src/types';

const RATE = 16000;

test('a narration up to 30 s is one window; a longer one is cut in its quietest pause', () => {
  assert.deepEqual(speechWindows(new Float32Array(25 * RATE).fill(0.3), RATE), [[0, 25 * RATE]]);

  const audio = new Float32Array(66 * RATE).fill(0.3);
  audio.fill(0, Math.round(21.4 * RATE), Math.round(22 * RATE));
  audio.fill(0, Math.round(47 * RATE), Math.round(47.6 * RATE));
  const windows = speechWindows(audio, RATE);
  assert.equal(windows.length, 3);
  assert.equal(windows[0][0], 0);
  assert.equal(windows[windows.length - 1][1], audio.length);
  for (let i = 1; i < windows.length; i++) assert.equal(windows[i][0], windows[i - 1][1], 'pieces neither overlap nor leave a gap');
  for (const [from, to] of windows) assert.ok(to - from <= 30 * RATE);
  assert.ok(Math.abs(windows[0][1] / RATE - 21.7) < 0.3, `first cut in the first pause, got ${windows[0][1] / RATE}`);
  assert.ok(Math.abs(windows[1][1] / RATE - 47.3) < 0.3, `second cut in the second pause, got ${windows[1][1] / RATE}`);
});

test('a Whisper repetition loop and the words that jump back in time are dropped (23 Oct, 75 s narration)', () => {
  const heard: NarrationWord[] = JSON.parse(readFileSync(new URL('./fixtures/whisper-tekrar-dongusu.json', import.meta.url), 'utf8'));
  const words = cleanWhisperWords(heard);
  for (let i = 1; i < words.length; i++) assert.ok(words[i].start >= words[i - 1].end - 0.05, `in order at ${i}: ${words[i - 1].text} → ${words[i].text}`);
  assert.ok(words.length < 150, `the loop is gone (${heard.length} → ${words.length})`);
  assert.ok(words.filter(w => /kısm/.test(w.text)).length <= 4);
  const text = words.map(w => w.text).join(' ');
  assert.match(text, /erilisimdir, dişil ve waafiratin sıfatıyla uyum sordur\./);
  assert.match(text, /Dee, rücacin, cam,/);
});

test('ordinary speech, including a word said twice, is left as it is', () => {
  const said = ['Şıklara', 'bakalım.', 'A,', 'çok', 'çok', 'güzel.'].map((text, i) => ({ text, start: i, end: i + 0.8 }));
  assert.deepEqual(cleanWhisperWords(said), said);
});
