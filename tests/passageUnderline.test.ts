import test from 'node:test';
import assert from 'node:assert/strict';
import { findPassageMatches, findPassages, readingOrder, withPassageReferences, wordLikeness } from '../src/services/ocr/passageMatcher';
import { findBestArabicMatches } from '../src/services/ocr/arabicMatcher';
import { parseSolutionSemantics } from '../src/services/analysis/solutionParser';
import { alignEventsWithNarration } from '../src/services/analysis/timelineAligner';
import { underlineProgress } from '../src/features/video/engine/timeline';
import type { OCRWord } from '../src/services/ocr/ocrTypes';

// A reading text on the right, the question beside it on the left (as in YDT paragraph questions).
const PASSAGE = 'ظَهَرَتِ الْمَلَابِسُ فِي الْعَصْرِ الْحَجَرِيِّ الْقَدِيمِ، أَيْ مُنْذُ أَكْثَرَ مِنْ مِائَةٍ وَخَمْسِينَ أَلْفَ سَنَةٍ، وَكَانَتِ الْمَلَابِسُ فِي الْبِدَايَةِ مَصْنُوعَةً مِنْ أَوْرَاقِ الْأَشْجَارِ الْكَبِيرَةِ وَالرِّيشِ وَفِرَاءِ وَجُلُودِ الْحَيَوَانَاتِ. وَفِي أَوَاخِرِ الْعَصْرِ الْحَجَرِيِّ الْقَدِيمِ تَمَكَّنَ الْإِنْسَانُ مِنِ اسْتِخْلَاصِ الْخُيُوطِ مِنْ أَلْيَافِ النَّبَاتَاتِ وَاسْتِخْدَامِهَا فِي صِنَاعَةِ الْمَلَابِسِ. اِرْتَبَطَتِ الْمَلَابِسُ بِالْأَلْوَانِ حَتَّى إِنَّهَا كَانَتْ تَرْمُزُ لِطَبَقَةٍ أَوْ حَالَةٍ اجْتِمَاعِيَّةٍ أَوْ فِئَةٍ عُمُرِيَّةٍ أَوْ غَيْرِهَا مِنَ التَّصْنِيفَاتِ، وَكَثِيرٌ مِنَ الْبُلْدَانِ كَانَتْ لَهَا طَبَقَةٌ أَوْ مِهْنَةٌ تَتَمَيَّزُ بِأَزْيَائِهَا. وَنُلَاحِظُ هٰذَا فِي الْأَزْيَاءِ الرُّومَانِيَّةِ وَالْإِفْرِيقِيَّةِ وَالْمِصْرِيَّةِ الْقَدِيمَةِ.';
const SOLUTION = `Önce paragrafın tamamını okuyalım.
${PASSAGE}
Şimdi soruda verilen ifadeyi okuyalım. Soruda şöyle deniyor.
يَبْدُو أَنَّ الْبَشَرَ قَدْ بَدَأَ بِصِنَاعَةِ الْمَلَابِسِ الْمَخِيطَةِ ----.
Parçada başlangıçta giysilerin yaprak, tüy, kürk ve hayvan derilerinden yapıldığı söyleniyor. Daha sonra ise insanın bitki liflerinden iplik elde etmeyi, yani اِسْتِخْلَاصَ الْخُيُوطِ مِنْ أَلْيَافِ النَّبَاتَاتِ başardığı belirtiliyor.
Bu nedenle doğru cevap D seçeneğidir.`;

// The printed lines of the passage, as OCR reads them: a few words misread, one lost, one written
// differently in the book (واستخدمها for وَاسْتِخْدَامِهَا), one split in two, الخيوط read as الخبوط.
const PRINTED = [
  'ظهرت الملابس في العصر الحجري القديم أي منذ أكثر',
  'من مائة وخمسين ألف سنة، وكانت الملابس في البداية',
  'مصنوعة من أوراق الاشجار الكبيرة والريش وفراء',
  'وجلود الحيوانات. وفي أواخر العصر الحجرى القديم',
  'تمكن الإنسان من استخلاص الخبوط من ألياف',
  'النباتات واستخدمها في صناعة الملابس. ارتبطت',
  'الملابس بالالوان حتى إنها كانت ترمز لطيقة أو حالة',
  'اجتماعية أو فئة عمرية أو غيرها من التصنيفات، وكثير',
  'من البلدان كانت لها طبقة أو مهنة تتميز بأزيائها.',
  'ونلاحظ هذا في الأزياء الرو مانية والإفريقية والمصرية',
  'القديمة.',
];
const QUESTION = ['يبدو أن البشر قد بدأ بصناعة الملابس المخيطة', 'في بداية العصر الحجري القديم أي منذ آلاف السنين'];

/** Words of one printed line, right to left from `right`, at height `y`. */
function line(text: string, right: number, y: number): OCRWord[] {
  let x = right;
  return text.split(' ').map(w => {
    const width = .008 * w.length + .004;
    x -= width;
    const word = { text: w, confidence: 80, x, y, width, height: .03, pixelX: 0, pixelY: 0, pixelWidth: 0, pixelHeight: 0 };
    x -= .008;
    return word;
  });
}
const passageWords = PRINTED.flatMap((text, i) => line(text, .97, .25 + i * .045)).filter(w => w.text !== 'الحيوانات.');
const questionWords = QUESTION.flatMap((text, i) => line(text, .47, .27 + i * .045));
const picture = [...passageWords, ...questionWords];

test('passage: an Arabic line of ten or more words is a passage; a quoted option is not', () => {
  const passages = findPassages(SOLUTION);
  assert.equal(passages.length, 1);
  assert.equal(SOLUTION.slice(passages[0][0].from, passages[0].at(-1)!.to), PASSAGE.slice(0, -1));
  const inline = findPassages(`Önce paragrafın tamamını okuyalım. ${PASSAGE} Şimdi soruya bakalım.`);
  assert.equal(inline.length, 1, 'a passage on the same line as Turkish is still a passage');
  assert.equal(inline[0].length, passages[0].length);
  assert.ok(wordLikeness('الحجري', 'الحجرى') >= .8 && wordLikeness('واستخدامها', 'واستخدمها') >= .8);
});

test('passage: the picture is read column by column, so the text beside the question stays in one run', () => {
  const { tokens } = readingOrder(picture);
  const first = tokens.findIndex(t => t.norm === 'ظهرت'), last = tokens.findIndex(t => t.norm === 'القديمه');
  assert.ok(first >= 0 && last > first);
  assert.ok(tokens.slice(first, last).every(t => t.word.x > .5), 'no question word inside the passage');
});

test('passage: one underline per printed line, in reading order, each timed by its own words', () => {
  const lines = findPassageMatches(SOLUTION, picture);
  assert.equal(lines.length, PRINTED.length, 'every printed line, despite misread words');
  lines.forEach((l, i) => {
    assert.ok(Math.abs(l.region.y - (.25 + i * .045)) < .01, `line ${i + 1} sits on printed line ${i + 1}`);
    assert.ok(l.region.x > .5, 'on the passage, not the question');
    if (i) assert.match(SOLUTION.slice(lines[i - 1].sourceEnd, l.sourceStart), /^[\s،.]+$/, 'lines follow each other in the text, no word left out');
  });
  assert.equal(lines[0].sourceStart, SOLUTION.indexOf('ظَهَرَتِ'));
  assert.equal(lines.at(-1)!.phrase, 'الْقَدِيمَةِ');
  assert.ok(lines[3].phrase.startsWith('وَجُلُودِ'), 'a word OCR lost still belongs to its line');

  // Narration: every word 0.4 s, the passage from 2 s.
  const spoken = SOLUTION.split(/\s+/).filter(Boolean).map((text, i) => ({ text, start: i * .4, end: i * .4 + .35 }));
  const parsed = parseSolutionSemantics(SOLUTION, lines.map(l => l.region), lines);
  const marks = alignEventsWithNarration(parsed.events, spoken, spoken.at(-1)!.end + 1, SOLUTION)
    .filter(a => a.targetRegionId.startsWith('arabic-passage'));
  assert.equal(marks.length, PRINTED.length);
  marks.forEach((m, i) => {
    if (i) assert.ok(m.start > marks[i - 1].start, 'line after line');
    // Each line only while it is read (and a moment after), like a teacher draws them by hand.
    if (i < marks.length - 1) assert.ok(m.start + m.duration < marks[i + 1].start + 1, 'gone soon after the next line starts');
  });
  // The first line is fully drawn once its words are read, long before the passage ends.
  const firstLineEnd = spoken[5 + 9].end;
  assert.ok(underlineProgress(marks[0], firstLineEnd - marks[0].start + .05) > .99);
  assert.ok(underlineProgress(marks[0], 1) < .4, 'and drawn as it is read');
});

test('passage: shorter phrases skip it while it is read, and a later mention points into it', () => {
  const lines = findPassageMatches(SOLUTION, picture);
  const text = SOLUTION.slice(0, lines[0].sourceStart) + ' '.repeat(lines.at(-1)!.passageEnd - lines[0].sourceStart) + SOLUTION.slice(lines.at(-1)!.passageEnd);
  const exact = findBestArabicMatches(text, picture, [], lines.flatMap(l => l.matchedWords));
  assert.ok(!exact.some(m => m.phrase.includes('الْخُيُوطِ') && m.phrase.includes('النَّبَاتَاتِ')), 'the exact search misses the misread words');
  const others = withPassageReferences(text, exact, lines);
  const mention = others.find(m => m.phrase === 'اِسْتِخْلَاصَ الْخُيُوطِ مِنْ أَلْيَافِ');
  assert.ok(mention && mention.region.x > .5, 'the explanation underlines the passage, where the words are');
  assert.ok(Math.abs(mention.region.y - (.25 + 4 * .045)) < .01, 'on the printed line that holds them');
  assert.ok(others.some(m => m.phrase === 'النَّبَاتَاتِ' && Math.abs(m.region.y - (.25 + 5 * .045)) < .01), 'and its last word on the next line');
  const all = [...lines, ...others];
  const parsed = parseSolutionSemantics(SOLUTION, all.map(m => m.region), all);
  const inside = parsed.events.filter(e => !e.targetRegionId.startsWith('arabic-passage')
    && e.sourceStart! >= lines[0].sourceStart && e.sourceStart! < lines.at(-1)!.passageEnd);
  assert.deepEqual(inside, [], 'nothing else is underlined while the passage is read');
  assert.ok(parsed.events.some(e => e.targetRegionId === mention!.region.id && e.sourceStart! > SOLUTION.indexOf('Parçada')));
});

test('passage: numbered sentences ("I. …", "II. …") are read as one passage, despite a watermark over them', () => {
  const sentences = [
    'مُنْذُ سِنٍّ مُبَكِّرَةٍ، يُفَضِّلُ أَغْلَبُ الْأَطْفَالِ اسْتِهْلَاكَ الْمُنْتَجَاتِ الْمُصَنَّعَةِ.',
    'تُعَدُّ وَجْبَةُ الْإِفْطَارِ أَهَمَّ وَجْبَةٍ فِي الْيَوْمِ.',
    'فَهِيَ الَّتِي تُحَضِّرُ الْجِسْمَ لِيَوْمٍ مَلِيءٍ بِالطَّاقَةِ وَالنَّشَاطِ.',
    'لِذَلِكَ مِنَ الضَّرُورِيِّ أَنْ يَتَنَاوَلَ الْأَطْفَالُ وَجْبَةَ إِفْطَارٍ مُغَذِّيَةً قَبْلَ الذَّهَابِ إِلَى الْمَدْرَسَةِ.',
    'وَيُسَاعِدُ تَنَاوُلُ وَجْبَةِ إِفْطَارٍ مُتَكَامِلَةٍ عَلَى تَلْبِيَةِ احْتِيَاجَاتِ الْأَطْفَالِ مِنَ الطَّاقَةِ.',
  ];
  const text = `Önce cümlelerin tamamını okuyalım:\n${sentences.map((s, i) => `${['I', 'II', 'III', 'IV', 'V'][i]}. ${s}`).join('\n')}\nŞimdi anlam bütünlüğüne bakalım. İkinci cümlede kahvaltının önemi söyleniyor. Doğru cevap A seçeneğidir.`;
  const passages = findPassages(text);
  assert.equal(passages.length, 1, 'the five numbered sentences are one passage');
  assert.equal(passages[0].length, sentences.join(' ').split(/\s+/).length);
  // As printed: sentence numbers inside the lines, a watermark across them (Latin words, some
  // Arabic words broken or misread under it).
  const printed = [
    '(I) منذ سن مبكرة، يفضل أغلب الأطفال استهلاك',
    'المنتجات المصنغة. (II) تعد وجبة الإفطار أهم وجبة في',
    'اليوم. (III) فهي التي تحضر الجسم لبوم مليء بالطاقة',
    'والنشاط، (IV) لذلك من الضرور ي أن يتناول الأطفال',
    'وجبة إفطار مغذية قبل الذهاب إلى المدرسة. (V) ويساعد',
    'تناول وجبة إفطار متكاملة على تلبية احتياجات الأطفال',
    'من الطاقة.',
  ];
  const words = printed.flatMap((row, i) => line(row, .70, .32 + i * .06))
    .concat(line("ÖSYM'nin yazılı izni olmadan", .62, .5), line('A) I B) II C) III D) IV E) V', .66, .74))
    // A watermark stripe read as one many-lines-tall "word".
    .concat([{ text: 'لا', confidence: 40, x: .45, y: .3, width: .04, height: .35, pixelX: 0, pixelY: 0, pixelWidth: 0, pixelHeight: 0 }]);
  const found = findPassageMatches(text, words);
  assert.equal(found.length, printed.length, 'one underline per printed line');
  found.forEach((l, i) => assert.ok(Math.abs(l.region.y - (.32 + i * .06)) < .01, `line ${i + 1} on printed line ${i + 1}`));
  assert.ok(found[1].phrase.includes('الْمُصَنَّعَةِ') && found[1].phrase.includes('فِي'), 'a line spanning two numbered sentences keeps both parts');
});

test('passage: the real Google Vision reading under the ÖSYM watermark gives one underline per printed line, on that line', async () => {
  const { readFileSync } = await import('node:fs');
  const data = JSON.parse(readFileSync(new URL('./fixtures/teshis/numarali-cumleler-filigran.json', import.meta.url), 'utf8'));
  const options = data.regions.filter((r: any) => r.id.startsWith('option-'));
  const inOption = (w: any) => options.some((r: any) => w.x + w.width / 2 >= r.x && w.x + w.width / 2 <= r.x + r.width && w.y + w.height / 2 >= r.y && w.y + w.height / 2 <= r.y + r.height);
  const lines = findPassageMatches(data.solutionText, data.words.filter((w: any) => !inOption(w)));
  // The printed lines of the paragraph, by the words Vision read on them.
  const printed = [.33, .39, .45, .50, .55, .61, .66];
  assert.equal(lines.length, printed.length, 'seven printed lines, seven underlines');
  lines.forEach((l, i) => {
    const bottom = l.region.y + l.region.height;
    assert.ok(Math.abs(l.region.y + l.region.height / 2 - printed[i]) < .025, `line ${i + 1} sits on printed line ${i + 1}`);
    assert.ok(bottom < printed[i] + .045, `line ${i + 1} is drawn under its own words, not the next line (${bottom.toFixed(3)})`);
  });
  const starts = ['مُنْذُ', 'الْمُنْتَجَاتِ', 'الْيَوْمِ', 'وَالنَّشَاطِ', 'وَجْبَةَ', 'تَنَاوُلُ', 'مِنَ'];
  const { normalizeArabic } = await import('../src/services/ocr/arabicMatcher');
  lines.forEach((l, i) => assert.ok(normalizeArabic(l.phrase).startsWith(normalizeArabic(starts[i])), `line ${i + 1} is read from “${starts[i]}”, not “${l.phrase.slice(0, 20)}”`));
});

test('phrases: a three-word-or-longer phrase with a word the reader lost is still found, once, and option quotes are not looked for', async () => {
  const { readFileSync } = await import('node:fs');
  const { findTolerantly, withTolerantPhrases } = await import('../src/services/ocr/passageMatcher');
  const data = JSON.parse(readFileSync(new URL('./fixtures/teshis/numarali-cumleler-filigran.json', import.meta.url), 'utf8'));
  const words = data.words.filter((w: any) => w.y < .7);
  // Vision did not read تحضر: the exact search misses this phrase.
  assert.deepEqual(findBestArabicMatches('الَّتِي تُحَضِّرُ الْجِسْمَ لِيَوْمٍ', words).filter(m => m.phrase.includes('تُحَضِّرُ')), []);
  const found = findTolerantly('الَّتِي تُحَضِّرُ الْجِسْمَ لِيَوْمٍ', words, 't');
  assert.equal(found.length, 1);
  assert.ok(Math.abs(found[0].region.y + found[0].region.height / 2 - .45) < .025, 'on the third printed line');
  const quoted = withTolerantPhrases('C seçeneğinde şöyle deniyor.\nالَّتِي تُحَضِّرُ الْجِسْمَ لِيَوْمٍ', [], words);
  assert.deepEqual(quoted, [], 'a quoted option is not looked for on the text');
  const said = withTolerantPhrases('Burada yani الَّتِي تُحَضِّرُ الْجِسْمَ لِيَوْمٍ deniyor.', [], words);
  assert.equal(said.length, 1);
});

test('a long option read under its letter is underlined line by line even when the reader garbled it', async () => {
  const { optionLineMarks } = await import('../src/services/pipeline/arabicMarks');
  // 2025 YDT 75, option D: the faded second line came out as fragments and Latin letters.
  const row = (texts: string[], y: number): OCRWord[] => texts.map((text, i) => ({ text, confidence: 80, x: .64 - i * .045, y, width: .04, height: .03 }) as OCRWord);
  const words = [
    { text: '\u200eD)\u200f', confidence: 90, x: .3, y: .7, width: .015, height: .03 } as OCRWord,
    ...row(['في', 'أواخر', 'الثمانينيات', 'نشرت', 'في', 'تركيا', 'كتب', 'كثرة'], .7),
    ...row(['I<', 'ب', '|', 'وحياة', 'بي', 'ال', 'يه', 'YİL'], .745),
    ...row(['وملحوظ.'], .79),
  ];
  const option = { id: 'option-d', label: 'D Seçeneği', type: 'option-d', x: .3, y: .695, width: .39, height: .13,
    content: words.map(w => w.text).join(' ') } as never;
  const solution = 'Şıklara bakalım\nD) فِي أَوَاخِرِ الثَّمَانِينِيَّاتِ نُشِرَتْ فِي تُرْكِيَا كُتُبٌ كَثِيرَةٌ مُتَعَلِّقَةٌ بِالتَّنْمِيَةِ الشَّخْصِيَّةِ وَحَيَاةِ الْعَمَلِ بِشَكْلٍ كَثِيفٍ وَمَلْحُوظٍ.\nOlmaz.';
  const marks = optionLineMarks(solution, words, [option]);
  assert.deepEqual(marks.map(m => m.region.id), ['option-d-read-1-line-1', 'option-d-read-1-line-2', 'option-d-read-1-line-3']);
  assert.ok(marks.every(m => m.region.x > .31), 'the letter is not part of a line');
  assert.ok(marks[0].sourceStart! < marks[1].sourceStart! && marks[1].sourceStart! < marks[2].sourceStart!, 'each line is drawn as it is read');
  // A sentence that only ends the option ("C) صَاحَ …: «…». فَانْفَتَحَ …") is not the whole option: not drawn line by line.
  const partial = solution.replace('D) ', 'D) صَاحَ أَحَدُ اللُّصُوصِ: "أَغْلِقْ يَا سِمْسِمُ". ');
  assert.ok(!optionLineMarks(partial, words, [option]).some(m => m.region.id.endsWith('-line-3')));
});
