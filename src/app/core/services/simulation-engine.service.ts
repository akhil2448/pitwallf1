import { Injectable } from '@angular/core';
import { BehaviorSubject, Subscription } from 'rxjs';
import { RaceClockService } from './race-clock-service';
import { TelemetryBufferService } from './race-telemetry-buffer.service';
import { TelemetryFrame } from '../models/race-telemetry.model';
import { TrackMapStateService } from './track-map-state.service';

@Injectable({
  providedIn: 'root',
})
export class SimulationEngineService {
  /** Emits the current simulation frame */
  private currentFrameSubject = new BehaviorSubject<TelemetryFrame | null>(
    null,
  );
  frame$ = this.currentFrameSubject.asObservable();

  private clockSub?: Subscription;
  private trackMapSub?: Subscription;

  private initialized = false;

  private trackLengthMeters = 0;

  constructor(
    private clock: RaceClockService,
    private telemetry: TelemetryBufferService,
    private trackMapState: TrackMapStateService,
  ) {}

  /**
   * MUST be called once telemetry data is loaded
   */
  initialize(): void {
    if (this.initialized) return;
    this.initialized = true;

    // Get track length ONCE
    this.trackMapSub = this.trackMapState.trackData$.subscribe((data) => {
      if (!data) return;

      this.trackLengthMeters = data.trackInfo.trackLength;
    });

    this.clockSub = this.clock.raceTime$.subscribe((second) => {
      const frame = this.telemetry.getFrame(second);

      if (!frame) return;

      /**
       * Backend telemetry is already authoritative for:
       * - lap
       * - lapDistance
       * - raceDistance
       * - timingLoopIndex
       * - x / y
       *
       * Do not reconstruct position from raceDistance.
       */
      this.currentFrameSubject.next(frame);
    });
  }

  /**
   * Optional cleanup (useful for future race switching)
   */
  destroy(): void {
    // console.log('******** DESTROY RACE CALLED ********');

    this.clockSub?.unsubscribe();
    this.clockSub = undefined;

    this.trackMapSub?.unsubscribe();
    this.trackMapSub = undefined;

    this.initialized = false;
    this.trackLengthMeters = 0;
    this.currentFrameSubject.next(null);
  }

  getTrackLengthMeters(): number {
    return this.trackLengthMeters;
  }
}
