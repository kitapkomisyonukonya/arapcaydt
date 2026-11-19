import React from 'react';
import type { QuestionProject } from '../../../types';
import { ArrowRight, CheckCircle, CircleNotch, Copy, DownloadSimple, Sparkle, WarningCircle } from '@phosphor-icons/react';
import { toast } from 'sonner';
import { videoInfo, videoInfoText } from '../../video/videoInfo';
import { ReadinessCard } from '../ReadinessCard';
import type { ReadinessAction } from '../readiness';
import { useConfirm } from '../../../components/common/ConfirmDialog';

export interface ExportStepProps {
  step: number;
  videoGenerated: boolean;
  currentProject: QuestionProject;
  handleReadinessAction: (action: ReadinessAction, letter?: string) => void;
  /** Mark the question finished (true) or open it for changes again (false). */
  onMarkDone: (done: boolean) => void;
  exportError: string | null;
  isExportingMp4: boolean;
  exportAbortRef: React.RefObject<AbortController | null>;
  handleDownloadMp4: () => void;
  exportPercent: number | null;
  setIsVideoModalOpen: (open: boolean) => void;
  handleAttemptCreateVideo: () => void;
  isAudioApproved: boolean;
  videoButtonWarning: string | null;
  /** Opens a new question that continues this one's series (name number + 1, same collection). */
  onNextQuestion?: () => void;
  /** The name the next question will get, shown on its button. */
  nextQuestionTitle?: string;
}

/** STEP 4: Video Oluştur */
export function ExportStep({ step, videoGenerated, currentProject, handleReadinessAction, onMarkDone, exportError, isExportingMp4, exportAbortRef, handleDownloadMp4, exportPercent, setIsVideoModalOpen, handleAttemptCreateVideo, isAudioApproved, videoButtonWarning, onNextQuestion, nextQuestionTitle }: ExportStepProps) {
  const confirm = useConfirm();
  return (
    <div hidden={step<3} className="space-y-3 pt-2 border-t border-[#E5E4DC]">
      <h2 className="text-sm font-bold text-[#1C1917] tracking-tight">
        {step===4?'Videonuzu indirin':'Animasyon önizlemesi'}
      </h2>

      {videoGenerated ? (
        /* Completed Video State: single clear download action + İşaretleri yeniden hazırla */
        <div className="p-4 rounded-xl border border-[#C5DAC8] bg-[#F4F9F5] space-y-3">
          <div className="flex items-center gap-2 text-sm font-bold text-[#15803D]">
            <CheckCircle size={18} weight="fill" />
            <span>Animasyon önizlemesi hazır</span>
          </div>

          <div className="space-y-2">
            <ReadinessCard project={currentProject} onAction={handleReadinessAction} />
            {exportError && <p role="alert" className="text-sm text-red-700">{exportError}</p>}
            {isExportingMp4 && <button type="button" className="text-sm underline" onClick={() => exportAbortRef.current?.abort()}>Oluşturmayı iptal et</button>}
            <button
              type="button"
              onClick={handleDownloadMp4}
              hidden={step!==4}
              disabled={isExportingMp4}
              className="w-full py-3 px-4 rounded-lg bg-[#8B1E2D] hover:bg-[#721824] text-white text-sm font-bold flex items-center justify-center gap-2 cursor-pointer shadow-xs transition-colors"
            >
              {isExportingMp4 ? (
                <>
                  <CircleNotch size={16} className="animate-spin" />
                  <span>MP4 Hazırlanıyor... {exportPercent ? `%${exportPercent}` : ''}</span>
                </>
              ) : (
                <>
                  <DownloadSimple size={17} weight="bold" />
                  <span>MP4 İndir (1080p)</span>
                </>
              )}
            </button>
            {step === 4 && (currentProject.completedAt ? (
              <div className="p-3 rounded-lg border border-[#C5DAC8] bg-white text-sm text-[#1E562A] space-y-1.5">
                <p className="font-semibold flex items-center gap-1.5"><CheckCircle size={16} weight="fill" /> Tamamlandı · {new Date(currentProject.completedAt).toLocaleDateString('tr-TR', { day: 'numeric', month: 'long' })}</p>
                <p className="text-[#55544F]">Bu soru bitti sayılır; kontrol listelerinde artık görünmez. Değişiklik yapmak isterseniz düzenlemeye açın, bitince yeniden indirin.</p>
                <button type="button" className="font-semibold text-[#8B1E2D] hover:underline" onClick={() => onMarkDone(false)}>Düzenlemeye geri aç</button>
              </div>
            ) : (
              <p className="text-sm text-[#787670] text-center">
                İndirince soru <b>Tamamlandı</b> olarak işaretlenir. Daha önce indirdiyseniz{' '}
                <button type="button" className="font-semibold text-[#8B1E2D] hover:underline" onClick={() => onMarkDone(true)}>tamamlandı olarak işaretleyin</button>.
              </p>
            ))}
            {step === 4 && onNextQuestion && (
              <button type="button" onClick={onNextQuestion} disabled={isExportingMp4}
                className="w-full py-2.5 px-4 rounded-lg border border-[#8B1E2D] text-[#8B1E2D] bg-white hover:bg-[#FBF3F4] text-sm font-semibold flex items-center justify-center gap-2">
                <span>Sıradaki soruya geç{nextQuestionTitle ? ` (${nextQuestionTitle})` : ''}</span>
                <ArrowRight size={16} weight="bold" />
              </button>
            )}
            {step === 4 && (
              <details className="rounded-lg border border-[#E5E4DC] bg-white text-sm">
                <summary className="px-3 py-2 cursor-pointer font-semibold text-[#33322E]">Video bilgileri</summary>
                <div className="px-3 pb-3 space-y-2">
                  <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
                    {videoInfo(currentProject).map(([label, value]) => (
                      <React.Fragment key={label}><dt className="text-[#787670]">{label}</dt><dd dir="auto" className="text-[#1C1917]">{value}</dd></React.Fragment>
                    ))}
                  </dl>
                  <button type="button" className="font-semibold text-[#8B1E2D] hover:underline inline-flex items-center gap-1"
                    onClick={() => navigator.clipboard.writeText(videoInfoText(currentProject)).then(() => toast.success('Video bilgileri kopyalandı.'), () => toast.error('Kopyalanamadı; metni seçip kopyalayın.'))}>
                    <Copy size={14} /> Kopyala
                  </button>
                </div>
              </details>
            )}
          </div>

          <div className="pt-1 text-center">
            <button
              type="button"
              onClick={async () => {
                if (await confirm({ title: 'İşaretler baştan hazırlansın mı?', message: 'İşaretler görsel ve sese göre yeniden oluşturulur. Elle yaptığınız zamanlama düzeltmeleri kaybolur.', confirmLabel: 'Baştan hazırla', danger: true })) setIsVideoModalOpen(true);
              }}
              className="text-sm font-semibold text-[#55544F] hover:text-[#1C1917] underline-offset-2 hover:underline transition-colors"
            >
              İşaretleri yeniden hazırla
            </button>
          </div>
        </div>
      ) : (
        /* Video creation button (Enabled ONLY when audio is approved) */
        <div className="space-y-2">
          <button
            type="button"
            onClick={handleAttemptCreateVideo}
            disabled={!isAudioApproved}
            className={`w-full py-3 px-4 rounded-xl font-bold text-sm flex items-center justify-center gap-2 shadow-xs transition-all ${
              isAudioApproved
                ? 'bg-[#8B1E2D] hover:bg-[#721824] text-white cursor-pointer'
                : 'bg-[#E5E4DC] text-[#787670] cursor-not-allowed opacity-75'
            }`}
          >
            <Sparkle size={18} weight="fill" />
            <span>İşaretleri otomatik hazırla</span>
          </button>

          {!isAudioApproved && (
            <p className="text-sm text-[#787670] text-center">
              Önce bir seslendirme oluşturun veya MP3 yükleyip onaylayın.
            </p>
          )}

          {videoButtonWarning && (
            <div className="p-2.5 rounded bg-amber-50 border border-amber-200 text-sm text-amber-800 flex items-center gap-1.5 animate-in fade-in">
              <WarningCircle size={15} weight="bold" className="shrink-0 text-amber-700" />
              <span>{videoButtonWarning}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
