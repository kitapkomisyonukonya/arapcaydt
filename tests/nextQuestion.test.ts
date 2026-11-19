import test from 'node:test';
import assert from 'node:assert/strict';
import { nextQuestionDraft } from '../src/features/projects/nextQuestion';
import type { QuestionProject } from '../src/types';

const project = (title: string, extra: Partial<QuestionProject> = {}) =>
  ({ title, category: 'soru-coz', examYear: '2026 YDT', examName: 'TTKB-AYT-DENEME-2', questionNumber: 38, ...extra }) as QuestionProject;

test('the next question continues a numbered series in the same collection', () => {
  assert.deepEqual(nextQuestionDraft(project('TTKB-AYT-DENEME-2-38')),
    { title: 'TTKB-AYT-DENEME-2-39', category: 'soru-coz', examYear: '2026 YDT', examName: 'TTKB-AYT-DENEME-2', questionNumber: 39 });
  assert.equal(nextQuestionDraft(project('Soru 09')).title, 'Soru 10');
  assert.equal(nextQuestionDraft(project('Soru 18.')).title, 'Soru 19.');
});

test('a name without a number at its end gets the default name', () => {
  const draft = nextQuestionDraft(project('Mübteda ve haber', { examName: undefined, questionNumber: undefined }));
  assert.equal(draft.title, undefined);
  assert.equal('examName' in draft, false);
  assert.equal('questionNumber' in draft, false);
});
