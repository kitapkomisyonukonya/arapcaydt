import test from 'node:test';
import assert from 'node:assert/strict';
import { addMark, drawnRegion, placeFromStroke, snapToText, stampAt, optionBeside, LINE_BOX } from '../src/features/video/PreviewEditOverlay';
import { tapMark } from '../src/features/video/MarkTimeline';
import { computeTimelineVisualState } from '../src/features/video/engine/timeline';
import type { AnnotationRegion, VideoAction } from '../src/types';

const fit = { x: 0, y: 0, width: 1000, height: 1000 };
const phrase = (id: string, x: number, y: number, width: number, height = .04) =>
  ({ id, type: 'phrase', label: id, content: id, x, y, width, height }) as AnnotationRegion;

test('alt çizgi: a flat drag becomes a line under one text line, dropped near text it sits exactly under it', () => {
  // Dragged right-to-left at y .505, a little under a printed line whose box ends at .50.
  const stroke = drawnRegion('drawing', .6, .505, .3, .505);
  const place = placeFromStroke(stroke, 'underline', fit, .04)!;
  assert.ok(place, 'a flat stroke is a line, not a stray click');
  assert.ok(Math.abs(place.y + place.height / 2 - .505) < 1e-9, 'the line is where it was drawn');
  assert.deepEqual([place.height, place.shape], [LINE_BOX, 'line'], 'a line is a thin box of its own, not a text-line box');
  const snapped = snapToText(place, [phrase('line', .2, .46, .5)], .04);
  assert.ok(Math.abs(snapped.y + snapped.height / 2 - .504) < 1e-9 && snapped.height === LINE_BOX, 'dropped close under text, it sits just under that line');
  const far = snapToText(place, [phrase('other', .2, .30, .5)], .04);
  assert.equal(far.y, place.y, 'far from any text it stays where it was drawn');
  const aside = snapToText(place, [phrase('aside', .8, .46, .1)], .04);
  assert.equal(aside.y, place.y, 'text beside the line (not over it) is not used');
  assert.equal(placeFromStroke(drawnRegion('d', .5, .5, .5005, .5), 'underline', fit, .04), null, 'a click is not a line');
});

test('şimdi: first tap starts the mark, the second ends it; a cross only starts', () => {
  const line = { id: 'u', type: 'underline', targetRegionId: 'r', start: 2, duration: 2 } as VideoAction;
  const started = tapMark(line, 5, 30, 'start');
  assert.deepEqual([started.start, started.duration], [5, 2]);
  const ended = tapMark(started, 8.5, 30, 'end');
  assert.deepEqual([ended.start, ended.duration], [5, 3.5]);
  assert.equal(tapMark(started, 5.1, 30, 'end').duration, .3, 'never shorter than the shortest mark');
  const cross = { id: 'x', type: 'reject', targetRegionId: 'option-a', start: 1, duration: 29 } as VideoAction;
  assert.equal(tapMark(cross, 6, 30, 'end').start, 6, 'a cross only moves its start');
});

test('daire and direction: a ring is drawn in and kept; a left-to-right line flows left-to-right', () => {
  const marks = addMark([], 'box', 'circle', 3, 30);
  assert.deepEqual([marks[0].type, marks[0].duration], ['circle', 2.5]);
  const early = computeTimelineVisualState(3.3, marks, []);
  assert.equal(early.activeCircles.length, 1);
  assert.ok(early.activeCircles[0].progress > .4 && early.activeCircles[0].progress < .6, 'half drawn after 0.3 s');
  assert.equal(computeTimelineVisualState(4.5, marks, []).activeCircles[0].progress, 1);
  assert.equal(computeTimelineVisualState(6, marks, []).activeCircles.length, 0, 'gone after its time');
  const line = { id: 'u', type: 'underline', targetRegionId: 'r', start: 0, duration: 2 } as VideoAction;
  assert.equal(computeTimelineVisualState(1, [line], []).activeUnderlines[0].isRtl, true, 'Arabic default: right-to-left');
  assert.equal(computeTimelineVisualState(1, [{ ...line, fromLeft: true }], []).activeUnderlines[0].isRtl, false);
});

test('an option read aloud ("A) …") is not underlined where the same words stand in the passage', async () => {
  const { isOptionQuote } = await import('../src/services/pipeline/arabicMarks');
  const sentence = 'تعتمد الطيور المهاجرة على المجال المغناطيسي';
  const options = [{ content: `A) ${sentence} للأرض وحده` }];
  assert.equal(isOptionQuote(`Şıkları okuyalım:\nA) ${sentence} للأرض وحده.`, sentence, options), true, 'read as option A');
  assert.equal(isOptionQuote(`A şıkkı: ${sentence}.`, sentence, options), true);
  assert.equal(isOptionQuote(`Yani ${sentence} deniyor.`, sentence, options), true, 'mostly option A’s own text, not tied to the passage');
  assert.equal(isOptionQuote(`Parçada açıkça ${sentence} deniyor.`, sentence, options), false, 'pointed at the passage: underlined there');
  assert.equal(isOptionQuote(`Yani الطيور المهاجرة deniyor.`, 'الطيور المهاجرة', options), false, 'a short phrase is looked for as usual');
  assert.equal(isOptionQuote(`Bunu ve ${sentence}.`, sentence, []), false, 'no options known: nothing is skipped');
});

test('a coloured underline is drawn in its own colour; the default stays the studio orange', () => {
  const line = { id: 'u', type: 'underline', targetRegionId: 'r', start: 0, duration: 2 } as VideoAction;
  assert.equal(computeTimelineVisualState(1, [line], []).activeUnderlines[0].color, undefined);
  assert.equal(computeTimelineVisualState(1, [{ ...line, color: '#2563EB' }], []).activeUnderlines[0].color, '#2563EB');
});

test('long options read aloud are underlined in the option, line by line, timed by where each line is read', async () => {
  const { optionReadAt } = await import('../src/services/pipeline/arabicMarks');
  const text = 'Şimdi seçeneklere bakalım.\nA seçeneğinde şöyle deniyor:\nبدأ الأموريون بعد انفصالهم\nB) كانت المناطق';
  assert.equal(optionReadAt(text, text.indexOf('بدأ')), 'A', 'named on the line above');
  assert.equal(optionReadAt(text, text.indexOf('كانت')), 'B', '"B)" on the same line');
  assert.equal(optionReadAt('Parçada şöyle deniyor:\nبدأ', 'Parçada şöyle deniyor:\n'.length), null);
});

test('✗ and ✓ are stamps put where clicked; a ring drawn by hand fills its place', async () => {
  const fit = { x: 0, y: 0, width: 1000, height: 500 };
  const stamp = stampAt('s', .4, .5, fit, 44);
  assert.equal(stamp.shape, 'stamp');
  assert.ok(Math.abs(stamp.x + stamp.width / 2 - .4) < 1e-9 && Math.abs(stamp.y + stamp.height / 2 - .5) < 1e-9, 'centred on the click');
  assert.ok(Math.abs(stamp.width * fit.width - stamp.height * fit.height) < 1e-9, 'round on screen');
  const corner = stampAt('c', 0, 1, fit, 44);
  assert.ok(corner.x >= 0 && corner.y + corner.height <= 1, 'kept on the picture');
});

test('a ✗ / ✓ clicked on an option letter just outside its box judges that option', () => {
  // TTKB-AYT-DENEME-5-36: the boxes start after the letters, the teacher clicked beside "D)".
  const box = (id: string, x: number, y: number, width: number, height: number) => ({ id, type: id as 'option-d', label: id, x, y, width, height });
  const regions = [box('option-a', .107, .467, .341, .086), box('option-d', .5245, .498, .316, .083), box('option-e', .5245, .588, .354, .125)];
  const reach = 66 / 1920;
  assert.equal(optionBeside(.507, .514, regions, reach), 'option-d');
  assert.equal(optionBeside(.507, .6, regions, reach), 'option-e');
  assert.equal(optionBeside(.3, .3, regions, reach), null, 'far from every option: a stamp');
  assert.equal(optionBeside(.507, .45, regions, reach), null, 'above the row');
});
