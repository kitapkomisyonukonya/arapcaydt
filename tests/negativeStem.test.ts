import test from 'node:test';
import assert from 'node:assert/strict';
import { asksForFalse, parseSolutionSemantics } from '../src/services/analysis/solutionParser';
import type { AnnotationRegion } from '../src/types';

const regions = ['A', 'B', 'C', 'D', 'E'].map(l => ({ id: `option-${l.toLowerCase()}`, type: 'option', label: l, x: 0, y: 0, width: .2, height: .1 })) as AnnotationRegion[];
const stances = (text: string, declared?: 'A' | 'B' | 'C' | 'D' | 'E') => parseSolutionSemantics(text, regions, [], declared);

// DKAB tarama, as teachers write it: each option is called true or false, then the answer is named.
const yanlis = [
  'Hz. Muhammed’in merhamet anlayışıyla ilgili aşağıdaki ifadelerden hangisi yanlıştır?',
  'A) Güçsüzlere yardım etmiştir.', 'Hz. Peygamber fakirlerin yanında olmuştur; bu nedenle bu ifade doğrudur.',
  'B) Çocuklara şefkatle yaklaşmıştır.', 'Bu yargı da doğrudur.',
  'C) Hayvanlara merhameti emretmiştir.', 'Dolayısıyla bu ifade de doğrudur.',
  'D) Doğanın korunmasını teşvik etmiştir.', 'Bu ifade de doğrudur.',
  'E) Merhamette yakın çevreyi esas almıştır.', 'Merhameti tüm insanlığı kucaklamıştır; bu nedenle bu yargı yanlıştır.',
  'Dolayısıyla sorunun doğru cevabı E seçeneğidir.',
].join('\n');

test('"hangisi yanlıştır": options called true are crossed, the false one is the answer', () => {
  assert.equal(asksForFalse(yanlis), true);
  const r = stances(yanlis, 'D');
  assert.deepEqual(r.optionStances, { A: 'rejected', B: 'rejected', C: 'rejected', D: 'rejected', E: 'correct' });
  assert.equal(r.deducedCorrectAnswer, 'E', 'the text names E even though D was selected');
});

test('"hangisi … değildir" closed by "olmayan ifade B seçeneğinde verilmiştir"', () => {
  const text = [
    'Aşağıdakilerden hangisi Ahmet Yesevi ile ilgili değildir?',
    'A) Buhara’ya gitmiştir.', 'Yusuf Hemedani’den ilim tahsil etmiştir; dolayısıyla bu ifade doğrudur.',
    'B) Görüşleri oğlu tarafından sistemleştirilmiştir.', 'Görüşleri oğlu tarafından değil, halifeleri aracılığıyla yayılmıştır.',
    'C) Peygamber sevgisi önemlidir.', 'Dolayısıyla bu ifade doğrudur.',
    'D) Öğrencileri İslam’ı anlatmıştır.', 'Dolayısıyla bu ifade doğrudur.',
    'E) Şiirlerine hikmet denmiştir.', 'Dolayısıyla bu ifade doğrudur.',
    'Dolayısıyla Ahmet Yesevi ile ilgili olmayan ifade B seçeneğinde verilmiştir.',
  ].join('\n');
  assert.deepEqual(stances(text, 'E').optionStances, { A: 'rejected', B: 'correct', C: 'rejected', D: 'rejected', E: 'rejected' });
});

test('a positive question keeps "doğrudur" as the answer', () => {
  const text = 'Aşağıdakilerden hangisi doğrudur?\nA) Birinci. Bu ifade yanlıştır.\nB) İkinci. Bu ifade doğrudur.\nC) Üçüncü. Olmaz.\nD) Dördüncü. Olmaz.\nE) Beşinci. Olmaz.';
  assert.equal(asksForFalse(text), false);
  const r = stances(text);
  assert.equal(r.optionStances.A, 'rejected');
  assert.equal(r.optionStances.B, 'correct');
});

test('negative question words', () => {
  for (const q of ['hangisi söylenemez?', 'hangisine ulaşılamaz?', 'hangisinde değinilmemiştir?', 'hangisi bunlardan biri değildir?'])
    assert.equal(asksForFalse(`Parçaya göre aşağıdakilerden ${q}\nA) …`), true, q);
  for (const q of ['hangisidir?', 'hangisi getirilmelidir?', 'hangisine yer verilmiştir?'])
    assert.equal(asksForFalse(`Aşağıdakilerden ${q}\nA) …`), false, q);
});
