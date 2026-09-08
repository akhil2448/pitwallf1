import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';

import { PlaybackFrame } from '../models/playback-frame.model';

@Injectable({
  providedIn: 'root',
})
export class LapPlaybackService {
  /**
   * Complete telemetry for the lap.
   */
  private driverATelemetry: any[] = [];
  private driverBTelemetry: any[] = [];

  /**
   * Current lap progress (0 -> 1).
   * This is the single source of truth.
   */
  private currentProgressSubject = new BehaviorSubject<number>(0);

  readonly currentProgress$: Observable<number> =
    this.currentProgressSubject.asObservable();

  /**
   * Current playback frame.
   */
  private currentFrameSubject = new BehaviorSubject<PlaybackFrame | null>(null);

  readonly currentFrame$: Observable<PlaybackFrame | null> =
    this.currentFrameSubject.asObservable();

  /**
   * Playback state.
   */
  private playingSubject = new BehaviorSubject<boolean>(false);

  readonly playing$ = this.playingSubject.asObservable();

  /**
   * requestAnimationFrame id.
   */
  private animationFrameId: number | null = null;

  /**
   * Timestamp of previous animation frame.
   */
  private previousTimestamp = 0;

  /**
   * Playback rate.
   * 1 = realtime
   * 0.5 = half speed
   * 2 = double speed
   */
  private playbackRateValue = 1;

  /**
   * Reference playback duration (seconds).
   *
   * This controls how long the comparison takes to play.
   * It is independent of any individual driver's lap time.
   */
  private referenceLapTimeSeconds = 0;

  /**
   * Load telemetry.
   */
  loadLap(
    driverATelemetry: any[],
    driverBTelemetry: any[] | null,
    referenceLapTimeSeconds: number,
  ): void {
    this.pause();

    this.driverATelemetry = driverATelemetry ?? [];
    this.driverBTelemetry = driverBTelemetry ?? [];
    this.referenceLapTimeSeconds = referenceLapTimeSeconds;

    if (this.driverATelemetry.length > 0) {
      const last = this.driverATelemetry[this.driverATelemetry.length - 1];

      // console.log({
      //   referenceLapTime: this.referenceLapTimeSeconds,
      //   telemetryLastTime: last.t,
      //   telemetryLastRd: last.rd,
      //   telemetryLastDistance: last.d,
      // });
    }

    if (this.driverATelemetry.length === 0) {
      this.currentProgressSubject.next(0);
      this.currentFrameSubject.next(null);
      return;
    }

    this.currentProgressSubject.next(0);
    this.publishFrame();
  }

  /**
   * Play.
   */
  play(): void {
    if (this.playingSubject.value || this.driverATelemetry.length === 0) {
      return;
    }

    this.playingSubject.next(true);
    this.previousTimestamp = 0;

    const animate = (timestamp: number) => {
      if (!this.playingSubject.value) {
        return;
      }

      //
      // First frame
      //

      if (this.previousTimestamp === 0) {
        this.previousTimestamp = timestamp;
      }

      const deltaSeconds = (timestamp - this.previousTimestamp) / 1000;

      this.previousTimestamp = timestamp;

      const progressIncrement =
        (deltaSeconds * this.playbackRateValue) / this.referenceLapTimeSeconds;

      const nextProgress =
        this.currentProgressSubject.value + progressIncrement;

      if (nextProgress >= 1) {
        this.seekProgress(1);
        this.pause();
        return;
      }

      this.seekProgress(nextProgress);

      this.animationFrameId = requestAnimationFrame(animate);
    };

    this.animationFrameId = requestAnimationFrame(animate);
  }

  /**
   * Pause.
   */
  pause(): void {
    this.playingSubject.next(false);
    this.previousTimestamp = 0;

    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
  }

  /**
   * Toggle play/pause.
   */
  toggle(): void {
    this.playingSubject.value ? this.pause() : this.play();
  }

  /**
   * Step forward.
   */
  stepForward(): void {
    this.pause();
    this.seekProgress(Math.min(this.currentProgressSubject.value + 0.01, 1));
  }

  /**
   * Step backward.
   */
  stepBackward(): void {
    this.pause();
    this.seekProgress(Math.max(this.currentProgressSubject.value - 0.01, 0));
  }

  /**
   * Slider seek.
   */
  seek(progress: number): void {
    // Pause playback while the user scrubs.
    this.pause();

    this.seekProgress(progress);
  }

  /**
   * Seek using normalized lap progress.
   */
  seekProgress(progress: number): void {
    if (this.driverATelemetry.length === 0) {
      return;
    }

    progress = Math.max(0, Math.min(progress, 1));

    this.currentProgressSubject.next(progress);

    this.publishFrame();
  }

  /**
   * Returns the index of the first telemetry sample
   * whose rd >= progress.
   *
   * Binary search.
   */
  private findNextSampleIndex(telemetry: any[], progress: number): number {
    let low = 0;
    let high = telemetry.length - 1;

    while (low <= high) {
      const mid = Math.floor((low + high) / 2);

      const rd = Number(telemetry[mid].rd);

      if (rd < progress) {
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }

    return Math.min(low, telemetry.length - 1);
  }

  /**
   * Returns the index of the first telemetry sample
   * whose elapsed time >= requested elapsed time.
   *
   * This is used by the time-based playback implementation.
   *
   * NOTE:
   * The existing playback searches using normalized distance (rd).
   * This helper searches using telemetry time (t).
   *
   * Keeping both implementations makes it easy to compare
   * and revert if necessary.
   */
  private findNextTimeSampleIndex(
    telemetry: any[],
    elapsedTime: number,
  ): number {
    let low = 0;
    let high = telemetry.length - 1;

    while (low <= high) {
      const mid = Math.floor((low + high) / 2);

      const t = Number(telemetry[mid].t);

      if (t < elapsedTime) {
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }

    return Math.min(low, telemetry.length - 1);
  }

  /**
   * Builds an interpolated playback frame from two telemetry samples.
   */
  private buildInterpolatedFrame(
    previous: any,
    next: any,
    factor: number,
    progress: number,
    distance: number,
  ): PlaybackFrame {
    return {
      progress,

      previous,
      next,
      factor,

      sample: {
        rd: progress,

        t: previous.t + (next.t - previous.t) * factor,

        d: distance,

        x: previous.x + (next.x - previous.x) * factor,

        y: previous.y + (next.y - previous.y) * factor,

        speed: previous.speed + (next.speed - previous.speed) * factor,

        rpm: previous.rpm + (next.rpm - previous.rpm) * factor,

        throttle:
          previous.throttle + (next.throttle - previous.throttle) * factor,

        brake: previous.brake + (next.brake - previous.brake) * factor,

        gear: factor < 0.5 ? previous.gear : next.gear,
      },
    };
  }

  /**
   * LEGACY IMPLEMENTATION
   *
   * Interpolates telemetry using normalized lap distance (rd).
   *
   * Playback progress is interpreted as distance progress.
   *
   * This implementation is retained for comparison and rollback.
   * The preferred implementation is interpolateTelemetryByTime().
   */
  public interpolateTelemetry(
    telemetry: any[],
    progress: number,
  ): PlaybackFrame | null {
    if (!telemetry?.length) {
      return null;
    }

    const nextIndex = this.findNextSampleIndex(telemetry, progress);

    if (nextIndex <= 0) {
      const sample = telemetry[0];

      return {
        progress,
        previous: sample,
        next: sample,
        factor: 0,
        sample,
      };
    }

    const previous = telemetry[nextIndex - 1];
    const next = telemetry[nextIndex];

    const elapsedTime = progress * this.referenceLapTimeSeconds;

    if (elapsedTime > 16.2 && elapsedTime < 16.3) {
      // console.log('--------------------------------');
      // console.log({
      //   elapsedTime,
      //   progress,
      //   previous: {
      //     t: previous.t,
      //     d: previous.d,
      //     rd: previous.rd,
      //   },
      //   next: {
      //     t: next.t,
      //     d: next.d,
      //     rd: next.rd,
      //   },
      // });
    }
    const previousRd = Number(previous.rd);
    const nextRd = Number(next.rd);

    const factor =
      nextRd === previousRd
        ? 0
        : (progress - previousRd) / (nextRd - previousRd);

    const distance = previous.d + (next.d - previous.d) * factor;

    if (elapsedTime > 16.2 && elapsedTime < 16.3) {
      console.log({
        factor,

        interpolated: {
          t: previous.t + (next.t - previous.t) * factor,
          d: distance,
          rd: progress,
        },
      });
    }

    return this.buildInterpolatedFrame(
      previous,
      next,
      factor,
      progress,
      distance,
    );
  }

  public interpolateTelemetryByTime(
    telemetry: any[],
    progress: number,
  ): PlaybackFrame | null {
    if (!telemetry?.length) {
      return null;
    }

    const elapsedTime = progress * this.referenceLapTimeSeconds;

    const clampedElapsedTime = Math.min(
      elapsedTime,
      telemetry[telemetry.length - 1].t,
    );

    const nextIndex = this.findNextTimeSampleIndex(
      telemetry,
      clampedElapsedTime,
    );

    if (nextIndex <= 0) {
      const sample = telemetry[0];

      return {
        progress,
        previous: sample,
        next: sample,
        factor: 0,
        sample,
      };
    }

    const previous = telemetry[nextIndex - 1];
    const next = telemetry[nextIndex];

    if (elapsedTime > 16.2 && elapsedTime < 16.3) {
      // console.log('--------------------------------');
      // console.log({
      //   elapsedTime,
      //   progress,
      //   previous: {
      //     t: previous.t,
      //     d: previous.d,
      //     rd: previous.rd,
      //   },
      //   next: {
      //     t: next.t,
      //     d: next.d,
      //     rd: next.rd,
      //   },
      // });
    }
    const previousTime = Number(previous.t);
    const nextTime = Number(next.t);

    const rawFactor =
      nextTime === previousTime
        ? 0
        : (clampedElapsedTime - previousTime) / (nextTime - previousTime);

    const factor = Math.max(0, Math.min(rawFactor, 1));

    const distance = previous.d + (next.d - previous.d) * factor;

    // if (elapsedTime > 16.2 && elapsedTime < 16.3) {
    //   console.log({
    //     factor,

    //     interpolated: {
    //       t: previous.t + (next.t - previous.t) * factor,
    //       d: distance,
    //       rd: progress,
    //     },
    //   });
    // }

    return this.buildInterpolatedFrame(
      previous,
      next,
      factor,
      progress,
      distance,
    );
  }

  /**
   * Returns the index of the first telemetry sample
   * whose distance >= requested distance.
   *
   * Binary search.
   */
  private findNextDistanceSampleIndex(
    telemetry: any[],
    distance: number,
  ): number {
    let low = 0;
    let high = telemetry.length - 1;

    while (low <= high) {
      const mid = Math.floor((low + high) / 2);

      const d = Number(telemetry[mid].d);

      if (d < distance) {
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }

    return Math.min(low, telemetry.length - 1);
  }

  /**
   * Interpolates telemetry at a given track distance.
   */
  public interpolateTelemetryByDistance(
    telemetry: any[],
    distance: number,
  ): PlaybackFrame | null {
    if (!telemetry?.length) {
      return null;
    }

    const nextIndex = this.findNextDistanceSampleIndex(telemetry, distance);

    if (nextIndex <= 0) {
      const sample = telemetry[0];

      return {
        progress: sample.rd,
        previous: sample,
        next: sample,
        factor: 0,
        sample,
      };
    }

    const previous = telemetry[nextIndex - 1];
    const next = telemetry[nextIndex];

    const previousDistance = Number(previous.d);
    const nextDistance = Number(next.d);

    const factor =
      nextDistance === previousDistance
        ? 0
        : (distance - previousDistance) / (nextDistance - previousDistance);

    const progress = previous.rd + (next.rd - previous.rd) * factor;

    return this.buildInterpolatedFrame(
      previous,
      next,
      factor,
      progress,
      distance,
    );
  }

  /**
   * Creates one interpolated playback frame.
   */
  private publishFrame(): void {
    const progress = this.currentProgressSubject.value;

    const driverA = this.interpolateTelemetry(this.driverATelemetry, progress);

    if (!driverA) {
      this.currentFrameSubject.next(null);
      return;
    }

    const driverB = this.driverBTelemetry.length
      ? this.interpolateTelemetry(this.driverBTelemetry, progress)
      : null;

    this.currentFrameSubject.next({
      progress,

      previous: driverA.previous,
      next: driverA.next,
      factor: driverA.factor,

      sample: driverA.sample,

      driverA: {
        sample: driverA.sample,
        elapsedTime: driverA.sample.t,
      },

      driverB: driverB
        ? {
            sample: driverB.sample,
            elapsedTime: driverB.sample.t,
          }
        : null,
    });
  }

  /**
   * Current progress.
   */
  get progress(): number {
    return this.currentProgressSubject.value;
  }

  /**
   * Sample count.
   */
  get sampleCount(): number {
    return this.driverATelemetry.length;
  }

  /**
   * Current progress.
   */
  get currentProgress(): number {
    return this.currentProgressSubject.value;
  }

  /**
   * Current playback frame.
   */
  get currentFrame(): PlaybackFrame | null {
    return this.currentFrameSubject.value;
  }

  /**
   * Is playback currently running.
   */
  get isPlaying(): boolean {
    return this.playingSubject.value;
  }

  /**
   * Current playback rate.
   */
  get playbackRate(): number {
    return this.playbackRateValue;
  }

  /**
   * Current playback time (seconds).
   */
  get currentTimeSeconds(): number {
    return this.currentProgress * this.referenceLapTimeSeconds;
  }

  /**
   * Total playback duration (seconds).
   */
  get totalTimeSeconds(): number {
    return this.referenceLapTimeSeconds;
  }

  /**
   * Change playback speed.
   */
  setPlaybackRate(rate: number): void {
    this.playbackRateValue = rate;
  }

  destroy(): void {
    this.pause();

    this.driverATelemetry = [];
    this.driverBTelemetry = [];

    this.referenceLapTimeSeconds = 0;

    this.currentProgressSubject.next(0);
    this.currentFrameSubject.next(null);

    this.playbackRateValue = 1;
  }
}
