import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import { TelemetryFrame, TelemetryCar } from '../models/race-telemetry.model';
import { SimulationEngineService } from './simulation-engine.service';
import { RaceClockService } from './race-clock-service';
import { DriverPresenceService } from './driver-presence.service';

/**
 * Smooth 60fps interpolation of telemetry frames.
 *
 * ✔ Speed-safe (0.5x / 1x / 2x / 4x)
 * ✔ Pause-safe (NO jitter after resume)
 * ✔ Deterministic
 * ✔ Interpolates POSITION only
 */
@Injectable({
  providedIn: 'root',
})
export class TelemetryInterpolationService {
  /* ===================================================== */
  /* OUTPUT STREAM                                         */
  /* ===================================================== */

  private interpolatedFrameSubject = new BehaviorSubject<TelemetryFrame | null>(
    null,
  );

  interpolatedFrame$ = this.interpolatedFrameSubject.asObservable();

  /* ===================================================== */
  /* INTERNAL STATE                                        */
  /* ===================================================== */

  private prevFrame?: TelemetryFrame;
  private currFrame?: TelemetryFrame;

  /** Wall-clock time when current frame became active */
  private frameStartTime = 0;

  /** Actual real-time duration between frames */
  private frameDurationMs = 1000;

  private rafId?: number;

  /** Used to detect pause → resume transition */
  private wasPaused = true;

  constructor(
    private engine: SimulationEngineService,
    private clock: RaceClockService,
    private presence: DriverPresenceService,
  ) {
    /* ---------- PAUSE / RESUME HANDLING ---------- */
    this.clock.isPaused$.subscribe((paused) => {
      if (this.wasPaused && !paused) {
        // Pause → Play transition detected
        this.resetInterpolationTiming();
      }
      this.wasPaused = paused;
    });

    /* ---------- TELEMETRY FRAMES ---------- */
    this.engine.frame$.subscribe((frame) => {
      if (!frame) {
        this.prevFrame = undefined;
        this.currFrame = undefined;

        this.interpolatedFrameSubject.next(null);

        return;
      }

      // update currently visible telemetry drivers
      // this.presence.updateVisibleDrivers(frame.cars.map((c) => c.driver));

      // ✅ AUTHORITATIVE DRIVER PRESENCE UPDATE
      // REMOVED BECAUSE THE DRIVER PRESENCE IS HANDLED DIFFERENTLY
      this.presence.update(frame);

      const now = performance.now();

      // Shift frames
      this.prevFrame = this.currFrame;
      this.currFrame = frame;

      // Measure real frame duration ONLY if not paused
      if (this.frameStartTime > 0) {
        this.frameDurationMs = Math.max(now - this.frameStartTime, 16);
      }

      this.frameStartTime = now;

      // Start render loop once
      if (!this.rafId) {
        this.startRenderLoop();
      }
    });
  }

  /* ===================================================== */
  /* RENDER LOOP (≈60 FPS)                                 */
  /* ===================================================== */

  private startRenderLoop(): void {
    const loop = () => {
      if (!this.prevFrame || !this.currFrame) {
        this.rafId = requestAnimationFrame(loop);
        return;
      }

      const now = performance.now();
      const elapsedMs = now - this.frameStartTime;

      /**
       * Interpolate using REAL frame duration.
       * Clamp to [0,1] to avoid overshoot.
       */
      const t = Math.min(elapsedMs / this.frameDurationMs, 1);

      const interpolated = this.interpolateFrame(
        this.prevFrame,
        this.currFrame,
        t,
      );

      this.interpolatedFrameSubject.next(interpolated);

      this.rafId = requestAnimationFrame(loop);
    };

    this.rafId = requestAnimationFrame(loop);
  }

  /* ===================================================== */
  /* INTERPOLATION LOGIC                                   */
  /* ===================================================== */

  private interpolateFrame(
    prev: TelemetryFrame,
    curr: TelemetryFrame,
    t: number,
  ): TelemetryFrame {
    const prevCars = new Map(prev.cars.map((c) => [c.driver, c]));

    const cars: TelemetryCar[] = curr.cars.map((currCar) => {
      const prevCar = prevCars.get(currCar.driver);

      if (!prevCar) {
        return currCar;
      }

      // /**
      //  * Do not interpolate across a lap boundary.
      //  *
      //  * The backend has already provided the authoritative
      //  * current position for the new lap.
      //  */
      // if (prevCar.lap !== currCar.lap) {
      //   return currCar;
      // }

      const interpolatedX = prevCar.x + (currCar.x - prevCar.x) * t;

      const interpolatedY = prevCar.y + (currCar.y - prevCar.y) * t;

      const interpolatedLapDistance =
        prevCar.lapDistance + (currCar.lapDistance - prevCar.lapDistance) * t;

      return {
        ...currCar,

        /**
         * Visual position now comes directly from the
         * backend coordinate system.
         */
        x: interpolatedX,
        y: interpolatedY,

        /**
         * Keep lapDistance smooth for any visual consumers.
         */
        lapDistance: interpolatedLapDistance,
      };
    });

    return {
      ...curr,
      cars,
    };
  }

  /* ===================================================== */
  /* RESET ON PAUSE → PLAY                                 */
  /* ===================================================== */

  private resetInterpolationTiming(): void {
    /**
     * Pause breaks time continuity.
     * We must NOT interpolate across pause.
     */
    this.prevFrame = this.currFrame;
    this.frameStartTime = performance.now();
    this.frameDurationMs = 1000;
  }

  resetAfterSeek(): void {
    /**
     * Seeking invalidates interpolation continuity.
     *
     * Prevent:
     * - teleport smoothing
     * - stale interpolation
     * - ghost transitions
     * - pause/resume artifacts
     */

    this.prevFrame = undefined;
    this.currFrame = undefined;

    this.frameStartTime = performance.now();

    this.frameDurationMs = 1000;

    this.wasPaused = true;

    this.interpolatedFrameSubject.next(null);
  }

  /* ===================================================== */
  /* CLEANUP                                              */
  /* ===================================================== */

  destroy(): void {
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = undefined;
    }

    this.prevFrame = undefined;
    this.currFrame = undefined;
    this.frameStartTime = 0;
    this.frameDurationMs = 1000;

    this.wasPaused = true;

    this.interpolatedFrameSubject.next(null);
  }
}
