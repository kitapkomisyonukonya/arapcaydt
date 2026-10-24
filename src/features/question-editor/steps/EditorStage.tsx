import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { NarrationWord, QuestionProject, VideoConfig } from '../../../types';
import { FilmStrip, Image as ImageIcon } from '@phosphor-icons/react';
import { VideoPreviewCanvas } from '../../video/VideoPreviewCanvas';
import { MarkTimeline } from '../../video/MarkTimeline';
import { applyRegionEdits, assignOption } from '../../../services/analysis/regionEdits';
import { NarrationStrip } from '../NarrationStrip';
import type { TextRange } from '../../../services/narration/revoice';

export interface EditorStageProps {
  videoGenerated: boolean;
  hasImage: boolean;
  previewMode: 'video' | 'image';
  setPreviewMode: (mode: 'video' | 'image') => void;
  step: number;
  currentProject: QuestionProject;
  updateCurrentProject: (updates: Partial<QuestionProject>) => void;
  currentPreviewTime: number;
  setCurrentPreviewTime: (time: number) => void;
  isPlayingPreview: boolean;
  setIsPlayingPreview: (playing: boolean) => void;
  activeAudioDuration: number;
  activeAudioUrl: string;
  setIsVideoModalOpen: (open: boolean) => void;
  /** A missing option the teacher is showing on the picture, from the readiness check. */
  drawOption: string | null;
  setDrawOption: (letter: string | null) => void;
  regionHistory: VideoConfig[];
  setRegionHistory: React.Dispatch<React.SetStateAction<VideoConfig[]>>;
  /** Ses step with a generated voice: the question on top, the narration strip ("Sesi düzelt") under it. */
  narration?: { words: NarrationWord[]; showSkipped: boolean; busy: boolean; onRevoice: (range: TextRange) => void; canUndo: boolean; onUndo: () => void;
    lastFix: { start: number; end: number; at: number } | null; onKeepFix: () => void };
}

/** A 13–15" laptop screen, where the strips go compact so the question stays large. */
function useShortScreen(): boolean {
  const query = '(max-height: 820px)';
  const [short, setShort] = useState(() => typeof window !== 'undefined' && window.matchMedia?.(query).matches);
  useEffect(() => {
    const media = window.matchMedia?.(query);
    if (!media) return;
    const change = () => setShort(media.matches);
    media.addEventListener('change', change);
    return () => media.removeEventListener('change', change);
  }, []);
  return short;
}

/** One "↑ Yukarı / ↓ Aşağı" click moves every underline by this share of its text line. */
export const LINE_STEP = .1;
export const lineOffset = (current: number | undefined, delta: number) => Math.round(Math.max(-.8, Math.min(.8, (current ?? 0) + delta)) * 100) / 100;

/** Narrowest the picture gets to leave room for the controls and the strip, in pixels. */
const MIN_PICTURE = 420;
/** Below this column height (a 13–15" laptop) the strip goes compact so the question stays large. */
const SHORT_ROOM = 760;

/**
 * The widest preview whose picture, controls and mark strip all fit the column's height, so a
 * teacher sees the whole question while editing without scrolling. Re-measured when the column,
 * the window or the strip (more rows of marks) changes size.
 */
function useFitWidth(frame: React.RefObject<HTMLDivElement | null>, active: boolean, step: number): { width?: number; short: boolean } {
  const [width, setWidth] = useState<number>();
  const [short, setShort] = useState(false);
  useLayoutEffect(() => {
    const el = frame.current, stage = el?.closest('.editor-stage') as HTMLElement | null;
    if (!active || !el || !stage) return;
    const fit = () => {
      const picture = el.querySelector('[data-preview-picture]') as HTMLElement | null;
      if (!picture) return;
      const style = getComputedStyle(stage);
      const room = stage.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom);
      const rest = el.offsetHeight - picture.offsetHeight;
      const across = stage.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
      setShort(room < SHORT_ROOM);
      // The whole editor fits without scrolling: the question gives way to the strip, down to a readable size.
      // The mark tools stand beside the picture, so the preview is that much wider than the picture.
      const beside = (picture.parentElement?.offsetWidth ?? picture.offsetWidth) - picture.offsetWidth;
      const fits = (room - rest - 4) * 16 / 9 + beside;
      const next = Math.round(Math.max(MIN_PICTURE + beside, Math.min(across, fits)));
      setWidth(previous => previous !== undefined && Math.abs(previous - next) < 3 ? previous : next);
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(stage); observer.observe(el);
    return () => observer.disconnect();
    // The step matters: the Ses step shows its own layout, so the preview is a new element when the teacher comes back.
  }, [frame, active, step]);
  return { width, short };
}

/** Left column: question image or animated preview, timing editor and box editor. */
export function EditorStage({ videoGenerated, hasImage, previewMode, setPreviewMode, step, currentProject, updateCurrentProject, currentPreviewTime, setCurrentPreviewTime, isPlayingPreview, setIsPlayingPreview, activeAudioDuration, activeAudioUrl, drawOption, setDrawOption, regionHistory, setRegionHistory, narration }: EditorStageProps) {
  const frame = useRef<HTMLDivElement>(null);
  const { width: fitWidth, short } = useFitWidth(frame, previewMode === 'video' && videoGenerated, step);
  const shortScreen = useShortScreen();
  useEffect(() => { if (step !== 3) setDrawOption(null); }, [step, setDrawOption]);
  /** The sentence being spoken in the Ses step, shown under the question like a caption. */
  const [spoken, setSpoken] = useState<string | null>(null);
  /** The box to select on the picture after "Burada hata var" (a new object each time, so the same box can be picked again). */
  const [focusBox, setFocusBox] = useState<{ id: string } | null>(null);
  /** What Ctrl+Z took away, for Ctrl+Y; a new change starts a fresh redo list. */
  const [redo, setRedo] = useState<VideoConfig[]>([]);
  useEffect(() => setRedo([]), [currentProject.id]);
  const remember = () => { setRegionHistory(h => [...h.slice(-29), currentProject.videoConfig]); setRedo([]); };
  if (step === 2 && narration && hasImage) return (
    <div className="narration-stage">
      <div className="narration-stage-picture">
        <img src={currentProject.imageUrl} alt="Soru görseli" crossOrigin="anonymous" />
        {spoken && <p className="narration-caption" dir="auto">{spoken}</p>}
      </div>
      <NarrationStrip solutionText={currentProject.solutionText} words={narration.words} duration={activeAudioDuration || 15}
        audioUrl={activeAudioUrl} showSkipped={narration.showSkipped} busy={narration.busy} onRevoice={narration.onRevoice}
        canUndo={narration.canUndo} onUndo={narration.onUndo} compact={shortScreen}
        lastFix={narration.lastFix} onKeepFix={narration.onKeepFix} onSpeaking={setSpoken} />
    </div>
  );
  return (
    <>
    {videoGenerated && hasImage && (
      <div className="absolute top-4 left-6 z-20 flex items-center gap-1 bg-white/90 backdrop-blur-xs p-1 rounded-lg border border-[#E5E4DC] shadow-xs">
        <button
          type="button"
          onClick={() => setPreviewMode('video')}
          className={`px-3 py-1 rounded text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer ${
            previewMode === 'video'
              ? 'bg-[#8B1E2D] text-white shadow-xs'
              : 'text-[#55544F] hover:text-[#1C1917]'
          }`}
        >
          <FilmStrip size={14} weight="bold" />
          <span>Video Önizleme</span>
        </button>
        <button
          type="button"
          onClick={() => setPreviewMode('image')}
          className={`px-3 py-1 rounded text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer ${
            previewMode === 'image'
              ? 'bg-[#8B1E2D] text-white shadow-xs'
              : 'text-[#55544F] hover:text-[#1C1917]'
          }`}
        >
          <ImageIcon size={14} weight="bold" />
          <span>Soru Görseli</span>
        </button>
      </div>
    )}

    <div className="preview-content">
    {previewMode === 'video' && videoGenerated ? (
      /* Generated Video Player powered by local Canvas engine */
      <div ref={frame} className="w-full flex flex-col items-center gap-2 px-2 pb-2">
        {/* Only the picture and its controls are sized to fit; settings and the strip keep the full width. */}
        <div style={{ width: fitWidth ? `${fitWidth}px` : '100%', maxWidth: '100%' }}>
        <VideoPreviewCanvas
          imageUrl={currentProject.imageUrl}
          regions={currentProject.videoConfig.regions}
          actions={currentProject.videoConfig.timelineActions}
          currentTime={currentPreviewTime}
          duration={activeAudioDuration || 15}
          isPlaying={isPlayingPreview}
          onPlayPause={() => setIsPlayingPreview(!isPlayingPreview)}
          onSeek={(t) => setCurrentPreviewTime(t)}
          videoConfig={currentProject.videoConfig}
          audioUrl={activeAudioUrl}
          editing={step === 3 ? {
            canUndo: regionHistory.length > 0,
            onUndo: () => { const previous = regionHistory.at(-1); if (previous) { setRedo(r => [...r, currentProject.videoConfig]); updateCurrentProject({ videoConfig: previous }); setRegionHistory(regionHistory.slice(0, -1)); } },
            canRedo: redo.length > 0,
            onRedo: () => { const next = redo.at(-1); if (next) { setRegionHistory(h => [...h.slice(-29), currentProject.videoConfig]); updateCurrentProject({ videoConfig: next }); setRedo(redo.slice(0, -1)); } },
            onActions: actions => { remember(); updateCurrentProject({ videoConfig: { ...currentProject.videoConfig, timelineActions: actions } }); },
            onRegions: (regions, add = []) => {
              remember();
              const config = applyRegionEdits(currentProject.videoConfig, regions, currentProject.solutionText,
                currentProject.narrationSource?.words || currentProject.audioNarration?.words || [], activeAudioDuration || 15);
              updateCurrentProject({ videoConfig: add.length ? { ...config, timelineActions: [...(config.timelineActions || []), ...add].sort((a, b) => a.start - b.start) } : config });
            },
            onAssignOption: (boxId, letter) => {
              remember();
              updateCurrentProject({ videoConfig: assignOption(currentProject.videoConfig, boxId, letter, currentProject.solutionText,
                currentProject.narrationSource?.words || currentProject.audioNarration?.words || [], activeAudioDuration || 15) });
            },
            drawOption,
            onDrawOptionDone: () => setDrawOption(null),
            focusBox,
          } : undefined}
        />
        </div>
        <div className="w-full flex flex-wrap gap-x-3 gap-y-1 items-center text-xs">
          <label className="flex gap-2 items-center">
          <input type="checkbox" checked={currentProject.videoConfig.showCaptions !== false}
            onChange={e => updateCurrentProject({ videoConfig: { ...currentProject.videoConfig, showCaptions: e.target.checked } })} />
          Altyazıları göster
          </label>
          <input aria-label="Altyazı yüksekliği" type="range" min="0.08" max="0.93" step="0.01"
            value={currentProject.videoConfig.captionY ?? .85}
            onChange={e => updateCurrentProject({ videoConfig: { ...currentProject.videoConfig, captionY: Number(e.target.value) } })} />
          Altyazı konumu
          <span className="flex gap-1 items-center ml-2" title="Altyazı bir şıkkı kapatıyorsa soruyu küçültün; küçülen soru altyazının üstünde durur">
            Soru boyutu
            <button type="button" className="w-6 h-6 rounded border bg-white hover:bg-[#F2F1EB] font-bold" aria-label="Soruyu küçült"
              onClick={() => updateCurrentProject({ videoConfig: { ...currentProject.videoConfig, imageScale: Math.max(.6, Math.round(((currentProject.videoConfig.imageScale ?? 1) - .05) * 100) / 100) } })}>−</button>
            <button type="button" className={`px-2 h-6 rounded border ${currentProject.videoConfig.imageScale === undefined ? 'bg-[#8B1E2D] text-white border-[#8B1E2D]' : 'bg-white hover:bg-[#F2F1EB]'}`}
              title="Tam boya dön" onClick={() => updateCurrentProject({ videoConfig: { ...currentProject.videoConfig, imageScale: undefined } })}>
              {currentProject.videoConfig.imageScale === undefined ? 'Tam boy' : `%${Math.round(currentProject.videoConfig.imageScale * 100)}`}
            </button>
            <button type="button" className="w-6 h-6 rounded border bg-white hover:bg-[#F2F1EB] font-bold" aria-label="Soruyu büyüt"
              onClick={() => updateCurrentProject({ videoConfig: { ...currentProject.videoConfig, imageScale: (currentProject.videoConfig.imageScale ?? 1) + .05 >= .999 ? undefined : Math.round(((currentProject.videoConfig.imageScale ?? 1) + .05) * 100) / 100 } })}>+</button>
          </span>
          <span className="flex gap-1 items-center ml-2" title="Bu videodaki tüm altı çizgileri yukarı ya da aşağı kaydırır">
            Altı çizgi
            <button type="button" className="px-2 h-6 rounded border bg-white hover:bg-[#F2F1EB] font-semibold" aria-label="Altı çizgileri yukarı al"
              onClick={() => updateCurrentProject({ videoConfig: { ...currentProject.videoConfig, underlineOffset: lineOffset(currentProject.videoConfig.underlineOffset, -LINE_STEP) } })}>↑ Yukarı</button>
            <button type="button" className="px-2 h-6 rounded border bg-white hover:bg-[#F2F1EB] font-semibold" aria-label="Altı çizgileri aşağı al"
              onClick={() => updateCurrentProject({ videoConfig: { ...currentProject.videoConfig, underlineOffset: lineOffset(currentProject.videoConfig.underlineOffset, LINE_STEP) } })}>↓ Aşağı</button>
            {Math.abs(currentProject.videoConfig.underlineOffset ?? 0) > .02 && (
              <button type="button" className="px-1.5 h-6 rounded text-[#787670] hover:text-[#8B1E2D] underline-offset-2 hover:underline" title="Normal yerine döndür"
                onClick={() => updateCurrentProject({ videoConfig: { ...currentProject.videoConfig, underlineOffset: 0 } })}>
                {(currentProject.videoConfig.underlineOffset ?? 0) < 0 ? 'yukarıda' : 'aşağıda'} · sıfırla
              </button>
            )}
          </span>
          <label className="flex gap-2 items-center ml-2">
          <input type="checkbox" checked={currentProject.videoConfig.showOutro !== false}
            onChange={e => updateCurrentProject({ videoConfig: { ...currentProject.videoConfig, showOutro: e.target.checked } })} />
          Kapanış kartı
          </label>
        </div>

        {step === 3 && (
          <div className="w-full"><MarkTimeline actions={currentProject.videoConfig.timelineActions || []} regions={currentProject.videoConfig.regions || []}
            duration={activeAudioDuration || 15} currentTime={currentPreviewTime} audioUrl={activeAudioUrl}
            onSeek={setCurrentPreviewTime} onPlayPause={() => setIsPlayingPreview(!isPlayingPreview)} keyboard compact={short}
            playing={isPlayingPreview} onFlag={id => setFocusBox(id ? { id } : null)}
            solutionText={currentProject.solutionText} words={currentProject.narrationSource?.words || currentProject.audioNarration?.words}
            onActions={actions => { remember(); updateCurrentProject({ videoConfig: { ...currentProject.videoConfig, timelineActions: actions } }); }} /></div>
        )}
      </div>
    ) : hasImage ? (
      /* Large, high-clarity question image preview */
      <div className="w-full flex items-center justify-center">
        <img
          src={currentProject.imageUrl}
          alt="Soru Görseli"
          crossOrigin="anonymous"
          className="max-h-[calc(100vh-16rem)] max-w-full object-contain rounded-lg border border-[#E5E4DC] bg-white shadow-xs p-2"
        />
      </div>
    ) : (
      /* Initial placeholder */
      <div className="flex flex-col items-center justify-center text-center p-8 max-w-md text-[#8C8A82]">
        <div className="w-16 h-16 rounded-full bg-[#FAF9F5] border border-[#D5D4CC] flex items-center justify-center mb-3 text-[#A8A69E]">
          <ImageIcon size={32} />
        </div>
        <p className="text-xs font-medium text-[#55544F]">
          Soru görseli henüz yüklenmedi
        </p>
        <p className="text-xs text-[#8C8A82] mt-1">
          Sağdaki panelden görseli yüklediğinizde burada net ve büyük boyutta görüntülenecektir.
        </p>
      </div>
    )}
    </div>
    </>
  );
}
