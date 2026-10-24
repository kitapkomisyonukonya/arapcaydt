import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSolutionSemantics } from '../src/services/analysis/solutionParser';
import { alignEventsWithNarration, alignSolutionNarration } from '../src/services/analysis/timelineAligner';
import type { AnnotationRegion } from '../src/types';

const options = (letters = 'ABCDE') => [...letters].map(letter => ({ id: `option-${letter.toLowerCase()}`, type: `option-${letter.toLowerCase()}`,
  label: letter, x: 0, y: 0, width: .1, height: .1 } as AnnotationRegion));
const marks = (text: string, declared?: 'A' | 'B' | 'C' | 'D' | 'E', letters?: string) => {
  const parsed = parseSolutionSemantics(text, options(letters), [], declared);
  return { answer: parsed.deducedCorrectAnswer, stances: parsed.optionStances,
    marks: parsed.events.filter(e => e.actionType !== 'focus').map(e => `${e.targetOptionLetter}:${e.actionType}`) };
};
const spoken = (text: string) => Array.from(text.matchAll(/\S+/g), (m, i) => ({ text: m[0], start: i * .5, end: i * .5 + .45 }));

test('"diğer şıklar" before the answer never crosses out the spoken answer', () => {
  const result = marks('Diğer şıklar yanlış olduğu için doğru cevap C.');
  assert.equal(result.answer, 'C');
  assert.deepEqual(result.marks.sort(), ['A:reject', 'B:reject', 'C:correct', 'D:reject', 'E:reject']);
});

test('option lists and "Cevap X." are recognized', () => {
  assert.deepEqual(marks('A, B, D ve E şıkları yanlıştır. Doğru cevap C seçeneğidir.').marks,
    ['A:reject', 'B:reject', 'D:reject', 'E:reject', 'C:correct']);
  const late = marks('Cevap C. Diğer seçenekler cümlenin anlamına uymaz.');
  assert.equal(late.answer, 'C');
  assert.deepEqual(late.marks, ['C:correct', 'A:reject', 'B:reject', 'D:reject', 'E:reject']);
});

test('each clause judges its own option', () => {
  assert.deepEqual(marks('Doğru cevap C şıkkıdır, çünkü A şıkkı olmaz.').marks, ['C:correct', 'A:reject']);
  assert.deepEqual(marks('A seçeneğinde "gitti" var, olmaz. B seçeneğinde ise tam olarak uygundur.').marks, ['A:reject', 'B:correct']);
  assert.deepEqual(marks("B'yi eliyoruz. C'de ise anlam tam olarak uygundur.").marks, ['B:reject', 'C:correct']);
});

test('"Şimdi de şıklara bakalım" is not option D; elimination leaves the only open option as the answer', () => {
  const result = marks('Şimdi de şıklara bakalım. A şıkkı olmaz. B şıkkı olmaz. C şıkkı olmaz. D şıkkı olmaz.');
  assert.deepEqual(result.marks, ['A:reject', 'B:reject', 'C:reject', 'D:reject', 'E:correct']);
});

test('teacher-selected answer is checked when the script never names it; weak praise of another option is ignored', () => {
  assert.deepEqual(marks('A şıkkı uygun değil. B şıkkı olmaz.', 'D').marks, ['A:reject', 'B:reject', 'D:correct']);
  const praise = marks('A seçeneğine bakalım. Bu fiil geçmiş zaman anlamı sağlamaktadır. Ancak cümle gelecek zaman ister, eliyoruz. Doğru cevap B.');
  assert.deepEqual(praise.marks, ['A:reject', 'B:correct']);
});

test('four-option (LGS) questions eliminate only existing options; roman numerals are not options', () => {
  assert.deepEqual(marks('Doğru cevap B. Diğer seçenekler olmaz.', undefined, 'ABCD').marks, ['B:correct', 'A:reject', 'C:reject', 'D:reject']);
  assert.deepEqual(marks('I ve III numaralı yargılar doğrudur. Bu yüzden cevap Ce seçeneği.').marks, ['C:correct']);
});

test('grouped options keep a shared frame and receive staggered marks at the spoken judgment', () => {
  const text = 'C ve D şıkları uzaklaşma bildirir; bu yüzden ikisini de eliyoruz.';
  const parsed = parseSolutionSemantics(text, options());
  const actions = alignEventsWithNarration(parsed.events, spoken(text), 10, text);
  const focus = actions.filter(a => a.type === 'focus');
  const rejects = actions.filter(a => a.type === 'reject');
  assert.deepEqual(focus.map(a => a.targetRegionId), ['option-c', 'option-d']);
  assert.ok(focus.every(a => a.duration > 3), 'grouped focus frames must not cancel each other');
  assert.deepEqual(rejects.map(a => a.targetRegionId), ['option-c', 'option-d']);
  assert.ok(Math.abs(rejects[0].start - 4.96) < .1, `reject at ${rejects[0].start}`);
  assert.ok(rejects[1].start - rejects[0].start > .1);
});

test('praise while the answer is discussed only lights it; the check comes once, with "doğru cevap" (Rabia Hoca, 23 Oct)', () => {
  const text = 'B şıkkı tam olarak uygundur. Dolayısıyla doğru cevap B şıkkı.';
  const parsed = parseSolutionSemantics(text, options());
  const actions = alignEventsWithNarration(parsed.events, spoken(text), 10, text);
  const checks = actions.filter(a => a.type === 'correct');
  assert.equal(checks.length, 1);
  assert.equal(checks[0].targetRegionId, 'option-b');
  assert.ok(checks[0].start >= 2.9, `check at ${checks[0].start}, not at "uygundur"`);
  assert.ok(actions.some(a => a.type === 'focus' && a.targetRegionId === 'option-b' && a.start < 1), 'the option is lit while it is discussed');
});

test('an answer said first keeps its check there; repeating it later does not move or replay it', () => {
  const text = 'Doğru cevap B şıkkı. B şıkkı tam olarak uygundur. Yine doğru cevap B şıkkı.';
  const parsed = parseSolutionSemantics(text, options());
  const actions = alignEventsWithNarration(parsed.events, spoken(text), 10, text);
  const checks = actions.filter(a => a.type === 'correct');
  assert.equal(checks.length, 1);
  assert.ok(checks[0].start < 1, `check at ${checks[0].start}`);
});

test('captions carry per-word timing offsets for karaoke highlighting', () => {
  const text = 'A şıkkı عَلَى demektir. Olmaz.';
  const aligned = alignSolutionNarration(text, spoken(text), 5);
  const first = aligned.captions[0];
  assert.equal(first.text, 'A şıkkı عَلَى demektir.');
  assert.deepEqual(first.words!.map(w => first.text.slice(w.from, w.to)), ['A', 'şıkkı', 'عَلَى', 'demektir']);
  assert.ok(Math.abs(first.words![2].start - 1) < .01);
  const second = aligned.captions[1];
  assert.equal(second.text.slice(second.words![0].from, second.words![0].to), 'Olmaz');
});
