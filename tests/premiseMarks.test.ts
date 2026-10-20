import test from 'node:test';
import assert from 'node:assert/strict';
import { detectYdtQuestionRegions } from '../src/services/ocr/ydtQuestionDetector';
import { parseSolutionSemantics } from '../src/services/analysis/solutionParser';
import { alignEventsWithNarration } from '../src/services/analysis/timelineAligner';
import { computeTimelineVisualState } from '../src/features/video/engine/timeline';
import { addMark } from '../src/features/video/PreviewEditOverlay';
import type { AnnotationRegion } from '../src/types';
import fixture from './fixtures/maddeli-soru-ocr.json';
import lostFirst from './fixtures/maddeli-soru-ilk-numara-okunmadi-ocr.json';

// DKAB tarama S35 (a teacher's question): three statements whose numerals OCR lost, only their dots were read.
test('numbered statements (I, II, III) are found above the options, without the question sentence', () => {
  const { regions } = detectYdtQuestionRegions(fixture);
  const premises = regions.filter(r => r.type === 'premise');
  assert.deepEqual(premises.map(r => r.id), ['premise-1', 'premise-2', 'premise-3']);
  assert.deepEqual(premises.map(r => r.label), ['I. madde', 'II. madde', 'III. madde']);
  // The teacher drew them at y ≈ .25, .36 and .48; the last one stops before "Yukarıda … hangileri doğrudur?".
  const [one, two, three] = premises;
  assert.ok(one.y < .25 && one.y + one.height > .34 && one.y + one.height < .36);
  assert.ok(two.y > .355 && two.y + two.height < .48);
  assert.ok(three.y > .47 && three.y + three.height < .56);
  assert.match(three.content!, /^İbadetlerin amacı/);
  assert.ok(!/Yukarıda/.test(three.content!));
  assert.ok(one.x < .33, 'the box reaches over the lost numeral');
});

test('each statement is framed while read, then ticked or crossed as the solution judges it', () => {
  const { regions } = detectYdtQuestionRegions(fixture);
  const { events, optionStances } = parseSolutionSemantics(fixture.solutionText, regions, [], 'C');
  const premiseMarks = events.filter(e => e.targetRegionId.startsWith('premise-')).map(e => `${e.targetRegionId}:${e.actionType}`);
  assert.deepEqual(premiseMarks, [
    'premise-1:focus', 'premise-1:tick', 'premise-2:focus', 'premise-2:tick', 'premise-3:focus', 'premise-3:cross',
  ]);
  const cross = events.find(e => e.targetRegionId === 'premise-3' && e.actionType === 'cross')!;
  assert.equal(cross.semanticTriggerPhrase, 'yanlış');
  assert.ok(cross.sourceStart! < fixture.solutionText.indexOf('B, D ve E'));
  // The options keep their own marks: B, D, E and A eliminated, C the answer.
  assert.deepEqual(optionStances, { A: 'rejected', B: 'rejected', C: 'correct', D: 'rejected', E: 'rejected' });
  // The frame stays until the tick; the tick stays to the end.
  const actions = alignEventsWithNarration(events, [], 90, fixture.solutionText);
  const frame = actions.find(a => a.targetRegionId === 'premise-1' && a.type === 'focus')!;
  const tick = actions.find(a => a.targetRegionId === 'premise-1' && a.type === 'tick')!;
  assert.ok(Math.abs(frame.start + frame.duration - tick.start) < .05);
  assert.ok(Math.abs(tick.start + tick.duration - 90) < .01);
});

test('ordinals and roman numerals, also in lists, name statements; "Yalnız I" alone does not', () => {
  const premises = [1, 2, 3].map(n => ({ id: `premise-${n}`, type: 'premise', label: `${n}`, x: 0, y: n * .2, width: .5, height: .1 })) as AnnotationRegion[];
  const text = 'I. öncülde verilen bilgi parçada geçmektedir, bu öncül doğrudur. II numaralı yargı parçaya göre söylenemez. Yalnız I ve III doğru olabilir. Üçüncü ifade de doğrudur.';
  const marks = parseSolutionSemantics(text, premises).events.map(e => `${e.targetRegionId}:${e.actionType}`);
  assert.deepEqual(marks, ['premise-1:focus', 'premise-1:tick', 'premise-2:focus', 'premise-2:cross', 'premise-3:focus', 'premise-3:tick']);
});

const options = ['A', 'B', 'C', 'D', 'E'].map(l => ({ id: `option-${l.toLowerCase()}`, type: 'option', label: l, x: 0, y: 0, width: .2, height: .1 })) as AnnotationRegion[];

test('"hangisi yanlıştır": a true option gets a green tick, the answer a red cross beside its answer mark', () => {
  const text = [
    'Bu parçaya göre kurban ibadetiyle ilgili aşağıdakilerden hangisi yanlıştır?',
    'A seçeneğinde kişinin ibadeti samimiyetle yerine getirdiği ifade edilmektedir. Bu yargı parçaya göre doğrudur.',
    'B seçeneğinde kurbanın cömertliğin delili olduğu ileri sürülmektedir. Bu yargı yanlıştır.',
    'C seçeneği de doğrudur. D seçeneği de doğrudur. E seçeneği de doğrudur.',
    'Bu nedenle sorunun cevabı B seçeneğidir.',
  ].join('\n');
  const { events, optionStances } = parseSolutionSemantics(text, options, [], 'B');
  assert.deepEqual(optionStances, { A: 'rejected', B: 'correct', C: 'rejected', D: 'rejected', E: 'rejected' });
  const verdicts = events.filter(e => e.actionType !== 'focus').map(e => `${e.targetOptionLetter}:${e.actionType}`);
  assert.deepEqual(verdicts.sort(), ['A:tick', 'B:correct', 'B:cross', 'C:tick', 'D:tick', 'E:tick']);
  assert.ok(!events.some(e => e.actionType === 'reject'), 'no red cross on a true statement');
});

test('a positive question keeps its crosses', () => {
  const text = 'Aşağıdakilerden hangisi doğrudur? A seçeneği yanlıştır. B seçeneği doğrudur.';
  const verdicts = parseSolutionSemantics(text, options, [], 'B').events.filter(e => e.actionType !== 'focus').map(e => `${e.targetOptionLetter}:${e.actionType}`);
  assert.deepEqual(verdicts, ['A:reject', 'B:correct']);
});

test('a teacher\'s tick and cross are their own pair: they replace each other, not the answer mark', () => {
  let actions = addMark([], 'option-b', 'correct', 2, 20);
  actions = addMark(actions, 'option-b', 'cross', 3, 20);
  assert.deepEqual(actions.map(a => a.type), ['correct', 'cross']);
  actions = addMark(actions, 'option-b', 'tick', 4, 20);
  assert.deepEqual(actions.map(a => a.type), ['correct', 'tick']);
  assert.equal(actions[1].duration, 16, 'a tick stays to the end');
  const state = computeTimelineVisualState(10, [...actions.slice(0, 1), { ...actions[1], color: '#1C1917' }]);
  assert.ok(state.correctRegions['option-b']);
  assert.deepEqual({ kind: state.truthMarks['option-b'].kind, color: state.truthMarks['option-b'].color }, { kind: 'tick', color: '#1C1917' });
  assert.deepEqual(computeTimelineVisualState(3.5, actions).truthMarks, {});
});

test('"hangileri yanlıştır" with numbered statements: options listing them keep their usual marks', () => {
  const regions = [...options, ...[1, 2].map(n => ({ id: `premise-${n}`, type: 'premise', label: `${n}`, x: 0, y: n * .2, width: .5, height: .1 }))] as AnnotationRegion[];
  const text = 'Verilenlerden hangileri yanlıştır? Birinci ifade yanlıştır. İkinci ifade doğrudur. Bu yüzden A seçeneği elenir. Doğru cevap B seçeneğidir.';
  const marks = parseSolutionSemantics(text, regions, [], 'B').events.filter(e => e.actionType !== 'focus').map(e => `${e.targetRegionId}:${e.actionType}`);
  assert.deepEqual(marks, ['premise-1:cross', 'premise-2:tick', 'option-a:reject', 'option-b:correct']);
});

// DKAB tarama T5-S10: OCR lost statement I's numeral and its dot; II and III kept only their dots.

test('a first statement whose numeral was lost is still statement I, so "birinci bilgi" frames it', () => {
  const { regions } = detectYdtQuestionRegions(lostFirst);
  const premises = regions.filter(r => r.type === 'premise');
  assert.deepEqual(premises.map(r => r.id), ['premise-1', 'premise-2', 'premise-3']);
  assert.match(premises[0].content!, /^oluşum sürecinde/);
  assert.match(premises[1].content!, /^Özgün yapısıyla/);
  assert.match(premises[2].content!, /^kendine özgü/);
  assert.ok(premises[0].y > .34 && premises[0].y + premises[0].height < .425, 'the intro line above is not part of it');
  const marks = parseSolutionSemantics(lostFirst.solutionText, regions, [], 'E').events
    .filter(e => e.targetRegionId.startsWith('premise-')).map(e => `${e.targetRegionId}:${e.actionType}`);
  assert.deepEqual(marks, ['premise-1:focus', 'premise-1:tick', 'premise-2:focus', 'premise-2:tick', 'premise-3:focus', 'premise-3:tick']);
});

test('items called by other names: "Birinci isim", "ikinci isim de doğru bir örnektir"', () => {
  const premises = [1, 2, 3].map(n => ({ id: `premise-${n}`, type: 'premise', label: `${n}`, x: 0, y: n * .2, width: .5, height: .1 })) as AnnotationRegion[];
  const text = [
    'Numaralanmış isimlerden hangilerinin etkili olduğu söylenebilir?',
    'Birinci isim olan Ebu Hanife, Hanefi mezhebinin kurucusudur. Bu nedenle etkili olduğu doğrudur.',
    'İkinci isim olan Ahmed Yesevi Türkçe hikmetler yazmıştır. Dolayısıyla ikinci isim de doğru bir örnektir.',
    'Üçüncü isim olan İmam Matüridi inanç ekolünün kurucusudur. Bu yüzden üçüncü isim de doğrudur.',
  ].join('\n');
  const marks = parseSolutionSemantics(text, premises).events.map(e => `${e.targetRegionId}:${e.actionType}`);
  assert.deepEqual(marks, ['premise-1:focus', 'premise-1:tick', 'premise-2:focus', 'premise-2:tick', 'premise-3:focus', 'premise-3:tick']);
});
