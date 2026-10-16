import test from 'node:test';
import assert from 'node:assert/strict';
import { SUMMARY_SELECT, imageAssetPath, summaryFromRow, toSummary } from '../src/features/projects/projectSummary';
import { resumeStep } from '../src/features/question-editor/workflow';
import type { QuestionProject } from '../src/types';

const full: QuestionProject = {
  id: 'p1', ownerId: 't1', createdAt: '2026-09-01T10:00:00Z', updatedAt: '2026-09-30T10:00:00Z',
  title: 'Soru 3', examYear: '2026', examName: 'YDT', questionNumber: 3, category: 'soru-coz', correctAnswer: 'D', status: 'audio_approved',
  imageUrl: 'https://signed/img', imageFileName: 'soru3.png', arabicQuestionSnippet: 'هذا', solutionText: 'Doğru cevap D.',
  audioApproved: true, videoReady: false,
  narrationSource: { type: 'gemini', audioUrl: 'https://signed/a.mp3', duration: 42.5, isApproved: true, words: [{ text: 'x', start: 0, end: 1 }] as any },
  audioNarration: { audioUrl: 'https://signed/a.mp3', duration: 42.5, isApproved: true, voiceId: 'v', voiceName: 'v', modelId: 'm', generatedAt: '', mode: 'live' },
  videoConfig: { aspectRatio: '16:9', fps: 30, backgroundColor: '#fff', showWatermark: true, annotations: [], captions: [{ text: 'x' }] as any } as any,
};

test('the list query reads only light fields, never words, captions or the animation plan', () => {
  for (const heavy of ['words', 'captions', 'timelineActions', 'regions', 'videoConfig', 'alignment', 'audioUrl'])
    assert.ok(!SUMMARY_SELECT.includes(heavy), heavy);
  assert.ok(!SUMMARY_SELECT.split(',').includes('data'), 'never the whole JSON');
});

test('a list row becomes a summary with a signed thumbnail and safe defaults', () => {
  const row = {
    id: 'p1', owner_id: 't1', created_at: full.createdAt, updated_at: full.updatedAt, title: 'Soru 3', examYear: '2026', examName: 'YDT',
    questionNumber: 3, category: 'soru-coz', correctAnswer: 'D', status: 'audio_approved', audioApproved: true, videoReady: false,
    imageUrl: { assetPath: 't1/p1/img' }, imageFileName: 'soru3.png', arabicQuestionSnippet: 'هذا', solutionText: 'Doğru cevap D.',
    nsType: 'gemini', nsApproved: true, nsDuration: 42.5, anApproved: true, anDuration: 42.5,
  };
  const s = summaryFromRow(row, new Map([['t1/p1/img', 'https://signed/img']]));
  assert.deepEqual(s, toSummary(full));
  // Missing JSON fields (older projects) never crash a list.
  const bare = summaryFromRow({ id: 'p2', owner_id: 't1', created_at: '', updated_at: '', imageUrl: null, correctAnswer: 'Z' }, new Map());
  assert.equal(bare.title, '');
  assert.equal(bare.solutionText, '');
  assert.equal(bare.correctAnswer, 'A');
  assert.equal(bare.status, 'draft');
  assert.equal(bare.imageUrl, '');
  assert.equal(bare.narrationSource, undefined);
  // Inline sample SVGs and legacy URLs stay as stored.
  assert.equal(summaryFromRow({ ...row, imageUrl: 'data:image/svg+xml;utf8,<svg/>' }, new Map()).imageUrl, 'data:image/svg+xml;utf8,<svg/>');
  assert.equal(imageAssetPath({ assetPath: 'a/b' }), 'a/b');
  assert.equal(imageAssetPath('https://x'), null);
});

test('a summary resumes at the same editor step as the full project', () => {
  const variants: Array<Partial<QuestionProject>> = [
    { imageUrl: '' }, { solutionText: '  ' }, { audioApproved: false, narrationSource: { ...full.narrationSource!, isApproved: false }, audioNarration: { ...full.audioNarration!, isApproved: false } },
    {}, { videoReady: true },
  ];
  for (const v of variants) {
    const p = { ...full, ...v };
    assert.equal(resumeStep(toSummary(p)), resumeStep(p), JSON.stringify(v));
  }
  assert.deepEqual([0, 1, 2, 3, 4], variants.map(v => resumeStep(toSummary({ ...full, ...v }))));
});

test('a summary keeps no heavy data', () => {
  const s = toSummary(full) as any;
  assert.equal(s.videoConfig, undefined);
  assert.equal(s.narrationSource.words, undefined);
  assert.equal(s.narrationSource.audioUrl, undefined);
  assert.ok(JSON.stringify(s).length < JSON.stringify(full).length);
});

test('earlier collection names are offered most recent first, each once', async () => {
  const { recentCollections } = await import('../src/features/projects/CollectionInput');
  assert.deepEqual(recentCollections([
    { examName: 'Eylül Denemesi 1', updatedAt: '2026-09-20T10:00:00Z' },
    { examName: ' Ekim Denemesi ', updatedAt: '2026-09-28T10:00:00Z' },
    { examName: 'Eylül Denemesi 1', updatedAt: '2026-09-29T08:00:00Z' },
    { examName: '', updatedAt: '2026-09-29T09:00:00Z' },
    { updatedAt: '2026-09-29T09:00:00Z' },
    { examName: 'Ağustos' },
  ]), ['Eylül Denemesi 1', 'Ekim Denemesi', 'Ağustos']);
});

test('a question’s topic (konu) reaches the list, and a question without one has none', async () => {
  const { summaryFromRow, toSummary } = await import('../src/features/projects/projectSummary');
  assert.equal(summaryFromRow({ id: 'p', topic: 'Hal' }, new Map()).topic, 'Hal');
  assert.equal('topic' in summaryFromRow({ id: 'p' }, new Map()), false);
  assert.equal(toSummary({ id: 'p', topic: 'Temyiz' } as any).topic, 'Temyiz');
});

test('a playback link this site signed leads back to its stored file (R2 and Supabase)', async () => {
  const { signedLinkPath } = await import('../src/features/projects/projectSummary');
  const file = 'f1c3259f-064c-4338-86b7-a8aa709588ed/5f953951-36ce-43c1-ad03-bf1a6d12c971/' + 'a7'.repeat(32) + '.mp3';
  assert.equal(signedLinkPath(`https://acc.r2.cloudflarestorage.com/arapcaydt-assets/${file}?X-Amz-Expires=21600&X-Amz-Signature=ab`), file);
  assert.equal(signedLinkPath(`https://x.supabase.co/storage/v1/object/sign/project-assets/${file}?token=t`), file);
  for (const other of ['', 'blob:https://arapcaydt.vercel.app/1', 'data:audio/mpeg;base64,AA', 'https://example.com/a.mp3', `http://acc.r2.cloudflarestorage.com/b/${file}`])
    assert.equal(signedLinkPath(other), null, other);
});
