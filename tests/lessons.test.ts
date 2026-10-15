import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FADE_SECONDS, GAP_SECONDS, LEAD_SECONDS, TAIL_SECONDS, fitInside, joinVoices, lessonFileName, lessonTimeline, naturalOrder,
  slideAt, slideState, slidesToVoice, storedLesson, wavBytes, type Lesson, type LessonSlide,
} from '../src/features/lessons/lessonPlan';
import { exportEntries, orphans, referencedPaths, type StoredObject } from '../server/storage';
import { pageHash, parseHash } from '../src/layouts/route';

const slide = (id: string, text: string, audio?: Partial<NonNullable<LessonSlide['audio']>>): LessonSlide => ({
  id, imagePath: `t/l/${id}.webp`, imageUrl: `https://signed/${id}`, width: 1920, height: 1080, text,
  ...(audio ? { audio: { path: `t/l/${id}.mp3`, url: `https://signed/${id}.mp3`, duration: 5, spokenText: text, source: 'gemini', ...audio } } : {}),
});

test('Konu Anlatımı: a slide says what it still needs; only voiceable slides are voiced in a row', () => {
  assert.equal(slideState(slide('a', '')), 'no-text');
  assert.equal(slideState(slide('a', 'Metin')), 'no-voice');
  assert.equal(slideState(slide('a', 'Metin', {})), 'ready');
  assert.equal(slideState({ ...slide('a', 'Metin', {}), text: 'Metin değişti' }), 'old-voice', 'text changed after the voice');
  assert.equal(slideState({ ...slide('a', 'Metin  ', {}) }), 'ready', 'spaces at the ends do not count as a change');
  assert.equal(slideState({ ...slide('a', 'x', { source: 'upload', spokenText: '' }), text: 'yeni' }), 'ready', 'an uploaded recording is the teacher’s own: never “old”');
  const slides = [slide('a', ''), slide('b', 'B'), slide('c', 'C', {}), { ...slide('d', 'D', {}), text: 'D2' }];
  assert.deepEqual(slidesToVoice(slides), [1, 3]);
});

test('Konu Anlatımı: picture files keep the teacher’s numbering (Slayt2 before Slayt10)', () => {
  const names = ['Slayt10.png', 'slayt2.png', 'Slayt1.png', 'Slayt11.jpg', 'Slayt3.png'].map(name => ({ name }));
  assert.deepEqual(naturalOrder(names).map(f => f.name), ['Slayt1.png', 'slayt2.png', 'Slayt3.png', 'Slayt10.png', 'Slayt11.jpg']);
});

test('Konu Anlatımı: each voice has its place; the picture changes in the middle of the pause', () => {
  const t = lessonTimeline([4, 2.5, 3]);
  assert.deepEqual(t.spans.map(s => [s.start, s.end]), [
    [LEAD_SECONDS, LEAD_SECONDS + 4],
    [LEAD_SECONDS + 4 + GAP_SECONDS, LEAD_SECONDS + 6.5 + GAP_SECONDS],
    [LEAD_SECONDS + 6.5 + 2 * GAP_SECONDS, LEAD_SECONDS + 9.5 + 2 * GAP_SECONDS],
  ]);
  assert.equal(t.total, LEAD_SECONDS + 9.5 + 2 * GAP_SECONDS + TAIL_SECONDS);
  assert.deepEqual(lessonTimeline([]), { spans: [], total: 0 });

  // Every voiced moment shows its own slide, alone.
  for (const [i, span] of t.spans.entries()) for (const at of [span.start, (span.start + span.end) / 2, span.end - 0.01])
    assert.deepEqual(slideAt(t, at), { index: i, mix: 0 }, `slide ${i + 1} at ${at}`);
  const cut = (t.spans[0].end + t.spans[1].start) / 2;
  const middle = slideAt(t, cut);
  assert.equal(middle.index, 0); assert.equal(middle.next, 1); assert.ok(Math.abs(middle.mix - 0.5) < 1e-9);
  assert.deepEqual(slideAt(t, cut + FADE_SECONDS), { index: 1, mix: 0 });
  assert.deepEqual(slideAt(t, t.total + 5), { index: 2, mix: 0 }, 'the last slide stays to the end');
  assert.ok(FADE_SECONDS < GAP_SECONDS, 'the change never overlaps a voice');
});

test('Konu Anlatımı: the joined track puts each voice at its start and silence between', () => {
  const rate = 100;
  const voices = [new Float32Array(200).fill(0.5), new Float32Array(100).fill(-0.25)];
  const joined = joinVoices(voices, rate);
  const t = lessonTimeline([2, 1]);
  assert.equal(joined.length, Math.ceil(t.total * rate));
  const a = Math.round(t.spans[0].start * rate), b = Math.round(t.spans[1].start * rate);
  assert.equal(joined[a - 1], 0); assert.equal(joined[a], 0.5); assert.equal(joined[a + 199], 0.5); assert.equal(joined[a + 200], 0);
  assert.equal(joined[b - 1], 0); assert.equal(joined[b], -0.25); assert.equal(joined[b + 99], -0.25); assert.equal(joined[b + 100], 0);

  const wav = wavBytes(new Float32Array([0, 1, -1, 2]), 24000);
  const view = new DataView(wav.buffer);
  assert.equal(new TextDecoder().decode(wav.slice(0, 4)), 'RIFF');
  assert.equal(view.getUint32(24, true), 24000);
  assert.equal(view.getUint32(40, true), 8);
  assert.deepEqual([1, 2, 3, 4].map(i => view.getInt16(42 + i * 2, true)), [0, 32767, -32767, 32767], 'loud samples are clipped, not wrapped');
});

test('Konu Anlatımı: slides fill the 16:9 frame without being cut; 4:3 slides get white sides', () => {
  assert.deepEqual(fitInside(1920, 1080, 1920, 1080), { x: 0, y: 0, width: 1920, height: 1080 });
  assert.deepEqual(fitInside(1440, 1080, 1920, 1080), { x: 240, y: 0, width: 1440, height: 1080 });
  assert.deepEqual(fitInside(1920, 1440, 1920, 1080), { x: 240, y: 0, width: 1440, height: 1080 });
});

test('Konu Anlatımı: stored without playback links; the file name comes from the title', () => {
  const lesson: Lesson = { id: 'l', kind: 'lesson', title: 'Mübteda ve haber', slides: [slide('a', 'A', {}), slide('b', '')], createdAt: '', updatedAt: '' };
  const stored = storedLesson(lesson);
  assert.equal(stored.kind, 'lesson');
  assert.deepEqual(stored.slides[0], { id: 'a', imagePath: 't/l/a.webp', width: 1920, height: 1080, text: 'A',
    audio: { path: 't/l/a.mp3', duration: 5, spokenText: 'A', source: 'gemini' } });
  assert.ok(!('audio' in stored.slides[1]));
  assert.ok(!JSON.stringify(stored).includes('https://signed'));
  assert.equal(lessonFileName('Mübteda ve haber'), 'Mübteda_ve_haber_1080p.mp4');
  assert.equal(lessonFileName('  '), 'konu_anlatimi_1080p.mp4');
});

test('Konu Anlatımı: its slide pictures and voices are never swept as unused files', () => {
  const old = '2020-01-01T00:00:00Z';
  const objects: StoredObject[] = ['t/l/a.webp', 't/l/a.mp3', 't/l/b.webp', 't/l/eski.webp'].map(name => ({ name, bytes: 10, mimetype: null, created_at: old }));
  const rows = [{ id: 'l', owner_id: 't', title: 'Konu', slides: storedLesson({ id: 'l', kind: 'lesson', title: 'Konu', slides: [slide('a', 'A', {}), slide('b', '')], createdAt: '', updatedAt: '' }).slides }];
  assert.deepEqual([...referencedPaths(rows)].sort(), ['t/l/a.mp3', 't/l/a.webp', 't/l/b.webp']);
  assert.deepEqual(orphans(objects, referencedPaths(rows)).map(o => o.name), ['t/l/eski.webp']);
  assert.deepEqual(exportEntries(objects, rows, []).map(e => [e.path, e.use, e.projectId]), [
    ['t/l/a.webp', 'image', 'l'], ['t/l/a.mp3', 'audio', 'l'], ['t/l/b.webp', 'image', 'l'], ['t/l/eski.webp', 'unused', null],
  ]);
  assert.deepEqual([...referencedPaths([{ id: 'q', owner_id: 't', slides: 'bozuk' }])], [], 'a broken slides field is ignored');
});

test('Konu Anlatımı: its own address, and the open lesson survives a reload', () => {
  assert.equal(pageHash('lessons'), '#/konu');
  assert.equal(parseHash('#/konu').page, 'lessons');
  assert.equal(pageHash('lessons', 'abc-1'), '#/konu/abc-1');
  assert.deepEqual(parseHash('#/konu/abc-1'), { page: 'lessons', lessonId: 'abc-1' });
});
