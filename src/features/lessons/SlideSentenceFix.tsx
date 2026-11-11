import { useEffect, useRef, useState } from 'react';
import WaveSurfer from 'wavesurfer.js';
import RegionsPlugin, { type Region } from 'wavesurfer.js/plugins/regions';
import { ArrowCounterClockwise, ArrowsClockwise, CircleNotch, Pause, Play, Scissors } from '@phosphor-icons/react';
import { NARRATION_RATE, decodeAudio } from '../../services/narration/audioCodec';
import { plainMessage } from '../../services/plainError';
import { lessonRepository } from './lessonRepository';
import { sentenceCuts, type SentenceRow } from './slideRevoice';

const secs = (t: number) => `${t.toFixed(1).replace('.', ',')} sn`;
const PICK_COLOR = 'rgba(139, 30, 45, 0.18)';

/**
 * "Sesi düzelt": the slide's voice as a waveform. The teacher picks a sentence (its place is
 * shown on the wave, a guess from the voice's pauses) or drags over any stretch, moves its edges,
 * listens, then deletes that stretch or has the sentence read again into it. The rest of the voice
 * and the teacher's marks stay; marks after it move with the voice.
 */
export function SlideSentenceFix({ rows, audioPath, disabled, onCut, onRevoice, onUndo }: {
  rows: SentenceRow[];
  /** The slide's stored voice (a fresh link is asked for when the strip opens). */
  audioPath: string;
  disabled?: boolean;
  onCut: (start: number, end: number) => void;
  onRevoice: (index: number, start: number, end: number) => void;
  /** Takes back the last fix on this slide. */
  onUndo?: () => void;
}) {
  const changed = rows.some(r => r.changed);
  const [open, setOpen] = useState(changed || !!onUndo);
  return (
    <details className="rounded-md border border-[#E5E4DC] bg-white" open={open} onToggle={e => setOpen(e.currentTarget.open)}>
      <summary className="cursor-pointer select-none px-2.5 py-1.5 text-sm font-semibold text-[#1C1917]">
        Sesi düzelt (bir cümle hatalı, bir yer iki kez okunmuş…)
      </summary>
      {open && <VoiceStrip rows={rows} audioPath={audioPath} disabled={disabled} onCut={onCut} onRevoice={onRevoice} onUndo={onUndo} changed={changed} />}
    </details>
  );
}

function VoiceStrip({ rows, audioPath, disabled, onCut, onRevoice, onUndo, changed }: Parameters<typeof SlideSentenceFix>[0] & { changed: boolean }) {
  const waveBox = useRef<HTMLDivElement>(null);
  const surfer = useRef<WaveSurfer | null>(null);
  const regions = useRef<ReturnType<typeof RegionsPlugin.create> | null>(null);
  const [cuts, setCuts] = useState<Array<{ start: number; end: number }> | null>(null);
  const [pick, setPick] = useState<{ start: number; end: number; index: number | null } | null>(null);
  const [playing, setPlaying] = useState(false);
  const [error, setError] = useState('');
  const said = rows.map(r => r.said).join('\n');

  useEffect(() => {
    let alive = true, blobUrl = '';
    setCuts(null); setPick(null); setError('');
    (async () => {
      const res = await fetch(await lessonRepository.link(audioPath), { cache: 'no-store' });
      if (!res.ok) throw new Error('Ses açılamadı. Sayfayı yenileyip tekrar deneyin.');
      const blob = await res.blob();
      const samples = await decodeAudio(blob);
      if (!alive || !waveBox.current) return;
      setCuts(sentenceCuts(samples, NARRATION_RATE, rows.map(r => r.said)));
      blobUrl = URL.createObjectURL(blob);
      const plugin = RegionsPlugin.create();
      const ws = WaveSurfer.create({
        container: waveBox.current, height: 56, waveColor: '#D5D4CC', progressColor: '#C98A93', cursorColor: '#8B1E2D', cursorWidth: 2,
        barWidth: 2, barGap: 1, barRadius: 2, normalize: true, url: blobUrl, plugins: [plugin],
      });
      surfer.current = ws; regions.current = plugin;
      // Dragging over the wave picks any stretch (e.g. a word read twice).
      plugin.enableDragSelection({ color: PICK_COLOR });
      plugin.on('region-created', (r: Region) => {
        plugin.getRegions().filter(o => o !== r).forEach(o => o.remove());
        setPick(p => ({ start: r.start, end: r.end, index: p && Math.abs(p.start - r.start) < .01 && Math.abs(p.end - r.end) < .01 ? p.index : null }));
      });
      plugin.on('region-updated', (r: Region) => setPick(p => ({ start: r.start, end: r.end, index: p?.index ?? null })));
      ws.on('play', () => setPlaying(true));
      ws.on('pause', () => setPlaying(false));
    })().catch(e => { if (alive) setError(plainMessage(e, 'Ses açılamadı.')); });
    return () => {
      alive = false;
      surfer.current?.destroy(); surfer.current = null; regions.current = null;
      if (blobUrl) URL.revokeObjectURL(blobUrl);
    };
    // A new voice (after a fix) or other sentences: load again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audioPath, said]);

  const show = (start: number, end: number, index: number | null) => {
    const plugin = regions.current;
    if (!plugin) return;
    setPick({ start, end, index });
    plugin.clearRegions();
    plugin.addRegion({ start, end, color: PICK_COLOR, drag: true, resize: true });
    listen(start, end);
  };
  const listen = (start = pick?.start, end = pick?.end) => {
    const ws = surfer.current;
    if (!ws || start === undefined) return;
    if (playing) { ws.pause(); return; }
    void ws.play(start, end);
  };

  return (
    <div className="px-2.5 pb-2.5 space-y-2">
      <p className="text-xs text-[#55544F]">
        Bir cümleye tıklayın ya da dalganın üzerinde sürükleyerek bir yer seçin. Seçimin kenarlarını çekip tam yeri ayarlayın ve dinleyin.
        Sonra seçili yeri <strong>silin</strong> (ses hakkı harcamaz) ya da cümleyi oraya <strong>yeniden okutun</strong> (1 ses hakkı). Sesin geri kalanı ve işaretleriniz korunur.
        {changed && ' Metinde değiştirdiğiniz cümle yeni hâliyle okunur.'}
      </p>
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      <div className="relative">
        <div ref={waveBox} className="min-h-14 rounded border border-[#E5E4DC] bg-[#FAF9F5]" />
        {!cuts && !error && <span className="absolute inset-0 flex items-center justify-center gap-2 text-xs text-[#787670]"><CircleNotch size={14} className="animate-spin" /> Ses açılıyor…</span>}
      </div>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        {pick ? (
          <>
            <span className="tabular-nums text-[#33322E]">Seçili: {secs(pick.start)} – {secs(pick.end)}</span>
            <button type="button" onClick={() => listen()} className="flex items-center gap-1 rounded-md border border-[#D5D4CC] bg-white px-2 py-1 text-xs font-semibold hover:border-[#8B1E2D]">
              {playing ? <Pause size={13} /> : <Play size={13} />} Dinle
            </button>
            <button type="button" onClick={() => onCut(pick.start, pick.end)} disabled={disabled || pick.end - pick.start < .05}
              className="flex items-center gap-1 rounded-md border border-[#D5D4CC] bg-white px-2 py-1 text-xs font-semibold text-red-700 hover:border-red-700 disabled:opacity-50">
              <Scissors size={13} /> Seçili yeri sil
            </button>
            {pick.index !== null && (
              <button type="button" onClick={() => onRevoice(pick.index!, pick.start, pick.end)} disabled={disabled}
                className="flex items-center gap-1 rounded-md bg-[#8B1E2D] px-2 py-1 text-xs font-semibold text-white hover:bg-[#721824] disabled:opacity-50">
                <ArrowsClockwise size={13} /> {pick.index + 1}. cümleyi buraya yeniden oku
              </button>
            )}
          </>
        ) : <span className="text-xs text-[#787670]">Henüz bir yer seçmediniz.</span>}
        <span className="flex-1" />
        {onUndo && (
          <button type="button" onClick={onUndo} disabled={disabled} className="flex items-center gap-1.5 text-sm text-[#55544F] hover:text-[#8B1E2D] disabled:opacity-50">
            <ArrowCounterClockwise size={14} /> Olmadı, geri al
          </button>
        )}
      </div>
      <ol className="space-y-1">
        {rows.map((row, i) => (
          <li key={i}>
            <button type="button" onClick={() => cuts?.[i] && show(cuts[i].start, cuts[i].end, i)} disabled={!cuts}
              className={`w-full flex items-start gap-2 rounded px-1.5 py-1 text-left text-sm hover:bg-[#F2F1EB] disabled:opacity-60 ${pick?.index === i ? 'bg-[#8B1E2D]/10' : ''}`}
              title="Bu cümlenin seste olduğu yeri seç ve dinle">
              <span className="w-5 shrink-0 text-right tabular-nums text-[#787670]">{i + 1}.</span>
              <span dir="auto" className="flex-1 min-w-0 leading-snug text-[#33322E]">
                {row.now}
                {row.changed && <span className="ml-1.5 rounded bg-amber-100 px-1 text-xs font-semibold text-[#7C4A03]">değişti</span>}
              </span>
            </button>
          </li>
        ))}
      </ol>
    </div>
  );
}
