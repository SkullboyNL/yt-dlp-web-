import { spawn } from 'child_process';
import { tmpdir } from 'os';
import { extname, join, parse } from 'path';
import { promises as fs } from 'fs';
import type { FFmpegStreamsJson, Streams } from '@/types/video';

export class FFmpegHelper {
  public readonly filePath;
  public readonly fileUuid;

  constructor(params: { filePath: string; fileUuid?: string }) {
    this.filePath = params.filePath;
    this.fileUuid = params.fileUuid;
  }

  async getVideoStreams() {
    if (!this.filePath) {
      return;
    }

    const ffprobe = spawn('ffprobe', [
      '-v',
      'error',
      '-show_entries',
      'stream=width,height,color_primaries,r_frame_rate,codec_name,codec_type,duration:format=format_name',
      '-of',
      'json',
      this.filePath
    ]);

    let stdoutChunks = '';

    ffprobe.stdout.setEncoding('utf-8');
    ffprobe.stdout.on('data', (data) => {
      const text = data?.trim?.();
      if (text) stdoutChunks += text;
    });

    return new Promise((resolve: (streams: Streams) => void, reject: (message: string) => void) => {
      ffprobe.stderr.setEncoding('utf-8');
      ffprobe.stderr.on('data', (data) => {
        return reject(data?.trim?.() || '');
      });
      ffprobe.on('exit', () => {
        try {
          if (!stdoutChunks) {
            throw 'streams not found';
          }
          const json = JSON.parse(stdoutChunks) as FFmpegStreamsJson;
          const streams = json?.streams?.find((stream) => stream.codec_type === 'video');
          const audioStream = json?.streams?.find((stream) => stream.codec_type === 'audio');

          if (!streams) {
            throw 'streams not found';
          }

          const [total, duration] = streams?.r_frame_rate?.split?.('/') || [];
          resolve({
            codecName: streams.codec_name,
            audioCodecName: audioStream?.codec_name,
            containerName: json.format?.format_name,
            width: streams.width,
            height: streams.height,
            colorPrimaries: streams.color_primaries,
            rFrameRate:
              total && duration ? Number(total) / Number(duration) || undefined : undefined,
            duration: streams.duration
          });
        } catch (e) {
          reject('streams not found');
        }
      });
    });
  }


  private async downloadImage(url: string) {
    const response = await fetch(url);
    if (!response.ok) {
      throw `Failed to download thumbnail: ${response.status}`;
    }

    const contentType = response.headers.get('content-type') || '';
    const extension = contentType.includes('png')
      ? '.png'
      : contentType.includes('webp')
      ? '.webp'
      : '.jpg';
    const dirPath = await fs.mkdtemp(join(tmpdir(), 'yt-dlp-web-thumbnail-'));
    const imagePath = join(dirPath, `thumbnail${extension}`);
    await fs.writeFile(imagePath, Buffer.from(await response.arrayBuffer()));

    return { dirPath, imagePath };
  }

  async setThumbnailAsFirstFrame(thumbnailUrl?: string | null) {
    if (!thumbnailUrl) {
      throw 'thumbnail url is not found';
    }

    const streams = await this.getVideoStreams();
    if (!streams?.width || !streams?.height) {
      throw 'video size is not found';
    }

    const parsedPath = parse(this.filePath);
    const extension = extname(this.filePath).toLowerCase();
    const tempOutputPath = join(parsedPath.dir, `${parsedPath.name}.thumbnail-frame.tmp${extension}`);
    const { dirPath, imagePath } = await this.downloadImage(thumbnailUrl);
    const isWebm = extension === '.webm';
    const isMp4Like = ['.mp4', '.m4v', '.mov'].includes(extension);
    const videoCodecArgs = isWebm
      ? ['-c:v', 'libvpx-vp9', '-deadline', 'realtime', '-cpu-used', '4', '-b:v', '0', '-crf', '32']
      : ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p'];
    const audioCodecArgs = isWebm ? ['-c:a', 'libopus'] : ['-c:a', 'aac', '-b:a', '160k'];
    const movflagsArgs = isMp4Like ? ['-movflags', '+faststart'] : [];

    const filter = [
      `[1:v]scale=${streams.width}:${streams.height}:force_original_aspect_ratio=increase`,
      `crop=${streams.width}:${streams.height}`,
      'setsar=1[thumbnail]',
      "[0:v][thumbnail]overlay=0:0:enable='eq(n,0)'[video]"
    ].join(',');

    return new Promise((resolve: (filePath: string) => void, reject: (message: string) => void) => {
      const ffmpeg = spawn('ffmpeg', [
        '-y',
        '-loglevel',
        'repeat+info',
        '-i',
        this.filePath,
        '-loop',
        '1',
        '-i',
        imagePath,
        '-filter_complex',
        filter,
        '-map',
        '[video]',
        '-map',
        '0:a?',
        '-map',
        '0:s?',
        ...videoCodecArgs,
        ...audioCodecArgs,
        '-c:s',
        'copy',
        '-shortest',
        ...movflagsArgs,
        tempOutputPath
      ]);

      let stderr = '';
      ffmpeg.stderr.setEncoding('utf-8');
      ffmpeg.stderr.on('data', (data) => {
        stderr += data?.trim?.() || '';
      });
      ffmpeg.on('close', async (code) => {
        await fs.rm(dirPath, { recursive: true, force: true }).catch(() => {});

        if (code !== 0) {
          await fs.unlink(tempOutputPath).catch(() => {});
          reject(stderr || 'Failed to set thumbnail as first frame');
          return;
        }

        try {
          await fs.rename(tempOutputPath, this.filePath);
          resolve(this.filePath);
        } catch (error) {
          await fs.unlink(tempOutputPath).catch(() => {});
          reject('Failed to replace video with thumbnail frame output');
        }
      });
    });
  }

  async repair() {
    return new Promise((resolve) => {
      // const repairShellScriptFile = join(__dirname, 'src', 'server', 'ffmpeg-repair.sh');

      const ffmpeg = spawn(
        'ffmpeg',
        // [`${repairShellScriptFile}`]
        [
          '-y',
          '-loglevel',
          'repeat+info',
          '-i',
          `'file:${this.filePath}'`,
          '-map',
          '0',
          '-dn',
          '-ignore_unknown',
          '-c',
          'copy',
          '-f',
          'mp4',
          '-bsf:a',
          'aac_adtstoasc',
          '-movflags',
          '+faststart',
          `'file:${this.filePath}.temp'`,
          '&&',
          'rm',
          `'${this.filePath}'`,
          '&&',
          'mv',
          `'${this.filePath}.temp'`,
          `'${this.filePath}'`
        ],
        {
          shell: true
        }
      );

      ffmpeg.on('close', () => {
        resolve(undefined);
      });

      const interval = setInterval(() => {
        if (!ffmpeg.connected) {
          clearInterval(interval);
          resolve(undefined);
        }
      }, 30 * 1000);
    });
  }
}
