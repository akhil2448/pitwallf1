import {
  Component,
  OnInit,
  inject,
  HostListener,
  OnDestroy,
  DestroyRef,
} from '@angular/core';
import { Location } from '@angular/common';

import { RaceContextService } from '../../core/services/race-context.service';
import { RaceComparisonResponse } from '../../comparison/models/race-comparison.model';
import { ComparisonTrackMapComponent } from '../../comparison/components/comparison-track-map/comparison-track-map.component';
import { TelemetryPanelComponent } from '../../comparison/components/telemetry-panel/telemetry-panel.component';
import { LapPlaybackService } from '../../comparison/services/lap-playback.service';
import { PlaybackControlsComponent } from '../../comparison/components/playback-controls/playback-controls.component';
import { DriverCardComponent } from '../../comparison/components/driver-card/driver-card.component';
import { SectorDisplay } from '../../comparison/models/sector-display.model';
import { ComparisonThemeService } from '../../comparison/services/comparison-theme.service';
import { ComparisonTheme } from '../../comparison/models/comparison-theme.model';
import { ConfirmationDialogComponent } from '../../shared/components/confirmation-dialog/confirmation-dialog.component';
import { Router } from '@angular/router';
import { LoadingOverlayService } from '../../core/services/loading-overlay.service';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { SupportButtonComponent } from '../../shared/components/support-button/support-button.component';

@Component({
  selector: 'app-race-comparison-page',
  standalone: true,
  imports: [
    ComparisonTrackMapComponent,
    TelemetryPanelComponent,
    PlaybackControlsComponent,
    DriverCardComponent,
    ConfirmationDialogComponent,
    SupportButtonComponent,
  ],
  templateUrl: './race-comparison-page.component.html',
  styleUrl: './race-comparison-page.component.scss',
})
export class RaceComparisonPageComponent implements OnInit, OnDestroy {
  readonly playbackService = inject(LapPlaybackService);
  private readonly raceContext = inject(RaceContextService);
  private readonly overlay = inject(LoadingOverlayService);
  private readonly router = inject(Router);
  private readonly location = inject(Location);
  private themeService = inject(ComparisonThemeService);
  private destroyRef = inject(DestroyRef);

  comparison: RaceComparisonResponse | null = null;
  theme!: ComparisonTheme;

  private readonly MIN_BACK_LOADING_MS = 1000;
  loading = true;
  showExitDialog = false;

  ngOnInit(): void {
    const response = this.raceContext.comparison;

    if (!response) {
      this.redirectToPerformanceLab();
      return;
    }

    this.comparison = response;

    this.theme = this.themeService.buildTheme(
      response.driverA.teamColor,
      response.driverB?.teamColor ?? response.driverA.teamColor,
    );

    // Changed this from min to max to accomodate the bug of playback stopping when the fastest driver
    // finished the lap, the playback stops, leaving the trailing driver behind finish line when
    // playback stops.
    const referenceLapTime = Math.max(
      response.driverA.lapTime,
      response.driverB?.lapTime ?? response.driverA.lapTime,
    );

    this.playbackService.loadLap(
      response.driverA.telemetry,
      response.driverB?.telemetry ?? null,
      referenceLapTime,
    );

    this.stepForward();

    this.loading = false;

    this.playbackService.currentFrame$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((frame) => {
        if (!frame) {
          return;
        }

        // console.log(frame);
      });
  }

  get driverASector1() {
    return this.getSectorDisplay(1, 'A');
  }

  get driverASector2() {
    return this.getSectorDisplay(2, 'A');
  }

  get driverASector3() {
    return this.getSectorDisplay(3, 'A');
  }

  get driverBSector1() {
    return this.getSectorDisplay(1, 'B');
  }

  get driverBSector2() {
    return this.getSectorDisplay(2, 'B');
  }

  get driverBSector3() {
    return this.getSectorDisplay(3, 'B');
  }

  private getSectorDisplay(
    sector: 1 | 2 | 3,
    driver: 'A' | 'B',
  ): SectorDisplay {
    if (!this.comparison?.driverB) {
      return {
        text: null,
        color: 'white',
        isSessionFastest: false,
      };
    }

    const driverA = this.comparison.driverA;
    const driverB = this.comparison.driverB;

    const elapsedA = this.driverAElapsedTime;
    const elapsedB = this.driverBElapsedTime;

    const myElapsed = driver === 'A' ? elapsedA : elapsedB;

    const sectorEndA =
      sector === 1
        ? driverA.sector1
        : sector === 2
          ? driverA.sector1 + driverA.sector2
          : driverA.lapTime;

    const sectorEndB =
      sector === 1
        ? driverB.sector1
        : sector === 2
          ? driverB.sector1 + driverB.sector2
          : driverB.lapTime;

    const mySectorEnd = driver === 'A' ? sectorEndA : sectorEndB;

    if (myElapsed < mySectorEnd) {
      return {
        text: null,
        color: 'white',
        isSessionFastest: false,
      };
    }

    const timeA =
      sector === 1
        ? driverA.sector1
        : sector === 2
          ? driverA.sector2
          : driverA.sector3;

    const timeB =
      sector === 1
        ? driverB.sector1
        : sector === 2
          ? driverB.sector2
          : driverB.sector3;

    const myTime = driver === 'A' ? timeA : timeB;
    const otherTime = driver === 'A' ? timeB : timeA;

    const winner = myTime <= otherTime;

    const isSessionFastest =
      driver === 'A'
        ? sector === 1
          ? driverA.isSector1SessionFastest
          : sector === 2
            ? driverA.isSector2SessionFastest
            : driverA.isSector3SessionFastest
        : sector === 1
          ? driverB.isSector1SessionFastest
          : sector === 2
            ? driverB.isSector2SessionFastest
            : driverB.isSector3SessionFastest;

    const color = isSessionFastest
      ? '#b25cff' // Purple
      : winner
        ? '#00d25a'
        : '#ffd400';

    return {
      text: winner ? myTime.toFixed(3) : `+${(myTime - otherTime).toFixed(3)}`,
      color,
      isSessionFastest,
    };
  }

  stepForward(): void {
    this.playbackService.stepForward();
  }

  stepBackward(): void {
    this.playbackService.stepBackward();
  }

  get driverAElapsedTime(): number {
    return this.playbackService.currentFrame?.driverA?.elapsedTime ?? 0;
  }

  get driverBElapsedTime(): number {
    return this.playbackService.currentFrame?.driverB?.elapsedTime ?? 0;
  }

  get driverAGap(): number | null {
    if (!this.comparison?.driverB) return null;

    const driverAFrame = this.playbackService.currentFrame?.driverA;
    const driverBFrame = this.playbackService.currentFrame?.driverB;

    if (!driverAFrame || !driverBFrame) return null;

    const gap = driverAFrame.elapsedTime - driverBFrame.elapsedTime;

    return gap > 0 ? gap : null;
  }

  get driverBGap(): number | null {
    if (!this.comparison?.driverB) return null;

    const driverAFrame = this.playbackService.currentFrame?.driverA;
    const driverBFrame = this.playbackService.currentFrame?.driverB;

    if (!driverAFrame || !driverBFrame) return null;

    const gap = driverBFrame.elapsedTime - driverAFrame.elapsedTime;

    return gap > 0 ? gap : null;
  }

  togglePlay(): void {
    this.playbackService.toggle();
  }

  onBackClicked(): void {
    this.showExitDialog = true;
  }

  cancelExit(): void {
    this.showExitDialog = false;
  }

  async confirmExit(): Promise<void> {
    this.showExitDialog = false;

    this.overlay.show('Returning to Performance Lab...');

    const startTime = Date.now();

    try {
      const elapsed = Date.now() - startTime;

      const remaining = Math.max(0, this.MIN_BACK_LOADING_MS - elapsed);

      await this.delay(remaining);

      this.playbackService.destroy();

      this.raceContext.navigationStep = 'performance-lab';

      this.location.back();
    } finally {
      this.overlay.hide();
    }
  }

  private async redirectToPerformanceLab(): Promise<void> {
    this.overlay.show('Returning to Performance Lab...');

    await this.delay(800);

    this.overlay.hide();

    this.playbackService.destroy();

    this.raceContext.navigationStep = 'performance-lab';

    await this.router.navigate(['/performance-lab']);
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => {
      setTimeout(resolve, ms);
    });
  }

  @HostListener('window:beforeunload', ['$event'])
  beforeUnload(event: BeforeUnloadEvent): void {
    event.preventDefault();
    event.returnValue = '';
  }

  ngOnDestroy(): void {
    this.playbackService.destroy();
  }
}
