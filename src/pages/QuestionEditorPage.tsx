import { steps, resumeStep, checkNarration, imageChangeNote } from '../features/question-editor/workflow';
import { VoiceSample } from '../features/question-editor/VoiceSample';
import { type ReadinessAction } from '../features/question-editor/readiness';
import { applyPipelineResult } from '../features/question-editor/projectUpdates';
import { useNarration } from '../features/question-editor/useNarration';
import { database, reportClientError } from '../services/supabase';
import React, { useState, useEffect, useRef } from 'react';
import { QuestionProject, VideoConfig } from '../types';
import { useProjects } from '../features/projects/ProjectContext';
import { VideoGenerationModal } from '../features/video/VideoGenerationModal';
import type { LocalPipelineResult } from '../services/pipeline/localVideoPipeline';
import { localOcrService } from '../services/ocr/localOcrService';
import { readCompressedImage, saveFile } from '../services/narration/browserMedia';
import { exportProjectVideo, videoFileName } from '../features/video/exportProjectVideo';
import { ExportStep } from '../features/question-editor/steps/ExportStep';
import { AudioStep } from '../features/question-editor/steps/AudioStep';
import { NarrationCheck } from '../features/question-editor/steps/NarrationCheck';
import { SolutionStep } from '../features/question-editor/steps/SolutionStep';
import { EditorStage } from '../features/question-editor/steps/EditorStage';
import { ImageStep } from '../features/question-editor/steps/ImageStep';
import { ProjectInfo } from '../features/question-editor/steps/ProjectInfo';
import { MarksCheckStep } from '../features/question-editor/steps/MarksCheckStep';
import { ArrowLeft, Check, CornersIn, CornersOut, Plus, SidebarSimple } from '@phosphor-icons/react';
import type { LeaveGuard } from '../layouts/AppLayout';
import { APP_NAME } from '../config/brand';
import { ReportProblem } from '../features/feedback/ReportProblem';
import { setReportContext } from '../features/feedback/feedback';
import { reportSnapshot } from '../features/feedback/reportSnapshot';
import { toast } from 'sonner';
import { useConfirm } from '../components/common/ConfirmDialog';
import { useAuth } from '../features/auth/AuthContext';
import { plainMessage } from '../services/plainError';

function voiceApproved(project: QuestionProject) {
  return Boolean(project.audioApproved || project.narrationSource?.isApproved || project.audioNarration?.isApproved);
}

function hasAnimationPlan(project: QuestionProject | null | undefined) {
  return Boolean(
    project &&
    project.videoReady !== false &&
    (project.videoReady || (project.videoConfig.timelineActions && project.videoConfig.timelineActions.length > 0)),
  );
}

interface QuestionEditorPageProps {
  onBack: () => void;
  /** Opens the new-question dialog (shown when no question is open). */
  onNewQuestion?: () => void;
  /** Lets the layout ask before leaving while audio or an MP4 is being prepared. */
  registerLeaveGuard?: (guard: LeaveGuard | null) => void;
  /** A question is being opened (first load or automatic selection). */
  waitingForProject?: boolean;
  loadError?: string;
}

export const QuestionEditorPage: React.FC<QuestionEditorPageProps> = ({
  onBack,
  onNewQuestion,
  registerLeaveGuard,
  waitingForProject,
  loadError,
}) => {
  const { currentProject, updateCurrentProject, saveCurrentProject, saveStatus, error: saveError } = useProjects();
  const { user } = useAuth();
  const confirm = useConfirm();

  const [step, setStep] = useState(() => (currentProject ? resumeStep(currentProject) : 0));
  /** A missing option the teacher is showing on the picture (from the readiness check). */
  const [drawOption, setDrawOption] = useState<string | null>(null);
  const [regionHistory, setRegionHistory] = useState<VideoConfig[]>([]);
  const [sampleBusy, setSampleBusy] = useState(false);

  const {
    activeAudioUrl, activeAudioDuration, isGeneratingAudio, voiceProgress, isTranscribingMp3, transcribeProgress,
    audioError, setAudioError, audioInfo, audioPlayTime, setAudioPlayTime, isAudioPlaying, setIsAudioPlaying, stageAudioRef,
    revoiceUndo, lastFix, setLastFix,
    handleGenerateAudio, handleRevoice, handleUndoRevoice, handleUploadMp3File, handleDeleteAudio,
    handleDownloadNarrationMp3, handleApproveVoice, toggleStageAudio,
  } = useNarration(() => setVideoGenerated(false));
  const uploadMp3InputRef = useRef<HTMLInputElement | null>(null);
  const replaceImageInputRef = useRef<HTMLInputElement | null>(null);

  // Video generation & status
  const [isVideoModalOpen, setIsVideoModalOpen] = useState(false);
  const [videoGenerated, setVideoGenerated] = useState(() => hasAnimationPlan(currentProject));
  const [videoButtonWarning, setVideoButtonWarning] = useState<string | null>(null);
  const [previewMode, setPreviewMode] = useState<'video' | 'image'>(() => (hasAnimationPlan(currentProject) ? 'video' : 'image'));
  // More room for the question on small screens: the right panel can be folded away (remembered on
  // this device), and "Tam ekranda düzenle" shows only the question and its strip.
  const [panelHidden, setPanelHidden] = useState(() => { try { return localStorage.getItem('studio-panel-hidden') === 'yes'; } catch { return false; } });
  useEffect(() => { try { localStorage.setItem('studio-panel-hidden', panelHidden ? 'yes' : 'no'); } catch { /* per-device only */ } }, [panelHidden]);
  const [focusMode, setFocusMode] = useState(false);
  const enterFocus = () => {
    setFocusMode(true);
    // The browser's own full screen hides its bars too; where it is not allowed the page still fills the window.
    if (!document.fullscreenElement) document.documentElement.requestFullscreen?.().catch(() => undefined);
  };
  const leaveFocus = () => {
    setFocusMode(false);
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
  };
  useEffect(() => {
    if (!focusMode) return;
    // Esc leaves focus mode (and the browser's full screen); leaving full screen another way does too.
    const onChange = () => { if (!document.fullscreenElement) setFocusMode(false); };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      setFocusMode(false);
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    };
    document.addEventListener('fullscreenchange', onChange);
    window.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('fullscreenchange', onChange); window.removeEventListener('keydown', onKey); };
  }, [focusMode]);

  // Video preview player state (HTML5 Canvas + Audio Sync)
  const [currentPreviewTime, setCurrentPreviewTime] = useState(0);
  const [isPlayingPreview, setIsPlayingPreview] = useState(false);

  // MP4 export
  const [isExportingMp4, setIsExportingMp4] = useState(false);
  const [exportPercent, setExportPercent] = useState<number | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const exportAbortRef = useRef<AbortController | null>(null);

  // Determine if video already exists for this project
  useEffect(() => {
    const ready = hasAnimationPlan(currentProject);
    setVideoGenerated(ready);
    setPreviewMode(ready ? 'video' : 'image');
  }, [currentProject?.id]);

  // OCR models download while the teacher writes the solution, not when they press "İşaretleri hazırla".
  const needsOcrSoon = Boolean(currentProject?.imageUrl) && !hasAnimationPlan(currentProject);
  useEffect(() => {
    if (!needsOcrSoon) return;
    // Safari has no idle callback.
    const idle = typeof window.requestIdleCallback === 'function';
    const handle = idle ? window.requestIdleCallback(() => localOcrService.warmUp(), { timeout: 4000 }) : window.setTimeout(() => localOcrService.warmUp(), 1500);
    return () => {
      if (idle) window.cancelIdleCallback(handle);
      else window.clearTimeout(handle);
    };
  }, [needsOcrSoon]);


  // Leaving while audio or an MP4 is being prepared would silently drop that work.
  const working = isExportingMp4 ? 'export' : isGeneratingAudio || sampleBusy || isTranscribingMp3 ? 'audio' : null;
  useEffect(() => {
    if (!registerLeaveGuard) return;
    registerLeaveGuard(
      working
        ? () => {
            toast.warning(working === 'export' ? 'MP4 hazırlanıyor.' : 'Ses hazırlanıyor.', {
              description: working === 'export'
                ? 'İndirme bitene kadar bekleyin ya da İndir adımında “İptal” ile durdurun.'
                : 'Bitince bu sayfadan çıkabilirsiniz.',
            });
            return false;
          }
        : null,
    );
    return () => registerLeaveGuard(null);
  }, [working, registerLeaveGuard]);

  // Entering the İşaretler step with an approved voice and no marks yet prepares them at once: the
  // step opens on the editor, not on an empty page with one button. Once per question (a cancel stays).
  const autoMarks = useRef<string | null>(null);
  const markable = Boolean(currentProject?.imageUrl && voiceApproved(currentProject) && !videoGenerated && !hasAnimationPlan(currentProject));
  useEffect(() => {
    if (step !== 3 || !markable || !currentProject || autoMarks.current === currentProject.id) return;
    autoMarks.current = currentProject.id;
    setIsVideoModalOpen(true);
  }, [step, markable, currentProject?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // A problem report says which question and step the teacher was on, and carries its teşhis record.
  const reportProject = useRef(currentProject);
  reportProject.current = currentProject;
  useEffect(() => {
    setReportContext({ page: 'Soru editörü', projectId: currentProject?.id, projectTitle: currentProject?.title, step: steps[step],
      snapshot: () => reportSnapshot(reportProject.current) });
  }, [currentProject?.id, currentProject?.title, step]);

  if (!currentProject) {
    return (
      <div className="h-screen flex items-center justify-center bg-[#FAF9F5] p-6">
        <section className="bg-white border border-[#E5E4DC] rounded-xl p-8 max-w-md w-full text-center space-y-4 shadow-xs">
          <h1 className="text-base font-bold text-[#1C1917]">
            {waitingForProject ? 'Soru açılıyor…' : loadError ? 'Soru açılamadı' : 'Açık bir soru yok'}
          </h1>
          <p className="text-xs text-[#666560]">
            {waitingForProject
              ? 'Birkaç saniye sürebilir.'
              : loadError
                ? loadError
                : 'Sorularım listesinden bir soru seçin ya da yeni bir soru oluşturun.'}
          </p>
          {!waitingForProject && (
            <div className="flex flex-wrap justify-center gap-2">
              <button type="button" onClick={onBack} className="studio-secondary flex items-center gap-1.5">
                <ArrowLeft size={16} /> Sorularıma dön
              </button>
              {onNewQuestion && (
                <button type="button" onClick={onNewQuestion} className="studio-primary flex items-center gap-1.5">
                  <Plus size={16} /> Yeni soru
                </button>
              )}
            </div>
          )}
        </section>
      </div>
    );
  }

  // Handle Save
  const handleSave = async () => {
    const saved = await saveCurrentProject();
    if (!saved) {
      setAudioError('Kayıt tamamlanamadı. Bağlantınızı kontrol edip tekrar deneyin.');
      return;
    }
  };

  // A new or removed image invalidates every box and mark drawn on the old one.
  const setImage = (imageUrl: string, imageFileName: string) => {
    updateCurrentProject({
      imageUrl,
      imageFileName,
      videoConfig: { ...currentProject.videoConfig, regions: [], suppressedRegionIds: [], timelineActions: [] },
      videoReady: false,
    });
    setVideoGenerated(false);
    setPreviewMode('image');
  };
  /** Work that a new or removed image throws away, said plainly; empty when there is none. */
  const imageLosses = () => {
    const config = currentProject.videoConfig;
    const parts = [
      (config.regions?.length || 0) > 0 && 'görsel üzerindeki kutular',
      (config.timelineActions?.length || 0) > 0 && 'videodaki işaretler',
    ].filter(Boolean);
    return parts.join(' ve ');
  };
  const handleImageFile = async (file: File) => {
    if (!file.type.startsWith('image/')) {
      toast.error('Bu dosya bir görsel değil.', { description: 'PNG, JPG ya da WEBP biçiminde bir soru görseli seçin.' });
      return;
    }
    const losses = currentProject.imageUrl ? imageLosses() : '';
    // A wrong picture under a right voice: the voice and text stay, only the marks are prepared again.
    const keepsVoice = Boolean(currentProject.imageUrl) && voiceApproved(currentProject) && Boolean(currentProject.solutionText?.trim());
    if (losses && !await confirm({ title: 'Görsel değiştirilsin mi?', message: imageChangeNote(losses, keepsVoice), confirmLabel: 'Görseli değiştir', danger: !keepsVoice })) return;
    try {
      setImage(await readCompressedImage(file), file.name);
    } catch {
      toast.error('Görsel açılamadı.', { description: 'Dosya bozuk olabilir. Başka bir görsel deneyin ya da ekran görüntüsü alıp onu yükleyin.' });
      return;
    }
    if (keepsVoice) {
      toast.success('Görsel değiştirildi; ses korundu.', { description: 'İşaretler yeni görsele göre hazırlanıyor.' });
      setStep(3);
      setIsVideoModalOpen(true);
    }
  };
  const handleDeleteImage = async () => {
    const losses = imageLosses();
    if (!await confirm({ title: 'Görsel silinsin mi?', message: losses ? `Görselle birlikte ${losses} ${losses.endsWith('işaretler') ? 'de' : 'da'} silinir. Bu işlem geri alınamaz.` : 'Soru görseli kaldırılır.', confirmLabel: 'Görseli sil', danger: true })) return;
    setImage('', '');
  };


  // On Video Generation Pipeline Success
  const handleVideoPipelineSuccess = (result: LocalPipelineResult) => {
    updateCurrentProject(applyPipelineResult(currentProject, result));
    setVideoGenerated(true);
    setPreviewMode('video');
    setCurrentPreviewTime(0);
    setIsVideoModalOpen(false);
    setStep(3);
  };

  // Handle direct MP4 Export & Download using local browser engine (1080p @ 30fps)
  const handleDownloadMp4 = async () => {
    if (isExportingMp4) return;
    setIsExportingMp4(true);
    setExportError(null);
    setIsPlayingPreview(false);
    exportAbortRef.current = new AbortController();
    setExportPercent(5);

    try {
      const videoBlob = await exportProjectVideo(currentProject, setExportPercent, exportAbortRef.current.signal);

      saveFile(videoBlob, videoFileName(currentProject));
      // Downloading the video finishes the question (it leaves the "to check" lists).
      await saveCurrentProject({ completedAt: new Date().toISOString() });
      const { error: activityError } = await database().rpc('record_video_export', { project_id: currentProject.id });
      if (activityError) setExportError('Video indirildi; üretim kaydı kaydedilemedi.');
    } catch (err) {
      console.error('Local MP4 Export error:', err);
      if (!exportAbortRef.current?.signal.aborted) reportClientError(currentProject.id, 'mp4', err);
      setExportError(plainMessage(err, 'Video oluşturulamadı.'));
    } finally {
      setIsExportingMp4(false);
      setExportPercent(null);
    }
  };

  const hasImage = Boolean(currentProject.imageUrl);
  const hasSolution = Boolean(currentProject.solutionText && currentProject.solutionText.trim().length > 0);
  const hasAudio = Boolean(activeAudioUrl);
  const isAudioApproved = voiceApproved(currentProject);
  const isUploadedAudio = currentProject.narrationSource?.type === 'uploaded';

  const handleAttemptCreateVideo = () => {
    if (!isAudioApproved) {
      setVideoButtonWarning('Video oluşturmak için önce bir seslendirme seçmelisiniz.');
      setTimeout(() => setVideoButtonWarning(null), 3500);
      return;
    }
    setIsVideoModalOpen(true);
  };

  const handleReadinessAction = (action: ReadinessAction, letter?: string) => {
    if (action === 'regenerate') {
      setIsVideoModalOpen(true);
      return;
    }
    if (action === 'text') {
      go(1);
      return;
    }
    setStep(3);
    setIsPlayingPreview(false);
    setPreviewMode('video');
    setDrawOption(action === 'regions' && letter ? letter : null);
  };

  const check = checkNarration(currentProject.solutionText, currentProject.correctAnswer);
  const enabled = [true, hasImage, hasImage, isAudioApproved, videoGenerated && isAudioApproved];
  const busy = isGeneratingAudio || sampleBusy || isTranscribingMp3 || isExportingMp4;
  const go = (next: number) => {
    if (!busy && enabled[next]) {
      setStep(next);
      setIsPlayingPreview(false);
      if (stageAudioRef.current) stageAudioRef.current.pause();
      setIsAudioPlaying(false);
    }
  };
  return (
    <div className={`studio-editor flex flex-col h-screen w-screen overflow-hidden bg-[#FAF9F5] ${focusMode ? 'editor-focus' : ''} ${panelHidden ? 'panel-hidden' : ''}`}>
      <header className="h-14 bg-white border-b border-[#E5E4DC] px-6 flex items-center justify-between shrink-0 z-10">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onBack}
            title={busy ? 'İşlem sürerken çıkmadan önce size sorulur' : undefined}
            className="flex items-center gap-1.5 text-xs font-semibold text-[#55544F] hover:text-[#1C1917] px-2.5 py-1.5 rounded hover:bg-[#F0EFEA] transition-colors cursor-pointer"
          >
            <ArrowLeft size={16} />
            <span>Sorularım</span>
          </button>

          <div className="h-4 w-px bg-[#E5E4DC]" />

          <span className="editor-brand">{APP_NAME}</span>
        </div>

        <h1 className="text-sm font-bold text-[#1C1917] tracking-tight hidden md:block">{currentProject.title || APP_NAME}</h1>

        <div className="flex items-center gap-2">
        <ReportProblem variant="compact" sender={user?.name} />
        <button
          type="button"
          onClick={handleSave}
          aria-label="Projeyi kaydet"
          className="px-4 py-1.5 rounded text-xs font-semibold bg-[#FAF9F5] border border-[#D5D4CC] text-[#1C1917] hover:bg-[#F0EFEA] transition-colors flex items-center gap-1.5 cursor-pointer"
        >
          {saveStatus === 'saved' ? (
            <>
              <Check size={14} className="text-[#15803D]" />
              <span role="status" className="text-[#15803D]">
                Kaydedildi
              </span>
            </>
          ) : (
            <span>
              {{ saved: 'Kaydedildi', pending: 'Değişiklikler bekliyor', saving: 'Kaydediliyor…', error: 'Kaydı tekrar dene' }[saveStatus]}
            </span>
          )}
        </button>
        </div>
      </header>

      <nav className="workflow-nav" aria-label="Video hazırlama adımları">
        {steps.map((label, i) => (
          <button key={label} disabled={!enabled[i] || busy} aria-current={step === i ? 'step' : undefined} onClick={() => go(i)}>
            <span className="step-number">{i + 1}</span>
            <span>{label}</span>
          </button>
        ))}
      </nav>
      {saveError && (
        <div role="alert" className="save-alert">
          {saveError} <button onClick={() => void handleSave()}>Tekrar kaydet</button>
        </div>
      )}
      <div className="editor-columns flex-1 flex min-h-0 overflow-hidden">
        <section className="editor-stage flex-[68] h-full bg-[#F7F6F0] border-r border-[#E5E4DC] p-6 pt-16 flex flex-col items-center overflow-y-auto relative">
          {hasImage && (
            <div className="stage-view-buttons">
              {focusMode ? (
                <button type="button" className="stage-view-button is-primary" onClick={leaveFocus}>
                  <CornersIn size={18} /> Tam ekrandan çık <kbd>Esc</kbd>
                </button>
              ) : (
                <>
                  <button type="button" className="stage-view-button" onClick={enterFocus} title="Yalnız soru ve şerit kalır; küçük ekranlar için">
                    <CornersOut size={18} /> Tam ekranda düzenle
                  </button>
                  <button type="button" className="stage-view-button" onClick={() => setPanelHidden(!panelHidden)} aria-expanded={!panelHidden}
                    title={panelHidden ? 'Sağdaki paneli geri açın' : 'Sağdaki paneli gizleyip soruya yer açın'}>
                    {panelHidden ? <><SidebarSimple size={18} /> Paneli aç</> : <><SidebarSimple size={18} mirrored /> Paneli gizle</>}
                  </button>
                </>
              )}
            </div>
          )}
          <EditorStage
            videoGenerated={videoGenerated}
            hasImage={hasImage}
            previewMode={previewMode}
            setPreviewMode={setPreviewMode}
            step={step}
            currentProject={currentProject}
            updateCurrentProject={updateCurrentProject}
            currentPreviewTime={currentPreviewTime}
            setCurrentPreviewTime={setCurrentPreviewTime}
            isPlayingPreview={isPlayingPreview}
            setIsPlayingPreview={setIsPlayingPreview}
            activeAudioDuration={activeAudioDuration}
            activeAudioUrl={activeAudioUrl}
            setIsVideoModalOpen={setIsVideoModalOpen}
            drawOption={drawOption}
            setDrawOption={setDrawOption}
            regionHistory={regionHistory}
            setRegionHistory={setRegionHistory}
            narration={hasAudio && !isUploadedAudio && (currentProject.narrationSource?.words?.length ?? 0) > 0 ? {
              words: currentProject.narrationSource!.words!,
              showSkipped: currentProject.narrationSource?.type === 'gemini' && currentProject.narrationSource.timingSource === 'gemini-transcribe',
              busy: isGeneratingAudio || sampleBusy,
              onRevoice: range => void handleRevoice(range),
              canUndo: !!revoiceUndo,
              onUndo: () => void handleUndoRevoice(),
              lastFix,
              onKeepFix: () => setLastFix(null),
            } : undefined}
          />
        </section>

        <aside className="editor-panel flex-[32] h-full bg-white overflow-y-auto p-6 flex flex-col space-y-6">
          <ProjectInfo hidden={step > 1} currentProject={currentProject} updateCurrentProject={updateCurrentProject} />
          <ImageStep
            step={step}
            hasImage={hasImage}
            currentProject={currentProject}
            replaceImageInputRef={replaceImageInputRef}
            handleImageFile={handleImageFile}
            handleDeleteImage={handleDeleteImage}
            keepsVoice={isAudioApproved && hasSolution}
          />
          <SolutionStep
            step={step}
            currentProject={currentProject}
            updateCurrentProject={updateCurrentProject}
            setVideoGenerated={setVideoGenerated}
            isGeneratingAudio={isGeneratingAudio}
            sampleBusy={sampleBusy}
          />
          <NarrationCheck step={step} check={check} currentProject={currentProject} />
          {step === 2 && (
            <VoiceSample text={currentProject.solutionText} disabled={isGeneratingAudio || isTranscribingMp3} onBusy={setSampleBusy} />
          )}
          <AudioStep
            step={step}
            hasAudio={hasAudio}
            hasSolution={hasSolution}
            isUploadedAudio={isUploadedAudio}
            isAudioApproved={isAudioApproved}
            currentProject={currentProject}
            stripShown={hasImage && hasAudio && !isUploadedAudio && (currentProject.narrationSource?.words?.length ?? 0) > 0}
            isAudioPlaying={isAudioPlaying}
            toggleStageAudio={toggleStageAudio}
            audioPlayTime={audioPlayTime}
            setAudioPlayTime={setAudioPlayTime}
            activeAudioDuration={activeAudioDuration}
            activeAudioUrl={activeAudioUrl}
            stageAudioRef={stageAudioRef}
            uploadMp3InputRef={uploadMp3InputRef}
            handleDownloadNarrationMp3={handleDownloadNarrationMp3}
            handleUploadMp3File={handleUploadMp3File}
            handleDeleteAudio={handleDeleteAudio}
            handleGenerateAudio={handleGenerateAudio}
            handleApproveVoice={handleApproveVoice}
            isGeneratingAudio={isGeneratingAudio}
            voiceProgress={voiceProgress}
            sampleBusy={sampleBusy}
            isTranscribingMp3={isTranscribingMp3}
            transcribeProgress={transcribeProgress}
            audioError={audioError}
            audioInfo={audioInfo}
          />
          {step === 3 && <MarksCheckStep videoGenerated={videoGenerated} currentProject={currentProject} />}
          <ExportStep
            step={step}
            videoGenerated={videoGenerated}
            currentProject={currentProject}
            handleReadinessAction={handleReadinessAction}
            onMarkDone={done => void saveCurrentProject(done ? { completedAt: new Date().toISOString() } : { completedAt: undefined, reopenedAt: new Date().toISOString() })}
            exportError={exportError}
            isExportingMp4={isExportingMp4}
            exportAbortRef={exportAbortRef}
            handleDownloadMp4={handleDownloadMp4}
            exportPercent={exportPercent}
            setIsVideoModalOpen={setIsVideoModalOpen}
            handleAttemptCreateVideo={handleAttemptCreateVideo}
            isAudioApproved={isAudioApproved}
            videoButtonWarning={videoButtonWarning}
          />
          <footer className="workflow-footer">
            <p>
              {
                [
                  'Görseli yükleyin; özgün tasarımı videoda korunur.',
                  'Arapça ifadeleri harekeli yazın.',
                  'Sesi dinleyip “Bu Sesi Kullan” ile devam edin.',
                  'Kutuları ve zamanlamayı son kez kontrol edin.',
                  'MP4 bu tarayıcıda hazırlanır. İndirme bitene kadar sekmeyi açık tutun.',
                ][step]
              }
            </p>
            <div className="flex gap-2">
              {step > 0 && (
                <button className="studio-secondary" disabled={busy} onClick={() => go(step - 1)}>
                  Geri
                </button>
              )}
              {step < 4 && (
                <button className="studio-primary" disabled={busy || !enabled[step + 1]} onClick={() => go(step + 1)}>
                  {['Metne geç', 'Sese geç', 'İşaretlere geç', 'İndirmeye geç'][step]}
                </button>
              )}
            </div>
          </footer>
        </aside>
      </div>

      <VideoGenerationModal
        isOpen={isVideoModalOpen}
        project={currentProject}
        onClose={() => setIsVideoModalOpen(false)}
        onSuccess={handleVideoPipelineSuccess}
      />
    </div>
  );
};
