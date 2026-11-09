import React from 'react';

/** Types, labels and small building blocks shared by the Yönetim tabs. */
import type { ElevenLabsStatus } from '../../types';

export interface Member {
  id: string;
  email: string;
  name: string;
  role: string;
  status: string;
  questions: number;
  mock_questions: number;
  mock_exams: number;
  voice_attempts: number;
  voices: number;
  characters: number;
  exports: number;
}
export interface Overview {
  members: Member[];
  projects: Array<{ id: string; owner_id: string; title: string; category: string; status: string; updated_at: string }>;
  activity: Array<{ id: string; owner_id: string; kind: string; state: string; characters: number; created_at: string }>;
}
export interface MemberAnalytics {
  categories: Record<string, number>;
  draft: number;
  audioGenerated: number;
  audioApproved: number;
  videoReady: number;
  withAudio: number;
  uploadedAudio: number;
  gemini: number;
  elevenlabs: number;
  geminiFallbacks: number;
  quality: { ready: number; check: number; blocked: number };
  /** Finished questions (MP4 downloaded or marked done); not counted in quality. */
  completed?: number;
  lastProjectAt: string | null;
}
export interface MemberToday {
  ownTts: number;
  ownTranscribe: number;
  ownTranscribeExhausted: boolean;
  ownTtsExhausted: number;
  sharedTts: number;
  sharedTranscribe: number;
  elevenlabsAlign: number;
}
export type Counter = { succeeded: number; failed: number };
export type RequestService = 'gemini_tts' | 'gemini_transcribe' | 'elevenlabs_align' | 'voice';
export interface Analytics {
  totalProjects: number;
  /** Every teacher's Konu Anlatımları (missing before the update is deployed; null if they could not be read). */
  lessons?: import('../../../server/lessonStats').LessonStat[] | null;
  categoryTotals: Record<string, number>;
  /** Missing before the analytics update is deployed. */
  topicTotals?: Record<string, { total: number; completed: number }>;
  members: Record<string, MemberAnalytics>;
  voice: {
    gemini: number;
    elevenlabs: number;
    geminiFallbacks: number;
    uploaded: number;
    none: number;
    models: Record<string, number>;
    timing: Record<string, number>;
  };
  funnel: { total: number; withAudio: number; withMarkers: number; ready: number; completed?: number };
  vision?: { month: number | null; limit: number; configured: boolean };
  serverErrors?: Array<{ owner_id: string | null; route: string; status: number; message: string; created_at: string }> | null;
  week?: Record<string, { completed: number; working: number; needsVoice: number; needsMarks: number; needsFix: number; errors: number }>;
  quality: { ready: number; check: number; blocked: number };
  /** Finished questions the teacher did not have to fix the marks of (missing before the analytics update is deployed). */
  marks?: { finished: number; untouched: number; moved: number; added: number; removed: number; retimed: number;
    byCategory: Record<string, { finished: number; untouched: number }> };
  issues: Array<{ projectId: string; ownerId: string; title: string; updatedAt: string; detail: string }>;
  teacherKeys?: Record<string, { last4: string; status: string; updatedAt: string }>;
  requests?: {
    migrationPending: boolean;
    quotaDay: string;
    resetsAt?: string;
    failures?: Array<{ at: string; ownerId: string; kind: RequestService; keySource: string | null; model: string; status: string; reason: string }>;
    totals: Record<'today' | 'last30Days' | 'all', Record<RequestService, Counter>>;
    geminiModels: Record<string, { today: Counter; last30Days: Counter; sharedToday?: number; lastQuota?: string }>;
    members: Record<string, Record<RequestService, number>>;
    membersToday?: Record<string, MemberToday>;
    membersWeek?: Record<string, { voice: Counter; timing: Counter }>;
    studio?: { transcribeUsed: number; transcribeExhausted: boolean; ttsExhausted: string[] };
    limits?: { sharedTranscribePerTeacher: number; elevenlabsAlignPerTeacher: number };
  };
}

/** The studio key's Transcribe quota per day on the free tier (billing off on the studio owner's AI Studio project). */
export const STUDIO_TRANSCRIBE_DAILY = 25;
export const requestLabels: Record<RequestService, string> = {
  gemini_tts: 'Gemini seslendirme',
  gemini_transcribe: 'Gemini Transcribe',
  elevenlabs_align: 'ElevenLabs Forced Alignment',
  voice: 'ElevenLabs yedek sesi',
};
export const timingLabels: Record<string, string> = {
  'gemini-transcribe': 'Gemini Transcribe',
  'forced-alignment': 'ElevenLabs Forced Alignment',
  whisper: 'Yerel Whisper',
  'elevenlabs-tts': 'ElevenLabs ses zamanları',
  none: 'Yok (yaklaşık zamanlama)',
};
export const statuses: Record<string, string> = {
  pending: 'Onay bekliyor',
  approved: 'Onaylı',
  blocked: 'Durduruldu',
  draft: 'Taslak',
  audio_generated: 'Ses hazır',
  audio_approved: 'Ses seçildi',
  video_ready: 'Video hazır',
};
export const activityStates: Record<string, string> = {
  succeeded: 'Tamamlandı',
  requested: 'İstek gönderildi',
  failed: 'Başarısız',
  aligned: 'Tamamlandı',
  align_failed: 'Başarısız',
  uncertain: 'Sonuç doğrulanamadı',
  client_reported: 'Tarayıcıda tamamlandı',
  role_admin: 'Yönetici yapıldı',
  ...statuses,
};

export const counts = (c?: Counter) =>
  c ? (
    <>
      <strong className="tabular-nums">{c.succeeded + c.failed}</strong>
      {c.failed > 0 && <span className="text-xs text-red-700"> · {c.failed} başarısız</span>}
    </>
  ) : (
    '—'
  );
export const sorted = (map: Record<string, number> | undefined) => Object.entries(map || {}).sort((a, b) => b[1] - a[1]);
export const dateTime = (iso: string) => new Date(iso).toLocaleString('tr', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
export function ago(iso: string | null | undefined): string {
  if (!iso) return '—';
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  const rtf = new Intl.RelativeTimeFormat('tr', { numeric: 'auto' });
  if (Math.abs(minutes) < 60) return rtf.format(-minutes, 'minute');
  if (Math.abs(minutes) < 60 * 24) return rtf.format(-Math.round(minutes / 60), 'hour');
  return rtf.format(-Math.round(minutes / 1440), 'day');
}

export type Tab = 'overview' | 'messages' | 'teachers' | 'usage' | 'projects' | 'settings';
export const card = 'rounded-xl border bg-white p-5';

export const Stat: React.FC<{ label: string; value: React.ReactNode; hint?: React.ReactNode; tone?: string }> = ({ label, value, hint, tone }) => (
  <div className={card}>
    <p className="text-sm text-[#666560]">{label}</p>
    <p className={`mt-1 text-3xl font-bold tabular-nums tracking-tight ${tone || 'text-[#1C1917]'}`}>{value}</p>
    {hint && <p className="mt-1 text-xs text-[#787670]">{hint}</p>}
  </div>
);
export const SectionTitle: React.FC<{ title: string; note?: React.ReactNode; action?: React.ReactNode }> = ({ title, note, action }) => (
  <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
    <div>
      <h3 className="font-bold text-[#1C1917]">{title}</h3>
      {note && <p className="text-xs text-[#787670] mt-1 max-w-3xl">{note}</p>}
    </div>
    {action}
  </div>
);
export const Chip: React.FC<{ tone: 'green' | 'amber' | 'red' | 'gray' | 'brand'; children: React.ReactNode }> = ({ tone, children }) => (
  <span
    className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap ${
      {
        green: 'bg-[#EFF7F0] text-[#1E562A]',
        amber: 'bg-[#FFF8E6] text-[#78540E]',
        red: 'bg-red-50 text-red-700',
        gray: 'bg-[#F2F1EB] text-[#55544F]',
        brand: 'bg-[#F8EEEE] text-[#8B1E2D]',
      }[tone]
    }`}
  >
    {children}
  </span>
);

/** What every Yönetim tab reads from the page: the loaded data and the page's actions. */
export interface AdminCtx {
  busy: boolean;
  open: (id: string) => Promise<void>;
  who: (id: string) => string;
  members: Member[];
  pending: Member[];
  change: (member: Member, status: string) => Promise<void>;
  promote: (member: Member) => Promise<void>;
  analytics: Analytics | null;
  requests: Analytics['requests'];
  limits: { shared: number; eleven: number };
  activeKeys: number;
  totalVideoReady: number;
  voice: ElevenLabsStatus | null;
  setTab: (tab: Tab) => void;
  filter: string;
  setFilter: (value: string) => void;
  data: Overview | null;
  importLegacy: () => Promise<void>;
  importMessage: string;
  issuesList: (limit?: number) => React.ReactNode;
  /** The Sorular list's teacher filter ('' = all); set from the Öğretmenler tab too. */
  projectOwner: string;
  showProjects: (ownerId: string) => void;
}
