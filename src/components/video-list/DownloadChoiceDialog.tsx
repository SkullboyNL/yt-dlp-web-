import type { VideoInfo } from '@/types/video';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Divider } from '@/components/Divider';
import { AiOutlineCloudDownload } from 'react-icons/ai';
import { MdOutlineVideoFile } from 'react-icons/md';

export type DownloadChoiceDialogProps = {
  open: boolean;
  video: VideoInfo;
  onClose: () => void;
  onDeleteConverted: () => void;
};

export function DownloadChoiceDialog({
  open,
  video,
  onClose,
  onDeleteConverted,
}: DownloadChoiceDialogProps) {
  const handleDeleteConverted = async () => {
    await fetch(`/api/converted-file?uuid=${video.uuid}`, { method: 'DELETE' });
    onDeleteConverted();
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className='max-w-sm flex flex-col gap-0'>
        <div className='font-bold text-base mb-1'>Which file do you want to download?</div>
        <div className='text-xs opacity-60 mb-4'>
          A converted file is available. Choose which version you want to download.
        </div>

        <div className='flex flex-col gap-2'>
          <a
            href={`/api/file?uuid=${video.uuid}&download=true`}
            download={video.file?.name ?? true}
            target='_blank'
            rel='noopener noreferrer'
            onClick={onClose}
            className='flex items-center gap-3 rounded-lg border border-foreground/15 px-4 py-3 hover:bg-foreground/5 transition-colors'
          >
            <AiOutlineCloudDownload className='text-2xl shrink-0 opacity-70' />
            <div className='min-w-0'>
              <div className='font-medium text-sm'>Original</div>
              <div className='text-xs opacity-50 truncate'>{video.file?.name ?? '—'}</div>
            </div>
          </a>

          <a
            href={`/api/converted-file?uuid=${video.uuid}`}
            download={video.convertedFile?.name ?? true}
            target='_blank'
            rel='noopener noreferrer'
            onClick={onClose}
            className='flex items-center gap-3 rounded-lg border border-primary/40 bg-primary/5 px-4 py-3 hover:bg-primary/10 transition-colors'
          >
            <MdOutlineVideoFile className='text-2xl shrink-0 text-primary' />
            <div className='min-w-0'>
              <div className='font-medium text-sm text-primary'>Converted</div>
              <div className='text-xs opacity-60 truncate'>{video.convertedFile?.name ?? '—'}</div>
            </div>
          </a>
        </div>

        <Divider className='mt-4' />

        <div className='flex justify-between items-center mt-1'>
          <button
            type='button'
            onClick={handleDeleteConverted}
            className='text-xs text-red-400 hover:text-red-300 transition-colors'
          >
            Delete converted file
          </button>
          <Button type='button' size='sm' variant='outline' onClick={onClose}>
            Cancel
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
