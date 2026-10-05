import { useEffect, useRef } from 'react';
import { loadYouTubeApi, YT_STATE, youtubeErrorMessage, type YTPlayer } from '../lib/youtube';

interface Props {
  videoId: string;
  rate: number;
  onEnded: () => void;
  onError: (message: string) => void;
  /** false = โหลดวิดีโอค้างไว้ ยังไม่เล่น (ค่าเริ่มต้น true) */
  autoplay?: boolean;
  onReady?: (player: YTPlayer) => void;
  onState?: (state: number) => void;
}

export function YouTubePlayer({ videoId, rate, onEnded, onError, autoplay = true, onReady, onState }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<YTPlayer | null>(null);
  const readyRef = useRef(false);
  const cb = useRef({ onEnded, onError, rate, onReady, onState });
  cb.current = { onEnded, onError, rate, onReady, onState };
  const autoplayRef = useRef(autoplay);
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
          playerVars: { autoplay: autoplayRef.current ? 1 : 0, playsinline: 1, rel: 0, modestbranding: 1, fs: 1, iv_load_policy: 3 },
          events: {
            onReady: (e) => {
              readyRef.current = true;
              e.target.setPlaybackRate(cb.current.rate);
              if (autoplayRef.current) e.target.playVideo();
              cb.current.onReady?.(e.target);
            },
            onStateChange: (e) => {
              cb.current.onState?.(e.data);
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
