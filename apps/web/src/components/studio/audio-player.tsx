'use client';

import { Pause, Play } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRef, useState, type CSSProperties } from 'react';
import { formatDuration } from '@/lib/utils';

/** What a signed link points at, without the signature that expires. */
const objectOf = (url: string) => url.split('?')[0];

/**
 * Plays a generated audio overview.
 *
 * Hand-built rather than `<audio controls>` for two reasons the native element
 * cannot be talked out of: it reloads the file whenever `src` changes, and it
 * shows whatever running time it reads out of the file — which for a stream
 * assembled from per-turn clips is not the running time of the whole thing.
 */
export function AudioPlayer({
  url,
  durationSeconds,
}: {
  url: string;
  /** Measured when the overview was generated; null for older artifacts. */
  durationSeconds: number | null;
}) {
  const t = useTranslations('studio');
  const audioRef = useRef<HTMLAudioElement>(null);

  /**
   * Audio links are signed per request, so polling the studio list hands this
   * component a new URL for the same file every few seconds — which is exactly
   * while something else in the notebook is generating. Passing that on as a
   * new `src` makes the browser throw away what it has buffered and start over,
   * heard as playback stopping mid-sentence. The signature is good for an hour,
   * far longer than an overview runs, so the link we started with is kept until
   * it points somewhere else.
   */
  const [src, setSrc] = useState(url);
  if (objectOf(url) !== objectOf(src)) setSrc(url);

  const [playing, setPlaying] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [reportedDuration, setReportedDuration] = useState<number | null>(null);

  /**
   * The stored duration is measured off the file's own frames when it is
   * generated, and it is what the studio list shows. Preferring it here keeps
   * the two in agreement and sidesteps the browser's own reading, which the
   * per-clip headers left in older overviews still get wrong.
   */
  const total = durationSeconds ?? reportedDuration ?? 0;
  const progress = total > 0 ? Math.min(elapsed / total, 1) : 0;

  const toggle = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) void audio.play();
    else audio.pause();
  };

  const seekTo = (fraction: number) => {
    const audio = audioRef.current;
    if (!audio || total <= 0) return;
    audio.currentTime = fraction * total;
    setElapsed(fraction * total);
  };

  return (
    <div className="flex items-center gap-3 rounded-lg border border-border-default bg-surface-sunken px-3 py-2.5">
      <button
        type="button"
        onClick={toggle}
        aria-label={playing ? t('pause') : t('play')}
        className="flex size-9 shrink-0 items-center justify-center rounded-full bg-accent text-accent-foreground transition-colors hover:bg-accent-hover"
      >
        {playing ? (
          <Pause className="size-4" aria-hidden />
        ) : (
          // Nudged right so the triangle looks centred in the circle.
          <Play className="size-4 translate-x-px" aria-hidden />
        )}
      </button>

      <input
        type="range"
        min={0}
        max={1000}
        value={Math.round(progress * 1000)}
        disabled={total <= 0}
        onChange={(event) => seekTo(Number(event.target.value) / 1000)}
        aria-label={t('seek')}
        aria-valuetext={`${formatDuration(elapsed)} / ${formatDuration(total)}`}
        className="scrubber min-w-0 flex-1"
        style={{ '--progress': `${progress * 100}%` } as CSSProperties}
      />

      <span className="shrink-0 text-[12px] tabular-nums text-foreground-muted">
        {formatDuration(elapsed)} / {formatDuration(total)}
      </span>

      {/* eslint-disable-next-line jsx-a11y/media-has-caption -- the full
          transcript is rendered directly below the player. */}
      <audio
        ref={audioRef}
        src={src}
        preload="metadata"
        className="hidden"
        onLoadedMetadata={(event) => {
          const reported = event.currentTarget.duration;
          setReportedDuration(Number.isFinite(reported) ? reported : null);
        }}
        onTimeUpdate={(event) => setElapsed(event.currentTarget.currentTime)}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
      >
        <track kind="captions" />
      </audio>
    </div>
  );
}
