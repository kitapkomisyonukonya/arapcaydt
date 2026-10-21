export type ProjectStatus = 'draft' | 'audio_generated' | 'audio_approved' | 'video_ready';

export type YdtCategory =
  | 'nahiv'
  | 'sarf'
  | 'kelime'
  | 'cumle_tamamlama'
  | 'ceviri'
  | 'paragraf'
  | 'diyalog'
  | 'anlam_butunlugu'
  | 'irab';

export interface User {
  id: string;
  name: string;
  email: string;
  title: string;
  institution?: string;
  role: 'teacher' | 'editor' | 'admin';
  status?: 'pending' | 'approved' | 'blocked';
  /** New-question and video defaults; see features/settings/preferences. */
  preferences?: import('../features/settings/preferences').UserPreferences;
}

export type AnnotationType = 'check' | 'cross' | 'highlight' | 'underline' | 'rule_box';

export interface VideoAnnotation {
  id: string;
  type: AnnotationType;
  target?: 'A' | 'B' | 'C' | 'D' | 'E' | 'stem' | 'free';
  x: number; // percentage (0 - 100)
  y: number; // percentage (0 - 100)
  width?: number; // percentage (0 - 100)
  height?: number; // percentage (0 - 100)
  startTime: number; // seconds
  duration: number; // seconds visible
  color?: string;
  text?: string;
  label?: string;
}

export interface NarrationWord {
  text: string;
  start: number;
  end: number;
}

export type RegionType =
  | 'question'
  | 'question-root'
  | 'paragraph'
  /** A numbered statement (I, II, III…) above the options; ids premise-1, premise-2… */
  | 'premise'
  | 'keyword'
  | 'word'
  | 'phrase'
  | 'option'
  | 'option-a'
  | 'option-b'
  | 'option-c'
  | 'option-d'
  | 'option-e'
  | 'custom';

export interface AnnotationRegion {
  id: string;
  label: string;
  type: RegionType;
  x: number; // normalized 0 to 1
  y: number; // normalized 0 to 1
  width: number; // normalized 0 to 1
  height: number; // normalized 0 to 1
  color?: string;
  content?: string;
  manuallyAdjusted?: boolean;
  /** Label center relative to this region, independent of Arabic descenders. */
  markerAnchor?: { x: number; y: number };
  /**
   * A mark the teacher put on the picture as an object of its own: a ✗/✓ `stamp` (the box is the
   * stamp), an underline `line` (the box is the line), or a `drawn` place (a ring fills it exactly).
   * Found boxes and older drawn boxes have none.
   */
  shape?: 'stamp' | 'line' | 'drawn' | 'arrow' | 'note';
  /** An `arrow`'s tail and head inside its box (shares of the box, 0–1). */
  arrow?: { x1: number; y1: number; x2: number; y2: number };
  /** A `note`'s text, written on the picture (never matched to the narration). */
  text?: string;
  /** Where the studio first found this box, kept when the teacher moves or resizes it ("Otomatiğe döndür"). */
  auto?: { x: number; y: number; width: number; height: number };
}

export interface VideoCaption {
  start: number;
  end: number;
  text: string;
  /** Spoken timing of each word, as offsets into `text` (karaoke highlight). */
  words?: Array<{ from: number; to: number; start: number; end: number }>;
}

export type VideoActionType =
  | 'highlight'
  | 'underline'
  | 'reject'
  | 'correct'
  /**
   * A plain ✓ / ✗ saying a statement is true / false (green / red unless the teacher picked a
   * colour). Unlike `correct` / `reject` it says nothing about the answer: in "hangisi yanlıştır"
   * a true option gets a tick, and a numbered statement (I, II, III) gets one once it is judged.
   */
  | 'tick'
  | 'cross'
  | 'focus'
  /** A hand-drawn ring around a word or an option, drawn in and kept for its duration. */
  | 'circle'
  /** An arrow the teacher drew, growing from its tail to its head. */
  | 'arrow'
  /** A short text the teacher wrote on the picture. */
  | 'note'
  | 'dim-others'
  | 'reset';

export interface VideoAction {
  /** No longer used: an underline is drawn over its whole duration (see underlineDrawTime). */
  drawDuration?: number;
  /**
   * Underline only: the line follows the spoken words. Each point says how far along the box
   * (`to`, 0–1) the line is `at` seconds after the mark starts; between points it moves evenly.
   */
  drawSteps?: Array<{ at: number; to: number }>;
  /** Underline, ring, arrow, note, tick or cross: the teacher's colour (each mark's own colour when not set). */
  color?: string;
  /** Underline only: drawn left-to-right (the way the teacher dragged it); otherwise right-to-left, as Arabic is read. */
  fromLeft?: boolean;
  /** Underline only: moves this line up (−) or down (+), in heights of its text line. */
  lineOffset?: number;
  /** Underline only: seconds the finished line stays at the end of the mark (older passage lines; no longer made). */
  holdFor?: number;
  id: string;
  start: number; // seconds
  startTime?: number; // alias
  duration: number; // seconds
  targetRegionId: string;
  regionId?: string; // alias
  type: VideoActionType;
  label?: string;
  /** The teacher moved this mark in time (Erken/Geç or dragging on the timeline). */
  retimed?: boolean;
  /**
   * A cross or tick that goes away at the end of its duration (Konu anlatımı slides, where the
   * teacher sets how long it stays). In question videos crosses and ticks stay to the end.
   */
  ends?: boolean;
}

export interface AudioNarration {
  audioBase64?: string;
  audioUrl: string;
  duration: number;
  voiceId: string;
  voiceName: string;
  modelId: string;
  generatedAt: string;
  isApproved: boolean;
  mode: 'live' | 'mock';
  assetPath?: string;
  fallbackReason?: string;
  mimeType?: string;
  words?: NarrationWord[];
  alignment?: {
    characters: string[];
    character_start_times_seconds: number[];
    character_end_times_seconds: number[];
  };
  wordAlignments?: Array<{
    word: string;
    start: number;
    end: number;
  }>;
}

export interface VideoConfig {
  aspectRatio: '9:16' | '16:9';
  fps: number;
  backgroundColor: string;
  showWatermark: boolean;
  teacherTag?: string;
  annotations: VideoAnnotation[];
  regions?: AnnotationRegion[];
  timelineActions?: VideoAction[];
  captions?: VideoCaption[];
  showCaptions?: boolean;
  captionY?: number;
  /** Question image size as a share of the whole frame; unset = whole frame. */
  imageScale?: number;
  /** Every underline in this video moves up (−) or down (+), in heights of its text line. */
  underlineOffset?: number;
  showOutro?: boolean;
  /** Konu anlatımı slides: "Vurgu" drawn as a highlighter pen (questions keep underlines and a soft tint). */
  markerPen?: boolean;
  timingQuality?: 'word-aligned' | 'anchored' | 'approximate';
  pipelineVersion?: number;
  warnings?: string[];
  suppressedRegionIds?: string[];
  /** Which reader read the question picture, and why Google Vision was not used (if tried). */
  ocrEngine?: 'vision' | 'tesseract';
  ocrNote?: string;
  /**
   * Google Vision's reading of this question's picture, kept so preparing the marks again reads
   * it from here instead of spending another reading. `key` is the picture's SHA-256: a new
   * picture is read again.
   */
  visionReading?: {
    key: string;
    page: { width: number; height: number; text: string; lines: number[][];
      words: Array<{ text: string; confidence: number; x: number; y: number; width: number; height: number }> };
  };
  /** What was found of the solution's Arabic passages (shown in İşaretler). */
  passageNote?: string;
}

export interface ExportConfig {
  resolution: '720p' | '1080p';
  fps: 30;
  format: 'mp4' | 'webm';
  aspectRatio: '16:9' | '9:16';
}

export type NarrationSourceType = 'gemini' | 'elevenlabs' | 'uploaded';

export interface NarrationSource {
  type: NarrationSourceType;
  audioUrl: string;
  audioBase64?: string;
  duration: number;
  fileName?: string;
  voiceName?: string;
  voiceId?: string;
  modelId?: string;
  mimeType?: string;
  words?: NarrationWord[];
  alignment?: {
    characters: string[];
    character_start_times_seconds: number[];
    character_end_times_seconds: number[];
  };
  transcript?: string;
  /** The solution text this voice was generated from, to tell when the text has changed since. */
  spokenText?: string;
  /** How word timings were obtained. */
  timingSource?: 'gemini-transcribe' | 'forced-alignment' | 'whisper' | 'none';
  generatedAt?: string;
  isApproved?: boolean;
  assetPath?: string;
  fallbackReason?: string;
}

export interface QuestionProject {
  ownerId?: string;
  examName?: string;
  /** Konu (topic) of the question, e.g. "İsm-i mevsul"; free text with suggestions (src/config/topics.ts). */
  topic?: string;
  id: string;
  title: string;
  examYear: string;
  questionNumber: number;
  category: string;
  correctAnswer: 'A' | 'B' | 'C' | 'D' | 'E';
  status: ProjectStatus;
  createdAt: string;
  updatedAt: string;
  imageUrl: string;
  imageFileName?: string;
  imageDimensions?: { width: number; height: number };
  arabicQuestionSnippet?: string;
  solutionText: string;
  audioApproved?: boolean;
  narrationSource?: NarrationSource;
  audioNarration?: AudioNarration;
  videoConfig: VideoConfig;
  videoReady?: boolean;
  renderedVideoUrl?: string;
  isOutdated?: boolean;
  notes?: string;
  /** When the teacher moved it to the recycle bin; it is deleted for good 30 days later. */
  deletedAt?: string;
  /** The teacher finished the question (downloaded its MP4, or marked it done): no longer "to check". */
  completedAt?: string;
  /** When a finished question was opened for changes again. */
  reopenedAt?: string;
}

/**
 * What project lists need: no narration words, captions or animation plan.
 * The full project is loaded only when it is opened (projectRepository.getById).
 */
export type ProjectSummary = Pick<QuestionProject,
  'id' | 'ownerId' | 'createdAt' | 'updatedAt' | 'title' | 'examYear' | 'examName' | 'questionNumber' | 'category'
  | 'correctAnswer' | 'status' | 'audioApproved' | 'videoReady' | 'imageUrl' | 'imageFileName' | 'arabicQuestionSnippet' | 'solutionText'
  | 'deletedAt' | 'completedAt' | 'topic'> & {
  narrationSource?: Pick<NarrationSource, 'type' | 'isApproved' | 'duration'>;
  audioNarration?: Pick<AudioNarration, 'isApproved' | 'duration'>;
};

export interface ElevenLabsVoice {
  voice_id: string;
  name: string;
  category?: string;
  language?: string;
  accent?: string;
  gender?: string;
  description?: string;
  preview_url?: string;
  recommended?: boolean;
}

/** Narration service status (Gemini TTS primary, ElevenLabs fallback). */
export interface ElevenLabsStatus {
  configured: boolean;
  mode: 'live' | 'mock' | 'unconfigured';
  message: string;
  valid?: boolean;
  remainingCharacters?: number | null;
  tier?: string | null;
  gemini?: { configured: boolean };
  voiceReady?: boolean;
}
