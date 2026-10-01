import { Component, Input, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TelemetryCar } from '../../../core/models/race-telemetry.model';
import { TrackPoint } from '../../../core/models/track-data.model';
import { DriverMetaService } from '../../../core/services/driver-meta.service';
import { TelemetryInterpolationService } from '../../../core/services/telemetry-interpolation.service';
import { TrackMapStateService } from '../../../core/services/track-map-state.service';

@Component({
  selector: 'app-track-map',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './track-map.component.html',
  styleUrl: './track-map.component.scss',
})
export class TrackMapComponent implements OnInit {
  constructor(
    private interpolatedTelemetry: TelemetryInterpolationService,
    private driverMeta: DriverMetaService,
    private trackState: TrackMapStateService,
  ) {}

  /* ---------- TRACK DATA ---------- */
  trackPoints = '';
  viewBox = '';

  track: TrackPoint[] = [];
  trackInfo: any = null;

  startLine = { x1: 0, y1: 0, x2: 0, y2: 0 };
  arrow = { cx: 0, cy: 0, angle: 0 };

  /* ---------- CARS ---------- */
  cars: TelemetryCar[] = [];

  /* ---------- TRACK STATE ---------- */
  trackReady = false;

  @Input() highlightedDrivers: {
    driver: string | null;
    color: string;
  }[] = [];

  isMirrored = false;

  ngOnInit(): void {
    /* ---------- TRACK DATA (ASYNC SAFE) ---------- */
    this.trackState.trackData$.subscribe((data) => {
      if (!data) return;

      this.track = data.coordinates;
      this.trackInfo = data.trackInfo;

      this.buildTrack();
    });

    /* ---------- MIRROR STATE ---------- */
    this.trackState.mirrored$.subscribe((mirrored) => {
      this.isMirrored = mirrored;
    });

    /* ---------- TELEMETRY with INTERPOLATION ADDED ---------- */
    this.interpolatedTelemetry.interpolatedFrame$.subscribe((frame) => {
      if (!frame) {
        this.cars = [];
        return;
      }

      this.cars = frame.cars;
    });
  }

  /* ===================================================== */
  /* TRACK BUILDING                                        */
  /* ===================================================== */

  private buildTrack(): void {
    /* ---------- SVG POLYLINE ---------- */
    this.trackPoints = this.track.map((p) => `${p.x},${p.y}`).join(' ');

    const xs = this.track.map((p) => p.x);
    const ys = this.track.map((p) => p.y);
    const padding = 380;

    this.viewBox = [
      Math.min(...xs) - padding,
      Math.min(...ys) - padding,
      Math.max(...xs) - Math.min(...xs) + padding * 2,
      Math.max(...ys) - Math.min(...ys) + padding * 2,
    ].join(' ');

    /* ---------- START / FINISH ---------- */
    const startIndex = this.track.findIndex((p) => p.isStart);
    const finishIndex = this.track.findIndex((p) => p.isFinish);

    if (startIndex === -1 || finishIndex === -1) {
      throw new Error('Track must define isStart and isFinish');
    }

    /* ---------- START LINE + ARROW ---------- */
    if (startIndex < this.track.length - 1) {
      const p1 = this.track[startIndex];
      const p2 = this.track[startIndex + 1];

      const dx = p2.x - p1.x;
      const dy = p2.y - p1.y;
      const len = Math.hypot(dx, dy);

      const nx = -dy / len;
      const ny = dx / len;

      const halfWidth = 300;

      this.startLine = {
        x1: p1.x + nx * halfWidth,
        y1: p1.y + ny * halfWidth,
        x2: p1.x - nx * halfWidth,
        y2: p1.y - ny * halfWidth,
      };

      this.arrow = {
        cx: p1.x + nx * 740 - (dx / len) * 120,
        cy: p1.y + ny * 740 - (dy / len) * 120,
        angle: Math.atan2(dy, dx) * (180 / Math.PI),
      };
    }

    this.trackReady = true;

    // console.log('SVG track length:', this.totalTrackLength);
    // console.log('Real track length:', this.realTrackLengthMeters);
  }

  getCarColor(driver: string): string {
    return this.driverMeta.get(driver)?.color ?? '#ffffff';
  }

  isHighlighted(driver: string): boolean {
    return this.highlightedDrivers.some((d) => d.driver === driver);
  }

  getHighlightColor(driver: string): string {
    return (
      this.highlightedDrivers.find((d) => d.driver === driver)?.color ??
      '#ffffff'
    );
  }
}
