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
