import test from 'node:test';
import assert from 'node:assert/strict';
import { buildBatchPlan, questionNumberFromFileName, splitSolutions } from '../src/features/batch/batchPlan';

test('solution document splits on "Soru N" headings and keeps in-text mentions', () => {
  const doc = `Deneme 3 çözümleri\n\nSoru 1\nA şıkkı olmaz. Soru 1'de fiil geçmiş zamandır. Doğru cevap B.\n\n## Soru 2:\nDoğru cevap C.\n3. Soru\nCevap: E.`;
  const sections = splitSolutions(doc);
  assert.deepEqual(sections.map(s => s.number), [1, 2, 3]);
  assert.ok(sections[0].text.startsWith('A şıkkı olmaz.'), 'the heading is not read aloud');
  assert.ok(sections[0].text.includes("Soru 1'de"), 'mention inside the text is not a new heading');
  assert.equal(sections[1].text, 'Doğru cevap C.');
  assert.equal(sections[2].text, 'Cevap: E.');
  assert.equal(splitSolutions('Soru 4: Doğru cevap D.')[0].text, 'Doğru cevap D.', 'a heading on the same line as the text');
});

test('question number comes from labelled or single numbers in file names', () => {
  assert.equal(questionNumberFromFileName('soru_12.png'), 12);
  assert.equal(questionNumberFromFileName('2026-ydt-soru-7.jpg'), 7);
  assert.equal(questionNumberFromFileName('S3.mp3'), 3);
  assert.equal(questionNumberFromFileName('q07.png'), 7);
  assert.equal(questionNumberFromFileName('5.png'), 5);
  assert.equal(questionNumberFromFileName('deneme 2026 12.png'), null, 'two unlabeled numbers are ambiguous');
  assert.equal(questionNumberFromFileName('kapak.png'), null);
});

test('files and solutions are matched by number; gaps and duplicates are reported', () => {
  const f = (name: string) => ({ name });
  const doc = 'Soru 1\nDoğru cevap B.\nSoru 2\nA şıkkı olmaz.\nSoru 4\nDoğru cevap D.';
  const { items, unmatched } = buildBatchPlan([f('soru1.png'), f('soru2.png'), f('soru3.png'), f('s3.jpg'), f('logo.png')], doc, [f('soru2.mp3')]);
  assert.deepEqual(items.map(i => i.number), [1, 2, 3, 4]);
  assert.equal(items[0].answer, 'B');
  assert.deepEqual(items[0].problems, []);
  assert.equal(items[1].audio?.name, 'soru2.mp3');
  assert.equal(items[1].answer, undefined);
  assert.ok(items[1].notes[0].includes('doğru cevap bulunamadı'));
  assert.ok(items[2].problems.some(p => p.includes('iki görsel')) && items[2].problems.includes('Çözüm metni yok'));
  assert.deepEqual(items[3].problems, ['Görsel yok']);
  assert.equal(unmatched.length, 1);
});

test('a solution that starts in Arabic gets a note once its heading is dropped', () => {
  const { items } = buildBatchPlan([{ name: 'soru1.png' }], 'Soru 1\nقَرَأَ الطَّالِبُ الدَّرْسَ. Doğru cevap B.');
  assert.ok(items[0].notes.some(n => n.includes('Arapça başlıyor')));
});
