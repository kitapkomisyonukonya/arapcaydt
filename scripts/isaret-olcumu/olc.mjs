/**
 * Measures the studio's automatic marks against what teachers left in their finished questions.
 * Every stored question is prepared again with today's code (the real "İşaretleri otomatik hazırla",
 * picture reading included, in a headless browser; Google Vision is not called), and the result is
 * compared with the teacher's saved marks: option boxes the teacher had to move, underlines the
 * teacher drew by hand (missed) and underlines the teacher removed (extra).
 *
 *   npm run isaret:olc -- [--etiket ad] [--kategori cikmis-soru] [--gun 2026-10-03] [--onceki ad] [--klasor yol]
 *
 * Questions come from /api/admin/monitor (MONITOR_TOKEN as a Bearer token, or a proxy that adds it;
 * MONITOR_URL overrides the site). Questions and pictures are kept in the folder (default
 * /mnt/project-files/arapca-ydt/isaret-olcumu), each run's results under sonuc-<etiket>/ with rapor.json.
 * --onceki compares with an earlier run on the same questions. Needs Playwright with Chromium
 * (PLAYWRIGHT_MODULE, CHROMIUM_PATH as in help-screenshots). Nothing is written to the site.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const arg = (name, fallback) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : fallback; };
const dir = arg('klasor', '/mnt/project-files/arapca-ydt/isaret-olcumu');
const label = arg('etiket', execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: root }).toString().trim());
const category = arg('kategori'), since = arg('gun', '2026-10-03'), before = arg('onceki');
const site = process.env.MONITOR_URL || 'https://arapcaydt.vercel.app';
for (const d of ['sorular', 'resimler', `sonuc-${label}`]) fs.mkdirSync(path.join(dir, d), { recursive: true });

/** curl, so the environment's proxy settings apply. */
const get = (query, file) => {
  const auth = process.env.MONITOR_TOKEN ? ['-H', `Authorization: Bearer ${process.env.MONITOR_TOKEN}`] : [];
  const out = execFileSync('curl', ['-sS', '-f', ...auth, `${site}/api/admin/monitor?${query}`, ...(file ? ['-o', file] : [])], { maxBuffer: 64 << 20 });
  return file ? null : JSON.parse(out.toString());
};

// Questions with marks, changed since the given day (a question's saved marks are the teacher's last word).
const list = get('list=1').filter(q => q.updated_at >= since && (!category || q.category === category));
const questions = [];
for (const q of list) {
  const file = path.join(dir, 'sorular', `${q.id}.json`);
  const cached = fs.existsSync(file) && JSON.parse(fs.readFileSync(file, 'utf8'));
  const data = cached && cached.updated_at === q.updated_at ? cached : get(`project=${q.id}`);
  if (data !== cached) fs.writeFileSync(file, JSON.stringify(data));
  if (!data.solutionText || !data.videoConfig?.timelineActions?.length) continue;
  const picture = path.join(dir, 'resimler', q.id);
  if (!fs.existsSync(picture) || data !== cached) get(`project=${q.id}&picture=1`, picture);
  questions.push(data);
}
console.log(`${questions.length} işaretli soru (${since} sonrası${category ? `, ${category}` : ''}).`);

const server = await createServer({ root, configFile: path.join(root, 'vite.config.ts'), logLevel: 'warn', server: { port: 5298, strictPort: true, hmr: false, watch: null } });
await server.listen();
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const page = await browser.newPage();
await page.route('**/api/**', route => route.fulfill({ status: 503, json: { error: 'ölçümde kapalı' } }));
await page.route('**/__soru/*', route => route.fulfill({ body: fs.readFileSync(path.join(dir, 'resimler', route.request().url().split('/__soru/')[1])) }));
// The reader's engine files come from the installed package, not from the CDN.
await page.route('https://cdn.jsdelivr.net/**', route => {
  const name = new URL(route.request().url()).pathname.split('/').pop();
  const file = [path.join(root, 'node_modules/tesseract.js/dist', name), path.join(root, 'node_modules/tesseract.js-core', name)].find(f => fs.existsSync(f));
  return file ? route.fulfill({ body: fs.readFileSync(file), contentType: name.endsWith('.wasm') ? 'application/wasm' : 'application/javascript' }) : route.abort();
});
await page.goto('http://localhost:5298/scripts/isaret-olcumu/index.html');
await page.waitForFunction(() => window.ready, null, { timeout: 120000 });
for (const [i, q] of questions.entries()) {
  const file = path.join(dir, `sonuc-${label}`, `${q.id}.json`);
  if (fs.existsSync(file)) continue;
  try {
    const out = await page.evaluate(q => window.prepareMarks(q), { imageUrl: `/__soru/${q.id}`, solutionText: q.solutionText,
      correctAnswer: q.correctAnswer, words: q.words, duration: q.duration, narrationType: q.narrationType });
    fs.writeFileSync(file, JSON.stringify(out));
  } catch (e) { console.warn(`  ${q.id}: ${String(e).slice(0, 200)}`); }
  if ((i + 1) % 20 === 0) console.log(`  ${i + 1} / ${questions.length}`);
}
await browser.close();
await server.close();

/** Underlines that play, as a line under text: where it sits and which way it runs. */
function underlines(regions, actions) {
  const byId = new Map(regions.map(r => [r.id, r]));
  const ids = [...new Set(actions.filter(a => a.type === 'underline').map(a => a.targetRegionId || a.regionId))];
  return ids.map(id => byId.get(id)).filter(Boolean).map(r => ({ id: r.id, x0: r.x, x1: r.x + r.width, text: r.content || '',
    manual: r.shape === 'line', y: r.shape === 'line' ? r.y + r.height / 2 : r.y + r.height }));
}
const same = (a, b) => Math.abs(a.y - b.y) < .03 && Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0) > .5 * Math.min(a.x1 - a.x0, b.x1 - b.x0);
const overlap = (a, b) => {
  const i = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
  return i / (a.width * a.height + b.width * b.height - i);
};
const ticks = actions => [...new Set(actions.filter(a => a.type === 'correct' && /^option-[a-e]$/.test(a.targetRegionId)).map(a => a.targetRegionId))].sort();
function compare(q, out) {
  const saved = q.videoConfig, teacher = underlines(saved.regions, saved.timelineActions), ours = underlines(out.regions, out.actions);
  const option = r => /^option-[a-e]$/.test(r.id) && r.type.startsWith('option');
  const found = new Map(out.regions.filter(option).map(r => [r.id, r]));
  return {
    id: q.id, category: q.category, title: q.title,
    options: saved.regions.filter(option).filter(r => !found.has(r.id) || overlap(r, found.get(r.id)) < .6).map(r => r.id),
    missed: teacher.filter(t => !ours.some(o => same(t, o))).map(t => ({ y: +t.y.toFixed(3), x: +t.x0.toFixed(3), byHand: t.manual, text: t.text })),
    extra: ours.filter(o => !teacher.some(t => same(t, o))).map(o => ({ y: +o.y.toFixed(3), id: o.id, text: o.text })),
    // Only ticks on options: a teacher's extra tick on a premise (I, II, III) is not an answer.
    correct: JSON.stringify(ticks(saved.timelineActions)) === JSON.stringify(ticks(out.actions)),
  };
}
const report = run => questions.flatMap(q => {
  const file = path.join(dir, `sonuc-${run}`, `${q.id}.json`);
  return fs.existsSync(file) ? [compare(q, JSON.parse(fs.readFileSync(file, 'utf8')))] : [];
});
const clean = r => !r.options.length && !r.missed.length && !r.extra.length && r.correct;
const summary = rows => {
  const by = {};
  for (const r of rows) {
    const s = by[r.category] ??= { soru: 0, temiz: 0, sikKutusu: 0, eksikCizgi: 0, fazlaCizgi: 0, dogruCevap: 0 };
    s.soru++; s.temiz += clean(r); s.sikKutusu += r.options.length > 0; s.eksikCizgi += r.missed.length; s.fazlaCizgi += r.extra.length; s.dogruCevap += !r.correct;
  }
  return by;
};
const rows = report(label);
fs.writeFileSync(path.join(dir, `sonuc-${label}`, 'rapor.json'), JSON.stringify({ label, since, category, at: new Date().toISOString(), summary: summary(rows), rows }, null, 1));
console.log(`\n${label}: hocanın son hâliyle aynı çıkan soru`);
for (const [c, s] of Object.entries(summary(rows))) console.log(`  ${c}: ${s.temiz} / ${s.soru} temiz; şık kutusu farklı ${s.sikKutusu} soru, eksik çizgi ${s.eksikCizgi}, fazla çizgi ${s.fazlaCizgi}, doğru cevap farklı ${s.dogruCevap}`);
if (before) {
  const old = new Map(report(before).map(r => [r.id, r]));
  const both = rows.filter(r => old.has(r.id));
  const better = both.filter(r => clean(r) && !clean(old.get(r.id))), worse = both.filter(r => !clean(r) && clean(old.get(r.id)));
  console.log(`\n${before} → ${label} (${both.length} soru): ${better.length} soru düzeldi, ${worse.length} soru bozuldu.`);
  for (const r of worse) console.log(`  bozulan: ${r.id} ${JSON.stringify({ options: r.options, missed: r.missed.length, extra: r.extra.length, correct: r.correct })}`);
}
