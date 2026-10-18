import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import {
  ArrowDown, ArrowLeft, ArrowUp, ArrowsClockwise, CaretLeft, CaretRight, CircleNotch, DownloadSimple, FilePdf, ImageSquare,
  Microphone, Play, Stop, Trash, UploadSimple,
} from '@phosphor-icons/react';
import { useConfirm } from '../../components/common/ConfirmDialog';
import type { LeaveGuard } from '../../layouts/AppLayout';
import { STANDARD_VOICE_CONFIG } from '../../config/voice';
import { askLowerWith, narrationService } from '../../services/narration/narrationService';
import { capacityLine, geminiKeyService, type TeacherKeyStatus } from '../../services/narration/geminiKeyService';
import { startsWithArabic } from '../../services/narration/narrationParts';
import { readDataUrl, saveFile } from '../../services/narration/browserMedia';
import { NARRATION_RATE, decodeAudio } from '../../services/narration/audioCodec';
import { plainMessage } from '../../services/plainError';
import { clockOf, expectedVoiceSeconds } from '../question-editor/voiceProgress';
import { lessonRepository } from './lessonRepository';
import { SLIDE_STATE_LABELS, clock, fitInside, lessonFileName, slideState, slidesToVoice, type Lesson, type LessonSlide, type SlideState } from './lessonPlan';
import { LessonPreview } from './LessonPreview';
import { isPdf, isPowerPoint, readReplacement, readSlides } from './pdfSlides';
import { exportLessonVideo } from './lessonVideo';
import { deckWords, fixKey, type SlideBlock } from './slideMarks';
import { drawnOnly, type SlideScene } from './slideScene';
import { SlideMarksPanel } from './SlideMarksPanel';
import { SlideMarksEditor } from './SlideMarksEditor';

const SLIDE_FILES = '.pdf,application/pdf,image/png,image/jpeg,image/webp,.pptx,.ppt';
const POWERPOINT_NOTE = 'PowerPoint dosyası doğrudan okunamıyor. PowerPoint’te Dosya → Farklı Kaydet → PDF seçip o PDF’i yükleyin.';

const STATE_STYLES: Record<SlideState, string> = {
  'no-text': 'bg-[#F2EFE9] text-[#787670]',
  'no-voice': 'bg-amber-50 text-[#92400E] border border-amber-200',
  'old-voice': 'bg-amber-50 text-[#92400E] border border-amber-200',
  ready: 'bg-green-50 text-[#15803D] border border-green-200',
};

const TOOL = 'flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-[#E5E4DC] bg-white text-sm font-medium text-[#33322E] hover:border-[#8B1E2D]/50 hover:text-[#8B1E2D] disabled:opacity-50 disabled:pointer-events-none';
const without = (errors: Record<string, string>, id: string) => Object.fromEntries(Object.entries(errors).filter(([key]) => key !== id));

type Busy = { slideId: string; startedAt: number; expected: number } | null;

/**
 * One Konu Anlatımı: the slides in order on the left, the chosen slide with its text and voice in
 * the middle, the whole lesson's length, preview and MP4 download along the bottom.
 */
export function LessonEditor({ initial, onBack, registerLeaveGuard }: {
  initial: Lesson;
  onBack: () => void;
  registerLeaveGuard?: (guard: LeaveGuard | null) => void;
}) {
  const confirm = useConfirm();
  const [lesson, setLesson] = useState(initial);
  const latest = useRef(initial);
  const [selected, setSelected] = useState(0);
  const [saveState, setSaveState] = useState<'saved' | 'waiting' | 'saving' | 'failed'>('saved');
  const [importing, setImporting] = useState<string | null>(null);
  const [voicing, setVoicing] = useState<Busy>(null);
  const [voiceAll, setVoiceAll] = useState<{ done: number; total: number } | null>(null);
  const stopAll = useRef(false);
  const [slideErrors, setSlideErrors] = useState<Record<string, string>>({});
  const [keyStatus, setKeyStatus] = useState<TeacherKeyStatus | null>(null);
  const [preview, setPreview] = useState<{ lesson: Lesson; at: number } | null>(null);
  const [exporting, setExporting] = useState<{ percent: number; message: string } | null>(null);
  const exportAbort = useRef<AbortController | null>(null);
  const [now, setNow] = useState(Date.now());
  const addInput = useRef<HTMLInputElement>(null);
  const replaceInput = useRef<HTMLInputElement>(null);
  const mp3Input = useRef<HTMLInputElement>(null);
  const [pointed, setPointed] = useState<SlideBlock | null>(null);
  /** "İşaretleri düzenle" is open for this slide. */
  const [markEditor, setMarkEditor] = useState<string | null>(null);

  // ---- Saving: text is saved a moment after typing stops; files and order at once.
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const chain = useRef<Promise<void>>(Promise.resolve());
  const saveNow = useCallback(() => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    setSaveState('saving');
    chain.current = chain.current.then(async () => {
      try {
        await lessonRepository.save(latest.current);
        setSaveState(timer.current ? 'waiting' : 'saved');
      } catch {
        setSaveState('failed');
      }
    });
    return chain.current;
  }, []);
  const update = useCallback((change: (l: Lesson) => Lesson, at: 'now' | 'later' = 'now') => {
    const next = change(latest.current);
    latest.current = next;
    setLesson(next);
    if (at === 'now') return saveNow();
    if (timer.current) clearTimeout(timer.current);
    setSaveState('waiting');
    timer.current = setTimeout(() => { timer.current = null; void saveNow(); }, 1200);
    return Promise.resolve();
  }, [saveNow]);
  const patchSlide = (id: string, patch: Partial<LessonSlide> | ((s: LessonSlide) => Partial<LessonSlide>), at: 'now' | 'later' = 'now') =>
    update(l => ({ ...l, slides: l.slides.map(s => s.id === id ? { ...s, ...(typeof patch === 'function' ? patch(s) : patch) } : s) }), at);
  // Typing then leaving the page right away still saves.
  useEffect(() => () => { if (timer.current) { clearTimeout(timer.current); void lessonRepository.save(latest.current).catch(() => undefined); } }, []);

  const working = !!(importing || voicing || voiceAll || exporting);
  useEffect(() => {
    if (!registerLeaveGuard) return;
    registerLeaveGuard(working ? () => {
      if (!window.confirm(exporting ? 'Video hazırlanıyor. Çıkarsanız durdurulur. Çıkılsın mı?' : 'Bir işlem sürüyor. Çıkarsanız yarıda kalır. Çıkılsın mı?')) return false;
      exportAbort.current?.abort();
      stopAll.current = true;
      return true;
    } : null);
    return () => registerLeaveGuard(null);
  }, [working, exporting, registerLeaveGuard]);
  useEffect(() => {
    if (!working && saveState !== 'waiting' && saveState !== 'saving') return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [working, saveState]);
  useEffect(() => {
    if (!voicing) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [voicing]);
  // Which Google key the next voice uses and what is left today; refreshed after each voice.
  useEffect(() => {
    if (voicing) return;
    let alive = true;
    geminiKeyService.status().then(s => { if (alive) setKeyStatus(s); }, () => undefined);
    return () => { alive = false; };
  }, [voicing]);

  const slides = lesson.slides;
  const index = Math.min(selected, Math.max(0, slides.length - 1));
  const slide = slides[index] as LessonSlide | undefined;
  const toVoice = slidesToVoice(slides);
  const voicedCount = slides.filter(s => slideState(s) === 'ready').length;
  const totalSeconds = slides.reduce((sum, s) => sum + (s.audio?.duration || 0), 0);
  const allReady = slides.length > 0 && voicedCount === slides.length;
  const deck = useMemo(() => deckWords(slides.map(s => s.lines)), [slides]);
  const fixMark = (sentence: string, part: number | undefined) => {
    if (!slide) return;
    const key = fixKey(sentence);
    void patchSlide(slide.id, s => {
      const { [key]: _old, ...rest } = s.markFixes || {};
      const fixes = part === undefined ? rest : { ...rest, [key]: part };
      return { markFixes: Object.keys(fixes).length ? fixes : undefined };
    });
  };
  const setScene = (id: string, scene: SlideScene | undefined) => void patchSlide(id, { scene });
  const pointedBox = (() => {
    if (!slide || !pointed) return null;
    const fit = fitInside(slide.width || 16, slide.height || 9, 16, 9);
    const pct = (v: number) => `${v * 100}%`;
    return {
      left: pct((fit.x + pointed.x * fit.width - 0.004 * fit.width) / 16), top: pct((fit.y + pointed.y * fit.height) / 9),
      width: pct((pointed.width + 0.008) * fit.width / 16), height: pct(pointed.height * fit.height / 9),
    };
  })();

  // ---- Adding slides
  const addSlides = async (files: File[]) => {
    if (!files.length) return;
    const ppt = files.filter(isPowerPoint);
    if (ppt.length) toast.error(POWERPOINT_NOTE, { duration: 12000 });
    const usable = files.filter(f => !isPowerPoint(f));
    if (!usable.length) return;
    try {
      setImporting('Slaytlar hazırlanıyor…');
      const pictures = await readSlides(usable, (done, total) => setImporting(`Slaytlar hazırlanıyor: ${done}/${total}`));
      const added: LessonSlide[] = [];
      for (const [i, pic] of pictures.entries()) {
        setImporting(`Slaytlar kaydediliyor: ${i + 1}/${pictures.length}`);
        const stored = await lessonRepository.storeFile(lesson.id, pic.url);
        if (pic.url.startsWith('blob:')) URL.revokeObjectURL(pic.url);
        added.push({ id: crypto.randomUUID(), imagePath: stored.path, imageUrl: stored.url, width: pic.width, height: pic.height, text: '', ...(pic.lines ? { lines: pic.lines } : {}) });
      }
      const first = latest.current.slides.length;
      const name = usable.find(isPdf)?.name.replace(/\.pdf$/i, '').trim();
      await update(l => ({ ...l, title: l.title.trim() || name || l.title, slides: [...l.slides, ...added] }));
      setSelected(first);
      toast.success(`${added.length} slayt eklendi.`);
    } catch (error) {
      toast.error(plainMessage(error, 'Slaytlar eklenemedi.'));
    } finally {
      setImporting(null);
    }
  };

  const replacePicture = async (file: File) => {
    if (!slide) return;
    if (isPowerPoint(file)) { toast.error(POWERPOINT_NOTE, { duration: 12000 }); return; }
    const target = slide.id, number = index + 1;
    try {
      setImporting('Yeni resim hazırlanıyor…');
      const pic = await readReplacement(file, number);
      const stored = await lessonRepository.storeFile(lesson.id, pic.url);
      if (pic.url.startsWith('blob:')) URL.revokeObjectURL(pic.url);
      // The new picture's text lines (none for a picture file); marks on the old one's lines go (what the teacher drew stays).
      await patchSlide(target, s => ({ imagePath: stored.path, imageUrl: stored.url, width: pic.width, height: pic.height, lines: pic.lines, markFixes: undefined, scene: drawnOnly(s.scene) }));
      toast.success(`${number}. slaytın resmi değişti; metni ve sesi aynı kaldı.`);
    } catch (error) {
      toast.error(plainMessage(error, 'Resim değiştirilemedi.'));
    } finally {
      setImporting(null);
    }
  };

  const move = (from: number, to: number) => {
    if (to < 0 || to >= slides.length) return;
    void update(l => {
      const next = [...l.slides];
      const [item] = next.splice(from, 1);
      next.splice(to, 0, item);
      return { ...l, slides: next };
    });
    setSelected(to);
  };

  const removeSlide = async () => {
    if (!slide) return;
    if (!await confirm({ title: `${index + 1}. slayt silinsin mi?`, message: 'Slayt, metni ve sesi bu konu anlatımından çıkarılır.', confirmLabel: 'Slaytı sil', danger: true })) return;
    const id = slide.id;
    await update(l => ({ ...l, slides: l.slides.filter(s => s.id !== id) }));
    setSelected(i => Math.max(0, Math.min(i, latest.current.slides.length - 1)));
  };

  // ---- Voice
  /** Voices one slide from its text; false when it did not happen (the reason is shown on the slide). */
  const voiceSlide = async (id: string): Promise<boolean> => {
    const target = latest.current.slides.find(s => s.id === id);
    const text = target?.text.trim() || '';
    if (!target) return false;
    if (!text) { setSlideErrors(e => ({ ...e, [id]: 'Önce bu slaytta ne söyleneceğini yazın.' })); return false; }
    if (timer.current) await saveNow();
    setSlideErrors(e => without(e, id));
    setVoicing({ slideId: id, startedAt: Date.now(), expected: expectedVoiceSeconds(text) });
    try {
      const result = await narrationService.generateNarration({
        projectId: lesson.id, text,
        voiceId: STANDARD_VOICE_CONFIG.voiceId, modelId: STANDARD_VOICE_CONFIG.modelId, outputFormat: STANDARD_VOICE_CONFIG.outputFormat,
      }, undefined, askLowerWith(confirm));
      let path = result.assetPath || '', url = result.audioUrl || '';
      // A voice the server could not store came back in the answer: store it here.
      if (!path) ({ path, url } = await lessonRepository.storeFile(lesson.id, url));
      // The server measured the voice: loading it again here to measure it can wait for good (a tab in
      // the background loads no media), and the teacher saw no voice although it was made and counted.
      // Marks placed while listening were timed to the old voice.
      await patchSlide(id, { audio: { path, url, duration: result.durationSeconds, spokenText: text, source: 'gemini' }, scene: undefined });
      return true;
    } catch (error) {
      setSlideErrors(e => ({ ...e, [id]: plainMessage(error, 'Seslendirme oluşturulamadı.') }));
      return false;
    } finally {
      setVoicing(null);
    }
  };

  const voiceThis = async () => {
    if (!slide) return;
    if (slide.audio && !await confirm({
      title: 'Bu slayt yeniden seslendirilsin mi?',
      message: `Şu anki sesi silinir, yerine yenisi üretilir. Bugünkü ses haklarınızdan biri kullanılır.${slide.scene ? ' İşaretlerde elle yaptığınız değişiklikler de silinir (yeni sese göre otomatik işaretler gelir).' : ''}`,
      confirmLabel: 'Yeniden seslendir',
    })) return;
    await voiceSlide(slide.id);
  };

  const voiceMissing = async () => {
    const ids = toVoice.map(i => slides[i].id);
    if (!ids.length) return;
    if (!await confirm({
      title: `${ids.length} slayt sırayla seslendirilsin mi?`,
      message: `Metni olup sesi olmayan (ya da metni sonradan değişen) ${ids.length} slayt tek tek seslendirilir. Bugünkü ses haklarınızdan ${ids.length} tanesi kullanılır. Bir slaytta sorun çıkarsa durur.`,
      confirmLabel: 'Seslendirmeye başla',
    })) return;
    stopAll.current = false;
    setVoiceAll({ done: 0, total: ids.length });
    try {
      for (const [n, id] of ids.entries()) {
        if (stopAll.current) break;
        setSelected(latest.current.slides.findIndex(s => s.id === id));
        if (!await voiceSlide(id)) break;
        setVoiceAll({ done: n + 1, total: ids.length });
      }
    } finally {
      setVoiceAll(null);
    }
  };

  const uploadMp3 = async (file: File) => {
    if (!slide) return;
    const id = slide.id;
    if (slide.audio && !await confirm({ title: 'Ses değiştirilsin mi?', message: `Bu slaytın şu anki sesi yerine yüklediğiniz dosya kullanılır.${slide.scene ? ' İşaretlerde elle yaptığınız değişiklikler silinir.' : ''}`, confirmLabel: 'Değiştir' })) return;
    try {
      setImporting('Ses dosyası yükleniyor…');
      const dataUrl = await readDataUrl(file);
      const duration = (await decodeAudio(dataUrl)).length / NARRATION_RATE;
      const stored = await lessonRepository.storeFile(lesson.id, dataUrl);
      await patchSlide(id, s => ({ audio: { path: stored.path, url: stored.url, duration, spokenText: s.text, source: 'upload', fileName: file.name }, scene: undefined }));
      setSlideErrors(e => without(e, id));
    } catch (error) {
      toast.error(plainMessage(error, 'Ses dosyası yüklenemedi.'));
    } finally {
      setImporting(null);
    }
  };

  const deleteVoice = async () => {
    if (!slide?.audio) return;
    if (!await confirm({ title: 'Bu slaytın sesi silinsin mi?', message: 'Metni kalır; sesi yeniden oluşturabilir ya da MP3 yükleyebilirsiniz.', confirmLabel: 'Sesi sil', danger: true })) return;
    await patchSlide(slide.id, { audio: undefined, scene: undefined });
  };

  // ---- Video
  const download = async () => {
    if (!allReady) return;
    exportAbort.current = new AbortController();
    setExporting({ percent: 0, message: 'Hazırlanıyor…' });
    try {
      const blob = await exportLessonVideo(latest.current, (percent, message) => setExporting({ percent, message }), exportAbort.current.signal);
      saveFile(blob, lessonFileName(latest.current.title));
      toast.success('Video indirildi.');
    } catch (error) {
      if ((error as Error)?.name !== 'AbortError') toast.error(plainMessage(error, 'Video hazırlanamadı.'));
    } finally {
      setExporting(null);
      exportAbort.current = null;
    }
  };

  const capacity = capacityLine(keyStatus);
  const busyHere = voicing && slide && voicing.slideId === slide.id;
  const elapsed = voicing ? (now - voicing.startedAt) / 1000 : 0;
  const saveLabel = saveState === 'saved' ? 'Kaydedildi' : saveState === 'failed' ? 'Kaydedilemedi' : 'Kaydediliyor…';

  return (
    <div className="max-w-7xl mx-auto p-4 sm:p-6 space-y-4">
      {/* Title row */}
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={onBack} className="flex items-center gap-1.5 text-sm text-[#55544F] hover:text-[#8B1E2D]">
          <ArrowLeft size={16} /> Konu anlatımları
        </button>
        <input
          value={lesson.title}
          onChange={e => { const title = e.target.value; void update(l => ({ ...l, title }), 'later'); }}
          placeholder="Konu adı (örneğin: Mübteda ve haber)"
          aria-label="Konu adı"
          className="flex-1 min-w-48 text-lg font-semibold bg-transparent border-b border-transparent hover:border-[#D5D4CC] focus:border-[#8B1E2D] focus:outline-none px-1 py-1"
        />
        <span role="status" className={`text-xs ${saveState === 'failed' ? 'text-red-700' : 'text-[#787670]'}`}>
          {saveLabel}
          {saveState === 'failed' && <button type="button" onClick={() => void saveNow()} className="ml-2 underline">Tekrar dene</button>}
        </span>
      </div>

      <input ref={addInput} type="file" multiple accept={SLIDE_FILES} className="sr-only" onChange={e => { void addSlides(Array.from(e.target.files || [])); e.target.value = ''; }} />
      <input ref={replaceInput} type="file" accept={SLIDE_FILES} className="sr-only" onChange={e => { const f = e.target.files?.[0]; if (f) void replacePicture(f); e.target.value = ''; }} />
      <input ref={mp3Input} type="file" accept=".mp3,audio/mpeg,.wav,audio/wav" className="sr-only" onChange={e => { const f = e.target.files?.[0]; if (f) void uploadMp3(f); e.target.value = ''; }} />

      {importing && (
        <p role="status" className="flex items-center gap-2 text-sm text-[#1C1917] bg-white border rounded-lg px-3 py-2">
          <CircleNotch size={16} className="animate-spin text-[#8B1E2D]" /> {importing}
        </p>
      )}

      {!slides.length ? (
        <SlideDrop disabled={!!importing} onFiles={files => void addSlides(files)} />
      ) : (
        <div className="grid gap-4 lg:grid-cols-[220px_minmax(0,1fr)]">
          {/* Slides in order */}
          <aside className="space-y-2">
            <ol className="space-y-2 max-h-[34vh] lg:max-h-[calc(100vh-300px)] overflow-y-auto pr-1" aria-label="Slaytlar">
              {slides.map((s, i) => {
                const state = slideState(s);
                return (
                  <li key={s.id}>
                    <button type="button" onClick={() => setSelected(i)} aria-current={i === index ? 'true' : undefined}
                      className={`w-full text-left rounded-lg border p-1.5 flex gap-2 items-center bg-white transition-colors ${i === index ? 'border-[#8B1E2D] ring-2 ring-[#8B1E2D]/20' : 'border-[#E5E4DC] hover:border-[#8B1E2D]/50'}`}>
                      <span className="text-xs font-bold tabular-nums w-5 text-center text-[#55544F] shrink-0">{i + 1}</span>
                      <img src={s.imageUrl} crossOrigin="anonymous" alt="" className="w-20 aspect-video object-contain bg-[#F5F4F0] rounded shrink-0" />
                      <span className="min-w-0 flex flex-col gap-1">
                        <span className={`text-[11px] font-semibold px-1.5 py-0.5 rounded w-fit ${STATE_STYLES[state]}`}>
                          {voicing?.slideId === s.id ? 'Ses üretiliyor…' : SLIDE_STATE_LABELS[state]}
                        </span>
                        {s.audio && <span className="text-[11px] text-[#787670] tabular-nums">{clock(s.audio.duration)}</span>}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ol>
            <button type="button" disabled={!!importing} onClick={() => addInput.current?.click()}
              className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg border border-dashed border-[#D5D4CC] text-sm font-semibold text-[#8B1E2D] hover:bg-white disabled:opacity-50">
              <FilePdf size={16} /> Slayt ekle (PDF ya da resim)
            </button>
          </aside>

          {/* The chosen slide */}
          {slide && (
            <section className="grid gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(340px,1fr)] items-start min-w-0" aria-label={`${index + 1}. slayt`}>
             <div className="space-y-3 min-w-0">
              <div className="relative bg-white border rounded-xl overflow-hidden">
                <img src={slide.imageUrl} crossOrigin="anonymous" alt={`${index + 1}. slayt`} className="w-full aspect-video object-contain bg-white" />
                {pointedBox && <span aria-hidden="true" className="absolute rounded bg-amber-300/40 ring-2 ring-amber-500 pointer-events-none" style={pointedBox} />}
                <div className="absolute top-2 left-2 flex gap-1">
                  <span className="px-2 py-0.5 rounded bg-black/60 text-white text-xs font-semibold">{index + 1} / {slides.length}</span>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-1.5 text-sm">
                <button type="button" onClick={() => setSelected(i => Math.max(0, i - 1))} disabled={index === 0} className={TOOL} aria-label="Önceki slayt"><CaretLeft size={16} /> Önceki</button>
                <button type="button" onClick={() => setSelected(i => Math.min(slides.length - 1, i + 1))} disabled={index === slides.length - 1} className={TOOL} aria-label="Sonraki slayt">Sonraki <CaretRight size={16} /></button>
                <span className="flex-1" />
                <button type="button" onClick={() => move(index, index - 1)} disabled={index === 0 || working} className={TOOL} title="Yukarı taşı"><ArrowUp size={16} /> Yukarı</button>
                <button type="button" onClick={() => move(index, index + 1)} disabled={index === slides.length - 1 || working} className={TOOL} title="Aşağı taşı"><ArrowDown size={16} /> Aşağı</button>
                <button type="button" onClick={() => replaceInput.current?.click()} disabled={working} className={TOOL} title="Slaytı düzelttiyseniz yeni resmini ya da sunumun yeni PDF’ini seçin"><ImageSquare size={16} /> Resmi değiştir</button>
                <button type="button" onClick={() => void removeSlide()} disabled={working} className={`${TOOL} text-red-700`} title="Slaytı sil"><Trash size={16} /> Sil</button>
              </div>
             </div>
             <div className="space-y-3 min-w-0">

              <label className="block space-y-1.5">
                <span className="text-sm font-semibold text-[#1C1917]">Bu slaytta ne anlatacaksınız?</span>
                <textarea
                  value={slide.text}
                  onChange={e => { const text = e.target.value; void patchSlide(slide.id, { text }, 'later'); }}
                  rows={7}
                  dir="auto"
                  placeholder="Buraya yazdığınız metin bu slaytın sesi olarak okunur."
                  className="w-full rounded-lg border border-[#D5D4CC] bg-white p-3 text-[15px] leading-relaxed focus:outline-none focus:border-[#8B1E2D] focus:ring-2 focus:ring-[#8B1E2D]/15"
                />
              </label>
              {startsWithArabic(slide.text) && (
                <p className="text-sm text-[#7C4A03] bg-amber-50 border border-amber-200 rounded-md px-2.5 py-1.5 leading-relaxed">
                  Metin Arapça başlıyor. Kısa bir Türkçe cümleyle başlatın (örneğin “Şimdi örneğe bakalım.”); yoksa ses Türkçeyi de Arap aksanıyla okur.
                </p>
              )}
              {slideState(slide) === 'old-voice' && (
                <p className="text-sm text-[#7C4A03] bg-amber-50 border border-amber-200 rounded-md px-2.5 py-1.5">
                  Metni ses oluşturulduktan sonra değiştirdiniz. Yeni metnin okunması için yeniden seslendirin.
                </p>
              )}

              <div className="rounded-lg border border-[#E5E4DC] bg-[#FAF9F5] p-3 space-y-2.5">
                {slide.audio ? (
                  <div className="space-y-1.5">
                    <p className="text-sm font-semibold text-[#1C1917]">
                      {slide.audio.source === 'upload' ? `Yüklenen ses: ${slide.audio.fileName || 'ses.mp3'}` : 'Slaytın sesi'} · {clock(slide.audio.duration)}
                    </p>
                    <audio key={slide.audio.url} src={slide.audio.url} controls preload="metadata" className="w-full" />
                  </div>
                ) : (
                  <p className="text-sm text-[#55544F]">Bu slaytın henüz sesi yok.</p>
                )}
                {busyHere && (
                  <p role="status" className="flex items-center gap-2 text-sm text-[#1C1917]">
                    <CircleNotch size={16} className="animate-spin text-[#8B1E2D]" />
                    Ses üretiliyor. {clockOf(elapsed)} geçti; bu uzunlukta bir metin genelde {clockOf(Math.max(15, voicing!.expected))} sürer.
                  </p>
                )}
                {slideErrors[slide.id] && <p role="alert" className="text-sm text-red-700">{slideErrors[slide.id]}</p>}
                <div className="flex flex-wrap gap-2">
                  <button type="button" onClick={() => void voiceThis()} disabled={working || !slide.text.trim()}
                    className="flex items-center gap-2 px-3.5 py-2 rounded-lg bg-[#8B1E2D] hover:bg-[#721824] text-white text-sm font-semibold disabled:opacity-50">
                    {slide.audio ? <ArrowsClockwise size={16} /> : <Microphone size={16} />}
                    {slide.audio ? 'Yeniden seslendir' : 'Sesi oluştur'}
                  </button>
                  <button type="button" onClick={() => mp3Input.current?.click()} disabled={working} className={TOOL}><UploadSimple size={16} /> MP3 yükle</button>
                  {slide.audio && <button type="button" onClick={() => void deleteVoice()} disabled={working} className={`${TOOL} text-red-700`}><Trash size={16} /> Sesi sil</button>}
                </div>
                {capacity && <p className="text-xs text-[#787670]">{capacity}</p>}
              </div>
              {!lesson.marksOff && (slide.text.trim() || slide.audio) && (
                <SlideMarksPanel slide={slide} deck={deck} disabled={working} onFix={fixMark} onHover={setPointed}
                  onEdit={() => setMarkEditor(slide.id)} onAuto={() => setScene(slide.id, undefined)} />
              )}
             </div>
            </section>
          )}
        </div>
      )}

      {/* The whole lesson */}
      {slides.length > 0 && (
        <div className="sticky bottom-0 -mx-4 sm:mx-0 bg-white/95 backdrop-blur border-t sm:border sm:rounded-xl px-4 py-3 flex flex-wrap items-center gap-3 shadow-sm">
          <p className="text-sm text-[#1C1917]">
            <strong>{slides.length}</strong> slayt · <strong>{voicedCount}</strong> ses hazır · toplam <strong className="tabular-nums">{clock(totalSeconds)}</strong>
          </p>
          <span className="flex-1" />
          {voiceAll ? (
            <button type="button" onClick={() => { stopAll.current = true; }} className={TOOL}>
              <Stop size={16} /> Durdur ({voiceAll.done}/{voiceAll.total} hazır)
            </button>
          ) : toVoice.length > 0 && (
            <button type="button" onClick={() => void voiceMissing()} disabled={working} className={TOOL}>
              <Microphone size={16} /> Eksik sesleri oluştur ({toVoice.length})
            </button>
          )}
          <label className="flex items-center gap-1.5 text-sm text-[#33322E]" title="Anlatılan madde slaytta boyanır, anlatımı bitince yanına tik atılır">
            <input type="checkbox" checked={!lesson.marksOff} disabled={working}
              onChange={e => { const on = e.target.checked; void update(l => ({ ...l, marksOff: !on })); }} className="accent-[#8B1E2D]" />
            Slaytlarda işaretler
          </label>
          <button type="button" onClick={() => setPreview({ lesson: latest.current, at: index })} disabled={!allReady || working} className={TOOL}
            title={allReady ? 'Videoyu indirmeden önce baştan izleyin' : 'Her slaytın sesi hazır olunca açılır'}>
            <Play size={16} /> Baştan izle
          </button>
          {exporting ? (
            <span className="flex items-center gap-2">
              <span role="status" className="text-sm font-semibold tabular-nums text-[#8B1E2D]">Video hazırlanıyor… %{Math.round(exporting.percent)}</span>
              <button type="button" onClick={() => exportAbort.current?.abort()} className={TOOL}>İptal</button>
            </span>
          ) : (
            <button type="button" onClick={() => void download()} disabled={!allReady || working}
              title={allReady ? '' : 'Her slaytın sesi hazır olunca açılır'}
              className="flex items-center gap-2 px-3.5 py-2 rounded-lg bg-[#8B1E2D] hover:bg-[#721824] text-white text-sm font-semibold disabled:opacity-50">
              <DownloadSimple size={16} /> Videoyu indir (MP4)
            </button>
          )}
          {!allReady && <p className="basis-full text-xs text-[#787670]">Baştan izleme ve video indirme, her slaytın sesi hazır olunca açılır.</p>}
        </div>
      )}

      {markEditor && slide?.id === markEditor && slide.audio && (() => {
        const voiced = (i: number) => slides[i]?.audio ? () => { setSelected(i); setMarkEditor(slides[i].id); } : undefined;
        return (
          <SlideMarksEditor key={slide.id} slide={slide} number={index + 1} count={slides.length} deck={deck}
            onChange={scene => setScene(slide.id, scene)} onClose={() => setMarkEditor(null)}
            onPrevious={voiced(index - 1)} onNext={voiced(index + 1)} />
        );
      })()}
      {preview && <LessonPreview lesson={preview.lesson} startAt={preview.at} onClose={() => setPreview(null)} />}
    </div>
  );
}

/** The first step of an empty lesson: the presentation as a PDF (or its slides as pictures). */
export function SlideDrop({ disabled, onFiles }: { disabled?: boolean; onFiles: (files: File[]) => void }) {
  const [over, setOver] = useState(false);
  return (
    <label
      onDragOver={e => { if (disabled) return; e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={e => { e.preventDefault(); setOver(false); if (!disabled) onFiles(Array.from(e.dataTransfer.files)); }}
      className={`flex flex-col items-center justify-center gap-3 text-center rounded-2xl border-2 border-dashed px-6 py-14 transition-colors ${
        disabled ? 'opacity-60 cursor-not-allowed' : over ? 'border-[#8B1E2D] bg-[#F8EEEE] cursor-copy' : 'border-[#D5D4CC] bg-white hover:border-[#8B1E2D]/60 cursor-pointer'}`}
    >
      <span className="w-12 h-12 rounded-xl bg-[#8B1E2D]/10 text-[#8B1E2D] flex items-center justify-center"><FilePdf size={26} weight="bold" /></span>
      <span className="text-base font-semibold text-[#1C1917]">Sunumunuzun PDF’ini buraya bırakın ya da <span className="text-[#8B1E2D]">seçin</span></span>
      <span className="text-sm text-[#55544F] max-w-xl">
        PowerPoint’te <strong>Dosya → Farklı Kaydet → PDF</strong> ile kaydedin. Her sayfa bir slayt olur, sırası korunur.
        Slaytları resim olarak (PNG, JPG) da yükleyebilirsiniz; dosya adındaki numaraya göre sıralanır.
      </span>
      <input type="file" multiple accept={SLIDE_FILES} className="sr-only" disabled={disabled}
        onChange={e => { onFiles(Array.from(e.target.files || [])); e.target.value = ''; }} />
    </label>
  );
}
