import { useEffect, useMemo, useRef, useState } from 'react';
import { freshAssetUrl } from '../features/projects/cloudProjectRepository';
import type { LeaveGuard } from '../layouts/AppLayout';
import { Stack, Play, Stop, ArrowRight, ImageSquare, MusicNotes, FileText, FileZip, DownloadSimple } from '@phosphor-icons/react';
import { FileDrop } from '../components/common/FileDrop';
import { QUESTION_CATEGORIES, DEFAULT_CATEGORY_ID } from '../config/categories';
import { STANDARD_VOICE_CONFIG } from '../config/voice';
import { buildBatchPlan } from '../features/batch/batchPlan';
import { runBatch, type BatchDeps, type BatchRowState } from '../features/batch/batchRunner';
import { projectRepository } from '../features/projects/projectRepository';
import { useProjects } from '../features/projects/ProjectContext';
import { CollectionInput } from '../features/projects/CollectionInput';
import { useAuth } from '../features/auth/AuthContext';
import { newProjectDefaults } from '../features/settings/preferences';
import { exportProjectVideo, videoFileName } from '../features/video/exportProjectVideo';
import { askLowerWith, narrationService } from '../services/narration/narrationService';
import { readAudioDuration, readCompressedImage, readDataUrl, saveFile } from '../services/narration/browserMedia';
import { prepareUploadedNarration } from '../services/narration/uploadedNarration';
import { localOcrService } from '../services/ocr/localOcrService';
import { localVideoPipeline } from '../services/pipeline/localVideoPipeline';
import { database } from '../services/supabase';
import { localWhisperService } from '../services/whisper/localWhisperService';
import { toast } from 'sonner';
import { useConfirm } from '../components/common/ConfirmDialog';
import { createZip, zipSafeName } from '../services/zip';

const stageLabels: Record<BatchRowState['stage'], string> = {
  waiting: 'Sırada', creating: 'Oluşturuluyor', voice: 'Ses', markers: 'İşaretler', video: 'MP4',
  done: 'Tamamlandı', failed: 'Hata', skipped: 'Atlandı', stopped: 'Durduruldu',
};
const readinessLabels = { ready: 'Yayına hazır', check: 'Kontrol önerilir', blocked: 'Düzeltme gerekli' };
/** A batch video's name inside the ZIP, e.g. "Eylül Denemesi 1 – Soru 05.mp4". */
export function batchVideoName(collection: string, number: number, title: string) {
  const label = collection.trim() || title.trim() || 'Soru';
  return `${zipSafeName(label)} – Soru ${String(number).padStart(2, '0')}.mp4`;
}
const readinessTones = { ready: 'text-[#15803D]', check: 'text-[#B45309]', blocked: 'text-red-700' };


export function BatchPage({ onOpenProject, registerLeaveGuard }: { onOpenProject: (id: string) => void; registerLeaveGuard?: (guard: LeaveGuard | null) => void }) {
  const { loadProjects } = useProjects();
  const { user } = useAuth();
  const confirm = useConfirm();
  const defaults = newProjectDefaults(user?.preferences);
  const [images, setImages] = useState<File[]>([]);
  const [audios, setAudios] = useState<File[]>([]);
  const [solutions, setSolutions] = useState('');
  const [solutionFile, setSolutionFile] = useState<File[]>([]);
  const [category, setCategory] = useState(defaults.category || DEFAULT_CATEGORY_ID);
  const [examName, setExamName] = useState(defaults.examName || '');
  const [examYear, setExamYear] = useState(defaults.examYear || `${new Date().getFullYear()} YDT`);
  const [generateVoice, setGenerateVoice] = useState(false);
  const [exportVideo, setExportVideo] = useState(true);
  // Finished videos wait here and come as one ZIP at the end, unless the teacher wants each one at once.
  const [asZip, setAsZip] = useState(true);
  const [videos, setVideos] = useState<Record<number, { name: string; blob: Blob }>>({});
  const [rows, setRows] = useState<Record<number, BatchRowState>>({});
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');
  const abort = useRef<AbortController | null>(null);

  const plan = useMemo(() => buildBatchPlan(images, solutions, audios), [images, solutions, audios]);
  const runnable = plan.items.filter(i => !i.problems.length);
  const voiceChars = generateVoice ? runnable.filter(i => !i.audio).reduce((sum, i) => sum + (i.solution?.trim().length || 0), 0) : 0;

  // OCR models load while the teacher is still choosing files.
  useEffect(() => { if (images.length) localOcrService.warmUp(); }, [images.length]);
  // Leaving the page while a batch runs stops it (asked first); finished questions stay saved.
  useEffect(() => {
    if (!registerLeaveGuard) return;
    registerLeaveGuard(running ? () => {
      if (!window.confirm('Toplu üretim sürüyor. Bu sayfadan çıkarsanız durdurulur; tamamlanan sorular kayıtlı kalır. Çıkılsın mı?')) return false;
      abort.current?.abort();
      return true;
    } : null);
    return () => registerLeaveGuard(null);
  }, [running, registerLeaveGuard]);
  useEffect(() => () => abort.current?.abort(), []);
  useEffect(() => {
    if (!running) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [running]);

  // Questions an earlier run left half done (stopped or failed); they can be continued, not created again.
  const unfinished = runnable.filter(i => ['failed', 'stopped'].includes(rows[i.number]?.stage ?? ''));
  const created = plan.items.filter(i => rows[i.number]?.projectId).length;

  const start = async (onlyUnfinished = false) => {
    if (!runnable.length || running) return;
    const items = onlyUnfinished ? unfinished : plan.items;
    if (!onlyUnfinished && created > 0 && !await confirm({
      title: 'Baştan başlatılsın mı?',
      message: `Önceki çalıştırmada ${created} soru zaten oluşturuldu. Baştan başlatırsanız bunlar yeniden oluşturulur ve listenizde iki kez görünür. Yalnız yarım kalanlar için “Yarım kalanları tamamla”yı kullanın.`,
      confirmLabel: 'Yine de baştan başlat', danger: true,
    })) return;
    const toVoice = items.filter(i => !i.audio && !i.problems.length && !(onlyUnfinished && rows[i.number]?.projectId)).length;
    if (generateVoice && toVoice > 0 && !await confirm({
      title: 'Otomatik seslendirme',
      message: `${toVoice} soru otomatik seslendirilecek; her biri bir ses hakkı kullanır. Sesler dinlenmeden onaylanır, sonra editörde kontrol edebilirsiniz.`,
      confirmLabel: 'Başlat',
    })) return;
    setError('');
    setRunning(true);
    abort.current = new AbortController();
    const resume = onlyUnfinished ? Object.fromEntries(items.flatMap(i => rows[i.number]?.projectId ? [[i.number, rows[i.number].projectId!]] : [])) : {};
    setRows(previous => onlyUnfinished
      ? { ...previous, ...Object.fromEntries(items.map(i => [i.number, { stage: 'waiting' as const, projectId: previous[i.number]?.projectId }])) }
      : Object.fromEntries(plan.items.map(i => [i.number, { stage: 'waiting' as const }])));
    const outcome: Record<number, BatchRowState['stage']> = {};
    if (!onlyUnfinished) setVideos({});
    const finished: Record<number, { name: string; blob: Blob }> = {};
    const zipMode = asZip;
    // Asked once for the whole batch, not for every question.
    let lowerAnswer: Promise<boolean> | null = null;
    const askLower = askLowerWith(confirm);
    const deps: BatchDeps<File> = {
      // Only question images go through this; MP3s use prepareUpload below.
      readDataUrl: readCompressedImage,
      createProject: p => projectRepository.create(p),
      loadProject: id => projectRepository.getById(id),
      saveProject: p => projectRepository.save(p),
      generateVoice: p => narrationService.generateNarration({ projectId: p.id, text: p.solutionText, voiceId: STANDARD_VOICE_CONFIG.voiceId,
        modelId: STANDARD_VOICE_CONFIG.modelId, outputFormat: STANDARD_VOICE_CONFIG.outputFormat }, undefined, reason => (lowerAnswer ??= askLower(reason))),
      alignGeneratedVoice: p => narrationService.alignGeneratedNarration(p.id),
      alignGeneratedVoiceLocal: p => localWhisperService.transcribeNarrationAudio(p),
      prepareUpload: (p, file) => prepareUploadedNarration(file, {
        readDataUrl, readDuration: readAudioDuration,
        // Stored with the project first, then timed on the server from storage.
        align: async untimed => narrationService.alignGeneratedNarration((await projectRepository.save({ ...p, narrationSource: untimed.source, audioNarration: untimed.compat })).id),
        transcribe: async upload => localWhisperService.transcribeAudioLocally(await upload.arrayBuffer()),
      }),
      runPipeline: async (p, declared) => localVideoPipeline.executePipeline({ imageUrl: await freshAssetUrl(p.imageUrl), solutionText: p.solutionText,
        narrationSource: p.narrationSource!, correctAnswer: declared }),
      exportVideo: (p, onPercent, signal) => exportProjectVideo(p, onPercent, signal),
      download: (blob, p) => {
        const name = batchVideoName(p.examName || examName, p.questionNumber, p.title);
        finished[p.questionNumber] = { name, blob };
        setVideos(previous => ({ ...previous, [p.questionNumber]: { name, blob } }));
        if (!zipMode) saveFile(blob, videoFileName(p));
      },
      recordExport: async p => {
        await projectRepository.save({ ...p, completedAt: new Date().toISOString() }).catch(() => undefined);
        await database().rpc('record_video_export', { project_id: p.id });
      },
      wait: ms => new Promise(resolve => setTimeout(resolve, ms)),
      now: () => Date.now(),
    };
    try {
      await runBatch(items, { category, examName: examName.trim(), examYear: examYear.trim(), generateVoice, exportVideo, video: defaults.video }, deps,
        (number, state) => { outcome[number] = state.stage; setRows(previous => ({ ...previous, [number]: state })); }, abort.current.signal, resume);
      const done = Object.values(outcome).filter(stage => stage === 'done').length;
      const left = Object.values(outcome).filter(stage => stage === 'failed' || stage === 'stopped').length;
      if (left) toast.warning(`${done} soru hazır, ${left} soru yarım kaldı.`, { description: 'Hata nedenleri tabloda. “Yarım kalanları tamamla” ile kaldıkları yerden devam edebilirsiniz.', duration: 12000 });
      else if (done) toast.success(`${done} soru hazır.`, { description: exportVideo ? (zipMode ? 'Videolar tek ZIP dosyası olarak indiriliyor.' : 'MP4 dosyaları indirildi.') : 'Sorular listenizde.' });
      if (zipMode && Object.keys(finished).length) downloadZip(finished);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Toplu üretim tamamlanamadı.');
    } finally {
      setRunning(false);
      void loadProjects();
    }
  };

  /** All finished videos as one ZIP, named by collection and question number. */
  function downloadZip(list: Record<number, { name: string; blob: Blob }> = videos) {
    void (async () => {
      const entries = await Promise.all(Object.values(list).map(async v => ({ name: v.name, data: new Uint8Array(await v.blob.arrayBuffer()) })));
      entries.sort((a, b) => a.name.localeCompare(b.name, 'tr', { numeric: true }));
      saveFile(createZip(entries), `${zipSafeName(examName.trim() || 'Toplu üretim')} – videolar.zip`);
    })().catch(() => toast.error('ZIP dosyası hazırlanamadı.', { description: 'Videoları tablodaki MP4 düğmeleriyle tek tek indirebilirsiniz.' }));
  }
  const videoCount = Object.keys(videos).length;

  const field = 'block w-full border rounded-lg p-2.5 mt-1 text-sm bg-white';
  return <section className="studio-library">
    <header className="library-heading">
      <div><h2>Toplu üretim</h2><p>Birden çok soru görselini, tek bir çözüm metnini ve isteğe bağlı MP3'leri soru numarasına göre eşleştirip sırayla hazırlayın.</p></div>
      {running
        ? <button className="studio-secondary" onClick={() => abort.current?.abort()}><Stop size={18} />Durdur</button>
        : <span className="flex flex-wrap gap-2">
            {unfinished.length > 0 && <button className="studio-primary" onClick={() => void start(true)}><Play size={18} />Yarım kalanları tamamla ({unfinished.length})</button>}
            <button className={unfinished.length ? 'studio-secondary' : 'studio-primary'} disabled={!runnable.length} onClick={() => void start()}><Play size={18} />{created ? 'Baştan başlat' : 'Başlat'} ({runnable.length} soru)</button>
          </span>}
    </header>

    <div className="grid gap-4 md:grid-cols-2 pb-6 border-b border-[#E5E4DC]">
      <div className="space-y-4">
        <FileDrop label="Soru görselleri" icon={ImageSquare} multiple accept="image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp"
          hint="Dosya adında soru numarası olmalı: soru_3.png, S3.jpg, 3.png." disabled={running} files={images} onFiles={setImages} />
        <FileDrop label="MP3 dosyaları (isteğe bağlı)" icon={MusicNotes} multiple accept=".mp3,audio/mpeg,audio/mp3"
          hint="Adında aynı soru numarası olan MP3 o soruya eşleşir." disabled={running} files={audios} onFiles={setAudios} />
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <label className="block text-sm font-semibold">Kategori
            <select className={field} value={category} disabled={running} onChange={e => setCategory(e.target.value)}>{QUESTION_CATEGORIES.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}</select>
          </label>
          <label className="block text-sm font-semibold">Koleksiyon / deneme
            <CollectionInput className={field} placeholder="Örnek: Eylül Denemesi 1" value={examName} disabled={running} onChange={setExamName} />
          </label>
          <label className="block text-sm font-semibold">Sınav / yıl
            <input className={field} value={examYear} disabled={running} onChange={e => setExamYear(e.target.value)} />
          </label>
        </div>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" className="mt-1" checked={generateVoice} disabled={running} onChange={e => setGenerateVoice(e.target.checked)} />
          <span>MP3'ü olmayan soruları otomatik seslendir{generateVoice && voiceChars > 0 && <> · <strong>{runnable.filter(i => !i.audio).length} soru</strong></>}
            <span className="block text-xs text-[#787670]">Kapalıysa bu sorular oluşturulur ve ses için editörde bekler.</span></span>
        </label>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" className="mt-1" checked={exportVideo} disabled={running} onChange={e => setExportVideo(e.target.checked)} />
          <span>Hazır olan soruların MP4 videosunu da hazırla
            <span className="block text-xs text-[#787670]">İşlem bitene kadar bu sekmeyi açık tutun.</span></span>
        </label>
        {exportVideo && <label className="flex items-start gap-2 text-sm ml-6">
          <input type="checkbox" className="mt-1" checked={asZip} disabled={running} onChange={e => setAsZip(e.target.checked)} />
          <span>Videoları sonunda tek ZIP dosyası olarak indir
            <span className="block text-xs text-[#787670]">Kapalıysa her video hazır olunca ayrı indirilir (tarayıcı birden çok indirmeye izin isteyebilir).</span></span>
        </label>}
      </div>
      <div className="space-y-3">
      <label className="block text-sm font-semibold">Çözüm metinleri
        <textarea dir="auto" rows={16} disabled={running} value={solutions} onChange={e => setSolutions(e.target.value)}
          placeholder={'Soru 1\nA şıkkı … olmaz.\nDoğru cevap C.\n\nSoru 2\n…'} className={`${field} font-normal leading-relaxed`} />
        <span className="block text-xs font-normal text-[#787670] mt-1">Her soru kendi satırında "Soru 3" başlığıyla başlamalı.</span>
      </label>
      <FileDrop label="…ya da metin dosyası" icon={FileText} accept=".txt,.md,text/plain" disabled={running} files={solutionFile}
        onFiles={async files => { setSolutionFile(files); if (files[0]) setSolutions(await files[0].text()); }} />
      </div>
    </div>

    {error && <p role="alert" className="save-alert">{error}</p>}
    {videoCount > 0 && !running && <div className="mt-4 flex flex-wrap items-center gap-3 p-4 rounded-xl bg-[#F4EDEB] border border-[#E5D5D2]">
      <FileZip size={24} className="text-[#8B1E2D]" />
      <span className="mr-auto text-base font-semibold">{videoCount} video hazır.</span>
      <button className="studio-primary" onClick={() => downloadZip()}><DownloadSimple size={18} />Hepsini ZIP olarak indir</button>
    </div>}
    {plan.unmatched.length > 0 && <p className="text-xs text-[#B45309] mt-4">Eşleşmeyen dosyalar: {plan.unmatched.join(' · ')}</p>}
    <p className="library-count" role="status">{plan.items.length ? `${plan.items.length} soru bulundu · ${runnable.length} tanesi hazırlanabilir` : 'Dosyaları seçip çözüm metnini ekleyin.'}</p>

    {plan.items.length > 0 && <div className="overflow-x-auto"><table className="w-full text-sm text-left">
      <thead className="bg-[#FAF9F5]"><tr>{['Soru', 'Görsel', 'Çözüm', 'Cevap', 'Ses', 'Durum', ''].map(h => <th key={h} className="p-3 whitespace-nowrap font-semibold">{h}</th>)}</tr></thead>
      <tbody>{plan.items.map(item => {
        const row = rows[item.number];
        return <tr key={item.number} className="border-t border-[#E5E4DC] align-top">
          <td className="p-3 font-semibold">{item.number}</td>
          <td className="p-3">{item.image?.name || <span className="text-red-700">yok</span>}</td>
          <td className="p-3 max-w-xs"><span dir="auto" className="line-clamp-2 text-[#55544F]">{item.solution?.replace(/\s+/g, ' ').slice(0, 110) || <span className="text-red-700">yok</span>}</span></td>
          <td className="p-3">{item.answer || '—'}</td>
          <td className="p-3">{item.audio?.name || (generateVoice ? 'Otomatik' : 'Sonra')}</td>
          <td className="p-3 min-w-48">
            {row ? <>
              <strong className={row.stage === 'failed' ? 'text-red-700' : ''}>{stageLabels[row.stage]}{row.stage === 'video' && row.percent ? ` %${row.percent}` : ''}</strong>
              {row.readiness && <span className={`block text-xs font-semibold ${readinessTones[row.readiness]}`}>{readinessLabels[row.readiness]}</span>}
              {row.message && <span className="block text-xs text-[#787670]">{row.message}</span>}
            </> : <>
              {item.problems.map(p => <span key={p} className="block text-xs text-red-700">{p}</span>)}
              {item.notes.map(n => <span key={n} className="block text-xs text-[#B45309]">{n}</span>)}
              {!item.problems.length && !item.notes.length && <span className="text-xs text-[#15803D]">Hazır</span>}
            </>}
          </td>
          <td className="p-3"><span className="flex flex-wrap gap-2">
            {videos[item.number] && <button className="studio-secondary" title="Bu videoyu ayrı indir" onClick={() => saveFile(videos[item.number].blob, videos[item.number].name)}><DownloadSimple size={16} />MP4</button>}
            {row?.projectId && !running && <button className="studio-secondary" onClick={() => onOpenProject(row.projectId!)}>Aç<ArrowRight size={16} /></button>}
          </span></td>
        </tr>;
      })}</tbody>
    </table></div>}
    {!plan.items.length && <div className="library-empty"><Stack size={28} /><h3>Bir deneme ya da soru setini tek seferde hazırlayın</h3><p>Görsellerin adı soru numarasını içermeli; çözüm metni "Soru 1", "Soru 2" başlıklarıyla bölünmeli.</p></div>}
  </section>;
}
