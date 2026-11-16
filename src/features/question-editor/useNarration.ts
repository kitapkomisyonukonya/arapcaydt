import { useEffect, useRef, useState } from 'react';
import type { QuestionProject } from '../../types';
import { useProjects } from '../projects/ProjectContext';
import { useConfirm } from '../../components/common/ConfirmDialog';
import { localWhisperService } from '../../services/whisper/localWhisperService';
import { prepareUploadedNarration, transcriptText } from '../../services/narration/uploadedNarration';
import { readDataUrl, readAudioDuration, saveFile } from '../../services/narration/browserMedia';
import { askLowerWith, narrationService } from '../../services/narration/narrationService';
import { cutAtPauses, cutOut, matchLoudness, moveTimeline, spliceAudio, spokenSpan, type TextRange } from '../../services/narration/revoice';
import { NARRATION_RATE, decodeAudio, encodeMp3 } from '../../services/narration/audioCodec';
import { alignSolutionNarration } from '../../services/analysis/timelineAligner';
import { splitNarration, spokenLength } from '../../services/narration/narrationParts';
import { STANDARD_VOICE_CONFIG } from '../../config/voice';
import { narrationFromTts, timeGeneratedNarration, withWordTimings } from './projectUpdates';
import { VoiceProgress, nextVoiceStage, startVoiceProgress } from './voiceProgress';
import { plainMessage } from '../../services/plainError';

/** Longer than this (spoken letters, about four sentences), a re-voice is confirmed first. */
const REVOICE_ASK_CHARS = 400;

/**
 * The open question's narration: voicing, fixing one stretch ("Sesi düzelt"), uploading an MP3,
 * approving, deleting, and playing it on the stage. `onNewVoice` runs when the voice changes so the
 * marks are prepared again.
 */
export function useNarration(onNewVoice: () => void) {
  const { currentProject, updateCurrentProject, saveCurrentProject } = useProjects();
  const confirm = useConfirm();

  const [isGeneratingAudio, setIsGeneratingAudio] = useState(false);
  const [voiceProgress, setVoiceProgress] = useState<VoiceProgress | null>(null);
  const [isTranscribingMp3, setIsTranscribingMp3] = useState(false);
  const [transcribeProgress, setTranscribeProgress] = useState<{ progress: number; message: string } | null>(null);
  const [audioError, setAudioError] = useState<string | null>(null);
  const [audioInfo, setAudioInfo] = useState<string | null>(null);

  // Playing the narration on the stage
  const [audioPlayTime, setAudioPlayTime] = useState(0);
  const [isAudioPlaying, setIsAudioPlaying] = useState(false);
  const stageAudioRef = useRef<HTMLAudioElement | null>(null);

  // Audio playback updates
  const activeAudioUrl = currentProject?.narrationSource?.audioUrl || currentProject?.audioNarration?.audioUrl || '';
  const activeAudioDuration = currentProject?.narrationSource?.duration || currentProject?.audioNarration?.duration || 0;
  // The narration before the last "Sesi düzelt" change, so the teacher can take it back.
  const [revoiceUndo, setRevoiceUndo] = useState<Pick<QuestionProject, 'narrationSource' | 'audioNarration' | 'videoConfig'> | null>(null);
  /** Where the last fix sits in the new narration: the Ses şeridi plays it and asks "Oldu mu?". */
  const [lastFix, setLastFix] = useState<{ start: number; end: number; at: number } | null>(null);
  useEffect(() => setRevoiceUndo(null), [currentProject?.id]);

  useEffect(() => {
    const audio = stageAudioRef.current;
    if (!audio) return;

    const handleTimeUpdate = () => setAudioPlayTime(audio.currentTime);
    const handleEnded = () => {
      setIsAudioPlaying(false);
      setAudioPlayTime(0);
    };

    audio.addEventListener('timeupdate', handleTimeUpdate);
    audio.addEventListener('ended', handleEnded);

    return () => {
      audio.removeEventListener('timeupdate', handleTimeUpdate);
      audio.removeEventListener('ended', handleEnded);
    };
  }, [activeAudioUrl]);

  // A new narration of the whole solution text (Gemini voice, then word timings).
  const handleGenerateAudio = async () => {
    if (!currentProject) return;
    if (!currentProject.solutionText || currentProject.solutionText.trim().length === 0) {
      setAudioError('Lütfen önce çözüm metnini yazın.');
      return;
    }
    // A new narration replaces the one there is and uses one of the day's voice requests (one per part).
    const voiceParts = splitNarration(currentProject.solutionText).length;
    if (activeAudioUrl && !await confirm({
      title: 'Yeniden seslendirilsin mi?',
      message: `Yalnız bir iki cümle hatalıysa bunun yerine sorunun altındaki Ses şeridinden yalnız o cümleyi yeniden seslendirin. Yeniden seslendirirseniz şu anki ses silinir ve yerine yenisi üretilir. Bugünkü ses haklarınızdan ${voiceParts > 1 ? `${voiceParts} tanesi (uzun metin ${voiceParts} bölümde okunur)` : 'biri'} kullanılır.${currentProject.audioApproved ? ' Onayladığınız sesin yerine geçer.' : ''}`,
      confirmLabel: 'Yeniden seslendir',
    })) return;

    setAudioError(null);
    setAudioInfo(null);
    setIsGeneratingAudio(true);
    setVoiceProgress(startVoiceProgress(currentProject.solutionText, voiceParts));

    try {
      if (!(await saveCurrentProject())) throw new Error('Önce proje kaydedilmelidir.');
      setVoiceProgress(p => p && nextVoiceStage(p, 'voicing', 1));
      const result = await narrationService.generateNarration({
        projectId: currentProject.id,
        text: currentProject.solutionText,
        voiceId: STANDARD_VOICE_CONFIG.voiceId,
        modelId: STANDARD_VOICE_CONFIG.modelId,
        outputFormat: STANDARD_VOICE_CONFIG.outputFormat,
      }, (done, total) => setVoiceProgress(p => p && (done < total
        ? nextVoiceStage({ ...p, parts: total }, 'voicing', done + 1)
        : nextVoiceStage(p, 'joining'))), askLowerWith(confirm));

      const { narrationSource: newNarrationSource, audioNarration: compatNarration } = narrationFromTts(result);

      const persisted = await saveCurrentProject({
        narrationSource: { ...newNarrationSource, spokenText: currentProject.solutionText },
        audioNarration: compatNarration,
        status: 'audio_generated',
        audioApproved: false,
        videoReady: false,
      });
      if (!persisted) {
        setAudioError('Ses üretildi ama kaydedilemedi. Ses dosyasını indirip Kaydet düğmesini tekrar deneyin.');
      } else if (result.provider === 'gemini') {
        setVoiceProgress(p => p && nextVoiceStage(p, 'timing'));
        const timing = await timeGeneratedNarration(
          persisted,
          project => narrationService.alignGeneratedNarration(project.id),
          project => localWhisperService.transcribeNarrationAudio(project),
        );
        if (!timing) {
          setAudioError('Ses oluşturuldu ancak kelime zamanları alınamadı. Animasyon yaklaşık zamanlamayla hazırlanır; işaretleri kontrol edin.');
        } else if (timing.words.length) {
          await saveCurrentProject(withWordTimings(persisted, timing.words, timing.timingSource));
        }
      }
      onNewVoice();
    } catch (err) {
      console.error('Audio generation error:', err);
      setAudioError(plainMessage(err, 'Seslendirme oluşturulamadı.'));
    } finally {
      setIsGeneratingAudio(false);
      setVoiceProgress(null);
    }
  };

  // "Sesi düzelt": only the picked stretch is voiced again and put in place of the old one.
  // `at`: the stretch the teacher saw (and maybe moved) on the wave; it is what gets replaced.
  const handleRevoice = async (range: TextRange, at?: { start: number; end: number }) => {
    if (!currentProject || !activeAudioUrl) return;
    let source = currentProject.narrationSource;
    let span = spokenSpan(currentProject.solutionText, source?.words || [], activeAudioDuration, range);
    if (!span && source?.audioUrl) {
      // Timings that cannot place the sentence (a transcript that left out the Turkish): timed again once.
      setAudioError(null);
      setAudioInfo('Kelime zamanları yeniden alınıyor…');
      setIsGeneratingAudio(true);
      const timing = await timeGeneratedNarration(currentProject, project => narrationService.alignGeneratedNarration(project.id));
      setIsGeneratingAudio(false);
      setAudioInfo(null);
      if (timing?.words.length) {
        const timed = withWordTimings(currentProject, timing.words, timing.timingSource);
        await saveCurrentProject(timed);
        source = timed.narrationSource;
        span = spokenSpan(currentProject.solutionText, timing.words, activeAudioDuration, range);
      }
    }
    if (!span) { setAudioError('Bu sesin kelime zamanları yok; seçili yer bulunamadı. Sesi yeniden oluşturun.'); return; }
    const excerpt = range.text.length > 160 ? `${range.text.slice(0, 160)}…` : range.text;
    // A sentence or two is fixed at once ("Olmadı, geri al" is right there); a long stretch is asked first.
    if (spokenLength(range.text) > REVOICE_ASK_CHARS && !await confirm({
      title: span.skipped ? 'Okunmayan yer eklensin mi?' : 'Seçili yer yeniden seslendirilsin mi?',
      message: `“${excerpt}” yeniden seslendirilip sesin ${span.skipped ? 'atlanan yerine eklenir' : 'bu yerine konur'}. Sesin geri kalanı ve işaretleriniz korunur. Bugünkü ses haklarınızdan biri kullanılır.`,
      confirmLabel: span.skipped ? 'Ekle' : 'Yeniden seslendir',
    })) return;
    setAudioError(null);
    setAudioInfo('Seçili yer seslendiriliyor…');
    setIsGeneratingAudio(true);
    setLastFix(null);
    stageAudioRef.current?.pause();
    const before = { narrationSource: currentProject.narrationSource, audioNarration: currentProject.audioNarration, videoConfig: currentProject.videoConfig };
    try {
      if (!(await saveCurrentProject())) throw new Error('Önce proje kaydedilmelidir.');
      const piece = await narrationService.generateNarration({ projectId: currentProject.id, text: range.text,
        voiceId: STANDARD_VOICE_CONFIG.voiceId, modelId: STANDARD_VOICE_CONFIG.modelId, outputFormat: STANDARD_VOICE_CONFIG.outputFormat }, undefined, askLowerWith(confirm));
      setAudioInfo('Yeni parça sesin içine yerleştiriliyor…');
      if (!piece.audioUrl) throw new Error('Yeni parçanın sesi alınamadı. Tekrar deneyin.');
      const [base, insert] = await Promise.all([decodeAudio(activeAudioUrl), decodeAudio(piece.audioUrl)]);
      // The stretch shown on the wave; else cut in the real pauses around the range, so no word of
      // the sentences around it is lost.
      const cut = at && !span.skipped && at.end > at.start ? at : cutAtPauses(base, NARRATION_RATE, span);
      // The new piece at the loudness of the voice around it.
      const joined = spliceAudio(base, matchLoudness(insert, base, NARRATION_RATE, cut.start, cut.end), NARRATION_RATE, cut.start, cut.end);
      const blob = await encodeMp3(joined.samples);
      const audioUrl = URL.createObjectURL(blob);
      const duration = joined.samples.length / NARRATION_RATE;
      const moved = moveTimeline({ start: cut.start, end: cut.end, newStart: joined.newStart, newEnd: joined.newEnd },
        currentProject.videoConfig.timelineActions, currentProject.videoConfig.captions, source?.words);
      // A new file: the old stored path must not be reused when saving.
      const replaced = <T extends { audioUrl: string; duration: number }>(audio: T | undefined) => audio && ({
        ...audio, audioUrl, duration, mimeType: 'audio/mpeg', fileName: 'seslendirme.mp3', assetPath: undefined, audioBase64: undefined,
        words: moved.words, generatedAt: new Date().toISOString(),
      });
      const persisted = await saveCurrentProject({
        narrationSource: replaced(currentProject.narrationSource),
        audioNarration: replaced(currentProject.audioNarration),
        videoConfig: { ...currentProject.videoConfig, timelineActions: moved.actions, captions: moved.captions },
      });
      if (!persisted) throw new Error('Düzeltilmiş ses kaydedilemedi. Tekrar deneyin.');
      setRevoiceUndo(before);
      setLastFix({ start: joined.newStart, end: joined.newEnd, at: Date.now() });
      setAudioInfo('Kelime zamanları güncelleniyor…');
      const timing = await timeGeneratedNarration(persisted, project => narrationService.alignGeneratedNarration(project.id));
      if (timing?.words.length) {
        const timed = withWordTimings(persisted, timing.words, timing.timingSource);
        const captions = persisted.videoConfig.captions?.length
          ? alignSolutionNarration(persisted.solutionText, timing.words, duration).captions : persisted.videoConfig.captions;
        await saveCurrentProject({ ...timed, videoConfig: { ...persisted.videoConfig, captions } });
      }
      setAudioInfo(null);
    } catch (err) {
      setAudioInfo(null);
      setLastFix(null);
      setAudioError(plainMessage(err, 'Seçili yer yeniden seslendirilemedi.'));
    } finally {
      setIsGeneratingAudio(false);
    }
  };
  // "Kes": the stretch is taken out of the voice (no voice quota); marks after it move back with it.
  const handleCutAudio = async (at: { start: number; end: number }) => {
    if (!currentProject || !activeAudioUrl || !(at.end > at.start)) return;
    setAudioError(null);
    setAudioInfo('Seçili yer sesten çıkarılıyor…');
    setIsGeneratingAudio(true);
    setLastFix(null);
    stageAudioRef.current?.pause();
    const before = { narrationSource: currentProject.narrationSource, audioNarration: currentProject.audioNarration, videoConfig: currentProject.videoConfig };
    try {
      if (!(await saveCurrentProject())) throw new Error('Önce proje kaydedilmelidir.');
      const base = await decodeAudio(activeAudioUrl);
      const start = Math.max(0, at.start), end = Math.min(base.length / NARRATION_RATE, at.end);
      const samples = cutOut(base, NARRATION_RATE, start, end);
      const audioUrl = URL.createObjectURL(await encodeMp3(samples));
      const duration = samples.length / NARRATION_RATE;
      const moved = moveTimeline({ start, end, newStart: start, newEnd: start },
        currentProject.videoConfig.timelineActions, currentProject.videoConfig.captions, currentProject.narrationSource?.words);
      const replaced = <T extends { audioUrl: string; duration: number }>(audio: T | undefined) => audio && ({
        ...audio, audioUrl, duration, mimeType: 'audio/mpeg', fileName: 'seslendirme.mp3', assetPath: undefined, audioBase64: undefined,
        words: moved.words, generatedAt: new Date().toISOString(),
      });
      const persisted = await saveCurrentProject({
        narrationSource: replaced(currentProject.narrationSource),
        audioNarration: replaced(currentProject.audioNarration),
        videoConfig: { ...currentProject.videoConfig, timelineActions: moved.actions, captions: moved.captions },
      });
      if (!persisted) throw new Error('Kesilen ses kaydedilemedi. Tekrar deneyin.');
      setRevoiceUndo(before);
      // The second around the cut is played once, to hear that it joins well.
      setLastFix({ start: Math.max(0, start - 1), end: Math.min(duration, start + 1), at: Date.now() });
      setAudioInfo(null);
    } catch (err) {
      setAudioInfo(null);
      setAudioError(plainMessage(err, 'Seçili yer kesilemedi.'));
    } finally {
      setIsGeneratingAudio(false);
    }
  };
  const handleUndoRevoice = async () => {
    if (!revoiceUndo) return;
    stageAudioRef.current?.pause();
    if (await saveCurrentProject(revoiceUndo)) { setRevoiceUndo(null); setLastFix(null); setAudioInfo('Son düzeltme geri alındı; önceki ses geri geldi.'); }
  };

  // Uploaded MP3: align the written solution to the audio; Whisper stays as fallback.
  const handleUploadMp3File = async (file: File) => {
    if (!currentProject) return;
    if (!file.name.toLowerCase().endsWith('.mp3') && !file.type.includes('audio')) {
      setAudioError('Lütfen geçerli bir .mp3 dosyası seçin.');
      return;
    }
    setAudioError(null);
    setAudioInfo(null);
    setIsTranscribingMp3(true);
    setTranscribeProgress({ progress: 10, message: 'Ses dosyası taranıyor...' });
    try {
      let saved: QuestionProject | null = null;
      const result = await prepareUploadedNarration(file, {
        readDataUrl,
        readDuration: readAudioDuration,
        // The MP3 is stored with the project first; the server reads it from storage
        // (no upload size limit) and tries Gemini Transcribe, then ElevenLabs alignment.
        align: async untimed => {
          saved = await saveCurrentProject({ narrationSource: untimed.source, audioNarration: untimed.compat, audioApproved: false, videoReady: false });
          if (!saved) throw new Error('Ses dosyası kaydedilemedi.');
          return narrationService.alignGeneratedNarration(saved.id);
        },
        transcribe: async upload =>
          localWhisperService.transcribeAudioLocally(await upload.arrayBuffer(), p =>
            setTranscribeProgress({ progress: p.progress, message: p.message }),
          ),
        onProgress: (progress, message) => setTranscribeProgress({ progress, message }),
      });
      const stored = saved as QuestionProject | null;
      // Recorded before any text was written: the solution text comes from the recording itself.
      const heard = currentProject.solutionText.trim() ? '' : transcriptText(result.source.words || []);
      updateCurrentProject({
        ...(stored
          ? withWordTimings(stored, result.source.words || [], result.source.timingSource || 'none')
          : { narrationSource: result.source, audioNarration: result.compat }),
        ...(heard ? { solutionText: heard } : {}),
        audioApproved: false,
        videoReady: false,
      });
      if (result.notice) setAudioError(result.notice);
      else if (heard) setAudioInfo('Çözüm metni sesinizden çıkarıldı. Doğru cevabı ve metni 2. adımda kontrol edebilirsiniz.');
      else if (!currentProject.solutionText.trim()) setAudioError('Sesinizden metin çıkarılamadı. İşaretler için 2. adımda çözüm metnini yazın.');
      onNewVoice();
    } catch (err) {
      setAudioError(plainMessage(err, 'Ses dosyası okunamadı.'));
    } finally {
      setIsTranscribingMp3(false);
      setTranscribeProgress(null);
    }
  };

  // Delete audio
  const handleDeleteAudio = async () => {
    if (!await confirm({ title: 'Ses silinsin mi?', message: 'Bu sorunun sesi kaldırılır. Yeniden seslendirmek ses hakkı kullanır.', confirmLabel: 'Sesi sil', danger: true })) return;
    if (isAudioPlaying && stageAudioRef.current) {
      stageAudioRef.current.pause();
      setIsAudioPlaying(false);
    }
    updateCurrentProject({
      narrationSource: undefined,
      audioNarration: undefined,
      audioApproved: false,
      videoReady: false,
    });
    onNewVoice();
  };

  // Download real MP3 file
  const handleDownloadNarrationMp3 = () => {
    if (!currentProject || !activeAudioUrl) return;
    const source = currentProject.narrationSource;
    const extension = source?.mimeType?.includes('wav') ? 'wav' : 'mp3';
    const fallbackName = source?.type === 'uploaded' ? 'yuklenen_ses.mp3' : `${currentProject.title || 'soru'}_seslendirme.${extension}`;
    saveFile(activeAudioUrl, source?.fileName || fallbackName);
  };

  const handleApproveVoice = () => {
    if (!currentProject) return;
    const legacy = currentProject.audioNarration;
    // Projects from before narrationSource existed carry only the legacy copy.
    const source =
      currentProject.narrationSource ||
      (legacy && {
        type: legacy.modelId?.startsWith('gemini-') ? ('gemini' as const) : ('elevenlabs' as const),
        audioUrl: legacy.audioUrl,
        audioBase64: legacy.audioBase64,
        duration: legacy.duration,
        voiceId: legacy.voiceId,
        voiceName: legacy.voiceName,
        words: legacy.words,
        alignment: legacy.alignment,
      });
    if (!source) return;
    updateCurrentProject({
      audioApproved: true,
      narrationSource: { ...source, isApproved: true },
      audioNarration: legacy && { ...legacy, isApproved: true },
    });
  };

  const toggleStageAudio = () => {
    const audio = stageAudioRef.current;
    if (!audio) return;

    if (isAudioPlaying) {
      audio.pause();
      setIsAudioPlaying(false);
    } else {
      audio.play().catch(() => {});
      setIsAudioPlaying(true);
    }
  };

  return {
    activeAudioUrl, activeAudioDuration, isGeneratingAudio, voiceProgress, isTranscribingMp3, transcribeProgress,
    audioError, setAudioError, audioInfo, audioPlayTime, setAudioPlayTime, isAudioPlaying, setIsAudioPlaying, stageAudioRef,
    revoiceUndo, lastFix, setLastFix,
    handleGenerateAudio, handleRevoice, handleCutAudio, handleUndoRevoice, handleUploadMp3File, handleDeleteAudio,
    handleDownloadNarrationMp3, handleApproveVoice, toggleStageAudio,
  };
}
