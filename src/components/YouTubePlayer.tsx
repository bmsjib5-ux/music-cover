import { useEffect, useRef } from 'react';
import { loadYouTubeApi, YT_STATE, youtubeErrorMessage, type YTPlayer } from '../lib/youtube';

interface Props {
  videoId: string;
  rate: number;
  onEnded: () => void;
  onError: (message: string) => void;
}

export function YouTubePlayer({ videoId, rate, onEnded, onError }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<YTPlayer | null>(null);
  const readyRef = useRef(false);
  const cb = useRef({ onEnded, onError, rate });
  cb.current = { onEnded, onError, rate };
  const firstId = useRef(videoId);

  useEffect(() => {
    let cancelled = false;
    const host = hostRef.current;
    if (!host) return;
    // ให้ YouTube แทนที่ div ที่เราสร้างเอง (ไม่ใช่ div ที่ React ดูแล)
    const mount = document.createElement('div');
    host.appendChild(mount);
    loadYouTubeApi()
      .then((YT) => {
        if (cancelled) return;
        playerRef.current = new YT.Player(mount, {
          videoId: firstId.current,
          width: '100%',
          height: '100%',
          playerVars: { autoplay: 1, playsinline: 1, rel: 0, modestbranding: 1, fs: 1, iv_load_policy: 3 },
          events: {
            onReady: (e) => {
              readyRef.current = true;
              e.target.setPlaybackRate(cb.current.rate);
              e.target.playVideo();
            },
            onStateChange: (e) => {
              if (e.data === YT_STATE.ENDED) cb.current.onEnded();
            },
            onError: (e) => cb.current.onError(youtubeErrorMessage(e.data)),
          },
        });
      })
      .catch((err: Error) => cb.current.onError(err.message));
    return () => {
      cancelled = true;
      readyRef.current = false;
      playerRef.current?.destroy();
      playerRef.current = null;
      host.innerHTML = '';
    };
  }, []);

  useEffect(() => {
    if (readyRef.current && playerRef.current && videoId !== firstId.current) {
      firstId.current = videoId;
      playerRef.current.loadVideoById(videoId);
    }
  }, [videoId]);

  useEffect(() => {
    if (readyRef.current) playerRef.current?.setPlaybackRate(rate);
  }, [rate]);

  return <div ref={hostRef} className="yt-host" />;
}
