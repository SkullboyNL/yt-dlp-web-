import { useState } from 'react';
import axios from 'axios';
import { mutate } from 'swr';
import { toast } from 'react-toastify';
import type { SelectQuality, VideoInfo } from '@/types/video';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Divider } from '@/components/Divider';
import { initialDownloadFormState, useDownloadFormStore } from '@/store/downloadForm';
import { isDevelopment, jsonStringifyPrettier, qualityToYtDlpCmdOptions } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select';
import {
  appendOutputFilenameExtension,
  OutputFilenameEditorField,
  stripOutputFilenameExtension
} from '@/components/OutputFilenameEditor';

export type DownloadOptionsInfoDialogProps = {
  open: boolean;
  video: VideoInfo;
  onClose: () => void;
};

export function DownloadOptionsInfoDialog({
  open,
  video,
  onClose
}: DownloadOptionsInfoDialogProps) {
  const isEditable = video.status === 'failed';
  const [isRetrying, setRetrying] = useState(false);
  const [selectQuality, setSelectQuality] = useState(
    video.selectQuality || (video.format === 'ba' ? 'audio' : initialDownloadFormState.selectQuality)
  );
  const [outputFilename, setOutputFilename] = useState(
    stripOutputFilenameExtension(
      video.outputFilename || appendOutputFilenameExtension(initialDownloadFormState.outputFilename)
    )
  );
  const [filenameLengthLimit, setFilenameLengthLimit] = useState(
    String(initialDownloadFormState.filenameLengthLimit)
  );
  const [usingCookies, setUsingCookies] = useState(video.usingCookies);
  const [embedThumbnail, setEmbedThumbnail] = useState(true);
  const [embedChapters, setEmbedChapters] = useState(true);
  const [embedMetadata, setEmbedMetadata] = useState(true);
  const [embedVideoThumbnail, setEmbedVideoThumbnail] = useState(video.embedVideoThumbnail);
  const [enableLiveFromStart, setEnableLiveFromStart] = useState(video.enableLiveFromStart);
  const [cutVideo, setCutVideo] = useState(video.cutVideo);
  const [cutStartTime, setCutStartTime] = useState(video.cutStartTime || '');
  const [cutEndTime, setCutEndTime] = useState(video.cutEndTime || '');
  const [enableForceKeyFramesAtCuts, setEnableForceKeyFramesAtCuts] = useState(
    video.enableForceKeyFramesAtCuts
  );
  const [enableProxy, setEnableProxy] = useState(video.enableProxy);
  const [proxyAddress, setProxyAddress] = useState(video.proxyAddress || '');

  const handleChangeOpen = (open: boolean) => {
    if (!open) {
      onClose();
    }
  };

  const handleClickApplyOptionsToDownloadFormStore = () => {
    useDownloadFormStore.getState().loadDownloadedOptions(video);
    onClose();
  };

  const handleClickRetryWithOptions = async () => {
    if (isRetrying) return;
    setRetrying(true);

    const result = await axios
      .get('/api/r', {
        params: {
          uuid: video.uuid,
          selectQuality,
          outputFilename: appendOutputFilenameExtension(outputFilename),
          filenameLengthLimit,
          usingCookies,
          embedThumbnail,
          embedChapters,
          embedMetadata,
          embedVideoThumbnail,
          enableLiveFromStart,
          cutVideo,
          cutStartTime,
          cutEndTime,
          enableForceKeyFramesAtCuts,
          enableProxy,
          proxyAddress
        }
      })
      .then((res) => res.data)
      .catch((res) => res.response?.data || { error: 'Retry Failed' });

    setRetrying(false);

    if (!result?.success || result?.error) {
      toast.error(result?.error || 'Retry Failed');
      return;
    }

    toast.success(result?.status === 'already' ? 'Already been downloaded' : 'Download Retryed');
    mutate('/api/list');
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={handleChangeOpen}>
      <DialogContent className='max-w-3xl max-h-full flex flex-col'>
        <div className='flex-shrink-0'>
          <div className='font-bold text-lg'>Options used when downloading</div>
        </div>
        <Divider></Divider>
        <div className='flex-shrink overflow-auto text-sm'>
          <div className='break-all'>
            Url: <b>{video?.url ?? ''}</b>
          </div>
          <div>
            Download format:{' '}
            {video?.format === 'bv+ba/b' ? (
              <span className='opacity-60'>No formatting options were selected.</span>
            ) : (
              <b>{video?.format}</b>
            )}
          </div>
          <div>
            Up to quality:{' '}
            {video?.selectQuality ? (
              <span>
                <b>{video.selectQuality}</b> -&gt;{' '}
                <code className='bg-foreground/10 px-1 py-0.5'>
                  {qualityToYtDlpCmdOptions(video.selectQuality)?.join?.(' ') || ''}
                </code>
              </span>
            ) : video?.format === 'bv+ba/b' ? (
              <b>{initialDownloadFormState.selectQuality}</b>
            ) : (
              <span className='opacity-60'>You downloaded it by selecting the format option.</span>
            )}
          </div>
          <div>
            Using Cookies: <b>{video.usingCookies ? 'Yes' : 'No'}</b>
          </div>
          <div>
            Output filename:{' '}
            <b>{video.outputFilename ?? initialDownloadFormState.outputFilename}</b>
          </div>
          <div>
            Filename trim length: <b>{video.filenameLengthLimit || 0}</b> characters
          </div>
          <div>
            Cut Video: <b>{video.cutVideo ? 'Yes' : 'No'}</b>
          </div>
          <div>
            Cut start time:{' '}
            {video.cutStartTime ? (
              <b>{video.cutStartTime}</b>
            ) : (
              <span className='opacity-60'>Start</span>
            )}
          </div>
          <div>
            Cut end time:{' '}
            {video.cutEndTime ? <b>{video.cutEndTime}</b> : <span className='opacity-60'>End</span>}
          </div>
          <div>
            Force key frames at cuts: <b>{video.enableForceKeyFramesAtCuts ? 'Yes' : 'No'}</b>
          </div>
          <div>
            Embed subtitles:{' '}
            <b>{video.embedSubs ? `${video.subLangs?.join?.(', ') || 'Yes'}` : 'No'}</b>
          </div>
          <div>
            Embed thumbnail: <b>{video.embedThumbnail ? 'Yes' : 'No'}</b>
          </div>
          <div>
            Embed chapter markers: <b>{video.embedChapters ? 'Yes' : 'No'}</b>
          </div>
          <div>
            Embed metadata: <b>{video.embedMetadata ? 'Yes' : 'No'}</b>
          </div>
          <div>
            Set the thumbnail as the 1st frame (slow):{' '}
            <b>{video.embedVideoThumbnail ? 'Yes' : 'No'}</b>
          </div>
          <div>
            Download livestreams from the start: <b>{video.enableLiveFromStart ? 'Yes' : 'No'}</b>
          </div>
          <div>
            Enable Proxy: <b>{video.enableProxy ? 'Yes' : 'No'}</b>
          </div>
          <div>
            Proxy Address:{' '}
            {video.proxyAddress ? (
              <b>{video.proxyAddress}</b>
            ) : (
              <span className='opacity-60'>Not set</span>
            )}
          </div>
          <div className='opacity-60 mt-2'>
            The cookie is used as the value currently stored on the server.
          </div>
          {isEditable && (
            <div className='mt-4 space-y-4 rounded-lg border bg-background/60 p-4'>
              <div>
                <div className='font-semibold'>Edit options before retry</div>
                <div className='text-xs text-muted-foreground'>
                  These settings will be used only for this retry.
                </div>
              </div>
              <div className='space-y-3'>
                <div className='text-xs font-semibold uppercase tracking-wide text-muted-foreground'>
                  Download
                </div>
                <div className='grid gap-3 sm:grid-cols-[180px_1fr_150px]'>
                  <Label className='flex flex-col gap-y-1'>
                    <span>Quality</span>
                    <Select
                      value={selectQuality}
                      onValueChange={(value) => setSelectQuality(value as SelectQuality)}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder='Select a quality' />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
                          <SelectLabel>Quality</SelectLabel>
                          <SelectItem value='best'>Best</SelectItem>
                          <SelectItem value='4320p'>4320p</SelectItem>
                          <SelectItem value='2160p'>2160p</SelectItem>
                          <SelectItem value='1440p'>1440p</SelectItem>
                          <SelectItem value='1080p'>1080p</SelectItem>
                          <SelectItem value='720p'>720p</SelectItem>
                          <SelectItem value='480p'>480p</SelectItem>
                          <SelectItem value='audio'>Audio</SelectItem>
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                  </Label>
                  <div className='flex min-w-0 flex-col gap-y-1'>
                    <span>Output filename</span>
                    <OutputFilenameEditorField
                      value={outputFilename}
                      onChange={setOutputFilename}
                      className='basis-auto'
                    />
                  </div>
                  <Label className='flex flex-col gap-y-1'>
                    <span>Trim length</span>
                    <Input
                      type='number'
                      min={0}
                      max={255}
                      step={1}
                      value={filenameLengthLimit}
                      placeholder='80'
                      onChange={(event) => setFilenameLengthLimit(event.target.value)}
                    />
                    <span className='text-xs text-muted-foreground'>Characters, excluding ext.</span>
                  </Label>
                </div>
              </div>
              <div className='space-y-3'>
                <div className='text-xs font-semibold uppercase tracking-wide text-muted-foreground'>
                  Embeds
                </div>
                <div className='grid gap-2 sm:grid-cols-2'>
                  <Label className='flex items-center gap-x-2 rounded-md border bg-background/40 px-3 py-2'>
                    <Checkbox
                      checked={embedThumbnail}
                      onClick={() => setEmbedThumbnail(!embedThumbnail)}
                    />
                    <span>Embed thumbnail</span>
                  </Label>
                  <Label className='flex items-center gap-x-2 rounded-md border bg-background/40 px-3 py-2'>
                    <Checkbox
                      checked={embedChapters}
                      onClick={() => setEmbedChapters(!embedChapters)}
                    />
                    <span>Embed chapter markers</span>
                  </Label>
                  <Label className='flex items-center gap-x-2 rounded-md border bg-background/40 px-3 py-2'>
                    <Checkbox
                      checked={embedMetadata}
                      onClick={() => setEmbedMetadata(!embedMetadata)}
                    />
                    <span>Embed metadata</span>
                  </Label>
                  <Label className='flex items-center gap-x-2 rounded-md border bg-background/40 px-3 py-2'>
                    <Checkbox
                      checked={embedVideoThumbnail}
                      onClick={() => setEmbedVideoThumbnail(!embedVideoThumbnail)}
                    />
                    <span>Set thumbnail as 1st frame</span>
                  </Label>
                </div>
              </div>
              <div className='space-y-3'>
                <div className='text-xs font-semibold uppercase tracking-wide text-muted-foreground'>
                  Advanced
                </div>
                <div className='grid gap-3 sm:grid-cols-2'>
                  <Label className='flex items-center gap-x-2'>
                    <Checkbox
                      checked={usingCookies}
                      onClick={() => setUsingCookies(!usingCookies)}
                    />
                    <span>Using Cookies</span>
                  </Label>
                  <Label className='flex items-center gap-x-2'>
                    <Checkbox
                      checked={enableLiveFromStart}
                      onClick={() => setEnableLiveFromStart(!enableLiveFromStart)}
                    />
                    <span>Download livestreams from start</span>
                  </Label>
                  <Label className='flex items-center gap-x-2'>
                    <Checkbox checked={cutVideo} onClick={() => setCutVideo(!cutVideo)} />
                    <span>Cut video</span>
                  </Label>
                  <Label className='flex items-center gap-x-2'>
                    <Checkbox
                      checked={enableForceKeyFramesAtCuts}
                      onClick={() => setEnableForceKeyFramesAtCuts(!enableForceKeyFramesAtCuts)}
                    />
                    <span>Force key frames at cuts</span>
                  </Label>
                  <Label className='flex flex-col gap-y-1'>
                    <span>Cut start time</span>
                    <Input
                      value={cutStartTime}
                      placeholder='00:00:00.00'
                      disabled={!cutVideo}
                      onChange={(event) => setCutStartTime(event.target.value)}
                    />
                  </Label>
                  <Label className='flex flex-col gap-y-1'>
                    <span>Cut end time</span>
                    <Input
                      value={cutEndTime}
                      placeholder='00:00:00.00'
                      disabled={!cutVideo}
                      onChange={(event) => setCutEndTime(event.target.value)}
                    />
                  </Label>
                  <Label className='flex items-center gap-x-2'>
                    <Checkbox checked={enableProxy} onClick={() => setEnableProxy(!enableProxy)} />
                    <span>Enable Proxy</span>
                  </Label>
                  <Label className='flex flex-col gap-y-1'>
                    <span>Proxy Address</span>
                    <Input
                      value={proxyAddress}
                      placeholder='Proxy Address HTTP/HTTPS/SOCKS'
                      disabled={!enableProxy}
                      onChange={(event) => setProxyAddress(event.target.value)}
                    />
                  </Label>
                </div>
              </div>
            </div>
          )}
          {isDevelopment && (
            <div className='bg-black/80 text-white font-mono'>
              Only visible in development mode.
              <pre className='whitespace-break-spaces'>{jsonStringifyPrettier(video)}</pre>
            </div>
          )}
        </div>
        <Divider />
        <div className='flex flex-shrink-0 justify-end items-center gap-x-3'>
          {isEditable ? (
            <Button type='button' size='sm' disabled={isRetrying} onClick={handleClickRetryWithOptions}>
              Retry with options
            </Button>
          ) : (
            <Button
              type='button'
              variant='outline'
              size='sm'
              onClick={handleClickApplyOptionsToDownloadFormStore}
            >
              Use these options
            </Button>
          )}
          <Button type='button' size='sm' onClick={onClose}>
            Close
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
