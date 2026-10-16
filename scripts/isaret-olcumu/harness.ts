// The studio's own "İşaretleri otomatik hazırla", run on a stored question (see olc.mjs).
import { localVideoPipeline, pipelineDiagnostics } from '../../src/services/pipeline/localVideoPipeline';

(window as any).prepareMarks = async (q: any) => {
  const result = await localVideoPipeline.executePipeline({
    imageUrl: q.imageUrl, solutionText: q.solutionText, correctAnswer: q.correctAnswer || undefined,
    narrationSource: { type: q.narrationType || 'generated', words: q.words || [], duration: q.duration } as any,
  });
  return { regions: result.regions, actions: result.actions, warnings: result.warnings, diagnostics: pipelineDiagnostics() };
};
(window as any).ready = true;
