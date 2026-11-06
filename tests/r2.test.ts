import test from 'node:test';
import assert from 'node:assert/strict';
import { browserLink, parseList, presign, r2Config, r2Link, r2LinkPath } from '../server/r2';
import { copyBatch, mergeStores, type StoredObject } from '../server/storage';

test('presigned links match the AWS Signature V4 reference example', () => {
  const url = presign({
    method: 'GET', host: 'examplebucket.s3.amazonaws.com', path: '/test.txt', region: 'us-east-1',
    accessKeyId: 'AKIAIOSFODNN7EXAMPLE', secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
    expires: 86400, now: new Date('2013-05-24T00:00:00Z'),
  });
  assert.match(url, /X-Amz-Signature=aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404$/);
});

test('R2 is off until all four settings exist; its links map back to the stored path', () => {
  assert.equal(r2Config({ R2_ACCOUNT_ID: 'a', R2_ACCESS_KEY_ID: 'b', R2_BUCKET: 'c' } as any), null);
  const c = r2Config({ R2_ACCOUNT_ID: 'acc', R2_ACCESS_KEY_ID: 'id', R2_SECRET_ACCESS_KEY: 'sec', R2_BUCKET: 'assets' } as any)!;
  const link = r2Link(c, 'PUT', 'u1/p1/abc.png', 900, { 'content-type': 'image/png', 'content-length': '12' });
  assert.ok(link.startsWith('https://acc.r2.cloudflarestorage.com/assets/u1/p1/abc.png?'));
  assert.match(link, /X-Amz-SignedHeaders=content-length%3Bcontent-type%3Bhost/);
  assert.equal(r2LinkPath(link, c), 'u1/p1/abc.png');
  assert.equal(r2LinkPath('https://evil.example/assets/u1/p1/abc.png', c), null);
});

test('the browser gets R2 links through the site\'s own /r2 address (school networks block the R2 host)', () => {
  const c = r2Config({ R2_ACCOUNT_ID: 'acc', R2_ACCESS_KEY_ID: 'id', R2_SECRET_ACCESS_KEY: 'sec', R2_BUCKET: 'assets' } as any)!;
  const direct = r2Link(c, 'GET', 'u1/p1/abc.png', 600);
  const proxied = browserLink(direct);
  // Same path and signed query: vercel.json sends /r2/… on to the host the link was signed for.
  assert.equal(proxied, direct.replace('https://acc.r2.cloudflarestorage.com', '/r2'));
  assert.equal(r2LinkPath(proxied, c), 'u1/p1/abc.png');
  assert.equal(r2LinkPath('/r2/other/u1/p1/abc.png', c), null);
  assert.equal(browserLink('https://x.supabase.co/storage/v1/object/sign/a'), 'https://x.supabase.co/storage/v1/object/sign/a');
});

test('R2 listing pages are read with sizes and continuation', () => {
  const page = parseList(`<ListBucketResult><IsTruncated>true</IsTruncated><Contents><Key>u1/p/a&amp;b.mp3</Key><LastModified>2026-10-05T10:00:00.000Z</LastModified><Size>42</Size></Contents><NextContinuationToken>tok/1=</NextContinuationToken></ListBucketResult>`);
  assert.deepEqual(page, { objects: [{ name: 'u1/p/a&b.mp3', bytes: 42, created_at: '2026-10-05T10:00:00.000Z' }], next: 'tok/1=' });
  assert.equal(parseList('<ListBucketResult><IsTruncated>false</IsTruncated></ListBucketResult>').next, null);
});

test('only same-size R2 copies count as copied; copying goes in small batches', () => {
  const o = (name: string, bytes: number): StoredObject => ({ name, bytes, mimetype: 'image/png', created_at: '2026-10-01T00:00:00Z' });
  const stores = mergeStores([o('u/p/a', 10), o('u/p/b', 20), o('u/p/c', 30)], [
    { name: 'u/p/a', bytes: 10, created_at: '' }, { name: 'u/p/b', bytes: 5, created_at: '' }, { name: 'u/p/new.mp3', bytes: 7, created_at: '' },
  ]);
  assert.deepEqual(stores.copied.map(x => x.name), ['u/p/a']);
  assert.deepEqual(stores.toCopy.map(x => x.name), ['u/p/b', 'u/p/c']);
  assert.deepEqual(stores.all.map(x => x.name), ['u/p/a', 'u/p/b', 'u/p/c', 'u/p/new.mp3']);
  assert.equal(stores.supabase.bytes, 60);
  assert.deepEqual(copyBatch(stores.toCopy, new Set(['u/p/b']), 5).map(x => x.name), ['u/p/c']);
  assert.deepEqual(copyBatch([o('x', 50), o('y', 50)], new Set(), 12, 60).map(x => x.name), ['x']);
});
