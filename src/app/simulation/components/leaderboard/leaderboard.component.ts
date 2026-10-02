import {
  AfterViewInit,
  Component,
  ElementRef,
  OnDestroy,
  OnInit,
  QueryList,
  ViewChildren,
  Input,
  HostListener,
  HostBinding,
  ViewChild,
} from '@angular/core';
import { LeaderboardEntry } from '../../../core/models/leaderboard-entry.model';
import { LeaderboardService } from '../../../core/services/leaderboard.service';
import { CommonModule } from '@angular/common';
import { DriverMetaService } from '../../../core/services/driver-meta.service';
import { TrackStatusComponent } from '../track-status/track-status.component';
import { TrackStatusService } from '../../../core/services/track-status.service';
import { TrackStatusType } from '../../../core/constants/track-status.types';
import {
  LeaderboardDisplayMode,
  LeaderboardDisplayService,
} from '../../../core/services/leaderboard-display.service';
import { RaceClockService } from '../../../core/services/race-clock-service';
import { RaceFinishService } from '../../../core/services/race-finish.service';
import { FastestLapService } from '../../../core/services/fastest-lap.service';
import { LayoutScaleService } from '../../../core/services/layout-scale.service';

@Component({
  selector: 'app-leaderboard',
  standalone: true,
  imports: [CommonModule, TrackStatusComponent],
  templateUrl: './leaderboard.component.html',
  styleUrl: './leaderboard.component.scss',
})
export class LeaderboardComponent implements OnInit, AfterViewInit, OnDestroy {
  leaderboard: LeaderboardEntry[] = [];
  leaderLap = 0;
  totalLaps = 0;

  private rowPositions = new Map<string, number>();

  private displayedArrows = new Map<string, HTMLDivElement>();

  fastestLapDriver: string | null = null;

  finishedDrivers = new Set<string>();

  private alreadyAnimatedDrivers = new Set<string>();

  animatingFinishFlags = new Set<string>();

  @ViewChildren('driverRow', { read: ElementRef })
  rows!: QueryList<ElementRef<HTMLElement>>;

  // @ViewChild('leaderboardPanel', { read: ElementRef })
  // leaderboardPanel!: ElementRef<HTMLElement>;

  /** UI STATE */
  baseMode: LeaderboardDisplayMode = 'LEADER_GAP';
  activeTemporaryMode: LeaderboardDisplayMode | null = null;
  //private temporaryModeTimer?: number;

  raceFinished = false;

  trackStatus: TrackStatusType | null = null;

  /** 🔑 Broadcast anchors */
  private greenLap: number | null = null;
  private restartType: 'SC' | 'VSC' | 'RED' | 'YELLOW' | null = null;

  /**
   * Tracks whether a YELLOW flag began during
   * the opening race lap.
   *
   * Used only to handle:
   * LAP 1 YELLOW → immediate GREEN
   */
  private yellowStartedDuringOpeningLap = false;

  /**
   * Leaderboard remains hidden until the leader
   * reaches this lap.
   *
   * Example:
   * GREEN during lap 1 → hide until lap 2.
   * GREEN during lap 25 → hide until lap 26.
   */
  private hideLeaderboardUntilLap: number | null = null;

  /** Automatic gap → interval transition */
  private leaderGapModeActive = false;
  private spreadConfirmationSeconds = 0;
  private lastSpreadCheckSecond: number | null = null;

  /**
   * "Field is spread out" heuristic:
   * median interval must reach this threshold.
   */
  private readonly FIELD_SPREAD_INTERVAL_THRESHOLD = 1.0;

  /**
   * Require the condition to persist for this many
   * race-clock seconds before switching modes.
   */
  private readonly FIELD_SPREAD_CONFIRMATION_SECONDS = 3;

  @Input()
  highlightedDrivers: { driver: string | null; color: string }[] = [];

  mobileScale = 1;

  constructor(
    private leaderboardService: LeaderboardService,
    private driverMeta: DriverMetaService,
    private trackStatusService: TrackStatusService,
    private leaderboardDisplay: LeaderboardDisplayService,
    private raceFinish: RaceFinishService,
    private fastestLap: FastestLapService,
    private layoutScale: LayoutScaleService,
    private raceClock: RaceClockService,
  ) {
    // Track flag state
    this.trackStatusService.status$.subscribe((status) => {
      this.trackStatus = status;

      if (
        status === 'SC' ||
        status === 'VSC' ||
        status === 'VSC_ENDING' ||
        status === 'RED' ||
        status === 'YELLOW'
      ) {
        this.restartType = status === 'VSC_ENDING' ? 'VSC' : status;
      }

      /*
       * Remember that YELLOW started during lap 1.
       *
       * We evaluate this when YELLOW begins, rather than
       * trying to infer it later when GREEN arrives.
       */
      if (status === 'YELLOW' && this.leaderLap === 1) {
        this.yellowStartedDuringOpeningLap = true;
      }
    });

    // Fire on every GREEN (race start + restarts)
    this.trackStatusService.greenEvent$.subscribe(() => {
      this.triggerRestartWindow();
    });

    this.leaderboardDisplay.temporaryMode$.subscribe((mode) => {
      this.activeTemporaryMode = mode;
    });
  }

  private triggerRestartWindow(): void {
    const isRaceStart = this.greenLap === null;

    const isSafetyCarRestart = this.restartType === 'SC';

    const isRedFlagRestart = this.restartType === 'RED';

    const isVscRestart = this.restartType === 'VSC';

    const isEarlyYellowReturn =
      this.restartType === 'YELLOW' && this.yellowStartedDuringOpeningLap;

    /*
     * Leader-gap mode starts after:
     * - race start
     * - SC restart
     * - VSC restart
     * - red-flag restart
     *
     * Yellow → GREEN does not restart
     * the leader-gap phase.
     */
    if (
      isRaceStart ||
      isSafetyCarRestart ||
      isVscRestart ||
      isRedFlagRestart ||
      isEarlyYellowReturn
    ) {
      this.leaderGapModeActive = true;

      this.spreadConfirmationSeconds = 0;
      this.lastSpreadCheckSecond = null;
    }

    /*
     * Hide the leaderboard for one full lap only after:
     * - race start
     * - SC restart
     * - red-flag restart
     * - Yellow → GREEN during lap 1
     *
     * VSC returns the leaderboard immediately
     * when its status disappears.
     *
     * Yellow after lap 1 also returns the
     * leaderboard immediately.
     */
    const shouldStartOneLapHide =
      isRaceStart ||
      isSafetyCarRestart ||
      isVscRestart ||
      isRedFlagRestart ||
      isEarlyYellowReturn;

    /*
     * Use the most current authoritative leader lap
     * available at the moment GREEN is processed.
     */
    const currentLeaderLap = Math.max(
      this.leaderboardService.getLeaderLap(),
      this.leaderLap,
      1,
    );

    if (shouldStartOneLapHide) {
      /*
       * Hide for one complete leader lap after
       * race start / SC restart / red flag restart /
       * opening-lap Yellow → GREEN.
       */
      this.hideLeaderboardUntilLap = currentLeaderLap + 1;
    } else if (
      this.hideLeaderboardUntilLap !== null &&
      currentLeaderLap < this.hideLeaderboardUntilLap
    ) {
      /*
       * An existing mandatory one-lap hide is still active.
       *
       * VSC or a normal Yellow → GREEN must NOT
       * cancel it prematurely.
       */
      // Keep existing hide window.
    } else {
      /*
       * No active mandatory hide window remains.
       *
       * VSC → GREEN and normal Yellow → GREEN
       * can show the leaderboard immediately.
       */
      this.hideLeaderboardUntilLap = null;
    }

    this.greenLap = currentLeaderLap;

    this.restartType = null;
    this.yellowStartedDuringOpeningLap = false;

    this.clearTemporaryMode();

    this.updateBaseMode();
  }

  ngOnInit(): void {
    this.leaderboardService.leaderboard$.subscribe((state) => {
      this.leaderboard = state.entries;
      this.leaderLap = state.leaderLap;
      this.totalLaps = state.totalLaps;
      this.raceFinished = state.raceFinished;
      this.updateBaseMode();

      requestAnimationFrame(() => this.runFLIP());
    });

    this.layoutScale.metrics$.subscribe((layout) => {
      this.mobileScale = layout.scale;
    });

    this.raceFinish.finishedDrivers$.subscribe((drivers) => {
      this.finishedDrivers = drivers;

      drivers.forEach((driver) => {
        if (this.alreadyAnimatedDrivers.has(driver)) {
          return;
        }

        this.alreadyAnimatedDrivers.add(driver);
        this.animatingFinishFlags.add(driver);

        setTimeout(() => {
          this.animatingFinishFlags.delete(driver);
        }, 2200);
      });
    });

    this.fastestLap.fastestDriver$.subscribe((driver) => {
      this.fastestLapDriver = driver;
    });
  }

  ngAfterViewInit(): void {
    this.runFLIP();
  }

  ngOnDestroy(): void {}

  /* ===================================================== */
  /* 🔑 BROADCAST RULE GETTERS (CORRECTED)                 */
  /* ===================================================== */

  /** Hide leaderboard under flags + 1 lap after GREEN */
  get hideLeaderboard(): boolean {
    // Always show the official starting grid before the race starts
    if (this.leaderboardService.isShowingStartingGrid()) {
      return false;
    }

    /*
     * Before the first GREEN event,
     * the live leaderboard is hidden.
     */
    if (this.greenLap === null) {
      return true;
    }

    /*
     * Always hide during:
     * - RED
     * - SC
     * - VSC
     * - VSC ENDING
     */
    if (
      this.trackStatus === 'RED' ||
      this.trackStatus === 'SC' ||
      this.trackStatus === 'VSC' ||
      this.trackStatus === 'VSC_ENDING'
    ) {
      return true;
    }

    /*
     * Mandatory one-lap hiding after:
     * - race start
     * - SC restart
     * - VSC restart
     * - red-flag restart
     * - Yellow → GREEN during opening lap
     *
     * This check MUST happen before YELLOW,
     * because Yellow during this protected lap
     * must not reveal the leaderboard.
     */
    if (
      this.hideLeaderboardUntilLap !== null &&
      this.leaderLap < this.hideLeaderboardUntilLap
    ) {
      return true;
    }

    /*
     * YELLOW normally keeps the leaderboard visible.
     *
     * Driver rows are compacted while the
     * Yellow Flag banner is displayed.
     */
    if (this.trackStatus === 'YELLOW') {
      return false;
    }

    return false;
  }

  get activeDisplayMode(): LeaderboardDisplayMode {
    return this.activeTemporaryMode ?? this.baseMode;
  }

  get isTemporaryModeActive(): boolean {
    return this.activeTemporaryMode !== null;
  }

  private updateBaseMode(): void {
    /*
     * Nothing to do if we are not inside an
     * automatic leader-gap phase.
     */
    if (!this.leaderGapModeActive) {
      this.baseMode = 'INTERVAL';
      return;
    }

    /*
     * During SC / VSC / VSC_ENDING / RED / YELLOW:
     *
     * - do not evaluate field spread
     * - do not advance the confirmation counter
     *
     * The existing UI may hide the leaderboard during
     * these statuses, but the automatic mode state remains
     * intact until GREEN.
     */
    if (this.trackStatus !== null && this.trackStatus !== 'GREEN') {
      this.baseMode = 'LEADER_GAP';
      return;
    }

    /*
     * The first lap after GREEN is intentionally hidden.
     *
     * Do not count field-spread confirmation while the
     * leaderboard is invisible.
     */
    if (
      this.hideLeaderboardUntilLap !== null &&
      this.leaderLap < this.hideLeaderboardUntilLap
    ) {
      this.spreadConfirmationSeconds = 0;
      this.lastSpreadCheckSecond = null;

      this.baseMode = 'LEADER_GAP';
      return;
    }

    /*
     * We only count once per race-clock second.
     *
     * The leaderboard can receive many visual updates
     * between race seconds.
     */
    const currentSecond = this.raceClock.getCurrentSecond();

    if (this.lastSpreadCheckSecond !== currentSecond) {
      this.lastSpreadCheckSecond = currentSecond;

      if (this.isFieldSpreadOut(this.leaderboard)) {
        this.spreadConfirmationSeconds++;
      } else {
        this.spreadConfirmationSeconds = 0;
      }

      /*
       * Require the field to remain spread for
       * consecutive race seconds.
       */
      if (
        this.spreadConfirmationSeconds >= this.FIELD_SPREAD_CONFIRMATION_SECONDS
      ) {
        this.leaderGapModeActive = false;
      }
    }

    this.baseMode = this.leaderGapModeActive ? 'LEADER_GAP' : 'INTERVAL';
  }

  private isFieldSpreadOut(entries: LeaderboardEntry[]): boolean {
    const activeEntries = entries.filter(
      (entry) => entry.status !== 'OUT' && (entry.lapsDown ?? 0) === 0,
    );

    /*
     * We need enough cars for "field spread"
     * to mean anything.
     */
    if (activeEntries.length < 5) {
      return false;
    }

    const intervals = activeEntries
      .slice(1)
      .map((entry) => entry.intervalGap)
      .filter(
        (gap): gap is number => gap != null && Number.isFinite(gap) && gap >= 0,
      )
      .sort((a, b) => a - b);

    if (intervals.length < 4) {
      return false;
    }

    const middle = Math.floor(intervals.length / 2);

    const medianInterval =
      intervals.length % 2 === 0
        ? (intervals[middle - 1] + intervals[middle]) / 2
        : intervals[middle];

    return medianInterval >= this.FIELD_SPREAD_INTERVAL_THRESHOLD;
  }

  /* ===================================================== */
  /* FLIP ANIMATION                                        */
  /* ===================================================== */
  private runFLIP(): void {
    if (this.leaderboardService.isShowingStartingGrid()) {
      return;
    }

    if (!this.rows || this.hideLeaderboard) return;

    this.rows.forEach((rowRef) => {
      const row = rowRef.nativeElement;
      const driver = row.dataset['driver'];
      if (!driver) return;

      const prevTop = this.rowPositions.get(driver);
      const newTop = row.offsetTop;

      if (prevTop !== undefined && prevTop !== newTop) {
        const movedUp = newTop < prevTop;

        const rowHeight = row.offsetHeight || 32;

        const placesChanged = Math.max(
          1,
          Math.round(Math.abs(prevTop - newTop) / rowHeight),
        );

        this.spawnPositionArrow(
          row,
          movedUp ? 'up' : 'down',
          Math.round(placesChanged),
        );

        row.style.transition = 'none';
        row.style.transform = `translateY(${prevTop - newTop}px)`;

        requestAnimationFrame(() => {
          row.style.transition = 'transform 220ms cubic-bezier(0.4, 0, 0.2, 1)';
          row.style.transform = '';
        });
      }

      this.rowPositions.set(driver, newTop);
    });
  }

  private spawnPositionArrow(
    row: HTMLElement,
    direction: 'up' | 'down',
    places: number,
  ): void {
    const driver = row.dataset['driver'];

    if (!driver) return;

    const positionBox = row.querySelector('.position') as HTMLElement | null;

    const posNumber = row.querySelector('.pos-number') as HTMLElement | null;

    if (!positionBox || !posNumber) return;

    // remove old arrow if already active
    const existingArrow = this.displayedArrows.get(driver);

    if (existingArrow) {
      existingArrow.remove();
      this.displayedArrows.delete(driver);
    }

    positionBox.classList.add('arrow-active');

    const arrow = document.createElement('div');

    arrow.className = `flip-overtake-arrow ${direction}`;

    arrow.style.color = direction === 'up' ? '#00ff87' : '#ff3b3b';

    arrow.textContent =
      places > 1
        ? `${direction === 'up' ? '▲' : '▼'}${places}`
        : direction === 'up'
          ? '▲'
          : '▼';

    positionBox.appendChild(arrow);

    this.displayedArrows.set(driver, arrow);

    const currentArrow = arrow;

    setTimeout(() => {
      const activeArrow = this.displayedArrows.get(driver);

      // another newer arrow already exists
      if (activeArrow !== currentArrow) {
        return;
      }

      currentArrow.remove();

      positionBox.classList.remove('arrow-active');

      this.displayedArrows.delete(driver);
    }, 1200);
  }

  /* ===================================================== */
  /* UI HELPERS                                            */
  /* ===================================================== */

  getDriverTeam(driverCode: string): string | undefined {
    return this.driverMeta.getTeamByDriverCode(driverCode);
  }

  onTeamLogoError(event: Event): void {
    const img = event.target as HTMLImageElement;
    img.src = 'assets/team-logos/plcholder.svg';
    img.className = 'plcholder';
  }

  getDriverColor(driverCode: string): string {
    return this.driverMeta.get(driverCode)?.color ?? '#888888';
  }

  trackByDriver(_: number, row: LeaderboardEntry) {
    return row.driver;
  }

  isDriverFinished(driver: string): boolean {
    return this.finishedDrivers.has(driver);
  }

  isFastestLapHolder(driver: string): boolean {
    return this.fastestLapDriver === driver;
  }

  isFinishFlagAnimating(driver: string): boolean {
    return this.animatingFinishFlags.has(driver);
  }

  isHighlighted(driver: string): boolean {
    return this.highlightedDrivers.some((d) => d.driver === driver);
  }

  getHighlightColor(driver: string): string | null {
    return (
      this.highlightedDrivers.find((d) => d.driver === driver)?.color ?? null
    );
  }

  get isShowingStartingGrid(): boolean {
    return this.leaderboardService.isShowingStartingGrid();
  }

  getGainLossClass(row: LeaderboardEntry): string | null {
    // Only apply colours in Gain/Loss mode
    if (this.activeDisplayMode !== 'GAINED_LOST') {
      return null;
    }

    // OUT drivers should not be coloured
    if (row.status === 'OUT') {
      return null;
    }

    const startPos = this.leaderboardService.getStartingPosition(row.driver);

    if (startPos == null) {
      return null;
    }

    const delta = startPos - row.position;

    if (delta > 0) {
      return 'gain';
    }

    if (delta < 0) {
      return 'loss';
    }

    return 'same';
  }

  /* ===================================================== */
  /* TOGGLES                                               */
  /* ===================================================== */

  showTyreLife(): void {
    this.leaderboardDisplay.showTemporaryMode('TYRE');
  }

  showPitStopsTemporarily(): void {
    this.leaderboardDisplay.showTemporaryMode('PIT');
  }

  showLappedTemporarily(): void {
    this.leaderboardDisplay.showTemporaryMode('LAPPED');
  }

  private clearTemporaryMode(): void {
    this.leaderboardDisplay.clearTemporaryMode();
  }

  private formatGap(seconds: number): string {
    /**
     * Under 2 minutes:
     * +12.3
     */
    if (seconds < 120) {
      return `+${seconds.toFixed(1)}`;
    }

    /**
     * 2 minutes or more:
     * 2:03.4
     */
    const minutes = Math.floor(seconds / 60);

    const remainingSeconds = seconds % 60;

    const wholeSeconds = Math.floor(remainingSeconds);

    const tenth = Math.floor((remainingSeconds % 1) * 10);

    return `+${minutes}:${String(wholeSeconds).padStart(2, '0')}.${tenth}`;
  }

  /* ===================================================== */
  /* GAP FORMATTERS                                        */
  /* ===================================================== */

  formatDisplayValue(row: LeaderboardEntry): string {
    if (
      row.isOfficialClassification &&
      this.activeDisplayMode !== 'TYRE' &&
      this.activeDisplayMode !== 'PIT' &&
      this.activeDisplayMode !== 'LAPPED'
    ) {
      return row.displayGap ?? '–';
    }

    if (row.status === 'OUT') {
      return this.activeDisplayMode === 'TYRE' ||
        this.activeDisplayMode === 'PIT'
        ? '–'
        : 'OUT';
    }

    switch (this.activeDisplayMode) {
      case 'LEADER_GAP':
        return this.formatLeaderGap(row);
      case 'INTERVAL':
        return this.formatIntervalGap(row);
      case 'TYRE':
        return row.tyreLife != null ? String(row.tyreLife) : '–';
      case 'PIT':
        return row.pitStops != null ? String(row.pitStops) : '0';
      case 'LAPPED':
        return this.formatLappedMode(row);
      case 'GAINED_LOST':
        return this.formatGainLoss(row);

      default:
        return this.formatIntervalGap(row);
    }
  }

  formatLeaderGap(row: LeaderboardEntry): string {
    // 🚧 PIT HAS HIGHEST PRIORITY
    if (row.isInPit) return 'IN PIT';

    if (row.position === 1) return 'Leader';

    return row.gapToLeader != null ? this.formatGap(row.gapToLeader) : '–';
  }

  formatIntervalGap(row: LeaderboardEntry): string {
    // 🚧 PIT HAS HIGHEST PRIORITY
    if (row.isInPit) return 'IN PIT';

    // PRE-RACE STARTING GRID
    if (this.leaderboardService.isShowingStartingGrid()) {
      return row.tyreLife != null ? `${row.tyreLife}` : '–';
    }

    if (row.position === 1) return 'Interval';

    return row.intervalGap != null ? this.formatGap(row.intervalGap) : '–';
  }

  private formatLappedMode(row: LeaderboardEntry): string {
    if (row.isInPit) return 'IN PIT';

    if (row.position === 1) return 'Leader';

    const lapsDown = row.lapsDown ?? 0;

    /**
     * EDGE CASE:
     * leader just crossed line,
     * but car is still effectively close
     *
     * show reconstructed time gap instead
     * of ugly +1 LAP jump
     */
    if (lapsDown === 1 && row.gapToLeader != null && row.gapToLeader < 120) {
      return this.formatGap(row.gapToLeader);
    }

    /**
     * Genuine lapped cars
     */
    if (lapsDown > 0) {
      return `+${lapsDown} ${lapsDown === 1 ? 'LAP' : 'LAPS'}`;
    }

    return this.formatLeaderGap(row);
  }

  private formatGainLoss(row: LeaderboardEntry): string {
    if (row.isInPit) {
      return 'IN PIT';
    }

    const startPos = this.leaderboardService.getStartingPosition(row.driver);

    if (startPos == null) {
      return '–';
    }

    const delta = startPos - row.position;

    if (delta > 0) {
      return `▲ ${delta}`;
    }

    if (delta < 0) {
      return `▼ ${Math.abs(delta)}`;
    }

    return '=';
  }

  @HostBinding('style.--mobile-scale')
  get mobileScaleCss(): number {
    return this.mobileScale;
  }
}
