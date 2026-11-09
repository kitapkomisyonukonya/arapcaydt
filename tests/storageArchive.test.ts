import test from 'node:test';
import assert from 'node:assert/strict';
import { exportEntries, type StoredObject } from '../server/storage';
import { crc32, ZipWriter } from '../src/features/admin/archiveZip';
import { archiveList, archiveNames, type ArchiveFile } from '../src/features/admin/storageArchive';

process.env.SUPABASE_URL ||= 'https://db.example.test';
const obj = (name: string, mimetype: string): StoredObject => ({ name, bytes: 2048, mimetype, created_at: '2026-10-01T10:00:00Z' });

test('archive lists each file with its teacher and the question that uses it', () => {
  const objects = [obj('u1/p1/aaa', 'image/png'), obj('u1/p1/bbb.mp3', 'audio/mpeg'), obj('u1/p1/old.wav', 'audio/wav'), obj('u9/x/ccc', 'image/jpeg')];
  const rows = [{ id: 'p1', owner_id: 'u1', title: 'Fiil çekimi', examYear: '2024', questionNumber: 7, image: { assetPath: 'u1/p1/aaa' }, anAudio: { assetPath: 'u1/p1/bbb.mp3' } }];
  const files = exportEntries(objects, rows, [{ id: 'u1', name: 'Ayşe Hoca', email: 'ayse@example.test' }]);
  assert.deepEqual(files.map(f => [f.ownerName, f.use, f.projectTitle]), [
    ['Ayşe Hoca', 'image', '2024 Soru 7 Fiil çekimi'], ['Ayşe Hoca', 'audio', '2024 Soru 7 Fiil çekimi'],
    ['Ayşe Hoca', 'unused', ''], ['Bilinmeyen', 'unused', ''],
  ]);
  const names = archiveNames(files.map(f => ({ ...f, url: null })) as ArchiveFile[]);
  assert.equal(names.get('u1/p1/aaa'), 'Ayşe Hoca/2024 Soru 7 Fiil çekimi (p1)/görsel.png');
  assert.equal(names.get('u1/p1/bbb.mp3'), 'Ayşe Hoca/2024 Soru 7 Fiil çekimi (p1)/ses.mp3');
  assert.equal(names.get('u1/p1/old.wav'), 'Ayşe Hoca/kullanılmayan/old.wav');
  assert.equal(names.get('u9/x/ccc'), 'Bilinmeyen/kullanılmayan/ccc.jpg');
  const csv = archiveList(files.map(f => ({ ...f, url: null })) as ArchiveFile[], names);
  assert.ok(csv.startsWith('﻿"Hoca";'));
  assert.match(csv, /"Ayşe Hoca";"ayse@example.test";"2024 Soru 7 Fiil çekimi";"Görsel"/);
});

test('same-named files in one folder get distinct archive names', () => {
  const f = (path: string): ArchiveFile => ({ path, bytes: 1, mimetype: 'audio/mpeg', createdAt: '', ownerName: 'A/B', ownerEmail: '', projectId: 'p', projectTitle: 'T', use: 'audio', url: null });
  const names = archiveNames([f('u/p/1'), f('u/p/2')]);
  assert.deepEqual([...names.values()], ['A-B/T (p)/ses.mp3', 'A-B/T (p)/ses-2.mp3']);
});

test('ZIP writer stores files with correct CRC and directory', async () => {
  assert.equal(crc32(new TextEncoder().encode('123456789')), 0xcbf43926);
  const zip = new ZipWriter();
  zip.add('ş/a.txt', new TextEncoder().encode('merhaba'));
  zip.add('b.bin', new Uint8Array([1, 2, 3]));
  const bytes = new Uint8Array(await zip.finish().arrayBuffer());
  const view = new DataView(bytes.buffer);
  const end = bytes.length - 22;
  assert.equal(view.getUint32(end, true), 0x06054b50);
  assert.equal(view.getUint16(end + 10, true), 2);
  const dir = view.getUint32(end + 16, true);
  assert.equal(view.getUint32(dir, true), 0x02014b50);
  assert.equal(view.getUint32(0, true), 0x04034b50);
});

test('archive puts a Konu Anlatımı in its own folder, files named by slide', () => {
  const objects = [obj('u1/l1/a.webp', 'image/webp'), obj('u1/l1/a.mp3', 'audio/mpeg'), obj('u1/l1/b.webp', 'image/webp')];
  const rows = [{ id: 'l1', owner_id: 'u1', title: 'Atıf harfleri', slides: [{ imagePath: 'u1/l1/a.webp', audio: { path: 'u1/l1/a.mp3' } }, { imagePath: 'u1/l1/b.webp' }] }];
  const files = exportEntries(objects, rows, [{ id: 'u1', name: 'Ayşe Hoca', email: '' }]);
  const names = archiveNames(files.map(f => ({ ...f, url: null })) as ArchiveFile[]);
  assert.deepEqual([...names.values()], [
    'Ayşe Hoca/Konu anlatımı - Atıf harfleri (l1)/slayt 01 görsel.webp',
    'Ayşe Hoca/Konu anlatımı - Atıf harfleri (l1)/slayt 01 ses.mp3',
    'Ayşe Hoca/Konu anlatımı - Atıf harfleri (l1)/slayt 02 görsel.webp',
  ]);
});
