import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  deckWords, markable, matchSentences, pictureLines, sentenceParagraphs, slideDraft, sentenceTimes, sentences, slideBlocks, slideMarks, textLines, timedMarks,
  translationPairs, voicePauses, type SlideLine, type TextRun,
} from '../src/features/lessons/slideMarks';
import { storedLesson, type Lesson } from '../src/features/lessons/lessonPlan';
import { autoScene, drawnOnly, sceneFromOldMarks, withEnds } from '../src/features/lessons/slideScene';
import { computeTimelineVisualState } from '../src/features/video/engine/timeline';
import { dragPill } from '../src/features/video/MarkTimeline';
import { penOf } from '../src/features/video/engine/renderer';
import { onTextLines, textLineAt } from '../src/features/video/PreviewEditOverlay';
import type { VideoAction } from '../src/types';

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

test('İşaretler: slides use the question editor’s marks: a highlighter pen in reading direction, no automatic green tick', () => {
  const list = textLines([...words('Kelimelerin anlamları', 0.165, 0.285), ...words('Kelimeler arası ilişkiler', 0.165, 0.417), ...words('Cümle içinde doğru kullanım', 0.165, 0.548)]);
  const text = 'Üç başlık var.\n\nİkincisi, kelimeler arasındaki ilişkileri kavramaktır.\n\nÜçüncüsü ise kelimeleri cümle içerisinde doğru kullanabilmektir.';
  const scene = autoScene(text, list, {}, 20);
  const say = (id: string) => scene.regions.find(r => r.id === id)?.content;
  assert.deepEqual(scene.actions.map(a => [a.type, say(a.targetRegionId), a.fromLeft ?? false]), [
    ['highlight', 'Kelimeler arası ilişkiler', true],
    ['highlight', 'Cümle içinde doğru kullanım', true],
  ]);
  // A slide saved with the studio's old automatic ticks shows them no more; a tick placed by hand stays.
  const region = scene.regions[0];
  const saved = withEnds({ regions: scene.regions, actions: [...scene.actions,
    { id: 'oto-tik-0-5000', type: 'correct', targetRegionId: region.id, start: 5, startTime: 5, duration: 15 },
    { id: 'el', type: 'tick', targetRegionId: region.id, start: 6, startTime: 6, duration: 14 }] });
  assert.deepEqual(saved.actions.map(a => a.type), ['highlight', 'highlight', 'tick']);
  // Arabic is highlighted right to left.
  const arabic = autoScene('اَلْبَيْتُ كَبِيرٌ, ev büyüktür.', deck[2], {}, 6);
  const rtl = arabic.actions.find(a => a.type === 'highlight' && /[؀-ۿ]/.test(arabic.regions.find(r => r.id === a.targetRegionId)?.content || ''));
  assert.ok(rtl && !rtl.fromLeft);
});

test('İşaretler: on a slide a cross or tick goes away at its end and its length can be set; in a question video it stays', () => {
  const region = { id: 'p', type: 'phrase' as const, label: 'p', x: .1, y: .1, width: .3, height: .05 };
  const tick: VideoAction = { id: 't', type: 'correct', targetRegionId: 'p', start: 2, startTime: 2, duration: 18 };
  const old = withEnds({ regions: [region], actions: [tick] });
  assert.equal(old.actions[0].ends, true, 'a tick saved before keeps its length now');
  const shorter = dragPill(old.actions[0], 'end', -14, 20);
  assert.deepEqual([shorter.start, shorter.duration], [2, 4], 'its end can be dragged like any mark');
  const shown = (t: number, a: VideoAction) => Object.keys(computeTimelineVisualState(t, [a], [region]).correctRegions).length > 0;
  assert.equal(shown(5, shorter), true);
  assert.equal(shown(7, shorter), false, 'gone after its end');
  assert.equal(shown(7, { ...tick, duration: 4 }), true, 'a question video keeps its tick to the end');
  const moved = dragPill({ ...tick }, 'end', -1, 20);
  assert.deepEqual([moved.start, moved.start + moved.duration], [1, 20], 'and only its start moves there');
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

test('İşaretler: a slide saved as a picture gets its lines from the words the reader found', () => {
  const w = (str: string, x: number, y: number, confidence = 90) => ({ str, x, y, width: 0.08, height: 0.04, confidence });
  const lines = pictureLines([
    w('Kitabı', 0.1, 0.2), w('okudum', 0.19, 0.2), w('%$', 0.5, 0.2, 20),
    w('الْكِتَابَ', 0.7, 0.3), w('قَرَأْتُ', 0.8, 0.3),
    w('|', 0.1, 0.5),
  ], 9 / 16);
  assert.deepEqual(lines.map(l => [l.text, !!l.rtl]), [['Kitabı okudum', false], ['قرأت الكتاب', true]]);
});

test('İşaretler: a slide told in one paragraph, one sentence per item, marks every item in turn', () => {
  const list = textLines([
    ...words('① Cümleyi anla. Cümlenin genel anlamını belirle.', 0.06, 0.2),
    ...words('② Boşluğu fark et. Boşluğun hangi anlamı tamamladığını belirle.', 0.06, 0.32),
    ...words('③ Bağlamı yakala. Önceki ve sonraki ifadeler arasındaki ilişkiyi incele.', 0.06, 0.44),
    ...words('④ Seçenekleri karşılaştır. Her seçeneği cümleye yerleştir.', 0.06, 0.56),
  ]);
  const text = 'Dört adım var. Önce cümleyi anla, cümlenin genel anlamını belirle. İkinci adımda boşluğu fark et. Üçüncü olarak bağlamı yakala; önceki ve sonraki ifadelere bak. Dördüncü adım seçenekleri karşılaştırmak. Bu adımlar çok önemli.';
  assert.deepEqual(slideMarks(text, list).marks.map(m => m.part), [-1, 0, 1, 2, 3, -1]);
});

test('Konu anlatımı: the slide’s own Turkish text as a first draft, one part per line', () => {
  const list = textLines([
    ...words('Başlık', 0.4, 0.06),
    ...words('① Cümleyi anla', 0.06, 0.3), ...words('Sebep', 0.06, 0.45), ...words('→ Sonuç', 0.5, 0.45),
  ]);
  assert.equal(slideDraft(list), 'Cümleyi anla.\nSebep – Sonuç.');
  assert.equal(slideDraft(undefined), '');
});

test('Konu anlatımı: the lesson keeps its pen; without one the strong yellow highlighter stays', () => {
  const lesson: Lesson = { id: 'l', kind: 'lesson', title: 'T', createdAt: '', updatedAt: '', slides: [], pen: { kind: 'underline', color: 'blue', size: 'thin' } };
  assert.deepEqual(storedLesson(lesson).pen, { kind: 'underline', color: 'blue', size: 'thin' });
  assert.equal('pen' in storedLesson({ ...lesson, pen: undefined }), false);
  assert.deepEqual(penOf(true), { kind: 'highlight', color: 'yellow', size: 'thick', direction: 'ltr' });
  assert.deepEqual(penOf({ kind: 'underline', color: 'pink', size: 'medium' }).kind, 'underline');
});

test('Konu anlatımı: a drawn highlight sits on the lines it covers; a click finds its line', () => {
  const lines = [{ x: .1, y: .2, width: .6, height: .05 }, { x: .1, y: .3, width: .5, height: .05 }];
  // A sloppy stroke over the first line: same height as the line, dragged length kept.
  const drawn = { id: 'h', x: .2, y: .19, width: .3, height: .09, type: 'box' } as never;
  const on = onTextLines(drawn, lines)!;
  assert.deepEqual([on.x, on.y, on.width, Number(on.height.toFixed(3))], [.2, .2, .3, .05]);
  // A stroke across both lines covers both.
  const both = onTextLines({ ...(drawn as object), y: .2, height: .15 } as never, lines)!;
  assert.deepEqual([both.y, Number(both.height.toFixed(3))], [.2, .15]);
  assert.equal(onTextLines({ ...(drawn as object), y: .6, height: .05 } as never, lines), null);
  assert.equal(textLineAt(.4, .32, lines), lines[1]);
  assert.equal(textLineAt(.4, .7, lines), null);
});

test('Konu anlatımı: the pen remembers its direction; old lessons draw left to right', () => {
  assert.equal(penOf({ kind: 'highlight', color: 'orange', size: 'thin', direction: 'rtl' }).direction, 'rtl');
  assert.equal(penOf({ kind: 'highlight', color: 'orange', size: 'thin' }).direction, 'ltr');
  const lesson: Lesson = { id: 'l', kind: 'lesson', title: 'T', createdAt: '', updatedAt: '', slides: [], autoMarks: true };
  assert.equal(storedLesson(lesson).autoMarks, true);
  assert.equal('autoMarks' in storedLesson({ ...lesson, autoMarks: false }), false);
});

test('Konu anlatımı: no studio marks unless the lesson asks for them; the teacher\'s own always stay', async () => {
  const { lessonMarks } = await import('../src/features/lessons/lessonVideo');
  const mine = { regions: [{ id: 'r', x: .1, y: .1, width: .2, height: .05, type: 'box' }], actions: [{ id: 'a', type: 'highlight', regionId: 'r', startTime: 0, duration: 1 }] } as never;
  const slides = [
    { id: 's1', text: deck[0].map(l => l.text).join('\n'), lines: deck[0] },
    { id: 's2', text: deck[1].map(l => l.text).join('\n'), lines: deck[1], scene: mine },
  ] as never;
  const timeline = { spans: [{ start: 0, end: 8 }, { start: 8, end: 16 }], total: 16 };
  const lesson: Lesson = { id: 'l', kind: 'lesson', title: 'T', createdAt: '', updatedAt: '', slides };
  const off = lessonMarks(lesson, timeline);
  assert.equal(off[0].actions.length, 0);
  assert.equal(off[1].actions.length, 1);
  assert.ok(lessonMarks({ ...lesson, autoMarks: true }, timeline)[0].actions.length > 0);
  assert.equal(lessonMarks({ ...lesson, marksOff: true }, timeline)[1].actions.length, 0);
});

test('Konu anlatımı: one sentence of a slide is voiced again in its place; the rest stays as it was', async () => {
  const { sentencePieces, sentenceRows, sentenceSpan, withSentence } = await import('../src/features/lessons/slideRevoice');
  const said = 'Bugün fiilleri görüyoruz. Fiil üç harflidir.\nSon olarak كَتَبَ örneğine bakalım.';
  assert.deepEqual(sentencePieces(said).map(p => said.slice(p.from, p.to)), sentences(said));
  // The teacher fixed the second sentence in the text box: only that row has changed.
  const now = said.replace('üç harflidir', 'çoğunlukla üç harflidir');
  const rows = sentenceRows(said, now);
  assert.deepEqual(rows.map(r => r.changed), [false, true, false]);
  assert.equal(withSentence(said, 1, rows[1].now), now);
  // A sentence added: rows keep the voiced sentences (nothing to pair).
  assert.deepEqual(sentenceRows(said, `${now} Yeni cümle.`).map(r => r.changed), [false, false, false]);
  // The cut is looked for in the pauses around the sentence; the first starts at 0, the last ends at the end.
  const times = [{ start: 0, end: 2 }, { start: 2, end: 5 }, { start: 5, end: 8 }];
  const middle = sentenceSpan(times, 1, 8)!;
  assert.deepEqual([middle.start, middle.end, middle.skipped], [2, 5, false]);
  assert.ok(middle.startWindow![0] < 2 && middle.startWindow![1] > 2 && middle.endWindow![0] < 5 && middle.endWindow![1] > 5);
  assert.deepEqual([sentenceSpan(times, 0, 8)!.start, sentenceSpan(times, 2, 8)!.end], [0, 8]);
  assert.equal(sentenceSpan(times, 3, 8), null);
});

test('Konu anlatımı ses düzeltme: a picked stretch is taken out; marks after it move back, the voice around it stays', async () => {
  const { cutOut, sentenceCuts } = await import('../src/features/lessons/slideRevoice');
  const { moveTimeline } = await import('../src/services/narration/revoice');
  const R = 1000;
  const voice = new Float32Array(8 * R).map((_, i) => (i >= 3 * R && i < 4 * R ? .5 : .2));
  const out = cutOut(voice, R, 3, 4);
  assert.equal(out.length, 7 * R);
  assert.ok(out.every(v => v < .21), 'the picked second is gone');
  const marks = moveTimeline({ start: 3, end: 4, newStart: 3, newEnd: 3 }, [
    { id: 'a', type: 'highlight', regionId: 'r', start: 1, duration: 1 },
    { id: 'b', type: 'highlight', regionId: 'r', start: 5, duration: 2 },
  ] as never).actions;
  assert.deepEqual(marks.map(m => [m.start, m.duration]), [[1, 1], [4, 2]]);

  // Each sentence's stretch lands in the silences around it (three spoken stretches with word gaps).
  const rate = 24000, segs = [[.3, 2.3], [2.9, 5.4], [6, 7.6]];
  const s = new Float32Array(8 * rate);
  for (const [a, b] of segs) for (let i = a * rate; i < b * rate; i++) { const t = i / rate; if ((t * 4) % 1 > .08) s[i] = .3 * Math.sin(2 * Math.PI * 220 * t); }
  const cuts = sentenceCuts(s, rate, ['Bugün fiilleri görüyoruz bu konu önemli.', 'Fiil çoğunlukla üç harfli olur ve kökten gelir.', 'Son olarak örneğe bakalım.']);
  assert.ok(cuts[1].start > 2.3 && cuts[1].start < 2.9 && cuts[1].end > 5.4 && cuts[1].end < 6, JSON.stringify(cuts));
});
