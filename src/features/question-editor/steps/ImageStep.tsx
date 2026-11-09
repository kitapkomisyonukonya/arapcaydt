import React, { useState } from 'react';
import { toast } from 'sonner';
import type { QuestionProject } from '../../../types';
import { CheckCircle, PresentationChart, UploadSimple, Trash } from '@phosphor-icons/react';
import { pageHash } from '../../../layouts/route';
import { plainMessage } from '../../../services/plainError';
import { PrepToolHint } from './PrepToolHint';
import { TEMPLATE_TOOL_URL } from '../../../config/prepTools';

export interface ImageStepProps {
  step: number;
  hasImage: boolean;
  currentProject: QuestionProject;
  replaceImageInputRef: React.RefObject<HTMLInputElement | null>;
  handleImageFile: (file: File) => void;
  handleDeleteImage: () => void;
  /** An approved voice is kept when the picture changes; only the marks are prepared again. */
  keepsVoice?: boolean;
}

/** STEP 1: Soru Görseli */
export function ImageStep({ step, hasImage, currentProject, replaceImageInputRef, handleImageFile, handleDeleteImage, keepsVoice }: ImageStepProps) {
  return (
    <div hidden={step!==0} className="space-y-2.5">
      <h2 className="text-sm font-bold text-[#1C1917] tracking-tight">
        1. Soru Görseli
      </h2>

      {hasImage ? (
        <div className="p-3 rounded-lg border border-[#E5E4DC] bg-[#FAF9F5] flex items-center justify-between">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-10 h-10 rounded border border-[#D5D4CC] overflow-hidden bg-white shrink-0">
              <img
                src={currentProject.imageUrl}
                alt="Thumbnail"
                crossOrigin="anonymous"
                className="w-full h-full object-cover"
              />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 text-sm font-semibold text-[#15803D]">
                <CheckCircle size={15} weight="fill" />
                <span className="truncate">{currentProject.imageFileName || 'Soru Görseli'}</span>
              </div>
              <div className="text-sm text-[#787670]">
                YDT Soru Görseli
              </div>
            </div>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            <label className="px-2.5 py-1 text-sm font-semibold text-[#55544F] hover:text-[#1C1917] bg-white border border-[#D5D4CC] rounded hover:bg-[#F0EFEA] cursor-pointer transition-colors">
              Görseli Değiştir
              <input
                ref={replaceImageInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="hidden"
                onChange={(e) => {
                  if (e.target.files?.[0]) handleImageFile(e.target.files[0]);
                  e.target.value = ''; // the same file can be picked again
                }}
              />
            </label>
            <button
              type="button"
              onClick={handleDeleteImage}
              title="Görseli Sil"
              className="p-1.5 text-[#787670] hover:text-red-600 hover:bg-red-50 rounded border border-transparent hover:border-red-200 transition-colors cursor-pointer"
            >
              <Trash size={14} />
            </button>
          </div>
        </div>
      ) : null}
      {hasImage && keepsVoice && (
        <p className="text-sm text-[#55544F]">
          Görsel yanlışsa <strong>Görseli Değiştir</strong> ile doğrusunu yükleyin: ses ve çözüm metni korunur, işaretler yeni görsele göre yeniden hazırlanır.
        </p>
      )}
      {!hasImage && (
        <label
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            if (e.dataTransfer.files?.[0]) handleImageFile(e.dataTransfer.files[0]);
          }}
          className="w-full py-8 border-2 border-dashed border-[#D5D4CC] hover:border-[#8B1E2D] rounded-xl flex flex-col items-center justify-center cursor-pointer bg-[#FAF9F5] hover:bg-white transition-all text-center p-4 group"
        >
          <div className="w-10 h-10 rounded-full bg-white border border-[#D5D4CC] group-hover:border-[#8B1E2D] flex items-center justify-center text-[#787670] group-hover:text-[#8B1E2D] mb-2 transition-colors">
            <UploadSimple size={20} />
          </div>
          <span className="text-sm font-semibold text-[#1C1917]">
            PNG veya JPG yükle
          </span>
          <span className="text-sm text-[#787670] mt-0.5">
            Soru görselini sürükleyin veya tıklayın
          </span>
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="hidden"
            onChange={(e) => {
              if (e.target.files?.[0]) handleImageFile(e.target.files[0]);
                  e.target.value = ''; // the same file can be picked again
            }}
          />
        </label>
      )}
      {!hasImage && (
        <PrepToolHint text="Sorunuz şablona yerleştirilmiş bir görsel olarak hazır değilse:" label="Soru şablonu yerleştirici" url={TEMPLATE_TOOL_URL} />
      )}
      <LessonHint project={currentProject} hasImage={hasImage} />
    </div>
  );
}

/**
 * A slide lesson does not belong here: this editor looks for a correct option, ticks it in green and
 * underlines like a question. Points to Konu Anlatımı and, once a picture is in, carries it over
 * there with its text and voice.
 */
function LessonHint({ project, hasImage }: { project: QuestionProject; hasImage: boolean }) {
  const [moving, setMoving] = useState(false);
  const move = async () => {
    setMoving(true);
    try {
      const { lessonFromQuestion } = await import('../../lessons/fromQuestion');
      const id = await lessonFromQuestion(project);
      toast.success('Konu anlatımı oluşturuldu. Bu soru da Sorularım’da duruyor; gerekmiyorsa silebilirsiniz.', { duration: 9000 });
      window.location.hash = pageHash('lessons', id);
    } catch (error) {
      toast.error(plainMessage(error, 'Konu anlatımına taşınamadı.'));
    } finally {
      setMoving(false);
    }
  };
  const link = 'inline-flex items-center gap-1 font-semibold text-[#8B1E2D] hover:underline disabled:opacity-50';
  return (
    <p className="text-sm text-[#787670]" title="Soru editörü doğru şıkkı yeşille işaretler ve altını çizer. Konu Anlatımı’nda doğru şık olmaz, anlatılan yer fosforlu kalemle boyanır.">
      Soru değil de konu anlatımı slaytı mı hazırlıyorsunuz?{' '}
      {hasImage ? (
        <button type="button" onClick={() => void move()} disabled={moving} className={link}>
          <PresentationChart size={14} /> {moving ? 'Taşınıyor…' : 'Konu anlatımına taşı'}
        </button>
      ) : (
        <a href={pageHash('lessons')} className={link}><PresentationChart size={14} /> Konu Anlatımı’nı açın</a>
      )}
    </p>
  );
}
