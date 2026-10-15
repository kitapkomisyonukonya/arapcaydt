import { database } from '../../services/supabase';
import { getCategoryLabel } from '../../config/categories';
import { lengthLabel } from '../video/videoInfo';

/** One question as the Yönetim list shows it: only the fields the list and the Excel file need. */
export interface AdminProjectRow {
  id: string; owner_id: string; updated_at: string;
  title: string | null; examName: string | null; examYear: string | null; questionNumber: number | string | null;
  topic: string | null; category: string | null; correctAnswer: string | null; status: string | null;
  videoReady: boolean | null; completedAt: string | null; nsDuration: number | string | null; anDuration: number | string | null;
}

const SELECT = [
  'id', 'owner_id', 'updated_at',
  'title:data->>title', 'examName:data->>examName', 'examYear:data->>examYear', 'questionNumber:data->questionNumber',
  'topic:data->>topic', 'category:data->>category', 'correctAnswer:data->>correctAnswer', 'status:data->>status',
  'videoReady:data->videoReady', 'completedAt:data->>completedAt',
  'nsDuration:data->narrationSource->duration', 'anDuration:data->audioNarration->duration',
].join(',');

export type ProgressFilter = 'all' | 'completed' | 'open';
export interface ProjectQuery { owner?: string; progress: ProgressFilter; search?: string }
export const PAGE_SIZE = 25;

/** Where a question stands, in the words the teachers' own list uses. */
export function progressLabel(row: Pick<AdminProjectRow, 'completedAt' | 'videoReady' | 'status'>): string {
  if (row.completedAt) return 'Tamamlandı';
  if (row.videoReady === true || row.status === 'video_ready') return 'Video hazır';
  if (row.status === 'audio_approved') return 'Ses seçildi';
  if (row.status === 'audio_generated') return 'Ses hazır';
  return 'Taslak';
}

function build(q: ProjectQuery, count: boolean) {
  let query = database().from('projects').select(SELECT, count ? { count: 'exact' } : undefined)
    .is('data->>deletedAt', null).is('data->>kind', null).order('updated_at', { ascending: false });
  if (q.owner) query = query.eq('owner_id', q.owner);
  if (q.progress === 'completed') query = query.not('data->>completedAt', 'is', null);
  if (q.progress === 'open') query = query.is('data->>completedAt', null);
  const term = q.search?.trim().replace(/[%_*,()]/g, ' ');
  if (term) query = query.or(`data->>title.ilike.*${term}*,data->>examName.ilike.*${term}*,data->>topic.ilike.*${term}*`);
  return query;
}

/** One page of questions (newest change first) and how many match in all. */
export async function loadProjectPage(q: ProjectQuery, page: number): Promise<{ rows: AdminProjectRow[]; total: number }> {
  const { data, error, count } = await build(q, true).range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);
  if (error) throw new Error('Soru listesi okunamadı.');
  return { rows: (data || []) as unknown as AdminProjectRow[], total: count ?? 0 };
}

/** Every matching question, for the Excel file. */
export async function loadAllProjects(q: ProjectQuery): Promise<AdminProjectRow[]> {
  const all: AdminProjectRow[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await build(q, false).range(from, from + 999);
    if (error) throw new Error('Soru listesi okunamadı.');
    all.push(...((data || []) as unknown as AdminProjectRow[]));
    if ((data || []).length < 1000) return all;
  }
}

export const EXPORT_COLUMNS = ['Öğretmen', 'Başlık', 'Koleksiyon', 'Sınav / yıl', 'Soru no', 'Konu', 'Kategori', 'Doğru cevap', 'Durum', 'Süre', 'Son değişiklik'];

/** The list as an Excel-readable file (semicolons and a BOM, like the teachers' own Excel list). */
export function projectsCsv(rows: AdminProjectRow[], who: (id: string) => string): string {
  const cell = (v: string) => /[;"\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
  const lines = rows.map(r => [
    who(r.owner_id), r.title || '', r.examName || '', r.examYear || '', r.questionNumber ? String(r.questionNumber) : '',
    r.topic || '', r.category ? getCategoryLabel(r.category) : '', r.correctAnswer || '', progressLabel(r),
    lengthLabel(Number(r.nsDuration) || Number(r.anDuration) || 0), r.updated_at ? new Date(r.updated_at).toLocaleDateString('tr') : '',
  ].map(v => cell(String(v))).join(';'));
  return '﻿' + [EXPORT_COLUMNS.join(';'), ...lines].join('\r\n') + '\r\n';
}
