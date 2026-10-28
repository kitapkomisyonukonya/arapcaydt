import test from 'node:test';
import assert from 'node:assert/strict';
import { detectYdtQuestionRegions } from '../src/services/ocr/ydtQuestionDetector';
import { emptyOptionCrops } from '../src/services/ocr/markerRecovery';
import type { OCRWord } from '../src/services/ocr/ocrTypes';

const word = (text: string, x: number, y: number, width = .05, height = .04): OCRWord =>
  ({ text, confidence: 92, x, y, width, height, pixelX: x * 2400, pixelY: y * 1350, pixelWidth: width * 2400, pixelHeight: height * 1350 });

// 2019 YDT question 8 as read: an instruction box and a two-line stem above, options in a grid
// (A B / C D / E). The right-hand options reach past the left ones' edge by design.
const page = [
  word('sorularda,', .30, .10, .1), word('yerlere', .55, .10, .08), word('uygun', .25, .17, .07), word('ifadeyi', .56, .17, .08),
  word('الماء', .24, .22), word('لكي', .35, .22, .04), word('التفرع', .40, .22, .1), word('جذور', .72, .22, .06),
  word('التربة.', .54, .29, .06), word('القليل', .73, .29),
  word('A)', .24, .415, .02), word('إلى', .27, .418, .03), word('تفتقر', .31, .42, .045),
  word('B)', .525, .415, .02), word('ب', .551, .435, .015, .028), word('تحيط', .572, .417, .051),
  word('C)', .24, .52, .02), word('على', .27, .523, .039), word('تزيد', .32, .529, .039),
  word('D)', .525, .52, .02), word('ب', .545, .528, .02), word('ترتحل', .575, .523, .062),
  word('E)', .397, .628, .02), word('على', .423, .631, .039), word('تحصل', .473, .631, .066),
];

test('Grid options: the right-hand column keeps its words', () => {
  const regions = detectYdtQuestionRegions({ words: page, lines: [], text: '', imageWidth: 2400, imageHeight: 1350 }).regions;
  for (const [id, text] of [['option-b', 'تحيط'], ['option-d', 'ترتحل']]) {
    const box = regions.find(r => r.id === id)!;
    assert.ok(box.content?.includes(text), `${id}: ${box.content}`);
    assert.ok(box.x + box.width > .62, `${id} reaches its last word`);
  }
  assert.deepEqual(emptyOptionCrops(regions, 2400, 1350), [], 'nothing to read again');
});

test('Grid options the page reading skipped are read again beside their label', () => {
  const unread = page.filter(w => !['تحيط', 'ب'].includes(w.text) || w.x < .5);
  const regions = detectYdtQuestionRegions({ words: unread, lines: [], text: '', imageWidth: 2400, imageHeight: 1350 }).regions;
  const crops = emptyOptionCrops(regions, 2400, 1350);
  assert.deepEqual(crops.map(c => c.id), ['option-b']);
  const r = crops[0].rectangle;
  // From the label to one column step on (B is the last in its row), on B's row only.
  assert.ok(r.left < .55 * 2400 && r.left > .52 * 2400 && r.left + r.width > .62 * 2400, JSON.stringify(r));
  assert.ok(r.top < .415 * 1350 && r.top + r.height > .455 * 1350 && r.top + r.height < .52 * 1350, JSON.stringify(r));
});

test('Options in one column are never read again', () => {
  const column = [word('A)', .1, .3, .02), word('B)', .1, .4, .02), word('C)', .1, .5, .02)];
  const regions = detectYdtQuestionRegions({ words: column, lines: [], text: '', imageWidth: 2400, imageHeight: 1350 }).regions;
  assert.deepEqual(emptyOptionCrops(regions, 2400, 1350), []);
});

// Çıkmış soru 55 (Rabia Hoca): short Arabic options sit at the right of their line, far from "A)".
import shortArabic from './fixtures/kisa-arapca-sik-ocr.json';

test('a short Arabic option in one column takes its text from the right, not just its label', () => {
  const options = detectYdtQuestionRegions(shortArabic as any).regions.filter(r => /^option-[a-e]$/.test(r.id));
  assert.equal(options.length, 5);
  for (const option of options) assert.ok(option.width > .45, `${option.id} covers its text (${option.content})`);
  assert.match(options[0].content!, /والكلاب/);
  assert.match(options[2].content!, /إفريقيا/);
  assert.ok(!/الشوارع/.test(options[0].content!) && !/المنزل/.test(options[3].content!), 'each keeps to its own row');
});

// Çıkmış soru 40: the page reading has its own copy of each label ("‎D)‏") beside the marker.
import labelCopy from './fixtures/kisa-arapca-sik-etiket-ocr.json';

test('the page reading\'s own copy of a label does not stand in for a short Arabic option\'s text', () => {
  const options = detectYdtQuestionRegions(labelCopy as any).regions.filter(r => /^option-[a-e]$/.test(r.id));
  assert.equal(options.length, 5);
  for (const option of options) assert.ok(option.width > .4, `${option.id} covers its text (${option.content})`);
  assert.match(options[0].content!, /بغداد/);
  assert.match(options[4].content!, /المكتوبة/);
});

test('a page footer under the last Arabic option is not its second line', () => {
  // Çıkmış soru 61: "2021 – YDT / ARAPÇA" printed right under option E.
  const rows = ['A', 'B', 'C', 'D', 'E'].flatMap((l, i) => [word(`${l})`, .15, .3 + i * .09, .02, .035),
    word('البلدان.', .2, .3 + i * .09, .06), word('بعض', .27, .3 + i * .09, .04), word('في', .32, .3 + i * .09, .02), word('رياضة', .35, .3 + i * .09, .05)]);
  const footer = [word('2021', .25, .705, .04, .035), word('–', .3, .705, .01, .035), word('YDT', .32, .705, .04, .035), word('ARAPÇA', .37, .705, .07, .035)];
  const e = detectYdtQuestionRegions({ words: [...rows, ...footer], lines: [], text: '', imageWidth: 2400, imageHeight: 1350 }).regions.find(r => r.id === 'option-e')!;
  assert.ok(!/ARAPÇA|2021/.test(e.content!), e.content);
});

test('a lone misread word on an Arabic option\'s second line still makes it two lines', () => {
  // Çıkmış soru 38: the second line of A was read only as "PRY".
  const rows = ['A', 'B', 'C', 'D', 'E'].flatMap((l, i) => [word(`${l})`, .15, .3 + i * .12, .02, .035),
    word('البلدان.', .2, .3 + i * .12, .06), word('بعض', .27, .3 + i * .12, .04), word('في', .32, .3 + i * .12, .02), word('رياضة', .35, .3 + i * .12, .05)]);
  const a = detectYdtQuestionRegions({ words: [...rows, word('‎PRY‏', .3, .345, .04, .045)], lines: [], text: '', imageWidth: 2400, imageHeight: 1350 }).regions.find(r => r.id === 'option-a')!;
  assert.ok(a.y + a.height > .38, `${a.y + a.height}`);
});

// Çıkmış soru 34: the passage is printed beside the options, starting level with the stem, and the
// gap between B's text and the passage is narrower than the gutter.
import passageBeside from './fixtures/sik-yaninda-parca-ocr.json';

test('an option box stops at the option column when a passage starts level with the stem beside it', () => {
  const options = detectYdtQuestionRegions(passageBeside as any).regions.filter(r => /^option-[a-e]$/.test(r.id));
  assert.equal(options.length, 5);
  for (const option of options) assert.ok(option.x + option.width < .48, `${option.id} stays in the column (${option.content})`);
  const b = options[1];
  assert.match(b.content!, /وحقائق/);
  assert.ok(!/القصص|العادات/.test(b.content!), b.content);
});

test('the last option leaves the passage lines beside and below it out of its box', () => {
  // Çıkmış soru 33 (screenshot): E's box ran across the passage's last two lines.
  const passageLine = (y: number) => [word('من', .55, y, .03), word('عجائب', .59, y, .06), word('الأسفار', .66, y, .07), word('بصدق،', .74, y, .06), word('لذلك', .81, y, .05), word('أطلق', .87, y, .05)];
  const rows = ['A', 'B', 'C', 'D', 'E'].flatMap((l, i) => [word(`${l})`, .07, .3 + i * .08, .02, .035),
    word('كان', .25, .3 + i * .08, .04), word('يشتاق', .3, .3 + i * .08, .06), word('إلى', .37, .3 + i * .08, .03), word('المعرفة', .41, .3 + i * .08, .07),
    ...passageLine(.3 + i * .08)]);
  // E is long enough to start near its label, so the reading runs on across the narrow gap.
  const e1 = [word('لأنه', .11, .62, .05), word('كان', .17, .62, .04), word('دائما', .22, .62, .05)];
  const words = [word('لقد', .3, .2, .04), word('أطلق', .35, .2, .05), ...passageLine(.2), ...passageLine(.25), ...rows, ...e1, word('الأمين).', .85, .675, .1)];
  const e = detectYdtQuestionRegions({ words, lines: [], text: '', imageWidth: 2400, imageHeight: 1350 }).regions.find(r => r.id === 'option-e')!;
  assert.ok(e.x + e.width < .5, `width ${e.x + e.width}`);
  assert.ok(e.y + e.height < .67, `bottom ${e.y + e.height}`);
  assert.match(e.content!, /المعرفة/);
});
