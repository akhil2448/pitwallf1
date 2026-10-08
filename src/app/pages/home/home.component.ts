import { Component, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';

import {
  AfterViewInit,
  ElementRef,
  QueryList,
  ViewChildren,
} from '@angular/core';
import { SupportButtonComponent } from '../../shared/components/support-button/support-button.component';
import { RaceContextService } from '../../core/services/race-context.service';
import { InstallPitwallDialogComponent } from '../../shared/components/install-pitwall-dialog/install-pitwall-dialog.component';
import { PwaService } from '../../core/services/pwa.service';

export interface Feature {
  title: string;
  description: string;
  extraNote?: string;
  extraNote2?: string;

  lab: 'simulation' | 'performance';

  type: 'video' | 'image';

  mediaUrl: string;
  posterUrl?: string;
}

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [
    CommonModule,
    SupportButtonComponent,
    InstallPitwallDialogComponent,
  ],
  templateUrl: './home.component.html',
  styleUrls: ['./home.component.scss'],
})
export class HomeComponent implements AfterViewInit {
  constructor(
    private router: Router,
    private raceContext: RaceContextService,
    public pwaService: PwaService,
  ) {}

  readonly showInstallDialog = signal(false);

  features: Feature[] = [
    // {
    //   title: 'Qualifying Results',
    //   description:
    //     'View qualifying lap times and starting grid before the race',
    //   type: 'image',
    //   mediaUrl: 'assets/features/qualifying-results.png',
    // },
    {
      title: 'Live Leaderboard',
      description:
        'Track every position change, interval and battle as the race unfolds',
      extraNote:
        '* Position gaps and intervals are calculated using FIA TIMING-LOOP principles',
      lab: 'simulation',
      type: 'video',
      mediaUrl: 'assets/features/live-leaderboard.mp4',
      posterUrl: 'assets/features/live-leaderboard-poster.webp',
    },
    // {
    //   title: 'Controls Area',
    //   description:
    //     'Check PitStop count, Tyre Age & Lapped Cars anytime on the go',
    //   lab: 'simulation',
    //   type: 'video',
    //   mediaUrl: 'assets/features/controls-area.mp4',
    // },
    {
      title: 'Interactive Track Map',
      description:
        'Watch every driver navigate the circuit with real-time car positioning',
      lab: 'simulation',
      type: 'video',
      mediaUrl: 'assets/features/track-map.mp4',
      posterUrl: 'assets/features/track-map-poster.webp',
    },
    // {
    //   title: 'Race Control Messages',
    //   description:
    //     'Follow official FIA race control events including flags, penalties and investigations',
    //   lab: 'simulation',
    //   type: 'video',
    //   mediaUrl: 'assets/features/race-control-messages.mp4',
    // },
    // {
    //   title: 'Weather Conditions',
    //   description:
    //     'Monitor track temperature, air temperature, humidity, wind and rainfall',
    //   lab: 'simulation',
    //   type: 'video',
    //   mediaUrl: 'assets/features/weather.mp4',
    // },
    // {
    //   title: 'Race Clock',
    //   description:
    //     'Control playback speed and relive the race at your own pace',
    //   extraNote:
    //     '* At 4x speed, a 90-minute race completes in approximately 22 minutes',
    //   lab: 'simulation',
    //   type: 'video',
    //   mediaUrl: 'assets/features/race-clock.mp4',
    // },
    {
      title: 'Driver Telemetry',
      description: 'Dive deeper into speed, throttle, brake, RPM and gear data',
      type: 'video',
      lab: 'simulation',
      mediaUrl: 'assets/features/driver-telemetry.mp4',
      posterUrl: 'assets/features/driver-telemetry-poster.webp',
    },
    {
      title: 'Red Flag Seek',
      description:
        'Jump directly to the race restart point when a red flag interrupts the session',
      lab: 'simulation',
      type: 'image',
      mediaUrl: 'assets/features/redflag-seek.webp',
    },
    {
      title: 'FIA Official Classification',
      description:
        'View the official FIA race classification, Fastest lap, and Championship standings at the chequered flag',
      lab: 'simulation',
      type: 'image',
      mediaUrl: 'assets/features/final-classification.webp',
    },

    {
      title: 'Performance Lab',
      description: 'Ultimate Pace & Race Management',
      extraNote: '* Ultimate Pace - Qualifying lap analysis.',
      extraNote2: `* Race Management - Explore recommended clean race laps (or) choose your own laps.`,
      lab: 'performance',
      type: 'video',
      mediaUrl: 'assets/features/performance-lab.mp4',
      posterUrl: 'assets/features/performance-lab-poster.webp',
    },

    {
      title: 'Analyze Race Performance',
      description: 'Compare your lap choices',
      extraNote: '* Select up to two laps from the performance chart.',
      lab: 'performance',
      type: 'video',
      mediaUrl: 'assets/features/analyze-race-performance.mp4',
      posterUrl: 'assets/features/analyze-race-performance-poster.webp',
    },

    {
      title: 'Compare Driving Styles',
      description:
        'Analyze race or qualifying laps side by side with synchronized telemetry graphs and track position playback.',
      extraNote:
        '* Hover over the telemetry graphs to view the per frame telemtry info.',
      lab: 'performance',
      type: 'video',
      mediaUrl: 'assets/features/comparison-telemetry.mp4',
      posterUrl: 'assets/features/comparison-telemetry-poster.webp',
    },
  ];

  readonly simulationFeatures = this.features.filter(
    (feature) => feature.lab === 'simulation',
  );

  readonly performanceFeatures = this.features.filter(
    (feature) => feature.lab === 'performance',
  );

  @ViewChildren('featureSection')
  featureSections!: QueryList<ElementRef>;

  visibleSections = new Set<number>();

  // ngAfterViewInit(): void {
  //   // window.addEventListener(
  //   //   'wheel',
  //   //   () => {
  //   //     document.querySelectorAll('video').forEach((video) => {
  //   //       const v = video as HTMLVideoElement;

  //   //       v.muted = true;
  //   //       v.play()
  //   //         .then(() => v.pause())
  //   //         .catch(() => {});
  //   //     });
  //   //   },
  //   //   { once: true },
  //   // );

  //   const observer = new IntersectionObserver(
  //     (entries) => {
  //       entries.forEach((entry) => {
  //         const index = Number(entry.target.getAttribute('data-index'));

  //         const video = entry.target.querySelector(
  //           'video',
  //         ) as HTMLVideoElement | null;

  //         if (entry.isIntersecting) {
  //           this.visibleSections.add(index);

  //           if (video) {
  //             // video.currentTime = 0;

  //             video.play().catch(() => {});
  //           }
  //         } else {
  //           if (video) {
  //             video.pause();
  //           }
  //         }
  //       });
  //     },
  //     {
  //       threshold: 0.7,
  //     },
  //   );

  //   this.featureSections.forEach((section) => {
  //     observer.observe(section.nativeElement);
  //   });
  // }

  ngAfterViewInit(): void {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          const index = Number(entry.target.getAttribute('data-index'));

          const video = entry.target.querySelector(
            'video',
          ) as HTMLVideoElement | null;

          if (entry.isIntersecting) {
            this.visibleSections.add(index);

            if (video) {
              video.muted = true;
              video.playsInline = true;

              video.play().catch(() => {});
            }
          } else {
            if (video) {
              video.pause();
            }
          }
        });
      },
      {
        threshold: 0.35,
      },
    );

    this.featureSections.forEach((section) => {
      observer.observe(section.nativeElement);
    });

    // Unlock autoplay on the first user scroll,
    // but ONLY for videos currently visible on screen.
    window.addEventListener(
      'wheel',
      () => {
        this.featureSections.forEach((section) => {
          const rect = section.nativeElement.getBoundingClientRect();

          const isVisible =
            rect.top < window.innerHeight * 0.8 &&
            rect.bottom > window.innerHeight * 0.2;

          if (!isVisible) {
            return;
          }

          const video = section.nativeElement.querySelector(
            'video',
          ) as HTMLVideoElement | null;

          if (video) {
            video.muted = true;
            video.playsInline = true;

            video.play().catch(() => {});
          }
        });
      },
      { once: true },
    );
  }

  scrollToFeature(feature: Feature): void {
    const featureIndex = this.features.indexOf(feature);

    if (featureIndex < 0) {
      return;
    }

    const section = this.featureSections.get(featureIndex)?.nativeElement as
      | HTMLElement
      | undefined;

    if (!section) {
      return;
    }

    section.scrollIntoView({
      behavior: 'smooth',
      block: 'start',
    });
  }

  goToRaceSelection(): void {
    this.raceContext.reset();

    this.raceContext.navigationStep = 'race-selection';

    this.router.navigate(['/select-race']);
  }

  openInstallDialog(): void {
    if (this.pwaService.shouldShowInstallDialog()) {
      this.showInstallDialog.set(true);
      return;
    }

    this.goToRaceSelection();
  }

  continueToRaces(): void {
    this.pwaService.dismissForNow();

    this.showInstallDialog.set(false);

    this.goToRaceSelection();
  }
}
