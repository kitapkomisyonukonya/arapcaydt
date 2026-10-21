import test from 'node:test';
import assert from 'node:assert/strict';
import { applyPronunciations } from '../server/pronunciation';

test('whole words are read as the list says; the rest of the text is untouched', () => {
  const list = [{ written: 'MEB', spoken: 'Meb' }, { written: 'ÖSYM', spoken: 'Ö Se Ye Me' }, { written: 'ism-i mevsul', spoken: 'ismi mevsul' }];
  assert.equal(applyPronunciations("MEB ve ÖSYM'nin sorusu; ism-i mevsul konusu.", list), "Meb ve Ö Se Ye Me'nin sorusu; ismi mevsul konusu.");
  assert.equal(applyPronunciations('MEBİ ve TMEB aynı kalır.', list), 'MEBİ ve TMEB aynı kalır.', 'never inside another word');
  assert.equal(applyPronunciations('meb küçük yazılsa da', list), 'Meb küçük yazılsa da');
});

test('an Arabic entry without vowel marks matches the word with its marks; Turkish is not affected', () => {
  const list = [{ written: 'الذي', spoken: 'اَلَّذِي' }];
  assert.equal(applyPronunciations('Burada اَلَّذِى değil الذي kelimesi var.', [{ written: 'الذى', spoken: 'اَلَّذِي' }]), 'Burada اَلَّذِي değil الذي kelimesi var.');
  assert.equal(applyPronunciations('Burada الَّذِي kelimesi var.', list), 'Burada اَلَّذِي kelimesi var.');
  assert.equal(applyPronunciations('والذي', list), 'والذي', 'not inside a longer Arabic word');
});

test('an Arabic entry written with marks still finds the word marked differently or with a doubled mark', () => {
  const list = [{ written: 'شِمَالَ', spoken: 'شِمَالَ' }, { written: 'عُلِّمَ', spoken: 'عُلِّمَ' }];
  // A kasra typed five times, another last vowel, no marks at all: the entry is used each time.
  assert.equal(applyPronunciations('Burada شِِِِِمَالَ yazılı.', [{ written: 'شِمَالَ', spoken: 'X' }]), 'Burada X yazılı.');
  assert.equal(applyPronunciations('شِمَالِ جِبَالِ', [{ written: 'شِمَالَ', spoken: 'X' }]), 'X جِبَالِ');
  assert.equal(applyPronunciations('شمال', [{ written: 'شِمَالَ', spoken: 'X' }]), 'X');
  // The exact marks win when two entries share the letters.
  assert.equal(applyPronunciations('عَلِمَ ve عُلِّمَ', [{ written: 'عَلِمَ', spoken: 'A' }, { written: 'عُلِّمَ', spoken: 'B' }]), 'A ve B');
  // Shadda and vowel typed in either order are the same word.
  assert.equal(applyPronunciations('\u0639\u0644\u0651\u064E\u0645', [{ written: '\u0639\u0644\u064E\u0651\u0645', spoken: 'Y' }]), 'Y');
  assert.equal(applyPronunciations('والشمال', list), 'والشمال', 'not inside a longer Arabic word');
});

test('a mark typed twice is read once even without a dictionary entry', () => {
  assert.equal(applyPronunciations('شِِِمَالَ', []), 'شِمَالَ');
});

test('longest entry wins and a replacement is not replaced again', () => {
  const list = [{ written: 'A', spoken: 'A şıkkı B' }, { written: 'B', spoken: 'Be' }, { written: 'A B', spoken: 'A ile B' }];
  assert.equal(applyPronunciations('A B', list), 'A ile B');
  assert.equal(applyPronunciations('A', list), 'A şıkkı B');
});

test('special characters in an entry are matched literally; empty lists change nothing', () => {
  assert.equal(applyPronunciations('(a+b) değil a+b', [{ written: 'a+b', spoken: 'a artı b' }]), '(a artı b) değil a artı b');
  assert.equal(applyPronunciations('Metin', []), 'Metin');
  assert.equal(applyPronunciations('Metin', [{ written: '  ', spoken: 'x' }]), 'Metin');
});

test('pronunciations migration: approved teachers read and add; only the owner or an admin changes an entry', async () => {
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
  const migration = readFileSync(new URL('../supabase/migrations/20261010_pronunciations.sql', import.meta.url), 'utf8');
  await db.exec(migration);
  await db.exec(migration);
  const admin = '00000000-0000-4000-8000-0000000000a1', t1 = '00000000-0000-4000-8000-0000000000b1', t2 = '00000000-0000-4000-8000-0000000000b2', t3 = '00000000-0000-4000-8000-0000000000b3';
  await db.query(`insert into auth.users values ($1,'yunusemreyilmaz93@gmail.com',now(),'{}'),($2,'t1@x.tr',now(),'{}'),($3,'t2@x.tr',now(),'{}'),($4,'t3@x.tr',now(),'{}')`, [admin, t1, t2, t3]);
  await db.query(`update public.profiles set status='approved' where id in ($1,$2)`, [t1, t2]);
  const as = async (id: string) => { await db.exec('reset role'); await db.query(`select set_config('request.jwt.claim.sub',$1,false)`, [id]); await db.exec('set role authenticated'); };

  await as(t1);
  await db.query(`insert into public.pronunciations(written, spoken) values ('MEB', 'Meb')`);
  await assert.rejects(db.query(`insert into public.pronunciations(written, spoken) values (' meb ', 'Me Be')`), /duplicate|unique/);
  await assert.rejects(db.query(`insert into public.pronunciations(written, spoken) values ('  ', 'x')`), /check/);
  await assert.rejects(db.query(`insert into public.pronunciations(written, spoken, created_by) values ('ÖSYM', 'x', $1)`, [t2]), /row-level security/);
  await as(t2);
  assert.equal((await db.query(`select * from public.pronunciations`)).rows.length, 1, 'shared with every approved teacher');
  await db.query(`update public.pronunciations set spoken='Mep'`);
  await db.query(`delete from public.pronunciations`);
  await as(t1);
  assert.equal((await db.query<any>(`select spoken from public.pronunciations`)).rows[0].spoken, 'Meb', 'another teacher cannot change or delete it');
  await as(t3);
  assert.equal((await db.query(`select * from public.pronunciations`)).rows.length, 0, 'not approved: nothing');
  await assert.rejects(db.query(`insert into public.pronunciations(written, spoken) values ('x', 'y')`), /row-level security/);
  await as(admin);
  await db.query(`update public.pronunciations set spoken='Me Be'`);
  await db.query(`delete from public.pronunciations`);
  assert.equal((await db.query(`select * from public.pronunciations`)).rows.length, 0, 'an admin can tidy any entry');
  await db.exec('reset role');
});

test('an option letter before Arabic text is spelled the Turkish way in the spoken copy only', async () => {
  const { spokenOptionLetters } = await import('../server/pronunciation');
  const text = 'Soruya bakalım:\nD) يَا وَالِدَتِي أَنْتِ\nOlmaz.\nE) الْقِطَّةُ حَيَوَانٌ\nDoğru cevap E seçeneği.\nC) Yalnız II';
  assert.equal(spokenOptionLetters(text), 'Soruya bakalım:\nDe, يَا وَالِدَتِي أَنْتِ\nOlmaz.\nE, الْقِطَّةُ حَيَوَانٌ\nDoğru cevap E seçeneği.\nC) Yalnız II');
});
