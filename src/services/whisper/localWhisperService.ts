import { NarrationWord } from '../../types';
import { cleanWhisperWords, speechWindows } from './whisperWords';

const SAMPLE_RATE = 16000;

export interface WhisperProgress {
  status: 'idle' | 'downloading' | 'loading' | 'transcribing' | 'completed' | 'error';
  progress: number; // 0 - 100
  message: string;
  file?: string;
}

class LocalWhisperService {
  private static instance: LocalWhisperService;
  private transcriberPipeline: any = null;
  private isModelLoading = false;

  public static getInstance(): LocalWhisperService {
    if (!LocalWhisperService.instance) {
      LocalWhisperService.instance = new LocalWhisperService();
    }
    return LocalWhisperService.instance;
  }

  /**
   * Lazy-loads the multilingual Whisper model only when needed.
   * Caches model in browser cache storage automatically via Transformers.js.
   */
  private async getTranscriber(onProgress?: (progress: WhisperProgress) => void): Promise<any> {
    if (this.transcriberPipeline) {
      return this.transcriberPipeline;
    }

    if (this.isModelLoading) {
      while (this.isModelLoading) {
        await new Promise((r) => setTimeout(r, 150));
      }
      if (this.transcriberPipeline) return this.transcriberPipeline;
    }

    this.isModelLoading = true;
    try {
      onProgress?.({
        status: 'loading',
        progress: 10,
        message: 'Whisper modeli hazırlanıyor (yerel tarayıcı önbelleği)...',
      });

      // Dynamically import @huggingface/transformers
      const { pipeline, env } = await import('@huggingface/transformers');

      // Configure cache settings if available
      if (env) {
        env.allowLocalModels = false;
        env.useBrowserCache = true;
      }

      onProgress?.({
        status: 'downloading',
        progress: 20,
        message: 'Whisper çok dilli model yükleniyor (ilk seferde indirilir)...',
      });

      // Word timestamps need the decoder's cross-attentions; onnx-community/whisper-tiny is exported
      // without them ("Model outputs must contain cross attentions"). Xenova/whisper-tiny keeps them.
      const pipe = await pipeline('automatic-speech-recognition', 'Xenova/whisper-tiny', {
        dtype: 'fp32',
        progress_callback: (info: any) => {
          if (info.status === 'progress') {
            const pct = Math.round(info.progress || 0);
            onProgress?.({
              status: 'downloading',
              progress: 20 + Math.round((pct / 100) * 50),
              message: `Whisper modeli indiriliyor: %${pct} (${info.file || ''})`,
              file: info.file,
            });
          } else if (info.status === 'done') {
            onProgress?.({
              status: 'loading',
              progress: 75,
              message: 'Model bellek ortamına aktarılıyor...',
            });
          }
        },
      });

      this.transcriberPipeline = pipe;
      return pipe;
    } finally {
      this.isModelLoading = false;
    }
  }

  /**
   * Decodes an audio file or base64 data into a 16kHz mono Float32Array for Whisper.
   */
  private async decodeAudioToFloat32(
    audioData: ArrayBuffer | Blob
  ): Promise<{ audioData: Float32Array; duration: number }> {
    const arrayBuffer =
      audioData instanceof Blob ? await audioData.arrayBuffer() : audioData;

    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    const audioCtx = new AudioContextClass({ sampleRate: SAMPLE_RATE });

    try {
      const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer.slice(0));
      const duration = audioBuffer.duration;

      // Extract mono channel data at 16kHz
      let channelData: Float32Array;
      if (audioBuffer.numberOfChannels === 1) {
        channelData = audioBuffer.getChannelData(0);
      } else {
        // Average stereo channels to mono
        const left = audioBuffer.getChannelData(0);
        const right = audioBuffer.getChannelData(1);
        channelData = new Float32Array(left.length);
        for (let i = 0; i < left.length; i++) {
          channelData[i] = (left[i] + right[i]) / 2;
        }
      }

      return { audioData: channelData, duration };
    } finally {
      if (audioCtx.state !== 'closed') {
        audioCtx.close().catch(() => {});
      }
    }
  }

  /** Word timings for a saved narration: downloads its audio and transcribes it here. */
  public async transcribeNarrationAudio(project: { narrationSource?: { audioUrl?: string }; audioNarration?: { audioUrl?: string } }): Promise<NarrationWord[]> {
    const audioUrl = project.narrationSource?.audioUrl || project.audioNarration?.audioUrl;
    if (!audioUrl) throw new Error('Ses dosyası bağlantısı bulunamadı.');
    const response = await fetch(audioUrl, { cache: 'no-store' });
    if (!response.ok) throw new Error(`Ses dosyası indirilemedi (HTTP ${response.status}).`);
    return (await this.transcribeAudioLocally(await response.arrayBuffer())).words;
  }

  /**
   * Performs in-browser speech-to-text with word-level timestamps using Whisper.
   * Never calls external AI APIs.
   */
  public async transcribeAudioLocally(
    audioData: ArrayBuffer | Blob,
    onProgress?: (progress: WhisperProgress) => void
  ): Promise<{
    text: string;
    duration: number;
    words: NarrationWord[];
  }> {
    onProgress?.({
      status: 'loading',
      progress: 5,
      message: 'Ses dosyası çözümleniyor (16kHz mono)...',
    });

    const { audioData: float32Audio, duration } = await this.decodeAudioToFloat32(audioData);

    const pipe = await this.getTranscriber(onProgress);

    onProgress?.({
      status: 'transcribing',
      progress: 80,
      message: 'Whisper ile yerel ses tanıma ve kelime zamanlaması yapılıyor...',
    });

    try {
      // Whisper hears 30 seconds at a time: a longer narration is transcribed piece by piece,
      // cut in pauses, and the pieces' word times are put back on the whole audio's clock.
      const texts: string[] = [];
      const heard: NarrationWord[] = [];
      for (const [from, to] of speechWindows(float32Audio, SAMPLE_RATE)) {
        const offset = from / SAMPLE_RATE;
        const result = await pipe(float32Audio.subarray(from, to), {
          return_timestamps: 'word',
          language: 'turkish',
          task: 'transcribe',
        });
        texts.push((result.text || '').trim());
        for (const chunk of result.chunks || []) {
          const text = (chunk.text || '').trim();
          if (!text) continue;

          const timestamps = chunk.timestamp || [0, 0.3];
          const start = typeof timestamps[0] === 'number' ? timestamps[0] : 0;
          const end = typeof timestamps[1] === 'number' ? timestamps[1] : start + 0.3;

          heard.push({
            text,
            start: parseFloat((offset + start).toFixed(2)),
            end: parseFloat((offset + end).toFixed(2)),
          });
        }
      }
      const fullText = texts.filter(Boolean).join(' ');
      const words = cleanWhisperWords(heard);

      onProgress?.({
        status: 'completed',
        progress: 100,
        message: 'Yerel ses deşifresi başarıyla tamamlandı.',
      });

      return {
        text: fullText,
        duration: parseFloat(duration.toFixed(2)),
        words,
      };
    } catch (err) {
      console.error('Local Whisper transcription encountered an error:', err);
      throw new Error(`Yerel Whisper ses çözümlemesi başarısız: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

export const localWhisperService = LocalWhisperService.getInstance();
