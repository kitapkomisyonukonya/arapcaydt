import test from 'node:test';
import assert from 'node:assert/strict';
import { pageHash, parseHash } from '../src/layouts/route';

test('studio addresses: every page round-trips and the editor names its question', () => {
  for (const page of ['dashboard', 'questions', 'batch', 'settings', 'admin', 'help', 'tools'] as const) assert.equal(parseHash(pageHash(page)).page, page);
  assert.equal(pageHash('editor', 'a1b2'), '#/soru/a1b2');
  assert.deepEqual(parseHash('#/soru/a1b2'), { page: 'editor', projectId: 'a1b2' });
  assert.deepEqual(parseHash('#/soru'), { page: 'editor' });
  assert.equal(parseHash('').page, 'dashboard');
  assert.equal(parseHash('#access_token=abc&type=recovery').page, 'dashboard', 'sign-in callbacks open the dashboard');
  assert.equal(parseHash('#/bilinmeyen').page, 'dashboard');
  assert.equal(pageHash('help', 'google-anahtari'), '#/yardim/google-anahtari');
  assert.deepEqual(parseHash('#/yardim/google-anahtari'), { page: 'help', topic: 'google-anahtari' });
});

test('Yenilikler: its own address; every entry is dated newest first and links only to real guide topics', async () => {
  const { NEWS, unseenNews, newsStamp } = await import('../src/features/help/changelog');
  const { HELP_TOPICS } = await import('../src/features/help/helpTopics');
  assert.equal(pageHash('news'), '#/yenilikler');
  assert.equal(parseHash('#/yenilikler').page, 'news');
  const ids = NEWS.map(n => n.id);
  assert.deepEqual(ids, [...ids].sort().reverse(), 'newest first, ids sort by date');
  assert.ok(ids.every(id => /^\d{4}-\d{2}-\d{2}$/.test(id)) && new Set(ids).size === ids.length, 'one entry per day');
  const topics = new Set(HELP_TOPICS.map(t => t.id));
  for (const entry of NEWS) for (const group of entry.groups) for (const item of group.items)
    if (item.help) assert.ok(topics.has(item.help), `${entry.id}: unknown guide topic ${item.help}`);
  assert.equal(unseenNews('').length, NEWS.length, 'a first visit marks everything new');
  assert.equal(unseenNews(newsStamp()).length, 0);
  assert.deepEqual(unseenNews(`${NEWS[0].id}#${NEWS[0].groups.flatMap(g => g.items).length - 1}`).map(e => e.id), [NEWS[0].id], 'a day that got more items is new again');
  assert.deepEqual(unseenNews('2026-10-01-ogle').map(e => e.id).includes(NEWS[0].id), NEWS[0].id >= '2026-10-01', 'an older stamp still works');
});

test('a newer studio is told apart by its bundle name', async () => {
  const { bundleOf } = await import('../src/features/settings/UpdateBanner');
  assert.equal(bundleOf('<script type="module" src="/assets/index-C8PtcxqW.js"></script>'), 'assets/index-C8PtcxqW.js');
  assert.equal(bundleOf('<script type="module" src="/src/main.tsx"></script>'), null, 'development: no check');
});
