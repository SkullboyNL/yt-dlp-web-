import { NextResponse } from 'next/server';
import { spawn } from 'child_process';
import { promises as fs } from 'fs';
import { parse, join } from 'path';
import { CacheHelper } from '@/server/helpers/CacheHelper';
import { lookup } from 'mime-types';
import type { VideoInfo } from '@/types/video';
import type { ConvertOptions } from '@/lib/convertOptions';
import { isHwCodec, isVaapiCodec } from '@/lib/convertOptions';

export const dynamic = 'force-dynamic';

function buildFfmpegArgs(
  inputPath: string,
  outputPath: string,
  options: ConvertOptions
): string[] {
  const args: string[] = ['-y', '-loglevel', 'repeat+info'];

  if (isVaapiCodec(options.videoCodec)) {
    args.push('-vaapi_device', '/dev/dri/renderD128');
  }

  args.push('-i', inputPath);

  if (options.audioOnly) {
    args.push('-vn');
    if (options.audioCodec !== 'copy' && options.audioCodec !== 'none') {
      args.push('-c:a', options.audioCodec, '-b:a', options.audioBitrate);
    } else if (options.audioCodec === 'copy') {
      args.push('-c:a', 'copy');
    }
  } else {
    args.push('-map', '0:v:0');
    if (!options.noAudio) args.push('-map', '0:a?');
    args.push('-dn', '-ignore_unknown');

    if (options.videoCodec === 'none') {
      args.push('-vn');
    } else if (options.videoCodec === 'copy') {
      args.push('-c:v', 'copy');
    } else if (isHwCodec(options.videoCodec)) {
      // VAAPI
      args.push('-vf', options.scaleHeight
        ? `format=nv12,hwupload,scale_vaapi=-2:${options.scaleHeight}`
        : 'format=nv12,hwupload'
      );
      args.push('-c:v', options.videoCodec);
      args.push('-global_quality', String(options.crf));
    } else {
      // Software
      args.push('-c:v', options.videoCodec);
      if (options.videoCodec === 'libvpx-vp9') {
        args.push('-b:v', '0', '-crf', String(options.crf));
        args.push('-deadline', 'realtime', '-cpu-used', '4');
      } else {
        args.push('-preset', options.preset);
        args.push('-crf', String(options.crf));
        if (options.videoCodec === 'libx264') args.push('-pix_fmt', 'yuv420p');
      }
      if (options.scaleHeight) args.push('-vf', `scale=-2:${options.scaleHeight}:flags=lanczos`);
    }

    if (options.noAudio) {
      args.push('-an');
    } else if (options.audioCodec === 'none') {
      args.push('-an');
    } else if (options.audioCodec === 'copy') {
      args.push('-c:a', 'copy');
    } else {
      args.push('-c:a', options.audioCodec, '-b:a', options.audioBitrate);
    }

    const isMp4Like = ['.mp4', '.m4v', '.mov'].includes('.' + options.outputFormat);
    if (options.faststart && isMp4Like) args.push('-movflags', '+faststart');
  }

  args.push(outputPath);
  return args;
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { uuid, options } = body as { uuid: string; options: ConvertOptions };

    if (!uuid || !options) {
      return NextResponse.json({ error: 'Missing uuid or options' }, { status: 400 });
    }

    const videoInfo = await CacheHelper.get<VideoInfo>(uuid);
    if (!videoInfo) {
      return NextResponse.json({ error: 'Video not found' }, { status: 404 });
    }

    const inputPath = videoInfo.file?.path;
    if (!inputPath) {
      return NextResponse.json({ error: 'Source file path not found' }, { status: 404 });
    }

    try {
      await fs.access(inputPath);
    } catch {
      return NextResponse.json({ error: 'Source file does not exist on disk' }, { status: 404 });
    }

    const parsedInput = parse(inputPath);
    const outputExt = options.audioOnly
      ? options.audioCodec === 'libmp3lame' ? 'mp3'
      : options.audioCodec === 'libopus'   ? 'opus'
      : options.audioCodec === 'flac'      ? 'flac'
      :                                      'aac'
      : options.outputFormat;

    const outputFileName = `${parsedInput.name} [converted].${outputExt}`;
    // Same folder as original
    const outputPath = join(parsedInput.dir, outputFileName);
    const ffmpegArgs = buildFfmpegArgs(inputPath, outputPath, options);

    await new Promise<void>((resolve, reject) => {
      const ffmpeg = spawn('ffmpeg', ffmpegArgs);
      let stderr = '';
      ffmpeg.stderr.setEncoding('utf-8');
      ffmpeg.stderr.on('data', (data: string) => { stderr += data; });
      ffmpeg.on('close', (code: number | null) => {
        if (code === 0) resolve();
        else reject(new Error(stderr || `ffmpeg exited with code ${code}`));
      });
    });

    // Save path to cache so VideoGridItem can read it
    videoInfo.convertedFile = { path: outputPath, name: outputFileName };
    await CacheHelper.set(uuid, videoInfo);

    const stat = await fs.stat(outputPath);
    const fileHandle = await fs.open(outputPath, 'r');
    const stream = fileHandle.createReadStream();

    stream.on('close', async () => {
      try { await fileHandle.close(); } catch {}
      // File is NOT deleted — kept for reuse
    });

    return new Response(stream as any, {
      headers: {
        'Content-Type': lookup(outputPath) || 'application/octet-stream',
        'Content-Length': String(stat.size),
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(outputFileName)}`,
        'X-Converted-Path': encodeURIComponent(outputPath),
        'X-Converted-Name': encodeURIComponent(outputFileName),
      },
      status: 200,
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || String(error) },
      { status: 500 }
    );
  }
}
