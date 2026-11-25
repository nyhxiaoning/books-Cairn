export interface PlaybackClock {
  currentTime: number;
  readonly duration: number;
  paused: boolean;
  playbackRate: number;
  volume: number;
  muted: boolean;
  play: () => void;
  pause: () => void;
}

/** A media-like clock for decks whose narration file is unavailable. */
export class VisualClock implements PlaybackClock {
  currentTime = 0;
  paused = true;
  playbackRate = 1;
  volume = 1;
  muted = false;

  private lastNow: number | undefined;
  private ended = false;

  constructor(
    readonly duration: number,
    private readonly onPlayingChange: (playing: boolean) => void,
    private readonly onEnded: () => void,
  ) {}

  play(): void {
    if (this.ended) {
      this.currentTime = 0;
      this.ended = false;
    }
    this.paused = false;
    this.lastNow = undefined;
    this.onPlayingChange(true);
  }

  pause(): void {
    this.paused = true;
    this.lastNow = undefined;
    this.onPlayingChange(false);
  }

  seek(seconds: number): void {
    this.currentTime = Math.min(this.duration, Math.max(0, seconds));
    this.ended = false;
    this.lastNow = undefined;
  }

  advance(now: number): number {
    if (this.paused) return this.currentTime;
    if (this.lastNow === undefined) this.lastNow = now;
    this.currentTime = Math.min(this.duration, this.currentTime + ((now - this.lastNow) / 1000) * this.playbackRate);
    this.lastNow = now;
    if (this.currentTime >= this.duration && !this.ended) {
      this.ended = true;
      this.pause();
      this.onEnded();
    }
    return this.currentTime;
  }
}
