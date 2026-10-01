import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';

import { RaceClockService } from './race-clock-service';
import { TelemetryBufferService } from './race-telemetry-buffer.service';
import { TimingEvent } from '../models/timing-event.model';
import { TelemetryCar } from '../models/race-telemetry.model';

export interface DriverTimingState {
  driver: string;
  lap: number;
  timingLoopIndex: number;
  lastCrossingTime: number;
  raceDistance: number;
  lapLoopCrossings: Map<number, Map<number, number>>;
  progressionScore?: number;
  gapToLeader?: number;
  intervalGap?: number;
}

@Injectable({
  providedIn: 'root',
})
export class TimingEventProcessorService {
  /**
   * Latest processed timing-event index
   */
  private processedIndex = 0;
  private totalTimingLoops = 60;

  /**
   * Latest timing state per driver
   */
  private driverStates = new Map<string, DriverTimingState>();
  private orderedStates: DriverTimingState[] = [];

  /**
   * Same-loop position changes are not accepted immediately.
   *
   * A live crossover must persist for 2 consecutive race seconds
   * before the leaderboard order is changed.
   */
  private pendingSameLoopChanges = new Map<
    string,
    {
      desiredAhead: string;
      lastRaceSecond: number;
      count: number;
    }
  >();

  /**
   * Reactive timing state
   */
  private timingStateSubject = new BehaviorSubject<
    Map<string, DriverTimingState>
  >(new Map());

  timingState$ = this.timingStateSubject.asObservable();

  constructor(
    private raceClock: RaceClockService,
    private telemetryBuffer: TelemetryBufferService,
  ) {
    /**
     * Consume timing events continuously
     * as race clock advances.
     */
    this.raceClock.raceTime$.subscribe((raceSecond) => {
      this.processEventsUpTo(raceSecond);
    });
  }

  /* ===================================================== */
  /* PROCESS EVENTS                                        */
  /* ===================================================== */

  private processEventsUpTo(raceSecond: number): void {
    const events = this.telemetryBuffer.getTimingEvents();

    while (this.processedIndex < events.length) {
      const event = events[this.processedIndex];

      // Future event → stop processing
      if (event.raceTime > raceSecond) {
        break;
      }

      this.applyEvent(event);
      this.processedIndex++;
    }

    /**
     * Re-evaluate the live ordering on every race-clock second.
     *
     * Timing events establish the authoritative lap/timing-loop
     * progression, while the current telemetry frame resolves
     * drivers that are inside the same timing loop.
     */
    this.recomputeIntervals(raceSecond);

    /**
     * Emit cloned map so Angular change detection fires
     */
    this.timingStateSubject.next(new Map(this.driverStates));
  }

  /* ===================================================== */
  /* APPLY SINGLE EVENT                                    */
  /* ===================================================== */

  private applyEvent(event: TimingEvent): void {
    const existing = this.driverStates.get(event.driver);

    const lapLoopCrossings =
      existing?.lapLoopCrossings ?? new Map<number, Map<number, number>>();

    const lapCrossings =
      lapLoopCrossings.get(event.lap) ?? new Map<number, number>();

    lapCrossings.set(event.timingLoopIndex, event.raceTime);

    lapLoopCrossings.set(event.lap, lapCrossings);

    const progressionScore =
      event.lap * this.totalTimingLoops + event.timingLoopIndex;

    this.driverStates.set(event.driver, {
      driver: event.driver,
      lap: event.lap,
      timingLoopIndex: event.timingLoopIndex,
      lastCrossingTime: event.raceTime,
      raceDistance: event.raceDistance,
      lapLoopCrossings,
      progressionScore,
      gapToLeader: existing?.gapToLeader,
      intervalGap: existing?.intervalGap,
    });
  }

  private getEquivalentCrossingTime(
    reference: DriverTimingState,
    targetLap: number,
    targetLoop: number,
  ): number | undefined {
    const lapMap = reference.lapLoopCrossings.get(targetLap);

    if (!lapMap) {
      return undefined;
    }

    /**
     * Exact loop match
     */
    const exact = lapMap.get(targetLoop);

    if (exact !== undefined) {
      return exact;
    }

    /**
     * Fallback:
     * search previous loops
     *
     * Prevents tiny edge gaps
     * when exact loop not yet stored.
     */
    for (let loop = targetLoop - 1; loop >= 0; loop--) {
      const fallback = lapMap.get(loop);

      if (fallback !== undefined) {
        return fallback;
      }
    }

    return undefined;
  }

  /* ===================================================== */
  /* FIA INTERVAL ENGINE                                   */
  /* ===================================================== */

  private recomputeIntervals(raceSecond: number): void {
    const states = Array.from(this.driverStates.values());

    if (!states.length) return;

    /**
     * Read the telemetry frame ONCE.
     *
     * Do not call getFrame() repeatedly from inside Array.sort().
     */
    const frame = this.telemetryBuffer.getFrame(raceSecond);

    const liveCars = new Map<string, TelemetryCar>();

    frame?.cars.forEach((car) => {
      liveCars.set(car.driver, car);
    });

    /**
     * Preserve the order that was already accepted by the timing engine.
     *
     * This is important for hysteresis:
     * a tiny live-position reversal should not immediately
     * rewrite the ordering.
     */
    const previousOrder = new Map<string, number>();

    this.orderedStates.forEach((state, index) => {
      previousOrder.set(state.driver, index);
    });

    /**
     * FIRST:
     * establish authoritative progression ordering.
     *
     * Different lap/timing-loop progression always wins.
     *
     * SAME progression:
     * preserve the previously accepted order.
     */
    states.sort((a, b) => this.compareTimingStates(a, b, previousOrder));

    /**
     * SECOND:
     * resolve same-loop live-position crossovers
     * using 2-second hysteresis.
     */
    this.applySameLoopHysteresis(states, liveCars, raceSecond);

    const leader = states[0];

    for (let i = 0; i < states.length; i++) {
      const current = states[i];

      /**
       * LEADER
       */
      if (i === 0) {
        current.gapToLeader = 0;
        current.intervalGap = 0;
        continue;
      }

      /**
       * GAP TO LEADER
       */
      const leaderEquivalentTime = this.getEquivalentCrossingTime(
        leader,
        current.lap,
        current.timingLoopIndex,
      );

      if (leaderEquivalentTime !== undefined) {
        const equivalentGap = current.lastCrossingTime - leaderEquivalentTime;

        const leaderElapsedSinceEquivalent =
          leader.lastCrossingTime - leaderEquivalentTime;

        current.gapToLeader = equivalentGap + leaderElapsedSinceEquivalent;
      }

      /**
       * INTERVAL TO CAR AHEAD
       */
      const ahead = states[i - 1];

      const aheadEquivalentTime = this.getEquivalentCrossingTime(
        ahead,
        current.lap,
        current.timingLoopIndex,
      );

      if (aheadEquivalentTime !== undefined) {
        const equivalentGap = current.lastCrossingTime - aheadEquivalentTime;

        const aheadElapsedSinceEquivalent =
          ahead.lastCrossingTime - aheadEquivalentTime;

        current.intervalGap = equivalentGap + aheadElapsedSinceEquivalent;
      }
    }

    /**
     * Write updated states back into map
     */
    states.forEach((state) => {
      this.driverStates.set(state.driver, state);
    });

    this.orderedStates = [...states];
  }

  private applySameLoopHysteresis(
    states: DriverTimingState[],
    liveCars: Map<string, TelemetryCar>,
    raceSecond: number,
  ): void {
    /**
     * Only adjacent cars can exchange positions.
     *
     * This keeps the resolution deterministic and prevents
     * unrelated cars in the same timing loop from jumping
     * around each other.
     */
    for (let i = 0; i < states.length - 1; i++) {
      const ahead = states[i];
      const behind = states[i + 1];

      /**
       * Timing progression remains authoritative.
       *
       * Never use live lapDistance across different
       * lap/timing-loop progression.
       */
      if (ahead.progressionScore !== behind.progressionScore) {
        continue;
      }

      const aheadDistance = this.getLiveLapDistance(ahead, liveCars);

      const behindDistance = this.getLiveLapDistance(behind, liveCars);

      /**
       * Cannot safely resolve this pair from live telemetry.
       */
      if (aheadDistance === undefined || behindDistance === undefined) {
        this.clearSameLoopCandidate(ahead.driver, behind.driver);
        continue;
      }

      /**
       * Current accepted order is already consistent
       * with live telemetry.
       */
      if (aheadDistance >= behindDistance) {
        this.clearSameLoopCandidate(ahead.driver, behind.driver);
        continue;
      }

      /**
       * Live telemetry says the current "behind" driver
       * is now ahead.
       *
       * Candidate crossover detected.
       */
      const desiredAhead = behind.driver;

      const key = this.getSameLoopPairKey(ahead.driver, behind.driver);

      const previous = this.pendingSameLoopChanges.get(key);

      let candidate;

      if (
        previous &&
        previous.desiredAhead === desiredAhead &&
        previous.lastRaceSecond === raceSecond - 1
      ) {
        candidate = {
          desiredAhead,
          lastRaceSecond: raceSecond,
          count: previous.count + 1,
        };
      } else {
        candidate = {
          desiredAhead,
          lastRaceSecond: raceSecond,
          count: 1,
        };
      }

      this.pendingSameLoopChanges.set(key, candidate);

      /**
       * Require 2 consecutive race seconds.
       */
      if (candidate.count >= 2) {
        states[i] = behind;
        states[i + 1] = ahead;

        this.pendingSameLoopChanges.delete(key);
      }
    }
  }

  private getLiveLapDistance(
    state: DriverTimingState,
    liveCars: Map<string, TelemetryCar>,
  ): number | undefined {
    const car = liveCars.get(state.driver);

    if (!car) {
      return undefined;
    }

    /**
     * Only use live position when telemetry agrees with
     * the authoritative timing state.
     */
    if (
      car.lap !== state.lap ||
      car.timingLoopIndex !== state.timingLoopIndex
    ) {
      return undefined;
    }

    return car.lapDistance;
  }

  private compareTimingStates(
    a: DriverTimingState,
    b: DriverTimingState,
    previousOrder: Map<string, number>,
  ): number {
    /**
     * PRIMARY:
     * official timing-loop progression.
     */
    const progressionDelta =
      (b.progressionScore ?? 0) - (a.progressionScore ?? 0);

    /**
     * Different timing progression:
     * timing loops remain authoritative.
     */
    if (progressionDelta !== 0) {
      return progressionDelta;
    }

    /**
     * SAME progression:
     *
     * Preserve the previously accepted order.
     *
     * Live telemetry is handled separately by
     * applySameLoopHysteresis().
     */
    const aPrevious = previousOrder.get(a.driver);
    const bPrevious = previousOrder.get(b.driver);

    if (
      aPrevious !== undefined &&
      bPrevious !== undefined &&
      aPrevious !== bPrevious
    ) {
      return aPrevious - bPrevious;
    }

    /**
     * Drivers not previously ordered:
     * use crossing time as deterministic fallback.
     */
    return a.lastCrossingTime - b.lastCrossingTime;
  }

  private getSameLoopPairKey(driverA: string, driverB: string): string {
    return [driverA, driverB].sort().join('|');
  }

  private clearSameLoopCandidate(driverA: string, driverB: string): void {
    const key = this.getSameLoopPairKey(driverA, driverB);

    this.pendingSameLoopChanges.delete(key);
  }

  /* ===================================================== */
  /* ACCESSORS                                             */
  /* ===================================================== */

  getDriverState(driver: string): DriverTimingState | undefined {
    return this.driverStates.get(driver);
  }

  getOrderedStates(): DriverTimingState[] {
    return [...this.orderedStates];
  }

  setTimingLoopCount(count: number): void {
    this.totalTimingLoops = count;
  }

  reset(): void {
    this.processedIndex = 0;

    this.driverStates.clear();
    this.orderedStates = [];
    this.pendingSameLoopChanges.clear();

    this.timingStateSubject.next(new Map());
  }
}
