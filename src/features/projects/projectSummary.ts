import type { ProjectSummary, QuestionProject } from '../../types';

/** Project JSON fields read for lists (PostgREST aliases; nothing heavier than the solution text). */
export const SUMMARY_SELECT = [
  'id', 'owner_id', 'created_at', 'updated_at',
  'title:data->>title', 'examYear:data->>examYear', 'examName:data->>examName', 'topic:data->>topic', 'questionNumber:data->questionNumber',
  'category:data->>category', 'correctAnswer:data->>correctAnswer', 'status:data->>status',
  'audioApproved:data->audioApproved', 'videoReady:data->videoReady',
  'imageUrl:data->imageUrl', 'imageFileName:data->>imageFileName', 'arabicQuestionSnippet:data->>arabicQuestionSnippet',
  'solutionText:data->>solutionText',
  'nsType:data->narrationSource->>type', 'nsApproved:data->narrationSource->isApproved', 'nsDuration:data->narrationSource->duration',
  'anApproved:data->audioNarration->isApproved', 'anDuration:data->audioNarration->duration',
  'deletedAt:data->>deletedAt', 'completedAt:data->>completedAt',
].join(',');

/** Storage path of a stored image reference, or null for inline/legacy URLs. */
export const imageAssetPath = (value: unknown): string | null =>
  value && typeof value === 'object' && typeof (value as any).assetPath === 'string' ? (value as any).assetPath : null;

/**
 * Storage path inside a playback link this site signed (Supabase or Cloudflare R2): files are kept
 * as "<owner>/<project>/<sha256>.<ext>". Null for any other address (inline, blob, outside links).
 */
export function signedLinkPath(url: string): string | null {
  if (!/^https:\/\//.test(url)) return null;
  let path: string;
  try { path = decodeURIComponent(new URL(url).pathname); } catch { return null; }
  return path.match(/\/([0-9a-f-]{36}\/[0-9a-f-]{36}\/[0-9a-f]{64}(?:\.[a-z0-9]+)?)$/)?.[1] ?? null;
}

const LETTERS = ['A', 'B', 'C', 'D', 'E'] as const;

/** A list row; `imageUrl` is the signed thumbnail link (or the inline/legacy URL as stored). */
export function summaryFromRow(row: any, signed: Map<string, string>): ProjectSummary {
  const path = imageAssetPath(row.imageUrl);
  const hasNarration = row.nsType != null || row.nsApproved != null || row.nsDuration != null;
  const hasCompat = row.anApproved != null || row.anDuration != null;
  return {
    id: row.id, ownerId: row.owner_id, createdAt: row.created_at, updatedAt: row.updated_at,
    title: row.title ?? '', examYear: row.examYear ?? '', examName: row.examName ?? undefined, ...(row.topic ? { topic: row.topic } : {}),
    questionNumber: Number(row.questionNumber) || 0, category: row.category ?? '',
    correctAnswer: (LETTERS as readonly string[]).includes(row.correctAnswer) ? row.correctAnswer : 'A',
    status: row.status || 'draft', audioApproved: row.audioApproved === true, videoReady: row.videoReady === true,
    imageUrl: path ? signed.get(path) || '' : typeof row.imageUrl === 'string' ? row.imageUrl : '',
    imageFileName: row.imageFileName ?? undefined, arabicQuestionSnippet: row.arabicQuestionSnippet ?? undefined,
    solutionText: row.solutionText ?? '',
    narrationSource: hasNarration ? { type: row.nsType, isApproved: row.nsApproved === true, duration: Number(row.nsDuration) || 0 } : undefined,
    audioNarration: hasCompat ? { isApproved: row.anApproved === true, duration: Number(row.anDuration) || 0 } : undefined,
    ...(row.deletedAt ? { deletedAt: row.deletedAt } : {}),
    ...(row.completedAt ? { completedAt: row.completedAt } : {}),
  };
}

/** The list entry for a project already in memory (after save or create). */
export function toSummary(p: QuestionProject | ProjectSummary): ProjectSummary {
  return {
    id: p.id, ownerId: p.ownerId, createdAt: p.createdAt, updatedAt: p.updatedAt, title: p.title, examYear: p.examYear,
    examName: p.examName, ...(p.topic ? { topic: p.topic } : {}), questionNumber: p.questionNumber, category: p.category, correctAnswer: p.correctAnswer, status: p.status,
    audioApproved: p.audioApproved, videoReady: p.videoReady, imageUrl: p.imageUrl, imageFileName: p.imageFileName,
    arabicQuestionSnippet: p.arabicQuestionSnippet, solutionText: p.solutionText,
    narrationSource: p.narrationSource ? { type: p.narrationSource.type, isApproved: p.narrationSource.isApproved, duration: p.narrationSource.duration } : undefined,
    audioNarration: p.audioNarration ? { isApproved: p.audioNarration.isApproved, duration: p.audioNarration.duration } : undefined,
    ...(p.deletedAt ? { deletedAt: p.deletedAt } : {}),
    ...(p.completedAt ? { completedAt: p.completedAt } : {}),
  };
}
