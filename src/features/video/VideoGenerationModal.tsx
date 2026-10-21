import React, { useState, useEffect, useRef } from 'react';
import { QuestionProject } from '../../types';
import { reportClientError } from '../../services/supabase';
import { NETWORK_MESSAGE, plainMessage } from '../../services/plainError';
import { pipelineParams } from '../question-editor/projectUpdates';
import { freshAssetUrl } from '../projects/cloudProjectRepository';
import { localVideoPipeline, LocalPipelineProgress, LocalPipelineResult } from '../../services/pipeline/localVideoPipeline';
import { 
  CheckCircle, 
  CircleNotch, 
  WarningCircle, 
  X 
} from '@phosphor-icons/react';

interface VideoGenerationModalProps {
  isOpen: boolean;
  project: QuestionProject;
  onClose: () => void;
  onSuccess: (result: LocalPipelineResult) => void;
}

type InternalStage = 
  | 'IMAGE_ANALYSIS'
  | 'SOLUTION_ANALYSIS'
  | 'TIMESTAMP_MATCHING'
  | 'COMPLETED'
  | 'ERROR';

interface StageDefinition {
  id: InternalStage;
  activeText: string;
  completedText: string;
  pendingText: string;
}

const STAGES: StageDefinition[] = [
  {
    id: 'IMAGE_ANALYSIS',
    activeText: 'Soru görseli okunuyor...',
    completedText: 'Soru görseli ve şıklar analiz edildi',
    pendingText: 'Soru görseli analizi',
  },
  {
    id: 'SOLUTION_ANALYSIS',
    activeText: 'Çözüm planı ve şık elemeleri çözümleniyor...',
    completedText: 'Çözüm planı ve elemeler hazırlandı',
    pendingText: 'Çözüm metnindeki elemeleri bulma',
  },
  {
    id: 'TIMESTAMP_MATCHING',
    activeText: 'İşaretler (çizgi, X, tik) sesle eşleştiriliyor...',
    completedText: 'İşaretler sesle eşleştirildi',
    pendingText: 'İşaretleri sesle eşleştirme',
  },
];

export const VideoGenerationModal: React.FC<VideoGenerationModalProps> = ({
  isOpen,
  project,
  onClose,
  onSuccess,
}) => {
  const [currentStage, setCurrentStage] = useState<InternalStage>('IMAGE_ANALYSIS');
  const [statusDetail, setStatusDetail] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const isRunningRef = useRef(false);
  /** Each run gets a number; a cancelled run's late result is ignored. */
  const runIdRef = useRef(0);

  const cancel = () => {
    runIdRef.current++;
    isRunningRef.current = false;
    onClose();
  };

  useEffect(() => {
    if (isOpen && !isRunningRef.current) {
      runPipeline();
    }
  }, [isOpen]);

  const runPipeline = async () => {
    if (isRunningRef.current) return;
    isRunningRef.current = true;
    const runId = ++runIdRef.current;
    const live = () => runId === runIdRef.current;
    setErrorMessage(null);
    setStatusDetail(null);
    setCurrentStage('IMAGE_ANALYSIS');

    try {
      const result = await localVideoPipeline.executePipeline({
        ...pipelineParams(project),
        // The editor's picture link can be hours old (an overnight tab) and expired.
        imageUrl: await freshAssetUrl(project.imageUrl),
        onProgress: (p: LocalPipelineProgress) => {
          setStatusDetail(p.message);
          if (p.stage === 'ocr' || p.stage === 'detect_layout') {
            setCurrentStage('IMAGE_ANALYSIS');
          } else if (p.stage === 'arabic_matching' || p.stage === 'semantic_parsing') {
            setCurrentStage('SOLUTION_ANALYSIS');
          } else if (p.stage === 'timeline_align') {
            setCurrentStage('TIMESTAMP_MATCHING');
          }
        },
      });

      if (!live()) return;
      // Every step above did real work; the ticks stay on screen a moment before the dialog closes.
      setCurrentStage('COMPLETED');
      await new Promise((r) => setTimeout(r, 300));

      if (!live()) return;
      isRunningRef.current = false;
      onSuccess(result);
    } catch (err) {
      if (!live()) return;
      isRunningRef.current = false;
      console.error('[Local Video Generation Error]:', err);
      reportClientError(project.id, 'isaretler', err);
      setCurrentStage('ERROR');
      setStatusDetail(null);
      // The browser's "Failed to fetch" means a file (picture or voice) could not be downloaded.
      const message = plainMessage(err, 'İşaretler hazırlanamadı.');
      setErrorMessage(message === NETWORK_MESSAGE
        ? 'Soru görseli veya ses dosyası indirilemedi. İnternet bağlantınızı kontrol edip Tekrar Dene’ye basın; sürerse sayfayı yenileyin.'
        : message);
    }
  };

  if (!isOpen) return null;

  const getStageStatus = (stageId: InternalStage): 'done' | 'active' | 'waiting' => {
    if (currentStage === 'COMPLETED') return 'done';
    if (currentStage === 'ERROR') {
      return 'waiting';
    }

    const order: InternalStage[] = [
      'IMAGE_ANALYSIS',
      'SOLUTION_ANALYSIS',
      'TIMESTAMP_MATCHING',
    ];
    const currentIndex = order.indexOf(currentStage);
    const stageIndex = order.indexOf(stageId);

    if (stageIndex < currentIndex) return 'done';
    if (stageIndex === currentIndex) return 'active';
    return 'waiting';
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-xs p-4">
      <div className="w-full max-w-md bg-white rounded-xl shadow-2xl border border-[#D5D4CC] overflow-hidden flex flex-col animate-in fade-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#E5E4DC] bg-[#FAF9F5]">
          <h2 className="text-sm font-bold text-[#1C1917] tracking-tight">
            İşaretler hazırlanıyor
          </h2>
          {currentStage !== 'COMPLETED' && (
            <button
              onClick={currentStage === 'ERROR' ? onClose : cancel}
              className="text-[#787670] hover:text-[#1C1917] p-1 rounded hover:bg-[#EFEFEA] flex items-center gap-1 text-xs font-semibold"
              title={currentStage === 'ERROR' ? 'Kapat' : 'İptal et'}
            >
              {currentStage !== 'ERROR' && <span>İptal</span>}
              <X size={18} />
            </button>
          )}
        </div>

        {/* Content Body */}
        <div className="p-6 space-y-4">
          {/* Progression checklist */}
          <div className="space-y-3">
            {STAGES.map((st) => {
              const status = getStageStatus(st.id);

              return (
                <div
                  key={st.id}
                  className={`flex items-center gap-3 text-xs transition-colors duration-200 ${
                    status === 'active'
                      ? 'text-[#1C1917] font-semibold'
                      : status === 'done'
                      ? 'text-[#15803D]'
                      : 'text-[#8C8A82]'
                  }`}
                >
                  <div className="w-5 h-5 flex items-center justify-center shrink-0">
                    {status === 'done' && (
                      <CheckCircle size={18} weight="fill" className="text-[#15803D]" />
                    )}
                    {status === 'active' && (
                      <CircleNotch size={17} className="animate-spin text-[#8B1E2D]" />
                    )}
                    {status === 'waiting' && (
                      <span className="w-2.5 h-2.5 rounded-full border-2 border-[#D5D4CC]" />
                    )}
                  </div>

                  <span>
                    {status === 'done'
                      ? st.completedText
                      : status === 'active'
                      ? st.activeText
                      : st.pendingText}
                  </span>
                </div>
              );
            })}
          </div>

          {/* Local pipeline status detail */}
          {statusDetail && currentStage !== 'ERROR' && currentStage !== 'COMPLETED' && (
            <div className="p-2.5 rounded-lg bg-[#FAF9F5] border border-[#E5E4DC] text-xs text-[#55544F] flex items-center gap-2">
              <CircleNotch size={14} className="animate-spin shrink-0 text-[#8B1E2D]" />
              <span className="truncate">{statusDetail}</span>
            </div>
          )}

          {/* Error fallback state */}
          {currentStage === 'ERROR' && (
            <div className="p-4 rounded-lg bg-red-50 border border-red-200 text-xs space-y-3">
              <div className="flex items-center gap-2 text-red-800 font-semibold">
                <WarningCircle size={18} weight="fill" className="shrink-0" />
                <span>{errorMessage || 'İşaretler şu anda hazırlanamadı.'}</span>
              </div>
              <button
                type="button"
                onClick={() => {
                  isRunningRef.current = false;
                  runPipeline();
                }}
                className="w-full py-2 px-3 rounded-md bg-[#8B1E2D] hover:bg-[#721824] text-white font-semibold text-xs transition-colors cursor-pointer"
              >
                Tekrar Dene
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
