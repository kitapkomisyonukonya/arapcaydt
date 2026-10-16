import { Muxer, ArrayBufferTarget } from 'mp4-muxer';
import { ExportConfig } from '../../../types';
import { ExportProgress, IVideoExporter } from './types';
import { normalizeLoudness } from './loudness';

export function exportDimensions(config: ExportConfig) {
  const long = config.resolution === '720p' ? 1280 : 1920;
  const short = config.resolution === '720p' ? 720 : 1080;
  return config.aspectRatio === '9:16' ? { width: short, height: long } : { width: long, height: short };
}
const yieldToUI = () => new Promise<void>(resolve => setTimeout(resolve, 0));

/**
 * MP4 needs strictly increasing timestamps per track. Some platform encoders
 * (macOS AAC) can hand back a packet one frame early; dropping that one packet
 * (21 ms of audio) is inaudible, while passing it on aborts the whole export.
 */
export function monotonicGate(): (timestamp: number) => boolean {
  let last = -Infinity;
  return timestamp => {
    if (timestamp <= last) return false;
    last = timestamp;
    return true;
  };
}

/**
 * Audio packets are never dropped: one stamped at or before the previous packet (an encoder
 * that restarts or repeats its clock) is moved to right after it. Dropping instead once left
 * whole videos silent without any error.
 */
export function sequentialStamp(): (timestamp: number, duration: number) => number {
  let next = -Infinity;
  return (timestamp, duration) => {
    const at = timestamp >= next ? timestamp : next;
    next = at + Math.max(1, duration);
    return at;
  };
}

/** Loudest sample (0–1) of a decoded narration, sampled sparsely. */
export function peakLevel(channels: Float32Array[], step = 16): number {
  let peak = 0;
  for (const data of channels) for (let i = 0; i < data.length; i += step) peak = Math.max(peak, Math.abs(data[i]));
  return peak;
}

export class BrowserVideoExporter implements IVideoExporter {
  private static instance: BrowserVideoExporter;
  public static getInstance() {
    return this.instance || (this.instance = new BrowserVideoExporter());
  }

  /** Encode numbered frames and PCM samples against one media clock, never wall-clock recording. */
  public async exportVideo(
    canvasRenderer: (ctx: CanvasRenderingContext2D, time: number) => void,
    audioUrl: string | undefined, duration: number, config: ExportConfig,
    onProgress: (progress: ExportProgress) => void, signal?: AbortSignal
  ): Promise<Blob> {
    if (config.format !== 'mp4') throw new Error('Bu dışa aktarıcı MP4 üretir. MP4 biçimini seçin.');
    if (!Number.isFinite(duration) || duration <= 0) throw new Error('Geçerli bir ses/video süresi gerekli.');
    if (typeof VideoEncoder === 'undefined' || typeof VideoFrame === 'undefined') {
      throw new Error('Bu tarayıcı MP4 kodlamayı desteklemiyor. Güncel masaüstü Chrome veya Edge kullanın.');
    }
    const { width, height } = exportDimensions(config);
    const fps = config.fps || 30;
    const videoConfig: VideoEncoderConfig = {
      codec: 'avc1.640028', width, height, framerate: fps,
      bitrate: config.resolution === '720p' ? 3_000_000 : 6_000_000,
      latencyMode: 'realtime', avc: { format: 'avc' },
    };
    if (!(await VideoEncoder.isConfigSupported(videoConfig)).supported)
      throw new Error('Bu cihaz seçilen çözünürlükte H.264 MP4 üretemiyor. Güncel masaüstü Chrome veya Edge deneyin.');

    let videoEncoder: VideoEncoder | undefined;
    let audioEncoder: AudioEncoder | undefined;
    let audioContext: AudioContext | undefined;
    let encodingError: Error | undefined;
    const check = () => {
      if (signal?.aborted) throw new DOMException('Video oluşturma iptal edildi.', 'AbortError');
      if (encodingError) throw encodingError;
    };
    try {
      check();
      onProgress({ stage: 'preparing', percent: 2, message: 'Fontlar ve ses hazırlanıyor...' });
      await Promise.all([
        document.fonts.load('500 36px Manrope'),
        document.fonts.load('700 36px Manrope'),
        document.fonts.load('400 36px Amiri', 'العربية'),
      ]);
      await document.fonts.ready;
      let audioBuffer: AudioBuffer | undefined;
      if (audioUrl) {
        if (typeof AudioEncoder === 'undefined' || typeof AudioData === 'undefined')
          throw new Error('Bu tarayıcı sesli MP4 kodlamayı desteklemiyor. Güncel masaüstü Chrome veya Edge kullanın.');
        const response = await fetch(audioUrl, { signal, cache: 'no-store' }).catch(error => {
          if (signal?.aborted) throw error;
          throw new Error('Sorunun ses dosyası indirilemedi. İnternet bağlantınızı kontrol edip tekrar deneyin.');
        });
        if (!response.ok) throw new Error('Ses dosyası yüklenemedi (' + response.status + ').');
        audioContext = new AudioContext({ sampleRate: 48000 });
        audioBuffer = await audioContext.decodeAudioData(await response.arrayBuffer());
        await audioContext.close();
        audioContext = undefined;
        if (audioBuffer.numberOfChannels > 2) throw new Error('Lütfen mono veya stereo ses yükleyin.');
        if (peakLevel(Array.from({ length: audioBuffer.numberOfChannels }, (_, c) => audioBuffer!.getChannelData(c))) < 1e-4)
          throw new Error('Bu sorunun ses dosyası sessiz görünüyor. Ses adımında sesi dinleyin; gerekirse yeniden seslendirin ya da MP3’ü yeniden yükleyin.');
        normalizeLoudness(Array.from({ length: audioBuffer.numberOfChannels }, (_, c) => audioBuffer!.getChannelData(c)), audioBuffer.sampleRate);
      }
      check();
      const totalSeconds = Math.max(duration, audioBuffer?.duration || 0);
      const totalFrames = Math.ceil(totalSeconds * fps);
      const canvas = document.createElement('canvas');
      canvas.width = width; canvas.height = height;
      const ctx = canvas.getContext('2d', { alpha: false });
      if (!ctx) throw new Error('Video çizim alanı açılamadı.');
      const muxer = new Muxer({
        target: new ArrayBufferTarget(),
        video: { codec: 'avc', width, height, frameRate: fps },
        ...(audioBuffer ? { audio: { codec: 'aac' as const, sampleRate: audioBuffer.sampleRate, numberOfChannels: audioBuffer.numberOfChannels } } : {}),
        fastStart: 'in-memory', firstTimestampBehavior: 'offset',
      });
      const failed = (error: DOMException) => { encodingError = error; };
      const videoInOrder = monotonicGate(), audioStamp = sequentialStamp();
      let audioMicros = 0;
      videoEncoder = new VideoEncoder({
        output: (chunk, metadata) => {
          if (!videoInOrder(chunk.timestamp)) return;
          try { muxer.addVideoChunk(chunk, metadata); } catch (error) { encodingError = error as Error; }
        }, error: failed,
      });
      videoEncoder.configure(videoConfig);

      if (audioBuffer) {
        const audioConfig: AudioEncoderConfig = {
          codec: 'mp4a.40.2', sampleRate: audioBuffer.sampleRate,
          numberOfChannels: audioBuffer.numberOfChannels, bitrate: 192000,
        };
        if (!(await AudioEncoder.isConfigSupported(audioConfig)).supported)
          throw new Error('Bu cihaz AAC sesi kodlayamıyor. Güncel masaüstü Chrome veya Edge kullanın.');
        audioEncoder = new AudioEncoder({
          output: (chunk, metadata) => {
            const length = chunk.duration ?? Math.round(1024 / audioBuffer!.sampleRate * 1_000_000);
            const at = audioStamp(chunk.timestamp, length);
            let packet = chunk;
            if (at !== chunk.timestamp) {
              const bytes = new Uint8Array(chunk.byteLength); chunk.copyTo(bytes);
              packet = new EncodedAudioChunk({ type: chunk.type, timestamp: at, duration: length, data: bytes });
            }
            try { muxer.addAudioChunk(packet, metadata); audioMicros += length; } catch (error) { encodingError = error as Error; }
          }, error: failed,
        });
        audioEncoder.configure(audioConfig);
        const blockSize = 4096;
        for (let offset = 0, block = 0; offset < audioBuffer.length; offset += blockSize, block++) {
          check();
          const count = Math.min(blockSize, audioBuffer.length - offset);
          const samples = new Float32Array(count * audioBuffer.numberOfChannels);
          for (let channel = 0; channel < audioBuffer.numberOfChannels; channel++)
            samples.set(audioBuffer.getChannelData(channel).subarray(offset, offset + count), channel * count);
          const data = new AudioData({
            format: 'f32-planar', sampleRate: audioBuffer.sampleRate,
            numberOfFrames: count, numberOfChannels: audioBuffer.numberOfChannels,
            timestamp: Math.round(offset / audioBuffer.sampleRate * 1_000_000), data: samples,
          });
          try { audioEncoder.encode(data); } finally { data.close(); }
          // One continuous stream: a flush mid-way restarts the macOS AAC encoder and
          // its next packet goes back one frame. Wait for the queue to drain instead.
          if (block % 32 === 31) {
            while (audioEncoder.encodeQueueSize > 16) { check(); await yieldToUI(); }
            await yieldToUI();
          }
        }
        await audioEncoder.flush(); check();
        // Never hand out a video whose narration did not make it in.
        if (audioMicros < audioBuffer.duration * 1_000_000 * .9)
          throw new Error('Ses videoya eklenemedi. Sayfayı yenileyip tekrar deneyin; sürerse güncel Chrome ile deneyin ve “Sorun bildir” ile haber verin.');
      }
      for (let i = 0; i < totalFrames; i++) {
        check();
        canvasRenderer(ctx, i / fps);
        const timestamp = Math.round(i / fps * 1_000_000);
        const frame = new VideoFrame(canvas, {
          timestamp, duration: Math.round((i + 1) / fps * 1_000_000) - timestamp,
        });
        try { videoEncoder.encode(frame, { keyFrame: i % (fps * 2) === 0 }); } finally { frame.close(); }
        if (i % 15 === 14 || i === totalFrames - 1) {
          await videoEncoder.flush(); check();
          onProgress({ stage: 'rendering', percent: Math.round(10 + (i + 1) / totalFrames * 85),
            currentFrame: i + 1, totalFrames, message: 'Video kareleri oluşturuluyor...' });
          await yieldToUI();
        }
      }
      await videoEncoder.flush(); check();
      onProgress({ stage: 'finalizing', percent: 98, message: 'Sesli MP4 dosyası tamamlanıyor...' });
      muxer.finalize();
      const blob = new Blob([muxer.target.buffer], { type: 'video/mp4' });
      if (!blob.size) throw new Error('Video dosyası boş oluşturuldu.');
      onProgress({ stage: 'completed', percent: 100, message: 'MP4 hazır.' });
      return blob;
    } finally {
      if (videoEncoder && videoEncoder.state !== 'closed') videoEncoder.close();
      if (audioEncoder && audioEncoder.state !== 'closed') audioEncoder.close();
      if (audioContext && audioContext.state !== 'closed') await audioContext.close().catch(() => {});
    }
  }
}
export const videoExporter = BrowserVideoExporter.getInstance();
