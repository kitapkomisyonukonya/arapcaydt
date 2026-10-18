import test from 'node:test';
import assert from 'node:assert/strict';
import { addMark, arrowFromStroke, flipUnderlines, noteAt, recolor, revertToAuto } from '../src/features/video/PreviewEditOverlay';
import { computeTimelineVisualState } from '../src/features/video/engine/timeline';
import { applyRegionEdits } from '../src/services/analysis/regionEdits';
import type { AnnotationRegion, VideoAction, VideoConfig } from '../src/types';

const fit = { x: 0, y: 0, width: 1000, height: 1000 };

test('ok: a drag from tail to head becomes a box with its ends; a flat drag still has a box to grab', () => {
  const up = arrowFromStroke('a', .6, .5, .3, .2, fit)!;
  assert.deepEqual([up.x, up.y, up.width, up.height].map(v => +v.toFixed(3)), [.3, .2, .3, .3]);
  assert.deepEqual(up.arrow, { x1: 1, y1: 1, x2: 0, y2: 0 }, 'tail bottom-right, head top-left');
  const flat = arrowFromStroke('b', .2, .5, .5, .5, fit)!;
  assert.ok(flat.height * fit.height >= 28);
  assert.deepEqual(flat.arrow, { x1: 0, y1: .5, x2: 1, y2: .5 });
  assert.equal(arrowFromStroke('c', .2, .5, .21, .5, fit), null, 'a click is not an arrow');
});

test('yazı: a click puts a short note there; a dragged area becomes the note', () => {
  const click = noteAt('n', .5, .5, fit, 1);
  assert.equal(click.shape, 'note');
  assert.equal(click.text, 'Not');
  assert.ok(Math.abs(click.x + click.width / 2 - .5) < 1e-9);
  const dragged = noteAt('n', .1, .1, fit, 1, { id: 'drawing', type: 'keyword', label: '', x: .1, y: .1, width: .3, height: .05 });
  assert.deepEqual([dragged.x, dragged.width], [.1, .3]);
});

test('arrow and note marks are drawn while on screen, in the teacher’s colour', () => {
  const regions = [arrowFromStroke('a', .1, .1, .4, .1, fit)!, noteAt('n', .5, .5, fit, 1)];
  const actions = recolor([...addMark([], 'a', 'arrow', 1, 10), ...addMark([], 'n', 'note', 1, 10)], 'a', '#16A34A');
  const at = computeTimelineVisualState(1.25, actions, regions);
  assert.equal(at.activeArrows.length, 1);
  assert.equal(at.activeArrows[0].color, '#16A34A');
  assert.ok(at.activeArrows[0].progress > 0 && at.activeArrows[0].progress < 1, 'the arrow is still growing');
  assert.equal(at.activeNotes[0].progress, 1);
  assert.equal(computeTimelineVisualState(9, actions, regions).activeArrows.length, 0, 'gone after its time');
  assert.equal(recolor(actions, 'a', '#000').find(a => a.targetRegionId === 'n')!.color, undefined, 'another box keeps its colour');
});

test('otomatiğe döndür: a moved found box remembers where it was found and goes back there', () => {
  const found: AnnotationRegion = { id: 'option-b', type: 'option-b', label: 'B', x: .1, y: .2, width: .3, height: .05 };
  const config = { regions: [found], timelineActions: [] } as unknown as VideoConfig;
  const moved = applyRegionEdits(config, [{ ...found, x: .15 }], '', [], 10);
  const box = moved.regions![0];
  assert.equal(box.manuallyAdjusted, true);
  assert.deepEqual(box.auto, { x: .1, y: .2, width: .3, height: .05 });
  const again = applyRegionEdits(moved, [{ ...box, width: .4 }], '', [], 10).regions![0];
  assert.deepEqual(again.auto, box.auto, 'the first found place is kept');
  const back = applyRegionEdits(moved, [revertToAuto(again)], '', [], 10).regions![0];
  assert.deepEqual([back.x, back.width, back.manuallyAdjusted, back.auto], [.1, .3, undefined, undefined]);
  const drawn = applyRegionEdits(config, [found, { ...noteAt('n', .5, .5, fit, 1) }], '', [], 10).regions![1];
  assert.equal(drawn.auto, undefined, 'a teacher’s own mark has nothing to go back to');
});

test('çizgi yönü: a box’s underlines turn between right-to-left and left-to-right; other marks stay', () => {
  const marks = [
    { id: 'u', type: 'underline' as const, targetRegionId: 'r', start: 1, duration: 2 },
    { id: 'c', type: 'circle' as const, targetRegionId: 'r', start: 1, duration: 2 },
    { id: 'o', type: 'underline' as const, targetRegionId: 'other', start: 1, duration: 2 },
  ];
  const once = flipUnderlines(marks, 'r');
  assert.deepEqual(once.map(m => m.fromLeft), [true, undefined, undefined]);
  assert.equal(computeTimelineVisualState(1.5, once, []).activeUnderlines.find(u => u.regionId === 'r')?.isRtl, false);
  assert.deepEqual(flipUnderlines(once, 'r')[0], marks[0], 'back to right to left');
});

test('vurgu (konu anlatımı): a highlighter stroke crosses its line as it is said, and turns like an underline', () => {
  const pen: VideoAction = { id: 'h', type: 'highlight', targetRegionId: 'r', start: 1, duration: 6, drawSteps: [{ at: 2, to: 1 }] };
  const at = (t: number, marks: VideoAction[] = [pen]) => computeTimelineVisualState(t, marks, []).activeHighlights[0];
  assert.deepEqual([at(2).progress, at(3).progress, at(5).progress], [.5, 1, 1], 'across the line in its own 2 s, then held');
  assert.equal(at(2).isRtl, true, 'right to left unless drawn from the left');
  assert.deepEqual(flipUnderlines([pen], 'r'), [pen], 'questions: a highlight has no direction');
  assert.equal(at(2, flipUnderlines([pen], 'r', true)).isRtl, false, 'slides: it turns');
});
