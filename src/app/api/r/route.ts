import { NextResponse } from 'next/server';
import type { SelectQuality, VideoInfo } from '@/types/video';
import { YtDlpHelper } from '@/server/helpers/YtDlpHelper';
import { CacheHelper } from '@/server/helpers/CacheHelper';
import { ProcessHelper } from '@/server/helpers/ProcessHelper';
import {
  checkRequiredFoldersAreAccessible,
  checkRequiredFoldersAreMounted
} from '@/server/helpers/PermissionHelper';

export const dynamic = 'force-dynamic';

const encoder = new TextEncoder();

const getBooleanOverride = (searchParams: URLSearchParams, key: string, fallback: boolean) => {
  if (!searchParams.has(key)) {
    return fallback;
  }
  return searchParams.get(key) === 'true';
};

// Restart Download
export async function GET(request: Request) {
  const urlObject = new URL(request.url);
  const searchParams = urlObject.searchParams;
  const uuid = searchParams.get('uuid');

  if (typeof uuid !== 'string') {
    return NextResponse.json({ error: 'Param `uuid` is only string type' }, { status: 400 });
  }

  await checkRequiredFoldersAreMounted();
  await checkRequiredFoldersAreAccessible();

  const videoInfo = await CacheHelper.get<VideoInfo>(uuid);
  if (!videoInfo || !videoInfo?.format) {
    return NextResponse.json(
      { error: 'Please delete the video file and retry download.' },
      { status: 400 }
    );
  }
  const url = videoInfo.url;
  const selectQuality = (searchParams.get('selectQuality') || videoInfo?.selectQuality || '') as
    | SelectQuality
    | '';
  const outputFilename = searchParams.has('outputFilename')
    ? searchParams.get('outputFilename') || ''
    : videoInfo?.outputFilename || '';
  const proxyAddress = searchParams.has('proxyAddress')
    ? searchParams.get('proxyAddress') || ''
    : videoInfo?.proxyAddress || '';
  const cutStartTime = searchParams.has('cutStartTime')
    ? searchParams.get('cutStartTime') || ''
    : videoInfo?.cutStartTime || '';
  const cutEndTime = searchParams.has('cutEndTime')
    ? searchParams.get('cutEndTime') || ''
    : videoInfo?.cutEndTime || '';
  const filenameLengthLimit = searchParams.has('filenameLengthLimit')
    ? Number(searchParams.get('filenameLengthLimit') || 0)
    : videoInfo?.filenameLengthLimit || 0;

  if (videoInfo?.download?.pid) {
    new ProcessHelper({ pid: videoInfo.download.pid }).kill();
  }

  const ytdlp = new YtDlpHelper({
    url,
    videoId: videoInfo.videoId || '',
    audioId: videoInfo.audioId || '',
    format: videoInfo.format,
    uuid: videoInfo.uuid,
    usingCookies: getBooleanOverride(searchParams, 'usingCookies', videoInfo?.usingCookies || false),
    embedThumbnail: getBooleanOverride(
      searchParams,
      'embedThumbnail',
      videoInfo?.embedThumbnail || false
    ),
    embedChapters: getBooleanOverride(
      searchParams,
      'embedChapters',
      videoInfo?.embedChapters || false
    ),
    embedMetadata: getBooleanOverride(
      searchParams,
      'embedMetadata',
      videoInfo?.embedMetadata || false
    ),
    embedVideoThumbnail: getBooleanOverride(
      searchParams,
      'embedVideoThumbnail',
      videoInfo?.embedVideoThumbnail || false
    ),
    embedSubs: getBooleanOverride(searchParams, 'embedSubs', videoInfo?.embedSubs || false),
    subLangs: videoInfo?.subLangs || [],
    enableProxy: getBooleanOverride(searchParams, 'enableProxy', videoInfo?.enableProxy || false),
    proxyAddress,
    enableLiveFromStart: getBooleanOverride(
      searchParams,
      'enableLiveFromStart',
      videoInfo?.enableLiveFromStart || false
    ),
    cutVideo: getBooleanOverride(searchParams, 'cutVideo', videoInfo?.cutVideo || false),
    cutStartTime,
    cutEndTime,
    outputFilename,
    filenameLengthLimit: Number.isNaN(filenameLengthLimit) ? 0 : filenameLengthLimit,
    selectQuality,
    enableForceKeyFramesAtCuts: getBooleanOverride(
      searchParams,
      'enableForceKeyFramesAtCuts',
      videoInfo?.enableForceKeyFramesAtCuts || false
    )
  });

  const stream = new ReadableStream({
    async start(controller) {
      await ytdlp
        .start({
          uuid,
          isDownloadRestart: true,
          downloadStartCallback() {
            controller.enqueue(
              encoder.encode(
                JSON.stringify({
                  success: true,
                  url,
                  status: ytdlp.getIsFormatExist() ? 'already' : 'downloading',
                  timestamp: Date.now()
                })
              )
            );
            try {
              controller?.close?.();
            } catch (e) {}
          },
          downloadErrorCallback(error) {
            try {
              controller.enqueue(
                encoder.encode(
                  JSON.stringify({
                    success: false,
                    url,
                    error: error,
                    timestamp: Date.now()
                  })
                )
              );
              controller?.close?.();
            } catch (e) {}
          },
          processExitCallback() {
            try {
              controller?.close?.();
            } catch (e) {}
          }
        })
        .catch(() => {});
    }
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8'
    }
  });
}
