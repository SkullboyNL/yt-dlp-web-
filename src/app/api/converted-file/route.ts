import { NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import { CacheHelper } from '@/server/helpers/CacheHelper';
import { lookup } from 'mime-types';
import type { VideoInfo } from '@/types/video';

export const dynamic = 'force-dynamic';

/**
 * GET /api/converted-file?uuid=...
 * Streams the converted file as a download response.
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const uuid = searchParams.get('uuid');

    if (!uuid) {
      return NextResponse.json({ error: 'Missing uuid' }, { status: 400 });
    }

    const videoInfo = await CacheHelper.get<VideoInfo>(uuid);
    if (!videoInfo?.convertedFile?.path) {
      return NextResponse.json({ error: 'No converted file found' }, { status: 404 });
    }

    const { path: filePath, name: fileName } = videoInfo.convertedFile;

    try {
      await fs.access(filePath);
    } catch {
      // File gone — clean up cache
      videoInfo.convertedFile = null;
      await CacheHelper.set(uuid, videoInfo);
      return NextResponse.json({ error: 'Converted file no longer exists on disk' }, { status: 404 });
    }

    const stat = await fs.stat(filePath);
    const fileHandle = await fs.open(filePath, 'r');
    const stream = fileHandle.createReadStream();

    stream.on('close', async () => {
      try { await fileHandle.close(); } catch {}
    });

    return new Response(stream as any, {
      headers: {
        'Content-Type': lookup(filePath) || 'application/octet-stream',
        'Content-Length': String(stat.size),
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
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

/**
 * DELETE /api/converted-file?uuid=...
 * Deletes the converted file from disk and clears it from cache.
 */
export async function DELETE(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const uuid = searchParams.get('uuid');

    if (!uuid) {
      return NextResponse.json({ error: 'Missing uuid' }, { status: 400 });
    }

    const videoInfo = await CacheHelper.get<VideoInfo>(uuid);
    if (!videoInfo) {
      return NextResponse.json({ error: 'Video not found' }, { status: 404 });
    }

    if (videoInfo.convertedFile?.path) {
      try { await fs.unlink(videoInfo.convertedFile.path); } catch {}
    }

    videoInfo.convertedFile = null;
    await CacheHelper.set(uuid, videoInfo);

    return NextResponse.json({ ok: true });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || String(error) },
      { status: 500 }
    );
  }
}
