import { ExportConfig, VideoCaption } from '../../../types';

export interface ActiveHighlight {
  regionId: string;
  opacity: number;
  color?: string;
  /** How far a highlighter pen stroke has gone across the box (0–1), and which way. */
  progress: number;
  isRtl: boolean;
}

export interface ActiveUnderline {
  regionId: string;
  progress: number; // 0 to 1
  isRtl: boolean;
  color?: string;
  /** Fades the marker out at the end of its spoken span. */
  opacity?: number;
  /** Teacher's nudge for this line, in heights of its text line. */
  offset?: number;
}

export interface ActiveFocus {
  regionId: string;
  intensity: number; // 0 to 1
}

/** A ring around a box: `progress` 0–1 of its drawing, then it stays. */
export interface ActiveCircle {
  regionId: string;
  progress: number;
  opacity: number;
  color?: string;
}

/** An arrow drawn from its tail (`progress` 0–1), then kept; a note faded in and kept. */
export interface ActiveShape {
  regionId: string;
  progress: number;
  opacity: number;
  color?: string;
}

export interface ActiveDimOthers {
  active: boolean;
  targetRegionId?: string;
  opacity: number;
}

export interface MarkerState {
  regionId: string;
  drawProgress: number; // 0 to 1
  timestamp: number;
}

export interface RenderState {
  activeHighlights: ActiveHighlight[];
  activeUnderlines: ActiveUnderline[];
  activeFocus: ActiveFocus[];
  activeCircles: ActiveCircle[];
  activeArrows: ActiveShape[];
  activeNotes: ActiveShape[];
  activeDimOthers: ActiveDimOthers;
  rejectedRegions: Record<string, MarkerState>;
  correctRegions: Record<string, MarkerState>;
  selectedRegionId?: string | null;
}

export interface FitRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface RenderOptions {
  width: number;
  height: number;
  aspectRatio: '16:9' | '9:16';
  showWatermark?: boolean;
  teacherTag?: string;
  selectedRegionId?: string | null;
  interactiveMode?: boolean;
  /** The paused editor: marks that have started are shown finished (a mark added at this moment is visible at once). */
  settled?: boolean;
  captions?: VideoCaption[];
  showCaptions?: boolean;
  captionY?: number;
  /** Teacher's question size (share of the whole frame); whole frame when unset. */
  imageScale?: number;
  /** Moves every underline up (−) or down (+), in heights of its text line. */
  underlineOffset?: number;
  /** Closing "Doğru cevap" card after the narration (on unless false). */
  showOutro?: boolean;
  /** Konu anlatımı: "Vurgu" is a highlighter pen stroke across the line, as it is said (questions keep their soft tint). */
  markerPen?: boolean;
  /** Narration length; draws the thin progress bar in exported frames. */
  duration?: number;
}

export interface ExportProgress {
  stage: 'preparing' | 'rendering' | 'encoding' | 'finalizing' | 'completed' | 'error';
  percent: number;
  currentFrame?: number;
  totalFrames?: number;
  message?: string;
}

export interface IVideoExporter {
  exportVideo(
    canvasRenderer: (ctx: CanvasRenderingContext2D, time: number) => void,
    audioUrl: string | undefined,
    duration: number,
    config: ExportConfig,
    onProgress: (progress: ExportProgress) => void
  ): Promise<Blob>;
}
