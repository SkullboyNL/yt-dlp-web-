import { useState } from 'react';
import numeral from 'numeral';
import type { VideoInfo } from '@/types/video';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Divider } from '@/components/Divider';
import type { ConvertOptions } from '@/lib/convertOptions';
import { isHwCodec } from '@/lib/convertOptions';

export type VideoInfoDialogProps = {
  open: boolean;
  video: VideoInfo;
  onClose: () => void;
};

type Tab = 'info' | 'convert';

// ─── Conversion state ────────────────────────────────────────────────────────

type ConvertState =
  | { phase: 'idle' }
  | { phase: 'converting' }
  | { phase: 'done'; objectUrl: string; filename: string }
  | { phase: 'error'; message: string };

const DEFAULT_OPTIONS: ConvertOptions = {
  outputFormat: 'mp4',
  videoCodec: 'h264_vaapi',
  audioCodec: 'copy',
  crf: 30,
  preset: 'veryfast',
  audioBitrate: '160k',
  scaleHeight: '',
  audioOnly: false,
  faststart: true,
  noAudio: false,
};

// ─── Size estimator ──────────────────────────────────────────────────────────

// CRF → average bitrate rule of thumb (Mbps) per codec at 1080p
const CRF_BITRATE_TABLE: Record<string, { base: number; crfNeutral: number; crfStep: number }> = {
  libx264:      { base: 4, crfNeutral: 23, crfStep: 0.12 },
  libx265:      { base: 2, crfNeutral: 28, crfStep: 0.12 },
  'libvpx-vp9': { base: 2, crfNeutral: 33, crfStep: 0.10 },
  // Hardware — global_quality behaves similarly to CRF
  h264_vaapi:   { base: 4, crfNeutral: 23, crfStep: 0.12 },
  hevc_vaapi:   { base: 2, crfNeutral: 28, crfStep: 0.12 },
};

const AUDIO_BITRATE_BITS: Record<string, number> = {
  '96k':  96_000,
  '128k': 128_000,
  '160k': 160_000,
  '192k': 192_000,
  '256k': 256_000,
  '320k': 320_000,
};

function estimateOutputBytes(video: VideoInfo, opts: ConvertOptions): number | null {
  // video.duration comes from yt-dlp metadata; video.file.duration from ffprobe — try both
  const rawDuration = video.duration ?? (video.file as any)?.duration;
  const durationSec = rawDuration ? Number(rawDuration) : null;
  const sourceBytes = video.file?.size ?? null;

  // If duration is missing but source size is known:
  // copy streams → source size is the best estimate, otherwise we can't estimate
  if (!durationSec || durationSec <= 0) {
    if (!sourceBytes) return null;
    if (opts.videoCodec === 'copy' && (opts.audioCodec === 'copy' || opts.noAudio)) {
      return Math.round(sourceBytes * 1.01); // +1% container overhead
    }
    return null;
  }

  // ── Video bitrate ─────────────────────────────────────────────────────────
  let videoBitsPerSec = 0;

  if (!opts.audioOnly && opts.videoCodec !== 'none') {
    if (opts.videoCodec === 'copy') {
      if (sourceBytes) {
        const sourceTotalBps = (sourceBytes * 8) / durationSec;
        // Estimate ~85% of total as video (rest = audio + container overhead)
        videoBitsPerSec = sourceTotalBps * 0.85;
      } else {
        return null;
      }
    } else {
      const table = CRF_BITRATE_TABLE[opts.videoCodec];
      if (!table) return null;

      // Resolution scale: pixels vs 1920×1080
      const targetH = opts.scaleHeight ? Number(opts.scaleHeight) : (video.file?.height ?? 1080);
      const sourceW = video.file?.width ?? 1920;
      const sourceH = video.file?.height ?? 1080;
      const targetW = Math.round((sourceW / sourceH) * targetH);
      const pixelRatio = (targetW * targetH) / (1920 * 1080);

      // CRF effect: every 6 points from neutral CRF → factor 2× or 0.5×
      const crfDelta = opts.crf - table.crfNeutral;
      const crfFactor = Math.pow(2, -crfDelta * table.crfStep);

      videoBitsPerSec = table.base * 1_000_000 * pixelRatio * crfFactor;
    }
  }

  // ── Audio bitrate ─────────────────────────────────────────────────────────
  let audioBitsPerSec = 0;

  if (!opts.noAudio && opts.audioCodec !== 'none') {
    if (opts.audioCodec === 'copy') {
      if (sourceBytes) {
        audioBitsPerSec = ((sourceBytes * 8) / durationSec) * 0.15;
      }
    } else if (opts.audioCodec === 'flac') {
      // FLAC is lossless; estimate ~60% of source audio portion
      audioBitsPerSec = sourceBytes ? ((sourceBytes * 8) / durationSec) * 0.15 * 0.6 : 800_000;
    } else {
      audioBitsPerSec = AUDIO_BITRATE_BITS[opts.audioBitrate] ?? 160_000;
    }
  }

  // ── Total ─────────────────────────────────────────────────────────────────
  const totalBits = (videoBitsPerSec + audioBitsPerSec) * durationSec;
  return Math.round((totalBits / 8) * 1.02); // +2% container overhead
}

function formatBytes(bytes: number): string {
  if (bytes >= 1_000_000_000) return `${(bytes / 1_073_741_824).toFixed(1)} GB`;
  if (bytes >= 1_000_000)     return `${(bytes / 1_048_576).toFixed(0)} MB`;
  return `${(bytes / 1024).toFixed(0)} KB`;
}

// ─── Main component ──────────────────────────────────────────────────────────

export function VideoInfoDialog({ open, video, onClose }: VideoInfoDialogProps) {
  const [tab, setTab] = useState<Tab>('info');

  const handleChangeOpen = (isOpen: boolean) => {
    if (!isOpen) onClose();
  };

  return (
    <Dialog open={open} onOpenChange={handleChangeOpen}>
      <DialogContent className='max-w-2xl max-h-[90vh] flex flex-col'>
        <div className='flex-shrink-0 flex gap-x-1 border-b border-foreground/10 pb-2'>
          <TabButton active={tab === 'info'} onClick={() => setTab('info')}>
            Video Info
          </TabButton>
          <TabButton active={tab === 'convert'} onClick={() => setTab('convert')}>
            Convert
          </TabButton>
        </div>

        {tab === 'info' ? (
          <InfoTab video={video} onClose={onClose} />
        ) : (
          <ConvertTab video={video} onClose={onClose} />
        )}
      </DialogContent>
    </Dialog>
  );
}

// ─── Tab button ──────────────────────────────────────────────────────────────

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type='button'
      onClick={onClick}
      className={[
        'px-3 py-1 rounded-md text-sm font-medium transition-colors',
        active
          ? 'bg-primary text-primary-foreground'
          : 'hover:bg-foreground/10 text-foreground/70',
      ].join(' ')}
    >
      {children}
    </button>
  );
}

// ─── Info tab ────────────────────────────────────────────────────────────────

function InfoTab({ video, onClose }: { video: VideoInfo; onClose: () => void }) {
  const durationSeconds = video.file?.duration ? Number(video.file.duration) : null;

  return (
    <>
      <div className='flex-shrink-0 flex gap-3 items-start mt-1'>
        {video.thumbnail && (
          <img
            src={video.thumbnail}
            alt='thumbnail'
            className='w-32 h-20 object-cover rounded-md flex-shrink-0 bg-black'
          />
        )}
        <div className='min-w-0'>
          <div className='font-semibold text-sm break-words line-clamp-3'>
            {video.title || video.url}
          </div>
          {video.url && (
            <a
              href={video.url}
              target='_blank'
              rel='noopener noreferrer'
              className='text-xs text-blue-500 hover:underline break-all line-clamp-1 mt-1'
            >
              {video.url}
            </a>
          )}
        </div>
      </div>

      <Divider />

      <div className='flex-shrink overflow-auto text-sm space-y-1'>
        <Section label='File' />
        <InfoRow label='Status' value={video.status} />
        <InfoRow label='Filename' value={video.file?.name ?? '—'} />
        <InfoRow
          label='File size'
          value={typeof video.file?.size === 'number' ? numeral(video.file.size).format('0.0b') : '—'}
        />
        <InfoRow
          label='Duration'
          value={durationSeconds ? numeral(durationSeconds).format('00:00:00') : '—'}
        />

        {(video.file?.width || video.file?.height || video.file?.codecName) && (
          <>
            <Section label='Video stream' />
            {video.file?.height && video.file?.width && (
              <InfoRow label='Resolution' value={`${video.file.width}×${video.file.height}`} />
            )}
            {video.file?.height && <InfoRow label='Quality' value={`${video.file.height}p`} />}
            {video.file?.rFrameRate && (
              <InfoRow label='Frame rate' value={`${Math.round(video.file.rFrameRate)} fps`} />
            )}
            {video.file?.codecName && <InfoRow label='Video codec' value={video.file.codecName} />}
            {video.file?.colorPrimaries && (
              <InfoRow
                label='Color'
                value={video.file.colorPrimaries === 'bt2020' ? 'HDR (BT.2020)' : video.file.colorPrimaries}
              />
            )}
          </>
        )}

        {video.file?.audioCodecName && (
          <>
            <Section label='Audio stream' />
            <InfoRow label='Audio codec' value={video.file.audioCodecName} />
          </>
        )}

        {video.file?.containerName && (
          <>
            <Section label='Container' />
            <InfoRow label='Format' value={video.file.containerName} />
          </>
        )}

        <Section label='Meta' />
        <InfoRow label='Type' value={video.type ?? '—'} />
        <InfoRow label='Live' value={video.isLive ? 'Yes' : 'No'} />
        {video.description && (
          <div className='mt-2'>
            <div className='opacity-60 text-xs mb-0.5'>Description</div>
            <div className='bg-foreground/5 rounded-md p-2 text-xs whitespace-pre-wrap line-clamp-6'>
              {video.description}
            </div>
          </div>
        )}

        <Section label='Timestamps' />
        <InfoRow
          label='Added'
          value={video.createdAt ? new Date(video.createdAt).toLocaleString() : '—'}
        />
        <InfoRow
          label='Updated'
          value={video.updatedAt ? new Date(video.updatedAt).toLocaleString() : '—'}
        />
      </div>

      <Divider />
      <div className='flex flex-shrink-0 justify-end'>
        <Button type='button' size='sm' onClick={onClose}>
          Close
        </Button>
      </div>
    </>
  );
}

// ─── Convert tab ─────────────────────────────────────────────────────────────

function ConvertTab({ video, onClose }: { video: VideoInfo; onClose: () => void }) {
  const [opts, setOpts] = useState<ConvertOptions>({ ...DEFAULT_OPTIONS });
  const [state, setState] = useState<ConvertState>({ phase: 'idle' });

  const set = <K extends keyof ConvertOptions>(key: K, value: ConvertOptions[K]) =>
    setOpts((prev) => ({ ...prev, [key]: value }));

  const isAudioOnlyFormat = ['mp3', 'aac', 'opus', 'flac'].includes(opts.outputFormat);

  const handleFormatChange = (fmt: ConvertOptions['outputFormat']) => {
    const isAudio = ['mp3', 'aac', 'opus', 'flac'].includes(fmt);
    setOpts((prev) => ({
      ...prev,
      outputFormat: fmt,
      audioOnly: isAudio ? true : prev.audioOnly,
      videoCodec: isAudio ? 'none' : prev.videoCodec === 'none' ? 'libx264' : prev.videoCodec,
    }));
  };

  const handleConvert = async () => {
    setState({ phase: 'converting' });
    try {
      const response = await fetch('/api/convert', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ uuid: video.uuid, options: opts }),
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({ error: response.statusText }));
        setState({ phase: 'error', message: err.error || response.statusText });
        return;
      }

      const disposition = response.headers.get('Content-Disposition') || '';
      const nameMatch = disposition.match(/filename\*?=(?:UTF-8'')?["']?([^;"'\n]+)/i);
      const filename = nameMatch
        ? decodeURIComponent(nameMatch[1].trim())
        : `converted.${opts.outputFormat}`;

      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      setState({ phase: 'done', objectUrl, filename });
    } catch (e: any) {
      setState({ phase: 'error', message: e?.message || String(e) });
    }
  };

  const handleReset = () => {
    if (state.phase === 'done') URL.revokeObjectURL(state.objectUrl);
    setState({ phase: 'idle' });
  };

  const converting = state.phase === 'converting';

  return (
    <>
      <div className='flex-shrink overflow-auto text-sm space-y-4 pr-1'>

        <FieldGroup label='Output format'>
          <div className='flex flex-wrap gap-1.5'>
            {(['mp4', 'mkv', 'webm', 'mov', 'mp3', 'aac', 'opus', 'flac'] as const).map((fmt) => (
              <Chip key={fmt} active={opts.outputFormat === fmt} onClick={() => handleFormatChange(fmt)} disabled={converting}>
                {fmt}
              </Chip>
            ))}
          </div>
        </FieldGroup>

        {!isAudioOnlyFormat && (
          <FieldGroup label='Mode'>
            <div className='flex gap-1.5'>
              <Chip active={!opts.audioOnly} onClick={() => set('audioOnly', false)} disabled={converting}>
                Video + Audio
              </Chip>
              <Chip active={opts.audioOnly} onClick={() => set('audioOnly', true)} disabled={converting}>
                Audio only
              </Chip>
            </div>
          </FieldGroup>
        )}

        {!opts.audioOnly && !isAudioOnlyFormat && (
          <>
            <FieldGroup label='Video codec — Software'>
              <div className='flex flex-wrap gap-1.5'>
                {([
                  ['copy', 'Copy (fast)'],
                  ['libx264', 'H.264'],
                  ['libx265', 'H.265 / HEVC'],
                  ['libvpx-vp9', 'VP9'],
                  ['none', 'No video'],
                ] as [ConvertOptions['videoCodec'], string][]).map(([val, label]) => (
                  <Chip key={val} active={opts.videoCodec === val} onClick={() => set('videoCodec', val)} disabled={converting}>
                    {label}
                  </Chip>
                ))}
              </div>
            </FieldGroup>

            <FieldGroup label='Video codec — Hardware (VAAPI)'>
              <div className='flex flex-wrap gap-1.5 mb-1'>
                {([
                  ['h264_vaapi', 'H.264 VAAPI'],
                  ['hevc_vaapi', 'H.265 VAAPI'],
                ] as [ConvertOptions['videoCodec'], string][]).map(([val, label]) => (
                  <Chip key={val} active={opts.videoCodec === val} onClick={() => set('videoCodec', val)} disabled={converting}>
                    {label}
                  </Chip>
                ))}
              </div>
              <div className='text-xs opacity-40'>
                Requires a GPU with VAAPI support and ffmpeg compiled with VAAPI.
              </div>
            </FieldGroup>

            {opts.videoCodec !== 'copy' && opts.videoCodec !== 'none' && (
              <>
                <FieldGroup label={
                  isHwCodec(opts.videoCodec)
                    ? `Quality (global_quality: ${opts.crf}) — lower = better`
                    : `Quality (CRF: ${opts.crf}) — lower = better`
                }>
                  <input
                    type='range'
                    min={1}
                    max={opts.videoCodec === 'libvpx-vp9' ? 63 : 51}
                    value={opts.crf}
                    onChange={(e) => set('crf', Number(e.target.value))}
                    disabled={converting}
                    className='w-full accent-primary'
                  />
                  <div className='flex justify-between text-xs opacity-50 mt-0.5'>
                    <span>Best quality</span>
                    <span>Smallest file</span>
                  </div>
                </FieldGroup>

                {opts.videoCodec !== 'libvpx-vp9' && !isHwCodec(opts.videoCodec) && (
                  <FieldGroup label='Speed (preset)'>
                    <div className='flex flex-wrap gap-1.5'>
                      {(['ultrafast', 'veryfast', 'faster', 'fast', 'medium', 'slow'] as const).map((p) => (
                        <Chip key={p} active={opts.preset === p} onClick={() => set('preset', p)} disabled={converting}>
                          {p}
                        </Chip>
                      ))}
                    </div>
                  </FieldGroup>
                )}

                <FieldGroup label='Scale (height) — empty = original'>
                  <div className='flex flex-wrap gap-1.5'>
                    {([['', 'Original'], ['360', '360p'], ['480', '480p'], ['720', '720p'], ['1080', '1080p'], ['1440', '1440p'], ['2160', '4K']] as [ConvertOptions['scaleHeight'], string][]).map(([val, label]) => (
                      <Chip key={val} active={opts.scaleHeight === val} onClick={() => set('scaleHeight', val)} disabled={converting}>
                        {label}
                      </Chip>
                    ))}
                  </div>
                </FieldGroup>
              </>
            )}

            {opts.videoCodec !== 'none' && (
              <FieldGroup label='Extra video options'>
                <label className='flex items-center gap-2 cursor-pointer select-none'>
                  <input
                    type='checkbox'
                    checked={opts.noAudio}
                    onChange={(e) => set('noAudio', e.target.checked)}
                    disabled={converting}
                    className='accent-primary'
                  />
                  <span>Remove audio track</span>
                </label>
              </FieldGroup>
            )}
          </>
        )}

        {!opts.noAudio && (
          <>
            <FieldGroup label='Audio codec'>
              <div className='flex flex-wrap gap-1.5'>
                {([
                  ['copy', 'Copy'],
                  ['aac', 'AAC'],
                  ['libopus', 'Opus'],
                  ['libmp3lame', 'MP3'],
                  ['flac', 'FLAC'],
                  ['none', 'No audio'],
                ] as [ConvertOptions['audioCodec'], string][]).map(([val, label]) => {
                  const isDisabled =
                    converting ||
                    (isAudioOnlyFormat && val === 'copy') ||
                    (opts.outputFormat === 'mp3' && val !== 'libmp3lame' && val !== 'none') ||
                    (opts.outputFormat === 'flac' && val !== 'flac' && val !== 'none') ||
                    (opts.outputFormat === 'aac' && val !== 'aac' && val !== 'none') ||
                    (opts.outputFormat === 'opus' && val !== 'libopus' && val !== 'none');
                  return (
                    <Chip key={val} active={opts.audioCodec === val} onClick={() => set('audioCodec', val)} disabled={isDisabled}>
                      {label}
                    </Chip>
                  );
                })}
              </div>
            </FieldGroup>

            {opts.audioCodec !== 'copy' && opts.audioCodec !== 'none' && opts.audioCodec !== 'flac' && (
              <FieldGroup label='Audio bitrate'>
                <div className='flex flex-wrap gap-1.5'>
                  {(['96k', '128k', '160k', '192k', '256k', '320k'] as const).map((b) => (
                    <Chip key={b} active={opts.audioBitrate === b} onClick={() => set('audioBitrate', b)} disabled={converting}>
                      {b}
                    </Chip>
                  ))}
                </div>
              </FieldGroup>
            )}
          </>
        )}

        {['mp4', 'mov'].includes(opts.outputFormat) && !opts.audioOnly && (
          <FieldGroup label='MP4 options'>
            <label className='flex items-center gap-2 cursor-pointer select-none'>
              <input
                type='checkbox'
                checked={opts.faststart}
                onChange={(e) => set('faststart', e.target.checked)}
                disabled={converting}
                className='accent-primary'
              />
              <span>Faststart (better web streaming)</span>
            </label>
          </FieldGroup>
        )}

        {state.phase === 'converting' && (
          <div className='flex items-center gap-3 rounded-lg bg-foreground/5 p-3'>
            <svg className='animate-spin w-5 h-5 text-primary flex-shrink-0' viewBox='0 0 24 24' fill='none'>
              <circle className='opacity-25' cx='12' cy='12' r='10' stroke='currentColor' strokeWidth='4' />
              <path className='opacity-75' fill='currentColor' d='M4 12a8 8 0 018-8v8H4z' />
            </svg>
            <div>
              <div className='font-medium text-sm'>Converting…</div>
              <div className='text-xs opacity-60'>This may take a while depending on file size and settings.</div>
            </div>
          </div>
        )}

        {state.phase === 'error' && (
          <div className='rounded-lg bg-red-500/10 border border-red-500/30 p-3 text-sm text-red-400'>
            <div className='font-medium mb-1'>Conversion failed</div>
            <pre className='whitespace-pre-wrap text-xs opacity-80'>{state.message}</pre>
            <Button type='button' size='sm' variant='outline' className='mt-2' onClick={handleReset}>
              Try again
            </Button>
          </div>
        )}

        {state.phase === 'done' && (
          <div className='rounded-lg bg-green-500/10 border border-green-500/30 p-3 text-sm text-green-400'>
            <div className='font-medium mb-2'>Conversion complete!</div>
            <div className='flex gap-2'>
              <a
                href={state.objectUrl}
                download={state.filename}
                className='inline-flex items-center gap-1.5 rounded-md bg-primary text-primary-foreground px-3 py-1.5 text-xs font-medium hover:bg-primary/90 transition-colors'
              >
                <svg viewBox='0 0 20 20' fill='currentColor' className='w-4 h-4'>
                  <path fillRule='evenodd' d='M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm3.293-7.707a1 1 0 011.414 0L9 10.586V3a1 1 0 112 0v7.586l1.293-1.293a1 1 0 111.414 1.414l-3 3a1 1 0 01-1.414 0l-3-3a1 1 0 010-1.414z' clipRule='evenodd' />
                </svg>
                Download ({state.filename})
              </a>
              <Button type='button' size='sm' variant='outline' onClick={handleReset}>
                Convert again
              </Button>
            </div>
          </div>
        )}
      </div>

      <Divider />

      <SizeEstimate video={video} opts={opts} />

      <div className='flex flex-shrink-0 justify-between items-center gap-x-3'>
        <div className='text-xs opacity-50'>
          {opts.videoCodec === 'copy' && opts.audioCodec === 'copy'
            ? 'Container change only — no re-encoding'
            : opts.videoCodec === 'copy'
            ? 'Video: copy | Audio: re-encode'
            : opts.audioCodec === 'copy'
            ? `Video: re-encode${isHwCodec(opts.videoCodec) ? ' (hardware)' : ''} | Audio: copy`
            : isHwCodec(opts.videoCodec)
            ? 'Video: re-encode (hardware) | Audio: re-encode'
            : 'Video + Audio: re-encode'}
        </div>
        <div className='flex gap-x-2'>
          <Button type='button' variant='outline' size='sm' onClick={onClose} disabled={converting}>
            Close
          </Button>
          {state.phase === 'idle' || state.phase === 'error' ? (
            <Button type='button' size='sm' onClick={handleConvert} disabled={converting}>
              Convert
            </Button>
          ) : state.phase === 'done' ? (
            <Button type='button' size='sm' onClick={handleReset}>
              Convert again
            </Button>
          ) : null}
        </div>
      </div>
    </>
  );
}

// ─── Size estimate bar ────────────────────────────────────────────────────────

function SizeEstimate({ video, opts }: { video: VideoInfo; opts: ConvertOptions }) {
  const estimatedBytes = estimateOutputBytes(video, opts);
  const sourceBytes = video.file?.size ?? null;

  if (!estimatedBytes) {
    const hasDuration = !!(video.duration ?? (video.file as any)?.duration);
    return (
      <div className='flex-shrink-0 rounded-lg bg-foreground/5 px-3 py-2 text-xs opacity-50'>
        {!sourceBytes
          ? 'Estimated size: unknown (source file not found)'
          : !hasDuration
          ? 'Estimated size: unknown (duration unavailable — choose "Copy" for a direct estimate)'
          : 'Estimated size: unknown'}
      </div>
    );
  }

  const ratio = sourceBytes ? estimatedBytes / sourceBytes : null;
  const ratioLabel = ratio !== null
    ? ratio > 1
      ? `+${Math.round((ratio - 1) * 100)}% larger than source`
      : ratio < 1
      ? `${Math.round((1 - ratio) * 100)}% smaller than source`
      : 'same size as source'
    : null;

  const barColor =
    ratio === null ? 'bg-primary'
    : ratio > 1.5  ? 'bg-red-500'
    : ratio > 1.0  ? 'bg-orange-400'
    : ratio > 0.5  ? 'bg-green-500'
    :                'bg-blue-400';

  const barWidth = ratio !== null
    ? `${Math.min(Math.round(ratio * 100), 100)}%`
    : '60%';

  return (
    <div className='flex-shrink-0 rounded-lg bg-foreground/5 px-3 py-2.5 space-y-1.5'>
      <div className='flex items-center justify-between text-xs'>
        <span className='font-medium'>Estimated output size</span>
        <span className='font-bold tabular-nums'>~{formatBytes(estimatedBytes)}</span>
      </div>
      <div className='relative w-full h-1.5 rounded-full bg-foreground/10 overflow-hidden'>
        <div
          className={`h-full rounded-full transition-all duration-300 ${barColor}`}
          style={{ width: barWidth }}
        />
      </div>
      <div className='flex items-center justify-between text-xs opacity-50'>
        <span>Source: {sourceBytes ? formatBytes(sourceBytes) : '—'}</span>
        {ratioLabel && <span>{ratioLabel}</span>}
        <span className='italic'>estimate</span>
      </div>
    </div>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function FieldGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className='text-xs font-semibold uppercase tracking-wide opacity-60 mb-1.5'>{label}</div>
      {children}
    </div>
  );
}

function Chip({
  active, onClick, disabled, children,
}: {
  active: boolean;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type='button'
      onClick={onClick}
      disabled={disabled}
      className={[
        'px-2.5 py-1 rounded-md text-xs font-medium border transition-colors',
        active
          ? 'bg-primary text-primary-foreground border-primary'
          : 'border-foreground/20 hover:border-foreground/40',
        disabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer',
      ].join(' ')}
    >
      {children}
    </button>
  );
}

function Section({ label }: { label: string }) {
  return (
    <div className='font-semibold pt-2 pb-0.5 opacity-70 uppercase text-xs tracking-wide'>
      {label}
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string | number | null | undefined }) {
  return (
    <div className='flex gap-x-2'>
      <span className='opacity-60 shrink-0 w-32'>{label}:</span>
      <span className='font-medium break-all'>{value ?? '—'}</span>
    </div>
  );
}
