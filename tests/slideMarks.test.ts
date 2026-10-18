import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  deckWords, markable, matchSentences, sentenceParagraphs, sentenceTimes, sentences, slideBlocks, slideMarks, textLines, timedMarks,
  translationPairs, voicePauses, type SlideLine, type TextRun,
} from '../src/features/lessons/slideMarks';
import { storedLesson, type Lesson } from '../src/features/lessons/lessonPlan';
import { autoScene, drawnOnly, sceneFromOldMarks } from '../src/features/lessons/slideScene';

// A four-slide test presentation (made in PowerPoint style, saved as PDF): the text pieces pdf.js gives.
const deckRuns: TextRun[][] = JSON.parse(fs.readFileSync(new URL('./fixtures/lesson-slides-runs.json', import.meta.url), 'utf8'));
const deck = deckRuns.map(runs => textLines(runs));
const parts = (n: number) => markable(slideBlocks(deck[n - 1]));
const partText = (n: number, i: number) => i < 0 ? null : parts(n)[i].text;

test('İşaretler: PDF lines become the slide parts (list items, a wrapped note, Arabic examples, table rows)', () => {
  assert.deepEqual(slideBlocks(deck[0]).map(b => [b.kind, b.text.slice(0, 12)]), [
    ['title', 'İsim Cümlesi'], ['line', 'İsimle başla'], ['bullet', '1. Mübteda: '], ['bullet', '2. Haber: Mü'], ['bullet', '3. Mübteda v'], ['bullet', '4. Mübteda ç'],
  ]);
  assert.ok(parts(2).some(b => b.text === 'Haber öne geçerse mübteda nekire olabilir.'), 'a sentence wrapped over two lines is one part');
  const blocks3 = slideBlocks(deck[2]), arabic = blocks3.filter(b => b.rtl);
  assert.equal(arabic.length, 4, 'four Arabic lines (harakat over and under the letters stay in their line)');
  const pairs = translationPairs(blocks3);
  assert.equal(pairs.get(arabic[2])?.text, 'Kitap masanın üzerindedir.', 'each example goes with its translation, in order');
  assert.deepEqual(parts(4).filter(b => b.kind === 'row').map(b => b.text.split(' ')[0]), ['Öğe', 'Mübteda', 'Haber', 'Şibh-i']);
});

test('İşaretler: each sentence marks the part it explains; when unsure, nothing', () => {
  const said = (n: number, list: string[]) => matchSentences(list, slideBlocks(deck[n - 1]), { deck: deckWords(deck) }).map(i => partText(n, i));
  assert.deepEqual(said(1, [
    'Bu derste isim cümlesini öğreneceğiz.',
    'Birincisi mübteda; cümlenin kendisinden haber verilen öğesidir.',
    'İkincisi haber; mübteda hakkında verilen bilgidir.',
    'Mübteda ve haber genellikle merfû olur.',
  ]).slice(1), ['1. Mübteda: Cümlenin kendisinden haber verilen öğesidir.', '2. Haber: Mübteda hakkında verilen bilgidir.', '3. Mübteda ve haber genellikle merfûdur.']);
  // Out of order, as teachers do: the note box first, the last bullet after it.
  assert.deepEqual(said(2, [
    'Burada dikkat: haber öne geçerse mübteda nekire olabilir.',
    'Son olarak haber, sayı ve cinsiyette mübtedaya uyar.',
    'ÖSYM bunu çok seviyor.',
  ]), ['Haber öne geçerse mübteda nekire olabilir.', '• Haber, sayı ve cinsiyette mübtedaya uyar.', null]);
  // Arabic in the text finds its Arabic line; "üçüncü cümlede" is the third example.
  const ar = said(3, ['اَلْبَيْتُ كَبِيرٌ, ev büyüktür.', 'Üçüncü cümlede haber bir câr-mecrûr.']);
  assert.ok([parts(3).filter(b => b.rtl)[1].text, 'Ev büyüktür.'].includes(ar[0]!), 'the example or its translation (both are marked together)');
  assert.ok([parts(3).filter(b => b.rtl)[2].text, 'Kitap masanın üzerindedir.'].includes(ar[1]!));
  // A table: "ikinci satır" is the second row under the header.
  assert.deepEqual(said(4, ['İkinci satır: haber de ötreli ama çoğunlukla belirsiz.']), ['Haber Merfû Genelde nekire']);
  // "ilk iş" is not a list item.
  assert.deepEqual(said(1, ['Soruda ilk iş cümleyi okumak.']), [null]);
});

// PowerPoint's own PDF: each word placed by itself with no spaces, Wingdings ticks as bullets, a running header.
const run = (str: string, x: number, y: number, width: number, height = 0.04): TextRun => ({ str, x, y, width, height });
const words = (text: string, x: number, y: number, height = 0.04) => {
  let at = x;
  return text.split(' ').map(w => { const r = run(w, at, y, w.length * 0.0105, height); at += w.length * 0.0105 + 0.005; return r; });
};
const pptSlide: SlideLine[] = textLines([
  ...words('ARAPÇA - YDT', 0.036, 0.027, 0.021), ...words('ÇELDİRİCİLERE DİKKAT!', 0.317, 0.091, 0.054),
  ...words('Çeldiriciler şunlar olabilir:', 0.069, 0.336),
  run('', 0.069, 0.463, 0.012), ...words('Anlamca birbirine yakın olabilir', 0.09, 0.463),
  run('', 0.52, 0.463, 0.012), ...words('Aynı kökten gelebilir', 0.541, 0.463),
  run('', 0.069, 0.573, 0.012), ...words('Gramere uyar, anlama uymaz', 0.09, 0.573),
]);

test('İşaretler: a PowerPoint PDF reads as words with spaces; its header and lead-in are not list items', () => {
  const blocks = slideBlocks(pptSlide);
  assert.deepEqual(blocks.map(b => [b.kind, b.text.replace(//, '✓')]), [
    ['title', 'ARAPÇA - YDT'], ['title', 'ÇELDİRİCİLERE DİKKAT!'], ['line', 'Çeldiriciler şunlar olabilir:'],
    ['bullet', '✓ Anlamca birbirine yakın olabilir'], ['bullet', '✓ Aynı kökten gelebilir'], ['bullet', '✓ Gramere uyar, anlama uymaz'],
  ]);
  // Three plain lines one under the other (bullet art drawn as shapes) are a list too.
  const plain = slideBlocks(textLines([...words('Kelimelerin anlamları', 0.165, 0.285), ...words('Kelimeler arası ilişkiler', 0.165, 0.417), ...words('Cümle içinde doğru kullanım', 0.165, 0.548)]));
  assert.deepEqual(plain.map(b => b.kind), ['bullet', 'bullet', 'bullet']);
});

test('İşaretler: a cover slide gets no marks; the subject’s everyday words are not enough to mark', () => {
  const cover = textLines([...words('ARAPÇA', 0.386, 0.325, 0.156), ...words('KELİME BİLGİSİ', 0.314, 0.557, 0.078)]);
  assert.deepEqual(slideMarks('Bu dersimizde Arapça kelime bilgisi konusunu ele alacağız.', cover).marks.map(m => m.part), [-1]);

  const list = textLines([...words('Kelimelerin anlamları', 0.165, 0.285), ...words('Kelimeler arası ilişkiler', 0.165, 0.417), ...words('Cümle içinde doğru kullanım', 0.165, 0.548)]);
  // "kelime", "anlam", "cümle" are on every slide of a vocabulary lesson.
  const everywhere = deckWords([list, ...Array.from({ length: 6 }, (_, i) => textLines(words(`Kelime anlam cümle soru ${i}`, 0.1, 0.5)))]);
  const marks = (text: string) => slideMarks(text, list, {}, everywhere).marks.map(m => m.part);
  assert.deepEqual(marks('Kelimeleri örnek cümlelerle öğrenmek, hem anlamlarını daha iyi kavramamızı sağlar.'), [-1]);
  assert.deepEqual(marks('Birincisi, kelimelerin anlamlarını bilmektir.'), [0], 'an ordinal still points at its item');
});

test('İşaretler: a mark stays while its paragraph goes on, and is timed inside the slide’s voice', () => {
  const list = textLines([...words('Kelimelerin anlamları', 0.165, 0.285), ...words('Kelimeler arası ilişkiler', 0.165, 0.417), ...words('Cümle içinde doğru kullanım', 0.165, 0.548)]);
  const text = 'Üç başlık var.\n\nİkincisi, kelimeler arasındaki ilişkileri kavramaktır. Aynı kökten türeyen kelimeler farklı anlamlar taşıyabilir.\n\nÜçüncüsü ise kelimeleri cümle içerisinde doğru kullanabilmektir.';
  assert.deepEqual(sentences(text).length, 4);
  assert.deepEqual(sentenceParagraphs(text), [0, 1, 1, 2]);
  assert.deepEqual(slideMarks(text, list).marks.map(m => m.part), [-1, 1, -1, 2]);
  const times = sentenceTimes(sentences(text), 20);
  assert.ok(Math.abs(times[3].end - 20) < 1e-9 && times[0].start === 0, 'the sentences fill the voice');
  const { marks } = timedMarks(text, list, {}, 20);
  assert.deepEqual(marks.map(m => [m.block.text, +m.start.toFixed(3), +m.end.toFixed(3)]), [
    ['Kelimeler arası ilişkiler', +times[1].start.toFixed(3), +times[2].end.toFixed(3)],
    ['Cümle içinde doğru kullanım', +times[3].start.toFixed(3), 20],
  ]);
});

test('İşaretler: the teacher’s changes win, are kept with the lesson, and marks can be turned off', () => {
  const list = textLines([...words('Kelimelerin anlamları', 0.165, 0.285), ...words('Kelimeler arası ilişkiler', 0.165, 0.417)]);
  const text = 'İkincisi, kelimeler arasındaki ilişkiler. Bu çok önemli.';
  assert.deepEqual(slideMarks(text, list).marks.map(m => [m.part, m.fixed]), [[1, false], [-1, false]]);
  const fixes = { 'İkincisi, kelimeler arasındaki ilişkiler.': -1, 'Bu çok önemli.': 0, 'Silinmiş bir cümle.': 1 };
  assert.deepEqual(slideMarks(text, list, fixes).marks.map(m => [m.part, m.fixed]), [[-1, true], [0, true]]);
  assert.deepEqual(slideMarks(text, list, { 'Bu çok önemli.': 7 }).marks[1], { sentence: 'Bu çok önemli.', part: -1, fixed: false }, 'a part that is no longer there is ignored');
  assert.deepEqual(slideMarks(text, undefined).marks.map(m => m.part), [-1, -1], 'a picture slide has no marks');

  const lesson: Lesson = { id: 'l', kind: 'lesson', title: 'T', marksOff: true, createdAt: '', updatedAt: '',
    slides: [{ id: 'a', imagePath: 'p', width: 1920, height: 1080, text, lines: list, markFixes: fixes }] };
  const stored = storedLesson(lesson);
  assert.equal(stored.marksOff, true);
  assert.deepEqual(stored.slides[0].lines, list);
  assert.deepEqual(stored.slides[0].markFixes, fixes);
  assert.ok(!('marksOff' in storedLesson({ ...lesson, marksOff: false })));
});

// A voice as stretches of sound and quiet: [seconds of speech, seconds of quiet after it].
const RATE = 24000;
function voice(parts: Array<[number, number]>, lead = 0.3) {
  const out = new Float32Array(Math.ceil((lead + parts.reduce((a, [s, q]) => a + s + q, 0)) * RATE));
  let at = lead, seed = 7;
  for (const [speech, quiet] of parts) {
    const from = Math.round(at * RATE);
    for (let i = 0; i < speech * RATE; i++) out[from + i] = 0.3 * Math.sin(i / RATE * 2 * Math.PI * 180) * (0.6 + 0.4 * Math.sin(i / RATE * 2 * Math.PI * 4));
    at += speech + quiet;
  }
  for (let i = 0; i < out.length; i++) { seed = (seed * 16807) % 2147483647; out[i] += (seed / 2147483647 - 0.5) * 0.002; }
  return out;
}

test('İşaretler: each sentence starts when the voice really says it (its breath), not where its length guesses', () => {
  // A long first sentence read fast with two commas, a short one, a third with a comma.
  const said = ['Birinci cümle oldukça uzun bir cümle ve hızlı okunuyor, araya virgül giriyor, bir virgül daha.', 'İkinci kısa.', 'Üçüncü cümle orta uzunlukta bir cümle, virgüllü.'];
  const samples = voice([[2, 0.2], [1.5, 0.2], [1.2, 0.55], [1.6, 0.6], [2, 0.22], [1.4, 0.4]]);
  const pauses = voicePauses(samples, RATE);
  assert.deepEqual(pauses.map(p => [+p.start.toFixed(2), +p.end.toFixed(2)]), [[0, 0.3], [2.3, 2.5], [4, 4.2], [5.4, 5.95], [7.55, 8.15], [10.15, 10.37], [11.77, 12.17]]);
  const duration = samples.length / RATE;
  const guessed = sentenceTimes(said, duration), heard = sentenceTimes(said, duration, pauses);
  assert.ok(guessed[1].start > 7, 'by length alone the second sentence would start after it is over');
  assert.deepEqual(heard.map(t => [+t.start.toFixed(2), +t.end.toFixed(2)]), [[0, 5.8], [5.8, 8], [8, +duration.toFixed(2)]], 'just before the voice goes on after each sentence end');
  // A voice with no clear quiet (steady noise): back to the guess.
  const noisy = Float32Array.from(samples, (v, i) => v + 0.2 * Math.sin(i * 1.3));
  assert.deepEqual(voicePauses(noisy, RATE), []);
});

test('İşaretler: slides use the question editor’s marks: a highlighter pen in reading direction, ticks that stay', () => {
  const list = textLines([...words('Kelimelerin anlamları', 0.165, 0.285), ...words('Kelimeler arası ilişkiler', 0.165, 0.417), ...words('Cümle içinde doğru kullanım', 0.165, 0.548)]);
  const text = 'Üç başlık var.\n\nİkincisi, kelimeler arasındaki ilişkileri kavramaktır.\n\nÜçüncüsü ise kelimeleri cümle içerisinde doğru kullanabilmektir.';
  const scene = autoScene(text, list, {}, 20);
  const say = (id: string) => scene.regions.find(r => r.id === id)?.content;
  assert.deepEqual(scene.actions.map(a => [a.type, say(a.targetRegionId), a.fromLeft ?? false]), [
    ['highlight', 'Kelimeler arası ilişkiler', true], ['correct', 'Kelimeler arası ilişkiler', false],
    ['highlight', 'Cümle içinde doğru kullanım', true], ['correct', 'Cümle içinde doğru kullanım', false],
  ]);
  const tick = scene.actions[3];
  assert.ok(Math.abs(tick.start + tick.duration - 20) < 1e-9, 'a tick stays to the end of the slide');
  // Arabic is highlighted right to left.
  const arabic = autoScene('اَلْبَيْتُ كَبِيرٌ, ev büyüktür.', deck[2], {}, 6);
  const rtl = arabic.actions.find(a => a.type === 'highlight' && /[؀-ۿ]/.test(arabic.regions.find(r => r.id === a.targetRegionId)?.content || ''));
  assert.ok(rtl && !rtl.fromLeft);
});

test('İşaretler: what the teacher placed on 17 October is kept; a new picture keeps only what was drawn', () => {
  const list = textLines([...words('Kelimelerin anlamları', 0.165, 0.285), ...words('Kelimeler arası ilişkiler', 0.165, 0.417)]);
  const scene = sceneFromOldMarks(list, [
    { id: 'b', start: 4, end: 6, area: { x: 0.6, y: 0.6, width: 0.2, height: 0.1 } },
    { id: 'a', start: 1, end: 3, part: 1 },
    { id: 'c', start: 7, end: 8, part: 9 },
  ], 10);
  assert.deepEqual(scene.actions.map(a => [a.type, a.start]), [['highlight', 1], ['highlight', 4]], 'in time order; a part no longer there is left out');
  const kept = drawnOnly(scene)!;
  assert.deepEqual(kept.regions.map(r => r.shape), ['drawn']);
  assert.deepEqual(kept.actions.map(a => a.type), ['highlight']);
  const lesson: Lesson = { id: 'l', kind: 'lesson', title: 'T', createdAt: '', updatedAt: '',
    slides: [{ id: 'a', imagePath: 'p', width: 1920, height: 1080, text: 'x', lines: list, scene: kept }] };
  assert.deepEqual(storedLesson(lesson).slides[0].scene, kept);
});
