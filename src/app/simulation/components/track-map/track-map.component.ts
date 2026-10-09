import {
  Component,
  ElementRef,
  Input,
  OnChanges,
  OnDestroy,
  OnInit,
  SimpleChanges,
  ViewChild,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { TelemetryCar } from '../../../core/models/race-telemetry.model';
import { TrackPoint } from '../../../core/models/track-data.model';
import { DriverMetaService } from '../../../core/services/driver-meta.service';
import { TelemetryInterpolationService } from '../../../core/services/telemetry-interpolation.service';
import { TrackMapStateService } from '../../../core/services/track-map-state.service';

interface DriverBroadcastLabel {
  driver: string;
  code: string;
  color: string;
  left: number;
  top: number;

  // Connector coordinates, relative to the track container.
  lineStartX: number;
  lineStartY: number;
  lineEndX: number;
  lineEndY: number;
}

interface LabelCandidate {
  left: number;
  top: number;
  preference: number;
}

@Component({
  selector: 'app-track-map',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './track-map.component.html',
  styleUrl: './track-map.component.scss',
})
export class TrackMapComponent implements OnInit, OnChanges, OnDestroy {
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

  /* ---------- DRIVER BROADCAST LABELS ---------- */

  driverLabels: DriverBroadcastLabel[] = [];

  // Coordinate system for the connector SVG, in CSS pixels.
  labelConnectorViewBox = '0 0 1 1';

  // Remember each driver's preferred label position to prevent jitter.
  private labelPlacementByDriver = new Map<string, number>();

  private trackContainerElement: HTMLDivElement | null = null;
  private trackSvgElement: SVGSVGElement | null = null;

  private resizeObserver: ResizeObserver | null = null;
  private labelUpdateFrame: number | null = null;

  // Fixed screen-space dimensions, in CSS pixels.
  private readonly LABEL_WIDTH = 84;
  private readonly LABEL_HEIGHT = 32;
  private readonly LABEL_GAP = 10;
  private readonly EDGE_MARGIN = 4;

  @ViewChild('trackContainer')
  set trackContainerRef(ref: ElementRef<HTMLDivElement> | undefined) {
    this.trackContainerElement = ref?.nativeElement ?? null;

    this.resizeObserver?.disconnect();
    this.resizeObserver = null;

    if (this.trackContainerElement && typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(() => {
        this.scheduleDriverLabelUpdate();
      });

      this.resizeObserver.observe(this.trackContainerElement);
    }

    this.scheduleDriverLabelUpdate();
  }

  @ViewChild('trackSvg')
  set trackSvgRef(ref: ElementRef<SVGSVGElement> | undefined) {
    this.trackSvgElement = ref?.nativeElement ?? null;
    this.scheduleDriverLabelUpdate();
  }

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
      this.scheduleDriverLabelUpdate();
    });

    /* ---------- TELEMETRY with INTERPOLATION ADDED ---------- */
    this.interpolatedTelemetry.interpolatedFrame$.subscribe((frame) => {
      if (!frame) {
        this.cars = [];
        this.driverLabels = [];
        return;
      }

      this.cars = frame.cars;
      this.scheduleDriverLabelUpdate();
    });
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['highlightedDrivers']) {
      this.scheduleDriverLabelUpdate();
    }
  }

  /* ===================================================== */
  /* TRACK BUILDING                                        */
  /* ===================================================== */

  private buildTrack(): void {
    /* ---------- SVG POLYLINE ---------- */
    this.trackPoints = this.track.map((p) => `${p.x},${p.y}`).join(' ');

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

    /* ---------- VIEWBOX ---------- */
    const geometry = [
      ...this.track,
      {
        x: this.startLine.x1,
        y: this.startLine.y1,
      },
      {
        x: this.startLine.x2,
        y: this.startLine.y2,
      },
    ];

    const xs = geometry.map((p) => p.x);
    const ys = geometry.map((p) => p.y);

    const padding = 220;

    this.viewBox = [
      Math.min(...xs) - padding,
      Math.min(...ys) - padding,
      Math.max(...xs) - Math.min(...xs) + padding * 2,
      Math.max(...ys) - Math.min(...ys) + padding * 2,
    ].join(' ');

    this.trackReady = true;

    this.scheduleDriverLabelUpdate();

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

  getDriverCode(driver: string): string {
    return this.driverMeta.get(driver)?.driverCode ?? driver;
  }

  private scheduleDriverLabelUpdate(): void {
    // Do not cancel an already scheduled update.
    // Telemetry may emit repeatedly before the next animation frame.
    if (this.labelUpdateFrame !== null) {
      return;
    }

    this.labelUpdateFrame = requestAnimationFrame(() => {
      this.labelUpdateFrame = null;
      this.updateDriverLabelPositions();
    });
  }

  private updateDriverLabelPositions(): void {
    const container = this.trackContainerElement;
    const svg = this.trackSvgElement;

    if (!container || !svg || !this.cars.length) {
      this.driverLabels = [];
      this.labelPlacementByDriver.clear();
      return;
    }

    const matrix = svg.getScreenCTM();

    if (!matrix) {
      this.driverLabels = [];
      return;
    }

    const bounds = container.getBoundingClientRect();
    const containerWidth = bounds.width;
    const containerHeight = bounds.height;

    // Smaller labels on phones and other compact touch devices.
    const compact = window.matchMedia(
      '(max-width: 1024px) and (orientation: landscape) and (pointer: coarse)',
    ).matches;

    const labelWidth = compact ? 70 : this.LABEL_WIDTH;
    const labelHeight = compact ? 27 : this.LABEL_HEIGHT;
    const labelGap = compact ? 7 : this.LABEL_GAP;
    const edgeMargin = compact ? 5 : this.EDGE_MARGIN;

    // The connector SVG uses the same coordinate system as the overlay.
    this.labelConnectorViewBox = `0 0 ${Math.max(1, containerWidth)} ${Math.max(1, containerHeight)}`;

    const selectedCars: {
      driver: string;
      x: number;
      y: number;
    }[] = [];

    // Convert each selected driver's SVG position to screen coordinates.
    for (const highlighted of this.highlightedDrivers) {
      const driver = highlighted.driver;

      if (!driver) {
        continue;
      }

      const car = this.cars.find((item) => item.driver === driver);

      if (!car) {
        continue;
      }

      const point = svg.createSVGPoint();
      point.x = car.x;
      point.y = car.y;

      const screenPoint = point.matrixTransform(matrix);

      selectedCars.push({
        driver,
        x: screenPoint.x - bounds.left,
        y: screenPoint.y - bounds.top,
      });
    }

    // Forget placement preferences for drivers that are no longer selected.
    const activeDrivers = new Set(
      selectedCars.map((selected) => selected.driver),
    );

    for (const driver of this.labelPlacementByDriver.keys()) {
      if (!activeDrivers.has(driver)) {
        this.labelPlacementByDriver.delete(driver);
      }
    }

    // Approximate the selected dot's radius in screen pixels.
    const dotRadius =
      125 *
      Math.max(Math.hypot(matrix.a, matrix.b), Math.hypot(matrix.c, matrix.d));

    const maxLeft = Math.max(
      edgeMargin,
      containerWidth - labelWidth - edgeMargin,
    );

    const maxTop = Math.max(
      edgeMargin,
      containerHeight - labelHeight - edgeMargin,
    );

    const clampLeft = (left: number): number =>
      Math.max(edgeMargin, Math.min(left, maxLeft));

    const clampTop = (top: number): number =>
      Math.max(edgeMargin, Math.min(top, maxTop));

    const placedLabels: DriverBroadcastLabel[] = [];

    // Measure overlap against labels already positioned this frame.
    const overlapAreaAt = (left: number, top: number): number =>
      placedLabels.reduce((area, previous) => {
        const overlapWidth = Math.max(
          0,
          Math.min(left + labelWidth, previous.left + labelWidth) -
            Math.max(left, previous.left),
        );

        const overlapHeight = Math.max(
          0,
          Math.min(top + labelHeight, previous.top + labelHeight) -
            Math.max(top, previous.top),
        );

        return area + overlapWidth * overlapHeight;
      }, 0);

    const fitsInside = (candidate: LabelCandidate): boolean =>
      candidate.left >= edgeMargin &&
      candidate.top >= edgeMargin &&
      candidate.left + labelWidth <= containerWidth - edgeMargin &&
      candidate.top + labelHeight <= containerHeight - edgeMargin;

    for (const selected of selectedCars) {
      const { driver, x, y } = selected;
      const metadata = this.driverMeta.get(driver);

      // Position order: top-right, top-left, bottom-right, bottom-left.
      const candidates: LabelCandidate[] = [
        {
          left: x + dotRadius + labelGap,
          top: y - dotRadius - labelHeight - labelGap,
          preference: 0,
        },
        {
          left: x - dotRadius - labelWidth - labelGap,
          top: y - dotRadius - labelHeight - labelGap,
          preference: 1,
        },
        {
          left: x + dotRadius + labelGap,
          top: y + dotRadius + labelGap,
          preference: 2,
        },
        {
          left: x - dotRadius - labelWidth - labelGap,
          top: y + dotRadius + labelGap,
          preference: 3,
        },
      ];

      const fittingIndices = candidates
        .map((candidate, index) => (fitsInside(candidate) ? index : -1))
        .filter((index) => index !== -1);

      // Prefer a position that avoids overlapping another driver's label.
      const chooseFittingCandidate = (indices: number[]): number =>
        [...indices].sort((a, b) => {
          const scoreA = overlapAreaAt(candidates[a].left, candidates[a].top);

          const scoreB = overlapAreaAt(candidates[b].left, candidates[b].top);

          return (
            scoreA - scoreB ||
            candidates[a].preference - candidates[b].preference
          );
        })[0];

      let chosenIndex = this.labelPlacementByDriver.get(driver);

      if (chosenIndex === undefined) {
        // Initial placement: find a fitting position.
        if (fittingIndices.length) {
          chosenIndex = chooseFittingCandidate(fittingIndices);
        } else {
          // If no candidate fully fits, choose the least-displaced position.
          chosenIndex = candidates
            .map((candidate, index) => {
              const left = clampLeft(candidate.left);
              const top = clampTop(candidate.top);

              const displacement =
                Math.abs(left - candidate.left) + Math.abs(top - candidate.top);

              return {
                index,
                score:
                  displacement * 100 +
                  overlapAreaAt(left, top) * 10_000 +
                  candidate.preference,
              };
            })
            .sort((a, b) => a.score - b.score)[0].index;
        }
      } else if (!fitsInside(candidates[chosenIndex])) {
        // Keep the current side while it fits.
        // Switch only when it no longer fits and an alternative does.
        if (fittingIndices.length) {
          chosenIndex = chooseFittingCandidate(fittingIndices);
        }
        // If no alternative fits, retain the side and clamp the box.
      }

      this.labelPlacementByDriver.set(driver, chosenIndex);

      const candidate = candidates[chosenIndex];
      const left = clampLeft(candidate.left);
      const top = clampTop(candidate.top);

      // Find the nearest point on the label box to the dot's center.
      const lineEndX = Math.max(left, Math.min(x, left + labelWidth));
      const lineEndY = Math.max(top, Math.min(y, top + labelHeight));

      placedLabels.push({
        driver,
        code: metadata?.driverCode ?? driver,
        color: metadata?.color ?? '#888888',
        left,
        top,

        // Start at the center of the driver dot.
        lineStartX: x,
        lineStartY: y,

        // Finish at the nearest edge of the label box.
        lineEndX,
        lineEndY,
      });
    }

    this.driverLabels = placedLabels;
  }

  trackByDriverLabel(_index: number, label: DriverBroadcastLabel): string {
    return label.driver;
  }

  ngOnDestroy(): void {
    this.resizeObserver?.disconnect();

    if (this.labelUpdateFrame !== null) {
      cancelAnimationFrame(this.labelUpdateFrame);
    }
  }
}
