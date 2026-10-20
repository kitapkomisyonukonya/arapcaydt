import { useEffect, useMemo, useRef, useState } from 'react';
import WaveSurfer from 'wavesurfer.js';
import TimelinePlugin from 'wavesurfer.js/plugins/timeline';
import { ArrowCounterClockwise, ArrowsOutLineHorizontal, Check, DotsThree, HandPalm, ListBullets, MagnifyingGlassMinus, MagnifyingGlassPlus, Microphone, Pause, Play, PlusCircle, Stop, WarningCircle, X } from '@phosphor-icons/react';
import type { NarrationWord } from '../../types';
import { narrationDrift } from '../../services/analysis/timelineAligner';
import { PART_CHARS, spokenLength } from '../../services/narration/narrationParts';
import { nextPick, partRanges, sentenceRanges, sentenceTimes, spokenSpan, wholeSentences, type TextRange } from '../../services/narration/revoice';
import { clock } from './workflow';

interface Props {
  solutionText: string;
  words: NarrationWord[];
  duration: number;
  audioUrl: string;
  /** The transcript is trustworthy enough to report skipped passages (Gemini Transcribe). */
  showSkipped: boolean;
  busy: boolean;
  onRevoice: (range: TextRange) => void;
  canUndo: boolean;
  onUndo: () => void;
  /** Short screen: thinner waveform. */
  compact?: boolean;
  /** The stretch just re-voiced: played at once, then "Oldu" or "Olmadı, geri al". */
  lastFix?: { start: number; end: number; at: number } | null;
  onKeepFix?: () => void;
  /** The sentence being spoken (for the caption under the question), or null. */
  onSpeaking?: (text: string | null) => void;
}

const ZOOMS = [1, 2, 4, 8];
/** Mostly Arabic (letters), so the block is shown in the Arabic face; a Turkish sentence quoting a word stays Turkish. */
export const mostlyArabic = (text: string) => (text.match(/[\u0621-\u064A]/g)?.length ?? 0) > (text.match(/[A-Za-zÇĞİÖŞÜçğıöşü]/g)?.length ?? 0);
const short = (text: string, n: number) => (text.length > n ? `${text.slice(0, n)}…` : text);
const typing = (target: EventTarget | null) => target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));

/** "2:05", "125" or "2.05" → seconds. */
function seconds(value: string): number | null {
  const m = /^\s*(?:(\d+)\s*[:.,]\s*)?(\d{1,2}(?:[.,]\d+)?)\s*$/.exec(value);
  return m ? (m[1] ? Number(m[1]) * 60 : 0) + Number(m[2].replace(',', '.')) : null;
}

/**
 * "Ses şeridi" under the question in the Ses step, like the mark strip in İşaretler: the narration
 * as a waveform with every sentence as a block at the time it is spoken. The teacher clicks the
 * sentence that was read wrong (or the first and the last of several), listens, and re-voices only
 * that; passages the voice seems to have skipped are marked and can be put in with one click.
 */
export function NarrationStrip({ solutionText, words, duration, audioUrl, showSkipped, busy, onRevoice, canUndo, onUndo, compact, lastFix, onKeepFix, onSpeaking }: Props) {
  const waveBox = useRef<HTMLDivElement>(null);
  const surfer = useRef<WaveSurfer | null>(null);
  const stopAt = useRef<number | null>(null);
  const [view, setView] = useState({ width: 0, scroll: 0 });
  const [zoom, setZoom] = useState(0);
  const [pick, setPick] = useState<[number, number] | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);
  const [listView, setListView] = useState(false);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [note, setNote] = useState('');
  const [now, setNow] = useState(0);
  const [running, setRunning] = useState(false);
  const [more, setMore] = useState(false);
  const ready = useRef(false);
  /** The fix already played once (by its time stamp), so a reload of the audio does not play it again. */
  const playedFix = useRef<number | null>(null);
  const fix = useRef(lastFix);
  fix.current = lastFix;
  const total = Math.max(1, duration);

  const sentences = useMemo(() => sentenceRanges(solutionText), [solutionText]);
  const parts = useMemo(() => (spokenLength(solutionText) > PART_CHARS ? partRanges(solutionText) : []), [solutionText]);
  const skipped = useMemo(() => (showSkipped ? narrationDrift(solutionText, words, total).skipped : []), [showSkipped, solutionText, words, total]);
  /** Each sentence's time on the narration: from its first to its last word. */
  const times = useMemo(() => sentenceTimes(solutionText, words, total, sentences), [solutionText, words, total, sentences]);

  useEffect(() => {
    if (!waveBox.current) return;
    const ws = WaveSurfer.create({
      container: waveBox.current, height: compact ? 26 : 40, waveColor: '#D5D4CC', progressColor: '#C98A93', cursorColor: '#8B1E2D', cursorWidth: 2,
      barWidth: 2, barGap: 1, barRadius: 2, normalize: true, dragToSeek: true, autoScroll: true, hideScrollbar: false, url: audioUrl,
      // Not from the HTTP cache: an <audio> load of the same R2 link is cached without CORS headers.
      fetchParams: { cache: 'no-store' },
      plugins: [TimelinePlugin.create({ height: 16, formatTimeCallback: s => clock(s).replace(/,\d$/, ''), style: { fontSize: '12px', color: '#8A8880' } })],
    });
    surfer.current = ws;
    ready.current = false;
    ws.on('ready', () => { ready.current = true; playFix(); });
    const sync = () => setView({ width: ws.getWrapper().clientWidth, scroll: ws.getScroll() });
    ws.on('ready', sync); ws.on('redrawcomplete', sync); ws.on('zoom', sync); ws.on('resize', sync);
    ws.on('scroll', (_a, _b, left) => setView(v => ({ ...v, scroll: left })));
    ws.on('timeupdate', t => { setNow(t); if (stopAt.current !== null && t >= stopAt.current) { ws.pause(); stopAt.current = null; } });
    ws.on('play', () => setRunning(true));
    ws.on('error', () => setNote('Ses yüklenemedi. İnternet bağlantınızı kontrol edip sayfayı yenileyin.'));
    ws.on('pause', () => { setPlaying(null); setRunning(false); });
    return () => { surfer.current = null; ws.destroy(); };
  }, [audioUrl, compact]);

  /** Plays the stretch just fixed, once, as soon as the new audio is loaded. */
  function playFix() {
    const ws = surfer.current, f = fix.current;
    if (!ws || !ready.current || !f || playedFix.current === f.at) return;
    playedFix.current = f.at;
    stopAt.current = f.end + .4;
    ws.setTime(Math.max(0, f.start - .4));
    void ws.play();
    setPlaying('fix');
  }
  useEffect(() => { if (lastFix) { setPick(null); playFix(); } }, [lastFix?.at]); // eslint-disable-line react-hooks/exhaustive-deps
  const replayFix = () => {
    const ws = surfer.current;
    if (!ws || !lastFix) return;
    if (playing === 'fix') { ws.pause(); return; }
    stopAt.current = lastFix.end + .4;
    ws.setTime(Math.max(0, lastFix.start - .4));
    void ws.play();
    setPlaying('fix');
  };

  const pxPerSec = (view.width || waveBox.current?.clientWidth || 800) / total;
  const px = (t: number) => t * pxPerSec - view.scroll;
  const setZoomStep = (step: number) => {
    const next = Math.max(0, Math.min(ZOOMS.length - 1, step));
    setZoom(next);
    surfer.current?.zoom(next === 0 ? 0 : (waveBox.current!.clientWidth / total) * ZOOMS[next]);
  };

  const chosen: TextRange | null = pick
    ? { from: sentences[pick[0]].from, to: sentences[pick[1]].to, text: solutionText.slice(sentences[pick[0]].from, sentences[pick[1]].to) }
    : null;
  const play = (range: TextRange, key: string) => {
    const ws = surfer.current, span = spokenSpan(solutionText, words, total, range);
    if (!ws || !span) return;
    if (playing === key) { ws.pause(); return; }
    stopAt.current = span.end + .3;
    ws.setTime(Math.max(0, span.start - .3));
    void ws.play();
    setPlaying(key);
  };
  const choose = (i: number) => {
    setNote('');
    setPick(p => nextPick(p, i));
    const t = times[i];
    if (t && !running) surfer.current?.setTime(t.start);
  };
  /** Play or pause the whole narration from the red line. */
  const toggle = () => {
    const ws = surfer.current;
    if (!ws) return;
    stopAt.current = null; setPlaying(null);
    if (ws.isPlaying()) ws.pause(); else void ws.play();
  };
  /** The sentence being spoken now, shown while playing. */
  const speaking = running ? times.findIndex(t => t && now >= t.start && now < t.end + .15) : -1;
  useEffect(() => { onSpeaking?.(speaking >= 0 ? sentences[speaking].text : null); }, [speaking, sentences, onSpeaking]);
  useEffect(() => () => onSpeaking?.(null), [onSpeaking]);
  /** "Burada hata var": stop and pick the sentence just heard (the one at the red line, else the one before it). */
  const heardAt = (t: number) => {
    let found = -1;
    times.forEach((x, i) => { if (x && x.start <= t + .05) found = i; });
    return found;
  };
  const flag = () => {
    const ws = surfer.current;
    if (!ws) return;
    ws.pause(); stopAt.current = null;
    const i = heardAt(ws.getCurrentTime());
    if (i < 0) { setNote('Önce sesi oynatın; hatayı duyduğunuz anda bu düğmeye basın.'); return; }
    setNote('');
    setPick([i, i]);
  };

  // Keys: Space plays or pauses, ←/→ picks the previous or next sentence (Shift adds it), Enter
  // listens to the choice, Esc lets it go.
  const keys = useRef<(e: KeyboardEvent) => void>(() => {});
  keys.current = e => {
    if (e.ctrlKey || e.metaKey || e.altKey || typing(e.target) || busy) return;
    if (e.key === 'Escape' && pick) { e.preventDefault(); setPick(null); return; }
    if (e.key === ' ' || e.code === 'Space') { e.preventDefault(); toggle(); return; }
    if (e.key === 'Enter' && chosen) { e.preventDefault(); play(chosen, 'chosen'); return; }
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    const heard = times.map((t, i) => (t ? i : -1)).filter(i => i >= 0);
    if (!heard.length) return;
    e.preventDefault();
    const step = e.key === 'ArrowRight' ? 1 : -1;
    const next = !pick ? heard[0]
      : step > 0 ? heard.find(i => i > pick[1]) : [...heard].reverse().find(i => i < pick[0]);
    if (next === undefined) return;
    setNote('');
    setPick(e.shiftKey && pick ? [Math.min(pick[0], next), Math.max(pick[1], next)] : [next, next]);
    const t = times[next];
    if (t && !running) surfer.current?.setTime(t.start);
  };
  useEffect(() => {
    // Before the page's own Esc (leaving full screen): a choice is let go first.
    const onKey = (e: KeyboardEvent) => keys.current(e);
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);
  const pickByTime = () => {
    const a = seconds(from), b = seconds(to);
    if (a === null || b === null || b <= a) { setNote('Başlangıç ve bitişi dakika:saniye olarak yazın, örneğin 2:00 ve 2:10.'); return; }
    const hit = times.map((t, i) => ({ i, t })).filter(x => x.t && x.t.end > a && x.t.start < b).map(x => x.i);
    if (!hit.length) { setNote('Bu aralıkta cümle bulunamadı.'); return; }
    setNote('');
    setPick([hit[0], hit[hit.length - 1]]);
  };
  const tooLong = chosen && spokenLength(chosen.text) > PART_CHARS;
  const button = 'narration-strip-button';

  return (
    <section className="narration-strip" aria-label="Ses şeridi">
      <header>
        <p><b>Ses şeridi</b> · dinleyin; yanlış bir yer duyarsanız <b>Burada hata var</b>’a basın</p>
        <span className="narration-strip-actions">
          <button type="button" className={button} onClick={toggle} title="Boşluk tuşu: oynat / durdur">
            {running && !playing ? <Pause size={16} /> : <Play size={16} />} {running && !playing ? 'Durdur' : 'Oynat'}
          </button>
          <span className="font-mono-code text-[#55544F]">{clock(now).replace(/,\d$/, '')} / {clock(total).replace(/,\d$/, '')}</span>
          <button type="button" className={`${button} is-flag`} disabled={busy} onClick={flag} title="Sesi durdurur ve az önce okunan cümleyi seçer">
            <HandPalm size={16} /> Burada hata var
          </button>
          <button type="button" className={button} aria-pressed={more} onClick={() => setMore(!more)} title="Yakınlaştırma, cümle listesi, zamanla seçme">
            <DotsThree size={16} weight="bold" /> Daha fazla
          </button>
        </span>
      </header>
      {more && (
        <div className="narration-strip-more">
          <span className="narration-strip-actions">
            <button type="button" className={button} onClick={() => setZoomStep(zoom - 1)} disabled={zoom === 0} aria-label="Uzaklaştır"><MagnifyingGlassMinus size={16} /></button>
            <span className="w-9 text-center font-semibold text-[#55544F]">{ZOOMS[zoom]}×</span>
            <button type="button" className={button} onClick={() => setZoomStep(zoom + 1)} disabled={zoom === ZOOMS.length - 1} aria-label="Yakınlaştır"><MagnifyingGlassPlus size={16} /></button>
            <button type="button" className={button} onClick={() => setZoomStep(0)} disabled={zoom === 0}><ArrowsOutLineHorizontal size={16} /> Tümü</button>
            <button type="button" className={button} aria-pressed={listView} onClick={() => setListView(!listView)}><ListBullets size={16} /> {listView ? 'Şeride dön' : 'Cümle listesi'}</button>
          </span>
          <span className="narration-time-pick">
            Zamanla seç:
            <input aria-label="Başlangıç (dakika:saniye)" placeholder="2:00" value={from} onChange={e => setFrom(e.target.value)} />
            –
            <input aria-label="Bitiş (dakika:saniye)" placeholder="2:10" value={to} onChange={e => setTo(e.target.value)} />
            <button type="button" className={button} disabled={busy} onClick={pickByTime}>Seç</button>
          </span>
        </div>
      )}

      <div ref={waveBox} className="narration-strip-wave" title="Tıklayın ya da sürükleyin: o andan dinleyin" />

      {!listView && (
        <div className="narration-strip-lane" style={{ height: compact ? 34 : 40 }}
          onClick={e => { if (e.target === e.currentTarget && !busy) setPick(null); }}>
          {sentences.map((s, i) => {
            const t = times[i];
            if (!t) return null;
            const on = !!pick && i >= pick[0] && i <= pick[1];
            return (
              <button key={s.from} type="button" aria-pressed={on} disabled={busy} onClick={() => choose(i)}
                onDoubleClick={() => play(s, `s${i}`)}
                className={`narration-pill ${mostlyArabic(s.text) ? 'is-arabic' : ''} ${i === speaking ? 'is-speaking' : ''}`}
                style={{ left: px(t.start), width: Math.max(10, (t.end - t.start) * pxPerSec - 2) }}
                title={`${clock(t.start)} · ${s.text}\nÇift tıklayın: dinleyin`}>
                <span dir="auto">{s.text}</span>
              </button>
            );
          })}
          {skipped.map((s, i) => (
            <span key={`${i}-${s.start}`} className="narration-skip" style={{ left: px(s.start) }} title={`Okunmamış görünüyor: “${short(s.text, 80)}”`}>
              <WarningCircle size={16} weight="fill" />
            </span>
          ))}
        </div>
      )}

      {listView && (
        <ol className="narration-list">
          {sentences.map((s, i) => {
            const on = !!pick && i >= pick[0] && i <= pick[1];
            return (
              <li key={s.from}>
                <button type="button" aria-pressed={on} disabled={busy} onClick={() => choose(i)} className={i === speaking ? 'is-speaking' : ''}>
                  <span className="revoice-time">{times[i] ? clock(times[i]!.start).replace(/,\d$/, '') : '–'}</span>
                  <span dir="auto">{s.text}</span>
                </button>
              </li>
            );
          })}
        </ol>
      )}

      <div className="narration-strip-bar">
        {lastFix && !busy ? (
          <>
            <p><strong>Düzeltilen yer</strong> ({clock(lastFix.start).replace(/,\d$/, '')}) {playing === 'fix' ? 'çalıyor…' : 'hazır.'} Doğru okundu mu?</p>
            <span className="narration-strip-actions">
              <button type="button" className={button} onClick={replayFix}>{playing === 'fix' ? <Stop size={16} /> : <Play size={16} />} Tekrar dinle</button>
              <button type="button" className={`${button} is-primary`} onClick={() => { surfer.current?.pause(); onKeepFix?.(); }}><Check size={16} /> Oldu</button>
              {canUndo && <button type="button" className={button} onClick={() => { surfer.current?.pause(); onUndo(); }}><ArrowCounterClockwise size={16} /> Olmadı, geri al</button>}
            </span>
          </>
        ) : chosen ? (
          <>
            <p dir="auto"><strong>Seçili:</strong> “{short(chosen.text, 160)}”</p>
            {tooLong && <p className="revoice-note">Seçim çok uzun; daha az cümle seçin ya da bölümü yeniden seslendirin.</p>}
            <span className="narration-strip-actions">
              <button type="button" className={button} onClick={() => play(chosen, 'chosen')}>{playing === 'chosen' ? <Stop size={16} /> : <Play size={16} />} Dinle</button>
              <button type="button" className={`${button} is-primary`} disabled={busy || !!tooLong} onClick={() => onRevoice(chosen)}>
                <Microphone size={16} /> Yeniden seslendir
              </button>
              <button type="button" className={button} disabled={busy} onClick={() => setPick(null)} title="Esc"><X size={16} /> Seçimi kaldır</button>
            </span>
          </>
        ) : (
          <>
            <p className="text-[#787670]">Ya da doğrudan bir cümleye tıklayın. Birden çok cümle için ilk ve son cümleye tıklayın; seçili cümleye yeniden tıklamak onu seçimden çıkarır.</p>
            {canUndo && <button type="button" className={button} disabled={busy} onClick={onUndo}><ArrowCounterClockwise size={16} /> Son düzeltmeyi geri al</button>}
          </>
        )}
        {note && <p role="alert" className="revoice-note w-full">{note}</p>}
      </div>

      {(skipped.length > 0 || parts.length > 1) && (
        <div className="narration-strip-extra">
          {skipped.map((s, i) => {
            const at = solutionText.indexOf(s.text);
            const target = at >= 0 ? wholeSentences(solutionText, at, at + s.text.length) : null;
            return (
              <div key={`${i}-${s.start}`} className="narration-extra-row is-warn">
                <WarningCircle size={18} weight="fill" />
                <p dir="auto"><span className="revoice-time">{clock(s.start).replace(/,\d$/, '')}</span> Okunmamış görünüyor: “{short(s.text, 90)}”</p>
                {target && <button type="button" className={button} disabled={busy} onClick={() => onRevoice(target)}><PlusCircle size={16} /> Bu yeri ekle</button>}
              </div>
            );
          })}
          {parts.length > 1 && (
            <div className="narration-extra-row">
              <p><strong>Bölümler:</strong> uzun çözüm {parts.length} bölümde seslendirildi.</p>
              {parts.map((p, i) => (
                <span key={p.from} className="narration-strip-actions">
                  <button type="button" className={button} onClick={() => play(p, `part${i}`)}>{playing === `part${i}` ? <Stop size={16} /> : <Play size={16} />} {i + 1}. bölüm</button>
                  <button type="button" className={button} disabled={busy} onClick={() => onRevoice(p)} aria-label={`${i + 1}. bölümü yeniden seslendir`}><Microphone size={16} /></button>
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
