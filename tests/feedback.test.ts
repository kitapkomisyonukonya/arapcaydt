import test from 'node:test';
import assert from 'node:assert/strict';
import { describeReport, type FeedbackContext } from '../src/features/feedback/feedback';

const context: FeedbackContext = {
  page: 'Soru editörü', projectId: 'p3', projectTitle: 'Soru 3', step: 'Ses',
  url: '/', at: '2026-09-28T09:00:00.000Z', browser: 'Chrome', screen: '1440×900',
  shownErrors: ['Şu anda ses üretilemedi.'], recentErrors: [],
};

test('a report reads as plain text with the question, step and what the teacher saw', () => {
  const text = describeReport('Ses üretmedi', context, 'Ayşe Hoca');
  assert.match(text, /^Ses üretmedi\n\nGönderen: Ayşe Hoca\nSayfa: Soru editörü\nSoru: Soru 3 · Ses adımı/);
  assert.match(text, /Ekrandaki uyarılar:\n- Şu anda ses üretilemedi\./);
  assert.doesNotMatch(text, /Son hatalar/, 'empty lists are left out');
  assert.match(describeReport('  ', { ...context, shownErrors: [] }), /^\(Açıklama yazılmadı\)/);
});

test('feedback migration: teachers write their own reports, only admins read all and resolve, 10 an hour', async () => {
  const { PGlite } = await import('@electric-sql/pglite');
  const { readFileSync } = await import('node:fs');
  const db = new PGlite();
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create schema storage;
   create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,raw_user_meta_data jsonb default '{}');
   create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
   create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
   create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text);
   create function storage.foldername(text) returns text[] language sql as $$select string_to_array($1,'/')$$;`);
  await db.exec(readFileSync(new URL('../supabase/migrations/20260921_membership.sql', import.meta.url), 'utf8'));
  const migration = readFileSync(new URL('../supabase/migrations/20261003_feedback.sql', import.meta.url), 'utf8');
  await db.exec(migration);
  await db.exec(migration);
  const admin = '00000000-0000-4000-8000-0000000000a1', t1 = '00000000-0000-4000-8000-0000000000b1', t2 = '00000000-0000-4000-8000-0000000000b2';
  await db.query(`insert into auth.users values ($1,'yunusemreyilmaz93@gmail.com',now(),'{}'),($2,'t1@x.tr',now(),'{}'),($3,'t2@x.tr',now(),'{}')`, [admin, t1, t2]);
  await db.query(`update public.profiles set status='approved' where id in ($1,$2)`, [t1, t2]);
  const as = async (id: string) => { await db.exec('reset role'); await db.query(`select set_config('request.jwt.claim.sub',$1,false)`, [id]); await db.exec('set role authenticated'); };

  await as(t1);
  await db.query(`insert into public.feedback(message, context) values ('Ses üretmedi', '{"page":"Soru editörü"}')`);
  await assert.rejects(db.query(`insert into public.feedback(owner_id, message) values ($1, 'başkası adına')`, [t2]), /row-level security/);
  await assert.rejects(db.query(`insert into public.feedback(message, status) values ('x', 'resolved')`), /row-level security/);
  await as(t2);
  assert.equal((await db.query(`select * from public.feedback`)).rows.length, 0, 'teachers see only their own reports');
  await db.query(`update public.feedback set status='resolved'`);
  await as(admin);
  const rows = (await db.query<any>(`select owner_id, message, status from public.feedback`)).rows;
  assert.deepEqual(rows, [{ owner_id: t1, message: 'Ses üretmedi', status: 'open' }], 'a teacher cannot resolve; the admin sees it');
  await db.query(`update public.feedback set status='resolved'`);
  assert.equal((await db.query<any>(`select status from public.feedback`)).rows[0].status, 'resolved');

  await as(t2);
  for (let i = 0; i < 10; i++) await db.query(`insert into public.feedback(message) values ('tekrar')`);
  await assert.rejects(db.query(`insert into public.feedback(message) values ('bir daha')`), /Çok fazla bildirim/);
  await db.exec('reset role');
  await db.exec('set role service_role');
  assert.equal((await db.query<any>(`select count(*)::int n from public.feedback`)).rows[0].n, 11, 'the server role can read reports');
  await db.exec('reset role');

  // The teşhis record and the server error log (run twice: safe to repeat).
  const reports = readFileSync(new URL('../supabase/migrations/20261007_reports_server_errors.sql', import.meta.url), 'utf8');
  await db.exec(reports);
  await db.exec(reports);
  await as(t1);
  await db.query(`insert into public.feedback(message, context, diagnostics) values ('', '{"reason":"Çizgi yanlış yerde"}', '{"words":[]}')`);
  await assert.rejects(db.query(`select * from public.server_errors`), /permission denied/, 'teachers cannot read server errors');
  await as(admin);
  assert.deepEqual((await db.query<any>(`select diagnostics from public.feedback where context->>'reason' is not null`)).rows, [{ diagnostics: { words: [] } }]);
  await db.exec('reset role');
  await db.exec('set role service_role');
  await db.query(`insert into public.server_errors(route, status, message) values ('/api/vision/ocr', 500, 'x')`);
  assert.equal((await db.query<any>(`select count(*)::int n from public.server_errors`)).rows[0].n, 1);
  await db.exec('reset role');

  // Replies: the admin answers, the teacher reads it and cannot write or change one.
  const replies = readFileSync(new URL('../supabase/migrations/20261008_feedback_reply.sql', import.meta.url), 'utf8');
  await db.exec(replies);
  await db.exec(replies);
  await as(admin);
  await db.query(`update public.feedback set reply='Sorunu çözdük hocam', replied_at=now(), status='resolved' where message='Ses üretmedi'`);
  await as(t1);
  assert.deepEqual((await db.query<any>(`select reply, status from public.feedback where message='Ses üretmedi'`)).rows, [{ reply: 'Sorunu çözdük hocam', status: 'resolved' }]);
  await db.query(`update public.feedback set reply='kendim yazdım'`);
  assert.equal((await db.query<any>(`select reply from public.feedback where message='Ses üretmedi'`)).rows[0].reply, 'Sorunu çözdük hocam', 'a teacher cannot write a reply');
  await db.exec('reset role');

  // Screenshots: up to three small pictures with a report; the admin reads them.
  const pictures = readFileSync(new URL('../supabase/migrations/20261020_feedback_screenshots.sql', import.meta.url), 'utf8');
  await db.exec(pictures);
  await db.exec(pictures);
  await as(t1);
  const shot = 'data:image/jpeg;base64,' + 'A'.repeat(1000);
  await db.query(`insert into public.feedback(message, screenshots) values ('ekranlı', $1)`, [JSON.stringify([shot, shot])]);
  await assert.rejects(db.query(`insert into public.feedback(message, screenshots) values ('dört', $1)`, [JSON.stringify([shot, shot, shot, shot])]), /check constraint/);
  await assert.rejects(db.query(`insert into public.feedback(message, screenshots) values ('büyük', $1)`, [JSON.stringify(['data:image/jpeg;base64,' + 'A'.repeat(1600000)])]), /check constraint/);
  await as(admin);
  assert.equal((await db.query<any>(`select jsonb_array_length(screenshots) n from public.feedback where message='ekranlı'`)).rows[0].n, 2);
  await db.exec('reset role');
});

test('a report with a one-tap reason says it first, and the teşhis snapshot is never part of its context', async () => {
  assert.match(describeReport('', { ...context, reason: 'Çizgi yanlış yerde' }), /^Sorun: Çizgi yanlış yerde\n\(Açıklama yazılmadı\)/);
  const { setReportContext, collectContext, currentSnapshot } = await import('../src/features/feedback/feedback');
  (globalThis as any).location = { pathname: '/', search: '' };
  (globalThis as any).navigator ??= { userAgent: 'test' };
  (globalThis as any).window ??= { innerWidth: 1, innerHeight: 1 };
  setReportContext({ page: 'Soru editörü', projectId: 'p', snapshot: () => ({ words: [1] }) });
  const collected = collectContext({ querySelectorAll: () => [] as any } as any);
  assert.equal('snapshot' in collected, false);
  assert.deepEqual(currentSnapshot(), { words: [1] });
  setReportContext({ snapshot: () => { throw new Error('x'); } });
  assert.equal(currentSnapshot(), undefined, 'a broken snapshot never blocks the report');
});
