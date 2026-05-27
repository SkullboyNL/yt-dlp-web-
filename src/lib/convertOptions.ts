export type SoftwareVideoCodec = 'copy' | 'libx264' | 'libx265' | 'libvpx-vp9' | 'none';
export type HardwareVideoCodec = 'h264_vaapi' | 'hevc_vaapi';
export type VideoCodec = SoftwareVideoCodec | HardwareVideoCodec;

export const HW_VAAPI_CODECS: HardwareVideoCodec[] = ['h264_vaapi', 'hevc_vaapi'];
export const HW_CODECS: HardwareVideoCodec[] = [...HW_VAAPI_CODECS];

export function isHwCodec(codec: string): codec is HardwareVideoCodec {
  return (HW_CODECS as string[]).includes(codec);
}

export function isVaapiCodec(codec: string): codec is HardwareVideoCodec {
  return (HW_VAAPI_CODECS as string[]).includes(codec);
}

export interface ConvertOptions {
  outputFormat: 'mp4' | 'mkv' | 'webm' | 'mov' | 'mp3' | 'aac' | 'opus' | 'flac';
  videoCodec: VideoCodec;
  audioCodec: 'copy' | 'aac' | 'libopus' | 'libmp3lame' | 'flac' | 'none';
  crf: number;
  preset: 'ultrafast' | 'superfast' | 'veryfast' | 'faster' | 'fast' | 'medium' | 'slow';
  audioBitrate: '96k' | '128k' | '160k' | '192k' | '256k' | '320k';
  scaleHeight: '' | '360' | '480' | '720' | '1080' | '1440' | '2160';
  audioOnly: boolean;
  faststart: boolean;
  noAudio: boolean;
}