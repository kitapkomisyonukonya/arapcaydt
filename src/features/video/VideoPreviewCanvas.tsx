import React, { Suspense, lazy, useRef, useEffect, useState, useCallback } from 'react';
import { AnnotationRegion, VideoAction, VideoConfig } from '../../types';
import { outroSeconds, renderQuestionVideoFrame } from './engine/renderer';
import { clock } from '../question-editor/workflow';
import type { FitRect } from './engine/types';
import { Play, Pause, ArrowCounterClockwise, CornersOut } from '@phosphor-icons/react';
// The drawing tools (and their large drag library) load only where marks are edited, not for playback.
const PreviewEditOverlay = lazy(() => import('./PreviewEditOverlay').then(m => ({ default: m.PreviewEditOverlay })));

/** Preview speeds a teacher can step through when checking a video. */
export const PREVIEW_SPEEDS = [1, 1.25, 1.5, 1.75, 2];
const RATE_KEY = 'studio-preview-rate';
export const speedLabel = (speed: number) => `${speed.toLocaleString('tr')}×`;
function readRate(): number {
  try { const saved = Number(localStorage.getItem(RATE_KEY)); return PREVIEW_SPEEDS.includes(saved) ? saved : 1; } catch { return 1; }
}

interface VideoPreviewCanvasProps {
  imageUrl: string;
  regions?: AnnotationRegion[];
  actions?: VideoAction[];
  currentTime: number;
  duration: number;
  isPlaying: boolean;
  onPlayPause: () => void;
  onSeek: (time: number) => void;
  videoConfig: VideoConfig;
  selectedRegionId?: string | null;
  audioUrl?: string;
  /** On-picture editing while paused (boxes, marks, underline position). */
  editing?: {
    onRegions: (regions: AnnotationRegion[]) => void;
    onActions: (actions: VideoAction[]) => void;
    onUndo?: () => void;
    canUndo?: boolean;
    onRedo?: () => void;
    canRedo?: boolean;
    /** The teacher says a box is option `letter`. */
    onAssignOption?: (boxId: string, letter: string) => void;
    /** A missing option to draw or pick on the picture. */
    drawOption?: string | null;
    onDrawOptionDone?: () => void;
    /** A box to select ("Burada hata var"). */
    focusBox?: { id: string } | null;
  };
}

export const VideoPreviewCanvas: React.FC<VideoPreviewCanvasProps> = ({
  imageUrl,
  regions = [],
  actions = [],
  currentTime,
  duration,
  isPlaying,
  onPlayPause,
  onSeek,
  videoConfig,
  selectedRegionId = null,
  audioUrl,
  editing,
}) => {
  const [fit, setFit] = useState<FitRect | null>(null);
  const totalDuration = duration + outroSeconds(actions, videoConfig.showOutro !== false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [imageElement, setImageElement] = useState<HTMLImageElement | null>(null);

  // Load image element when imageUrl changes
  useEffect(() => {
    if (!imageUrl) {
      setImageElement(null);
      return;
    }
    const img = new Image();
    img.crossOrigin = 'anonymous';
    // The previous picture stays until the new one is ready: a changed link never blanks the
    // preview or closes the on-picture editor in the middle of a drag.
    let active = true;
    img.onload = () => {
      if (active) setImageElement(img);
    };
    img.src = imageUrl;
    return () => { active = false; };
  }, [imageUrl]);

  // Preview speed (the exported MP4 always plays at normal speed); remembered on this device.
  const [rate, setRate] = useState(readRate);
  const changeRate = (next: number) => { setRate(next); try { localStorage.setItem(RATE_KEY, String(next)); } catch { /* per-device only */ } };
  useEffect(() => { if (audioRef.current) audioRef.current.playbackRate = rate; }, [rate, audioUrl]);

  const seekRef = useRef(onSeek);
  const toggleRef = useRef(onPlayPause);
  const timeRef = useRef(currentTime);
  useEffect(() => {
    seekRef.current = onSeek;
    toggleRef.current = onPlayPause;
    timeRef.current = currentTime;
  }, [onSeek, onPlayPause, currentTime]);
  // The media clock drives the picture, including buffering and resumed tabs.
  useEffect(() => {
    const audio = audioRef.current;
    let raf = 0;
    let stopped = false;
    if (!isPlaying) { audio?.pause(); return; }
    if (audio) {
      audio.currentTime = timeRef.current;
      audio.playbackRate = rate;
      audio.play().catch(() => { if (!stopped) toggleRef.current(); });
    }
    // Wall clock (no audio, or the silent closing frame): time runs at the chosen speed too.
    let wallStart = performance.now() / 1000, wallFrom = timeRef.current;
    // After the narration the silent closing frame runs on the wall clock.
    let onWallClock = !audio || timeRef.current >= duration - .02;
    const tick = () => {
      if (stopped) return;
      if (audio && !onWallClock && (audio.ended || audio.currentTime >= duration - .02) && totalDuration > duration) {
        onWallClock = true;
        wallStart = performance.now() / 1000;
        wallFrom = Math.max(audio.currentTime, duration);
      }
      const next = audio && !onWallClock ? audio.currentTime : wallFrom + (performance.now() / 1000 - wallStart) * rate;
      if (next >= totalDuration) { toggleRef.current(); seekRef.current(totalDuration); return; }
      seekRef.current(next);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => { stopped = true; cancelAnimationFrame(raf); audio?.pause(); };
  }, [isPlaying, audioUrl, duration, totalDuration, rate]);
  useEffect(() => {
    const audio = audioRef.current;
    // The closing frame has no audio: leave the ended track alone instead of re-seeking it every frame.
    if (audio && (!isPlaying || Math.abs(audio.currentTime - currentTime) > .4) && (currentTime < duration || !isPlaying))
      audio.currentTime = Math.min(currentTime, duration);
  }, [currentTime, isPlaying]);

  // Redraw canvas whenever currentTime, image, regions, or actions change
  const renderFrame = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const drawn = renderQuestionVideoFrame(
      ctx,
      canvas.width,
      canvas.height,
      imageElement,
      regions,
      actions,
      currentTime,
      {
        width: canvas.width,
        height: canvas.height,
        aspectRatio: videoConfig.aspectRatio || '16:9',
        showWatermark: videoConfig.showWatermark,
        teacherTag: videoConfig.teacherTag || 'Arapça YDT • Video Stüdyosu',
        selectedRegionId,
        interactiveMode: false,
        settled: !isPlaying,
        captions: videoConfig.captions,
        showCaptions: videoConfig.showCaptions,
        captionY: videoConfig.captionY,
        underlineOffset: videoConfig.underlineOffset,
        imageScale: videoConfig.imageScale,
        showOutro: videoConfig.showOutro,
        markerPen: videoConfig.markerPen,
        duration,
      }
    );
    setFit(previous => previous && ['x', 'y', 'width', 'height'].every(k => previous[k as keyof FitRect] === drawn[k as keyof FitRect]) ? previous : drawn);
  }, [currentTime, imageElement, regions, actions, videoConfig, selectedRegionId, duration, isPlaying]);

  useEffect(() => {
    renderFrame();
    let active = true;
    document.fonts.ready.then(() => { if (active) renderFrame(); });
    return () => { active = false; };
  }, [renderFrame]);

  const effectiveDuration = Math.max(1, totalDuration);

  const handleFullscreen = () => {
    if (containerRef.current) {
      if (!document.fullscreenElement) {
        containerRef.current.requestFullscreen().catch(() => {});
      } else {
        document.exitFullscreen().catch(() => {});
      }
    }
  };

  const handleRestart = () => {
    onSeek(0);
    if (audioRef.current) {
      audioRef.current.currentTime = 0;
    }
  };

  const handleScrubberClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const clickX = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
    const newTime = (clickX / rect.width) * effectiveDuration;
    onSeek(newTime);
  };

  return (
    <div ref={containerRef} className="flex flex-col space-y-1.5 select-none w-full">
      {audioUrl && (
        <audio
          ref={audioRef}
          src={audioUrl}
          onTimeUpdate={e => {
            if (isPlaying) onSeek(e.currentTarget.currentTime);
          }}
          onEnded={() => {
            if (isPlaying) onPlayPause();
            onSeek(0);
          }}
          className="hidden"
        />
      )}

      {/* Canvas Display Viewport */}
      <div data-preview-picture className="relative w-full aspect-video bg-[#1C1917] rounded-xl border border-[#D5D4CC] overflow-hidden shadow-sm flex items-center justify-center group">
        <canvas
          ref={canvasRef}
          width={1920}
          height={1080}
          className="w-full h-full object-contain"
        />

        {editing && fit && imageElement && (
          <Suspense fallback={null}>
          <PreviewEditOverlay fit={fit} canvasWidth={1920} canvasHeight={1080} regions={regions} actions={actions}
            time={currentTime} total={duration} underlineOffset={videoConfig.underlineOffset} markerPen={videoConfig.markerPen}
            onRegions={editing.onRegions} onActions={editing.onActions} onUndo={editing.onUndo} canUndo={editing.canUndo} onRedo={editing.onRedo} canRedo={editing.canRedo}
            onAssignOption={editing.onAssignOption} drawOption={editing.drawOption} onDrawOptionDone={editing.onDrawOptionDone} focusBox={editing.focusBox}
            playing={isPlaying} onPause={() => { if (isPlaying) onPlayPause(); }} />
          </Suspense>
        )}

        {/* Center overlay play button when paused */}
        {!isPlaying && currentTime === 0 && (
          <button
            type="button"
            onClick={onPlayPause}
            className="absolute inset-0 m-auto w-14 h-14 rounded-full bg-[#8B1E2D]/90 hover:bg-[#8B1E2D] text-white flex items-center justify-center shadow-lg transition-transform hover:scale-105 cursor-pointer backdrop-blur-xs z-20"
            title="Videoyu Oynat"
          >
            <Play size={24} weight="fill" className="ml-1" />
          </button>
        )}
      </div>

      {/* Controls in one row, so the picture keeps as much of the screen as possible. */}
      <div className="flex items-center gap-2 px-2 py-1.5 rounded-lg bg-white border border-[#E5E4DC] text-xs shadow-xs">
        <button
          type="button"
          onClick={onPlayPause}
          className="p-1.5 rounded-md bg-[#FAF9F5] hover:bg-[#8B1E2D] hover:text-white border border-[#D5D4CC] text-[#1C1917] transition-colors cursor-pointer"
          title={isPlaying ? 'Durdur' : 'Oynat'}
        >
          {isPlaying ? <Pause size={15} weight="bold" /> : <Play size={15} weight="bold" />}
        </button>
        <button
          type="button"
          onClick={handleRestart}
          className="p-1.5 rounded-md bg-[#FAF9F5] hover:bg-[#EFEFEA] border border-[#D5D4CC] text-[#55544F] transition-colors cursor-pointer"
          title="Başa Dön"
        >
          <ArrowCounterClockwise size={15} weight="bold" />
        </button>
        <div className="text-xs font-mono text-[#55544F] whitespace-nowrap">
          <span className="font-semibold text-[#1C1917]">{clock(currentTime)}</span>
          <span> / </span>
          <span>{clock(effectiveDuration)}</span>
        </div>
        <div
          onClick={handleScrubberClick}
          className="flex-1 min-w-16 h-3 bg-[#FAF9F5] border border-[#E5E4DC] rounded-full cursor-pointer relative overflow-hidden flex items-center"
          title="Zaman Çizelgesi"
        >
          <div
            className="h-full bg-[#8B1E2D] rounded-full transition-all duration-75"
            style={{ width: `${Math.min(100, (currentTime / effectiveDuration) * 100)}%` }}
          />
        </div>
        <div className="flex items-center rounded-md border border-[#D5D4CC] overflow-hidden text-xs font-semibold" role="group" aria-label="Oynatma hızı">
          {PREVIEW_SPEEDS.map(speed => (
            <button key={speed} type="button" onClick={() => changeRate(speed)} aria-pressed={rate === speed}
              title={speed === 1 ? 'Normal hız' : `${speedLabel(speed)} hızlı önizle`}
              className={`px-1.5 py-1 transition-colors ${rate === speed ? 'bg-[#8B1E2D] text-white' : 'bg-[#FAF9F5] text-[#55544F] hover:bg-[#EFEFEA]'}`}>
              {speedLabel(speed)}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={handleFullscreen}
          className="p-1.5 rounded-md bg-[#FAF9F5] hover:bg-[#EFEFEA] border border-[#D5D4CC] text-[#55544F] transition-colors cursor-pointer"
          title="Tam Ekran"
        >
          <CornersOut size={16} />
        </button>
      </div>
    </div>
  );
};
