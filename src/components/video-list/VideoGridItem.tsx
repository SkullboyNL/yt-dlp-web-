import { useEffect, useRef, useState } from 'react';
import axios from 'axios';
import useSWR, { mutate } from 'swr';
import numeral from 'numeral';
import { toast } from 'react-toastify';
import { useVideoPlayerStore } from '@/store/videoPlayer';
import { CircleLoader } from '@/components/modules/CircleLoader';
import { PingSvg } from '@/components/modules/PingSvg';
import { isMobile } from '@/client/utils';
import { FcRemoveImage } from 'react-icons/fc';
import { AiOutlineCloudDownload, AiOutlineInfoCircle, AiOutlineFileText } from 'react-icons/ai';
import { VscRefresh, VscWarning } from 'react-icons/vsc';
import { MdOutlineVideocamOff, MdStop } from 'react-icons/md';
import { CgPlayListSearch } from 'react-icons/cg';
import { BsCollectionPlay } from 'react-icons/bs';
import type { VideoInfo } from '@/types/video';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { LinkIcon } from 'lucide-react';
import { Progress } from '@/components/ui/progress';
import { BsCheckCircleFill } from 'react-icons/bs';
import { useVideoListStore } from '@/store/videoList';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu';
import { shallow } from 'zustand/shallow';
import { TbPlaylistX } from 'react-icons/tb';
import { PlaylistViewer } from './PlaylistViewer';
import { DownloadOptionsInfoDialog } from './DownloadOptionsInfoDialog';
import { VideoInfoDialog } from './VideoInfoDialog';
import { DownloadChoiceDialog } from './DownloadChoiceDialog';
import type { UserPlaylists } from '@/types/userPlaylist';


export type VideoGridItemProps = {
  video: VideoInfo;
};

export const VideoGridItem = ({ video }: VideoGridItemProps) => {
  const [isValidating, setValidating] = useState(false);
  const [isMouseEntered, setMouseEntered] = useState(false);
  const [isThumbnailImageError, setThumbnailImageError] = useState(false);
  const [proxyThumbnailUrl, setProxyThumbnailUrl] = useState('');
  const [isProxyThumbnailImageError, setProxyThumbnailImageError] = useState(false);
  const [isNotSupportedCodec, setNotSupportedCodec] = useState(false);
  const [recommendedDownloadRetry, setRecommendedDownloadRetry] = useState(false);
  const [openPlaylistView, setOpenPlaylistView] = useState(false);
  const { isSelectMode, addUuid, deleteUuid } = useVideoListStore(
    ({ isSelectMode, addUuid, deleteUuid }) => ({ isSelectMode, addUuid, deleteUuid }),
    shallow
  );
  const videoRef = useRef<HTMLVideoElement>(null);
  const prevVideoRef = useRef(video);
  const isCompleted = video.status === 'completed';
  const isDownloading = video.status === 'downloading';
  const isStandby = video.status === 'standby';
  const isFailed = video.status === 'failed';
  const isRecording = video.status === 'recording';
  const isAlready = video.status === 'already';
  const [isSelected, setSelected] = useState(false);

  const [openDeleteList, setOpenDeleteList] = useState(false);
  const [openDeleteFile, setOpenDeleteFile] = useState(false);
  const [openUserPlaylists, setOpenUserPlaylists] = useState(false);
  const [newPlaylistName, setNewPlaylistName] = useState('');
  const { data: userPlaylists, mutate: mutateUserPlaylists } = useSWR<UserPlaylists>(
    '/api/playlists',
    async () => axios.get<UserPlaylists>('/api/playlists').then((res) => res.data)
  );

  const handleCloseDeleteList = () => {
    setOpenDeleteList(false);
  };

  const handleChangeDeleteList = (open: boolean) => {
    setOpenDeleteList(open);
  };

  const handleCloseDeleteFile = () => {
    setOpenDeleteFile(false);
  };

  const handleChangeDeleteFile = (open: boolean) => {
    setOpenDeleteFile(open);
  };

  const selectedUserPlaylistIds =
    userPlaylists?.orders.filter((playlistId) =>
      userPlaylists.items[playlistId]?.uuids.includes(video.uuid)
    ) || [];

  const handleSubmitCreateUserPlaylist = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const name = newPlaylistName.trim();
    if (!name) return;

    const result = await axios
      .post('/api/playlists', { name, uuid: video.uuid })
      .then((res) => res.data)
      .catch((res) => res.response?.data);

    if (result?.error) {
      toast.error(result.error || 'Failed to create playlist.');
      return;
    }

    setNewPlaylistName('');
    mutateUserPlaylists(result, false);
  };

  const handleToggleUserPlaylist = (playlistId: string) => async () => {
    const nextPlaylistIds = selectedUserPlaylistIds.includes(playlistId)
      ? selectedUserPlaylistIds.filter((id) => id !== playlistId)
      : [...selectedUserPlaylistIds, playlistId];

    const result = await axios
      .patch('/api/playlists', {
        uuid: video.uuid,
        playlistIds: nextPlaylistIds
      })
      .then((res) => res.data)
      .catch((res) => res.response?.data);

    if (result?.error) {
      toast.error(result.error || 'Failed to update playlist.');
      return;
    }

    mutateUserPlaylists(result, false);
  };

  const handleClickDelete =
    (video: VideoInfo, deleteType: 'deleteFile' | 'deleteList') => async () => {
      const deleteFile = deleteType === 'deleteFile';
      if (deleteFile && !isCompleted) {
        toast.warn(
          video?.isLive
            ? 'Please delete it after stop recording'
            : 'The file cannot be deleted while downloading. Please erase it yourself.'
        );
        return;
      }

      const deleteApiPath = video.type === 'playlist' ? '/api/playlist/file' : '/api/file';

      const result = await axios
        .delete(deleteApiPath, {
          params: {
            uuid: video.uuid,
            deleteFile,
            deleteList: !deleteFile
          }
        })
        .then((res) => res.data)
        .catch((res) => res.response.data);

      if (result.success) {
        if (deleteFile) {
          toast.success('Deleted file. The item remains in the list.');
          handleCloseDeleteFile();
        } else {
          toast.success('Deleted from list. (File will be retained)');
          handleCloseDeleteList();
        }
      } else {
        toast.error(result.error || 'Failed to delete.');
      }

      mutate('/api/list');
    };

  const handleMouseLeave = () => {
    if (!isCompleted) {
      return;
    }
    if (!document.fullscreenElement) {
      setMouseEntered(false);
      const videoEl = videoRef.current;
      if (videoEl) {
        videoEl?.pause?.();
      }
    }
  };

  const handleMouseEnter = async () => {
    if (!isCompleted || video?.type === 'playlist') {
      return;
    }
    if (!video?.file?.duration) {
      return;
    }
    const videoEl = videoRef.current;
    if (videoEl) {
      try {
        if (!isMobile()) {
          await videoEl?.play?.();
        }
        setMouseEntered(true);
      } catch (e) {}
    }
  };

  const handleClickRestartDownload = async () => {
    if (isValidating || !video.uuid) {
      return;
    }
    setValidating(true);
    setRecommendedDownloadRetry(false);

    const result = await axios
      .get('/api/r', {
        params: {
          uuid: video.uuid
        }
      })
      .then((res) => res.data)
      .catch((res) => res.response.data);

    setValidating(false);

    if (!result?.success || result?.error) {
      toast.error(result?.error || 'Retry Failed');
    } else if (result?.success) {
      if (result?.status === 'already') {
        toast.info('Already been downloaded');
      } else if (result?.status === 'downloading') {
        toast.success('Download Retryed');
        mutate('/api/list');
      }
    }
  };

  const handleClickStopRecording = async () => {
    if (isValidating || !video.uuid) {
      return;
    }
    setValidating(true);

    const result = await axios
      .patch('/api/recording', {
        uuid: video.uuid
      })
      .then((res) => res.data)
      .catch((res) => res.response.data);

    if (result?.error) {
      toast.error('Failed stop recording');
    } else if (result?.success) {
      toast.success('Stoped recording');
    }
    setValidating(false);
  };

  const handleImageError = () => {
    setThumbnailImageError(true);
    if (typeof video.thumbnail === 'string' && video.thumbnail.startsWith('http')) {
      setProxyThumbnailUrl(`/api/image?url=${encodeURIComponent(video.thumbnail)}`);
    }
  };
  const handleProxyImageError = () => {
    setProxyThumbnailImageError(true);
  };

  const handleClickVideo = async () => {
    if (!isCompleted) {
      return;
    }
    if (video?.type === 'playlist') {
      setOpenPlaylistView(true);
      return;
    }

    const NOT_SUPPORTED = 'not supported';
    const videoEl = videoRef.current;
    if (videoEl) {
      try {
        if (!isMobile() && video?.file?.duration) {
          try {
            await videoEl?.play?.();
            setNotSupportedCodec(false);
          } catch (e) {
            throw NOT_SUPPORTED;
          }
          if (!videoEl.played) {
            videoEl.pause();
          }
        }
        const openVideo = useVideoPlayerStore.getState().open;
        setMouseEntered(false);
        openVideo({
          title: video.title,
          type: video.type,
          url: video.url,
          uuid: video.uuid,
          size: video?.file?.size
        });
      } catch (e) {
        if (e === NOT_SUPPORTED) {
          setNotSupportedCodec(true);
        }
      }
    }
  };

  const handleClickOpenPlaylistButton = () => {
    setOpenPlaylistView(true);
  };

  const handleClosePlaylistView = () => {
    setOpenPlaylistView(false);
  };

  const handleClickSelectItem = () => {
    const uuid = video?.uuid;
    if (!uuid) {
      return;
    }

    const action = isSelected ? deleteUuid : addUuid;
    action(uuid);
  };

  const [openDownloadOptionsInfo, setOpenDownloadOptionsInfo] = useState(false);

  const handleClickDownloadOptionsInfo = (event: React.MouseEvent<HTMLElement>) => {
    event.stopPropagation();
    setOpenDownloadOptionsInfo(true);
  };

  const handleCloseDownloadOptionsInfo = () => {
    setOpenDownloadOptionsInfo(false);
  };

  const [openVideoInfo, setOpenVideoInfo] = useState(false);

  const handleClickVideoInfo = () => {
    setOpenVideoInfo(true);
  };

  const handleCloseVideoInfo = () => {
    setOpenVideoInfo(false);
  };

  const [openDownloadChoice, setOpenDownloadChoice] = useState(false);

  const handleClickDownload = (e: React.MouseEvent<HTMLAnchorElement>) => {
    if (video.convertedFile) {
      e.preventDefault();
      setOpenDownloadChoice(true);
    }
    // Geen converted file → normale <a> download gaat gewoon door
  };

  useEffect(() => {
    if (video?.uuid) {
      const { selectedUuids } = useVideoListStore.getState();
      const newIsSelected = selectedUuids.has(video.uuid);
      setSelected(newIsSelected);
    }
    const unsubscribe = useVideoListStore.subscribe((state) => {
      if (video?.uuid) {
        const newIsSelected = state.selectedUuids.has(video.uuid);
        setSelected(newIsSelected);
      }
    });
    return () => {
      unsubscribe();
    };
  }, [video]);

  useEffect(() => {
    if (
      video.status === 'completed' ||
      video.download.progress === '1' ||
      video.updatedAt !== prevVideoRef.current.updatedAt
    ) {
      setRecommendedDownloadRetry(false);
      return () => {
        prevVideoRef.current = video;
      };
    }

    const initialUpdatedAt = prevVideoRef?.current?.updatedAt;
    const initialProgress = prevVideoRef?.current?.download?.progress;
    const timeout = setTimeout(() => {
      const nextProgress = prevVideoRef?.current?.download?.progress;
      const nextUpdatedAt = prevVideoRef.current.updatedAt;

      if (initialProgress === nextProgress && initialUpdatedAt === nextUpdatedAt) {
        setRecommendedDownloadRetry(true);
      }
    }, 10000);

    return () => {
      prevVideoRef.current = video;
      clearTimeout(timeout);
    };
  }, [video]);

  return (
    <div className={cn(isSelectMode && 'select-none')}>
      <Card className='relative bg-background flex flex-col rounded-xl overflow-hidden border-none'>
        <div
          className={cn(
            'relative flex items-center shrink-0 grow-0 min-w-[100px] max-h-[250px] overflow-hidden aspect-video',
            isCompleted && 'cursor-pointer'
          )}
          onClick={handleClickVideo}
          onMouseLeave={handleMouseLeave}
          onMouseEnter={handleMouseEnter}
        >
          <div
            className={cn(
              'w-full h-full place-items-center bg-black',
              isMouseEntered ? 'flex' : 'hidden'
            )}
          >
            {isCompleted && (
              <video
                key={video.status || 'completed'}
                ref={videoRef}
                className='w-full h-full outline-none'
                src={`/api/file?uuid=${video.uuid}`}
                muted
                playsInline
                loop
                preload='none'
              />
            )}
          </div>
          <div
            className={cn('w-full h-full', isMouseEntered ? 'hidden' : 'block')}
            onClick={handleMouseEnter}
          >
            <figure className='relative w-full h-full bg-black'>
              {video.thumbnail && !isThumbnailImageError ? (
                <img
                  className='w-full h-full object-contain'
                  src={video.thumbnail}
                  alt='thumbnail'
                  onError={handleImageError}
                  loading='lazy'
                />
              ) : video.thumbnail &&
                isThumbnailImageError &&
                proxyThumbnailUrl &&
                !isProxyThumbnailImageError ? (
                <img
                  className='w-full h-full object-contain'
                  src={proxyThumbnailUrl}
                  alt='thumbnail'
                  onError={handleProxyImageError}
                  loading='lazy'
                />
              ) : (
                <div className='w-full h-full min-h-[100px] flex items-center justify-center text-4xl bg-base-content/5 select-none '>
                  <FcRemoveImage />
                </div>
              )}
              {isNotSupportedCodec && (
                <div
                  className='absolute flex top-0 left-0 items-center text-center w-full h-full overflow-hidden cursor-auto'
                  onClick={(event) => event.stopPropagation()}
                >
                  <div className='w-full bg-black/70 text-white text-sm md:text-base py-2'>
                    The file does not exist or cannot be played.
                  </div>
                </div>
              )}
            </figure>
            {!isCompleted && (
              <div className='absolute top-0 left-0 w-full h-full flex flex-col p-3 gap-y-2 items-center justify-center bg-black/80 text-2xl text-white break-words dark:text-base-content'>
                {isStandby || isFailed || isAlready ? (
                  <span
                    className={cn(
                      'font-bold capitalize',
                      isFailed && 'text-error-foreground',
                      isAlready && 'text-warning-foreground'
                    )}
                  >
                    {video.status}
                  </span>
                ) : recommendedDownloadRetry ? (
                  <VscWarning className='text-3xl text-yellow-500' />
                ) : (
                  <CircleLoader className='text-xl' />
                )}
                {video.createdAt !== video.updatedAt && (
                  <div className='text-xs text-center'>
                    {'Running time ≈'}
                    {numeral((video.updatedAt - video.createdAt) / 1000).format('00:00:00')}
                  </div>
                )}
                {video.download.playlist && (
                  <div className='text-xs text-center'>
                    {video.download.playlist?.current}/{video.download.playlist?.count}
                  </div>
                )}
                <div
                  className={cn(
                    'text-sm text-center animate-pulse',
                    isFailed && 'overflow-y-auto',
                    video.cutVideo && video.download.ffmpeg && 'whitespace-pre-wrap'
                  )}
                >
                  {isAlready
                    ? `That filename already exists. Please rename the output filename and try again.`
                    : isFailed && video.error
                    ? video.error
                    : recommendedDownloadRetry
                    ? "The download doesn't seem to work. Try again with the refresh button below."
                    : video.status === 'downloading' && video.cutVideo && video.download.ffmpeg
                    ? `${video.download.ffmpeg.time} downloaded...
encode speed ${video.download.ffmpeg.speed}`
                    : `${video.status}...`}
                </div>
              </div>
            )}
          </div>
          {isCompleted && video?.type === 'playlist' && (
            <div className='absolute top-1.5 left-1.5 text-xs text-white bg-black/80 py-0.5 px-1.5 rounded-md'>
              Playlist {video.download.playlist?.count && `(${video.download.playlist?.count})`}
            </div>
          )}
          {video?.type === 'video' && (
            <div className='absolute top-1 right-1'>
              <Button
                variant='ghost'
                size='icon'
                className='w-[1.75em] h-[1.75em] bg-black/20 text-white text-sm rounded-full sm:text-base'
                onClick={handleClickDownloadOptionsInfo}
              >
                <AiOutlineInfoCircle />
              </Button>
            </div>
          )}
          {!isMouseEntered && typeof video.file.height === 'number' && video.file.height > 0 && (
            <div className='absolute left-1.5 top-1.5 text-xs text-white bg-black/80 py-0.5 px-1.5 rounded-md'>
              {video.file.height}p
              {typeof video.file.rFrameRate === 'number' && video.file.rFrameRate > 0
                ? Math.round(video.file.rFrameRate)
                : ''}
              {video.file.codecName ? ' ' + video.file.codecName : ''}
              {video.file.colorPrimaries === 'bt2020' ? ' HDR' : ''}
            </div>
          )}
          {!isMouseEntered && typeof video.file.size === 'number' && (
            <div className='absolute left-1.5 bottom-1.5 text-xs text-white bg-black/80 py-0.5 px-1.5 rounded-md'>
              {numeral(video.file.size).format('0.0b')}
            </div>
          )}
          {!isMouseEntered && video.file.duration && (
            <div className='absolute right-1.5 bottom-1.5 text-xs text-white bg-black/80 py-0.5 px-1.5 rounded-md'>
              {numeral(video.file.duration).format('00:00:00')}
            </div>
          )}
        </div>
        <div className='grow-0 shrink p-2 overflow-hidden'>
          <h2
            className='line-clamp-2 text-base font-bold min-h-[3rem] mb-2 break-all'
            title={video.title || undefined}
          >
            {video.isLive && isRecording && (
              <div className='inline-flex items-center align-text-top text-xl text-error-foreground'>
                <PingSvg />
              </div>
            )}
            <span className={(isStandby || isFailed) && !video.title ? 'text-xs font-normal' : ''}>
              {video.title || video.url}
            </span>
          </h2>
          <div className='flex items-center justify-between px-1 select-none'>
            <div className={cn(!(isStandby || isFailed || !isCompleted) && 'border-join')}>
              {!(isStandby || isFailed || !isCompleted) && (
                <DropdownMenu open={openDeleteFile} onOpenChange={handleChangeDeleteFile}>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant='outline'
                      size='sm'
                      borderCurrentColor
                      className='h-[1.7em] text-lg text-error-foreground hover:text-error-foreground/90'
                      title='Delete file'
                    >
                      <MdOutlineVideocamOff />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align='start' className='max-w-xs'>
                    <DropdownMenuLabel className='text-md'>Remove file from storage</DropdownMenuLabel>
                    <DropdownMenuLabel className='flex items-center justify-end gap-x-2'>
                      <Button
                        variant='outline'
                        size='sm'
                        className='grow'
                        onClick={handleCloseDeleteFile}
                      >
                        Cancel
                      </Button>
                      <Button
                        size='sm'
                        className='grow bg-error hover:bg-error/90 text-foreground'
                        onClick={handleClickDelete(video, 'deleteFile')}
                      >
                        Remove
                      </Button>
                    </DropdownMenuLabel>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
              <DropdownMenu open={openDeleteList} onOpenChange={handleChangeDeleteList}>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant='outline'
                    size='sm'
                    borderCurrentColor
                    className={cn(
                      'h-[1.7em] text-lg text-warning-foreground hover:text-warning-foreground/90',
                      (isStandby || isFailed || !isCompleted) && 'rounded-xl'
                    )}
                    title='Delete from List'
                  >
                    <TbPlaylistX />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align='start' className='max-w-xs'>
                  <DropdownMenuLabel className='text-md'>Remove from list</DropdownMenuLabel>
                  <DropdownMenuLabel className='flex items-center justify-end gap-x-2'>
                    <Button
                      variant='outline'
                      size='sm'
                      className='grow'
                      onClick={handleCloseDeleteList}
                    >
                      Cancel
                    </Button>
                    <Button
                      size='sm'
                      className='grow bg-warning hover:bg-warning/90'
                      onClick={handleClickDelete(video, 'deleteList')}
                    >
                      Remove
                    </Button>
                  </DropdownMenuLabel>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
            {video.isLive && isRecording && (
              <Button
                variant='outline'
                borderCurrentColor
                size='icon'
                className='w-[1.7em] h-[1.7em] rounded-full text-error-foreground hover:text-error-foreground/90 text-lg'
                onClick={handleClickStopRecording}
                title='Stop Recording'
              >
                <MdStop />
              </Button>
            )}
            <div className='flex items-center'>
              <Button
                size='sm'
                className='h-[1.7em] text-lg rounded-xl rounded-r-none bg-info hover:bg-info/90 border-l border-info-foreground/20'
                onClick={handleClickVideoInfo}
                title='Video Info'
              >
                <AiOutlineFileText />
              </Button>
              {isCompleted ? (
                video.type === 'playlist' ? (
                  <Button
                    size='sm'
                    className='h-[1.7em] text-lg rounded-none'
                    disabled={isValidating}
                    onClick={handleClickOpenPlaylistButton}
                  >
                    <CgPlayListSearch />
                  </Button>
                ) : (
				
                  <Button size='sm' className='relative p-0 h-[1.7em] text-lg rounded-xl rounded-l-none'>
                    <a
                      className='flex items-center w-full h-full px-3'
                      href={isCompleted ? `/api/file?uuid=${video.uuid}&download=true` : ''}
                      rel='noopener noreferrer'
                      target='_blank'
                      download={video?.status === 'completed' ? video.file.name : false}
                      title='Download Video'
                      onClick={handleClickDownload}
                    >
                      <AiOutlineCloudDownload />
                      {video.convertedFile && (
                        <span className='absolute -top-1 -right-1 w-2 h-2 rounded-full bg-primary' />
                      )}
                    </a>
                  </Button>
                )
              ) : (
                <div className={cn(recommendedDownloadRetry && 'animate-pulse')}>
                  <Button
                    size='sm'
                    className={'h-[1.7em] text-lg rounded-none'}
                    disabled={isValidating || video?.isLive}
                    onClick={handleClickRestartDownload}
                    title={video?.isLive ? '' : 'Retry Download'}
                  >
                    {video?.isLive ? (
                      <AiOutlineCloudDownload />
                    ) : (
                      <VscRefresh className={cn(isValidating && 'animate-spin')} />
                    )}
                  </Button>
                </div>
              )}
              <DropdownMenu open={openUserPlaylists} onOpenChange={setOpenUserPlaylists}>
                <DropdownMenuTrigger asChild>
                  <Button
                    size='sm'
                    className='h-[1.7em] rounded-xl rounded-l-none bg-warning text-black hover:bg-warning/90 hover:text-black text-lg'
                    title='Add to playlists'
                  >
                    <BsCollectionPlay />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align='end' className='w-72'>
                  <DropdownMenuLabel className='space-y-3'>
                    <div className='font-semibold'>Playlists</div>
                    <form className='flex gap-x-2' onSubmit={handleSubmitCreateUserPlaylist}>
                      <Input
                        className='h-8'
                        value={newPlaylistName}
                        placeholder='New playlist'
                        onChange={(event) => setNewPlaylistName(event.target.value)}
                      />
                      <Button type='submit' size='sm' className='h-8'>
                        Add
                      </Button>
                    </form>
                    <div className='max-h-64 space-y-1 overflow-auto'>
                      {userPlaylists?.orders.length ? (
                        userPlaylists.orders.map((playlistId) => {
                          const playlist = userPlaylists.items[playlistId];
                          if (!playlist) return null;
                          const checked = selectedUserPlaylistIds.includes(playlistId);
                          return (
                            <Label
                              key={playlistId}
                              className='flex cursor-pointer items-center gap-x-2 rounded-md px-2 py-1.5 hover:bg-accent'
                            >
                              <Checkbox checked={checked} onClick={handleToggleUserPlaylist(playlistId)} />
                              <span className='min-w-0 flex-1 truncate'>{playlist.name}</span>
                              <span className='text-xs text-muted-foreground'>
                                {playlist.uuids.length}
                              </span>
                            </Label>
                          );
                        })
                      ) : (
                        <div className='py-2 text-sm text-muted-foreground'>No playlists yet.</div>
                      )}
                    </div>
                  </DropdownMenuLabel>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </div>
        {isStandby ? (
          <div className='h-1 bg-zinc-500/50' />
        ) : isRecording ? (
          <div className='h-1 gradient-background' />
        ) : isDownloading ? (
          <Progress
            className='w-full h-1'
            value={Number(numeral(video.download.progress).format('0.00') || 0) * 100}
            title={video.download.progress ? `${Number(video.download.progress) * 100}%` : ''}
          />
        ) : (
          <div className='h-1'></div>
        )}
        {isSelectMode && (
          <div
            className={cn(
              'absolute top-0 left-0 w-full h-full flex items-center justify-center rounded-xl overflow-hidden border-4 isolate will-change-transform cursor-pointer',
              isSelected && 'border-primary'
            )}
            onClick={handleClickSelectItem}
          >
            <BsCheckCircleFill
              className={cn(
                'absolute top-2 right-2 text-2xl',
                isSelected ? 'text-primary' : 'opacity-30'
              )}
            />
          </div>
        )}
      </Card>
      {openPlaylistView && video.type === 'playlist' && video.playlist && video.playlist.length && (
        <PlaylistViewer open={openPlaylistView} video={video} onClose={handleClosePlaylistView} />
      )}
      {openDownloadOptionsInfo && video.type === 'video' && (
        <DownloadOptionsInfoDialog
          open={openDownloadOptionsInfo}
          video={video}
          onClose={handleCloseDownloadOptionsInfo}
        />
      )}
      {openVideoInfo && (
        <VideoInfoDialog
          open={openVideoInfo}
          video={video}
          onClose={handleCloseVideoInfo}
        />
      )}
      {openDownloadChoice && (
        <DownloadChoiceDialog
          open={openDownloadChoice}
          video={video}
          onClose={() => setOpenDownloadChoice(false)}
          onDeleteConverted={() => mutate('/api/list')}
        />
      )}
    </div>
  );
};

VideoGridItem.displayName = 'VideoGridItem';
