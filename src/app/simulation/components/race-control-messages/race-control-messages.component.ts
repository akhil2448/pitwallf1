import {
  Component,
  OnInit,
  OnDestroy,
  Input,
  ChangeDetectionStrategy,
  ChangeDetectorRef,
} from '@angular/core';

import { CommonModule } from '@angular/common';

import { Subscription } from 'rxjs';

import {
  RaceControlService,
  RaceControlMessage,
} from '../../../core/services/race-control.service';

import { RaceClockService } from '../../../core/services/race-clock-service';
import { SeekCoordinatorService } from '../../../core/services/seek-coordinator.service';

@Component({
  selector: 'app-race-control-messages',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './race-control-messages.component.html',
  styleUrls: ['./race-control-messages.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RaceControlMessagesComponent implements OnInit, OnDestroy {
  @Input() year!: number;

  @Input() round!: number;

  currentMessage: RaceControlMessage | null = null;

  // Persistent banner state
  // Used ONLY for:
  // - startup message
  // - CHEQUERED FLAG
  persistentMessage: RaceControlMessage | null = null;
  private startupMessage: RaceControlMessage | null = null;

  // FIFO display queue
  private queue: RaceControlMessage[] = [];

  // O(1) lookup
  private messagesBySecond = new Map<number, RaceControlMessage[]>();

  // prevent duplicate second processing
  private processedSeconds = new Set<number>();

  private sub?: Subscription;

  // queue processor state
  private isProcessing = false;

  // destroy safety
  private destroyed = false;

  // queue safety
  private readonly MAX_QUEUE_SIZE = 50;

  private previousRaceSecond: number | null = null;

  constructor(
    private raceClock: RaceClockService,
    private raceControl: RaceControlService,
    private cdr: ChangeDetectorRef,
    private seekCoordinator: SeekCoordinatorService,
  ) {}

  ngOnInit(): void {
    this.raceControl.getRaceControl(this.year, this.round).subscribe((data) => {
      // preprocess into hashmap
      for (const msg of data.messages) {
        const existing = this.messagesBySecond.get(msg.raceSecond) ?? [];

        existing.push(msg);

        this.messagesBySecond.set(msg.raceSecond, existing);
      }

      // startup GREEN flag persistence
      const startupMessage = this.messagesBySecond.get(0)?.[0];

      if (startupMessage) {
        this.startupMessage = startupMessage;
        this.persistentMessage = startupMessage;

        this.cdr.markForCheck();
      }

      // subscribe AFTER preprocessing
      this.sub = this.raceClock.raceTime$.subscribe((raceSecond) => {
        /**
         * Detect discontinuous timeline jump.
         *
         * Silent reposition:
         * - suppress skipped messages
         * - preserve future replay correctness
         */
        if (
          this.previousRaceSecond !== null &&
          raceSecond !== this.previousRaceSecond + 1
        ) {
          this.resetForSeek(raceSecond);
        }

        this.previousRaceSecond = raceSecond;

        // prevent duplicate processing
        if (this.processedSeconds.has(raceSecond)) {
          return;
        }

        this.processedSeconds.add(raceSecond);

        // hide startup GREEN
        // only after race actually starts
        // Hide the startup message once the race timeline moves past second 0.
        if (raceSecond > 0 && this.persistentMessage === this.startupMessage) {
          this.persistentMessage = null;

          this.cdr.markForCheck();
        }

        const messages = this.messagesBySecond.get(raceSecond);

        if (!messages?.length) {
          return;
        }

        for (const msg of messages) {
          /**
           * Suppress replay side effects
           * during deterministic seek rebuild.
           */
          if (this.seekCoordinator.isSeekingSnapshot()) {
            continue;
          }

          // startup GREEN handled
          // via persistent banner only
          if (raceSecond === 0 && msg.flag === 'GREEN') {
            continue;
          }

          // permanent chequered flag
          if (msg.flag === 'CHEQUERED') {
            this.queue = [];

            this.currentMessage = null;

            this.persistentMessage = msg;

            this.cdr.markForCheck();

            return;
          }

          this.enqueueMessage(msg);
        }
      });
    });
  }

  private resetForSeek(targetSecond: number): void {
    // console.log('[RaceControl] Resetting for seek:', targetSecond);

    /**
     * Clear transient UI state
     */
    this.queue = [];

    this.currentMessage = null;

    /**
     * Rebuild processed-second state
     * so skipped messages NEVER replay.
     */
    this.processedSeconds.clear();

    for (let i = 0; i <= targetSecond; i++) {
      this.processedSeconds.add(i);
    }

    /**
     * Preserve chequered flag persistence
     * only if seeked after finish.
     */
    const chequered = this.messagesBySecond
      .get(targetSecond)
      ?.find((m) => m.flag === 'CHEQUERED');

    if (targetSecond === 0 && this.startupMessage) {
      this.persistentMessage = this.startupMessage;
    } else {
      this.persistentMessage = chequered ?? null;
    }

    this.cdr.markForCheck();
  }

  private enqueueMessage(msg: RaceControlMessage): void {
    // queue protection
    if (this.queue.length >= this.MAX_QUEUE_SIZE) {
      console.warn('[RaceControl] Queue overflow prevented');

      return;
    }

    this.queue.push(msg);

    // start processor
    this.processQueue();
  }

  private async processQueue(): Promise<void> {
    // already running
    if (this.isProcessing) {
      return;
    }

    this.isProcessing = true;

    while (this.queue.length > 0 && !this.destroyed) {
      // dequeue next
      this.currentMessage = this.queue.shift()!;

      this.cdr.markForCheck();

      // display duration
      await this.delay(this.getMessageDuration(this.currentMessage));

      // clear current
      this.currentMessage = null;

      this.cdr.markForCheck();

      // small gap prevents layout thrash
      await this.delay(60);
    }

    this.isProcessing = false;
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => {
      setTimeout(resolve, ms);
    });
  }

  private getMessageDuration(msg: RaceControlMessage): number {
    const base = 3000;

    const perCharacter = 45;

    const calculated = base + msg.message.length * perCharacter;

    return Math.min(Math.max(calculated, 3000), 8000);
  }

  get displayMessage(): RaceControlMessage | null {
    return this.currentMessage ?? this.persistentMessage;
  }

  ngOnDestroy(): void {
    this.destroyed = true;

    this.sub?.unsubscribe();
  }
}
