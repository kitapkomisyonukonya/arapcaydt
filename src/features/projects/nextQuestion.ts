import type { QuestionProject } from '../../types';

/**
 * The next question of a numbered series ("TTKB-AYT-DENEME-2-38" → "TTKB-AYT-DENEME-2-39"):
 * same category, exam and collection. A name without a number at its end is left to the default.
 */
export function nextQuestionDraft(project: QuestionProject): Partial<QuestionProject> {
  const numbered = /^(.*?)(\d+)(\D*)$/.exec(project.title.trim());
  const title = numbered ? `${numbered[1]}${String(Number(numbered[2]) + 1).padStart(numbered[2].length, '0')}${numbered[3]}` : undefined;
  return {
    ...(title ? { title } : {}),
    category: project.category,
    examYear: project.examYear,
    ...(project.examName ? { examName: project.examName } : {}),
    ...(project.questionNumber ? { questionNumber: project.questionNumber + 1 } : {}),
  };
}
