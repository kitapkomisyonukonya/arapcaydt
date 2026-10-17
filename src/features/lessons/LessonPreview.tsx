import { useEffect, useRef, useState } from 'react';
import { CircleNotch, Pause, Play, X } from '@phosphor-icons/react';
import { plainMessage } from '../../services/plainError';
import { clock, slideAt, type Lesson, type LessonTimeline } from './lessonPlan';
import { drawLessonFrame, lessonMarks, lessonTrack, loadSlideImages, type LessonMarks } from './lessonVideo';

/**
 * "Baştan izle": the lesson exactly as the MP4 will be (same pictures, same sound track, same
 * pauses and changes). A slide number jumps to that slide.
 */
export function LessonPreview({ lesson, startAt = 0, onClose }: { lesson: Lesson; startAt?: number; onClose: () => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const audio = useRef<HTMLAudioElement>(null);
  const [ready, setReady] = useState<{ url: string; timeline: LessonTimeline; images: HTMLImageElement[]; marks: LessonMarks } | null>(null);
  const [error, setError] = useState('');
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    let alive = true, url = '';
    Promise.all([lessonTrack(lesson), loadSlideImages(lesson)]).then(([track, images]) => {
      url = track.url;
      if (alive) setReady({ ...track, images, marks: lessonMarks(lesson, track.timeline, track.pauses) }); else URL.revokeObjectURL(url);
    }, e => { if (alive) setError(plainMessage(e, 'Önizleme hazırlanamadı.')); });
    return () => { alive = false; if (url) URL.revokeObjectURL(url); };
  }, [lesson]);

  // Start at the chosen slide once the sound is there.
  useEffect(() => {
    if (!ready || !audio.current) return;
    const at = ready.timeline.spans[startAt]?.start ?? 0;
    audio.current.currentTime = Math.max(0, at - 0.3);
    void audio.current.play().catch(() => undefined);
  }, [ready, startAt]);

  useEffect(() => {
    if (!ready) return;
    let frame = 0;
    const tick = () => {
      const t = audio.current?.currentTime ?? 0;
      const ctx = canvas.current?.getContext('2d');
      if (ctx) drawLessonFrame(ctx, ctx.canvas.width, ctx.canvas.height, ready.images, ready.timeline, t, ready.marks);
      setTime(t);
      frame = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(frame);
  }, [ready]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const current = ready ? slideAt(ready.timeline, time).index : 0;
  const seek = (t: number) => { if (audio.current) audio.current.currentTime = t; };
  const toggle = () => { const a = audio.current; if (!a) return; if (a.paused) void a.play(); else a.pause(); };

  return (
    <div role="dialog" aria-modal="true" aria-label="Konu anlatımını baştan izle" className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4">
      <div className="w-full max-w-5xl bg-[#1C1917] rounded-xl overflow-hidden shadow-xl">
        <div className="flex items-center justify-between px-4 py-2.5 text-white">
          <span className="text-sm font-semibold truncate">{lesson.title || 'Konu anlatımı'} · {lesson.slides.length} slayt</span>
          <button type="button" onClick={onClose} className="p-1.5 rounded hover:bg-white/10" aria-label="Kapat" title="Kapat (Esc)"><X size={18} /></button>
        </div>
        <div className="relative bg-white aspect-video">
          <canvas ref={canvas} width={1280} height={720} className="w-full h-full block" />
          {!ready && !error && (
            <p role="status" className="absolute inset-0 flex items-center justify-center gap-2 text-sm text-[#55544F]">
              <CircleNotch size={18} className="animate-spin" /> Sesler birleştiriliyor…
            </p>
          )}
          {error && <p role="alert" className="absolute inset-0 flex items-center justify-center p-6 text-center text-sm text-red-700">{error}</p>}
        </div>
        {ready && (
          <div className="px-4 py-3 space-y-2.5 text-white">
            <div className="flex items-center gap-3">
              <button type="button" onClick={toggle} className="w-9 h-9 rounded-full bg-[#8B1E2D] hover:bg-[#721824] flex items-center justify-center shrink-0" aria-label={playing ? 'Durdur' : 'Oynat'}>
                {playing ? <Pause size={16} weight="fill" /> : <Play size={16} weight="fill" className="ml-0.5" />}
              </button>
              <span className="text-sm tabular-nums shrink-0">{clock(time)}</span>
              <input type="range" min={0} max={ready.timeline.total} step={0.1} value={time} onChange={e => seek(Number(e.target.value))}
                className="flex-1 accent-[#C2414F]" aria-label="Videoda konum" />
              <span className="text-sm tabular-nums shrink-0">{clock(ready.timeline.total)}</span>
            </div>
            <div className="flex flex-wrap gap-1.5" aria-label="Slayta git">
              {ready.timeline.spans.map((span, i) => (
                <button key={i} type="button" onClick={() => seek(Math.max(0, span.start - 0.3))}
                  aria-current={i === current ? 'true' : undefined}
                  className={`min-w-8 px-2 py-1 rounded text-xs font-semibold tabular-nums ${i === current ? 'bg-white text-[#1C1917]' : 'bg-white/10 hover:bg-white/20'}`}>
                  {i + 1}
                </button>
              ))}
            </div>
          </div>
        )}
        {ready && <audio ref={audio} src={ready.url} onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)} />}
      </div>
    </div>
  );
}
