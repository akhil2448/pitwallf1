import { CommonModule } from '@angular/common';
import { Component, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';

import { countryCodeMap } from '../../core/constants/country-code-map';

import { LoadingOverlayService } from '../../core/services/loading-overlay.service';
import { RaceSelectionStateService } from '../../core/services/race-selection-state.service';

import { Router } from '@angular/router';
import { SupportButtonComponent } from '../../shared/components/support-button/support-button.component';
import { RaceContextService } from '../../core/services/race-context.service';
import { DriverSelectionResponse } from '../performance-lab/models/performance-lab.model';

import { PwSelectComponent } from '../../shared/components/pw-select/pw-select.component';
import { PwSelectOption } from '../../shared/components/pw-select/pw-select-option';

export interface RaceSchedule {
  round: number;
  country: string;
  location: string;

  officialName: string;
  raceName: string;

  eventDate: string;

  qualifyingName: string;
  qualifyingDate: string;
  qualifyingDateUtc: string;

  raceSessionName: string;
  raceDate: string;
  raceDateUtc: string;

  qualifyingLocalDisplay: string;
  raceLocalDisplay: string;

  qualifyingDataStatus?: string | null;
  raceDataStatus?: string | null;
}

interface YearScheduleResponse {
  year: number;
  races: RaceSchedule[];
}

@Component({
  selector: 'app-race-selection',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    SupportButtonComponent,
    PwSelectComponent,
  ],
  templateUrl: './race-selection.component.html',
  styleUrls: ['./race-selection.component.scss'],
})
export class RaceSelectionComponent implements OnInit {
  private readonly http = inject(HttpClient);

  years: number[] = [];

  get yearOptions(): PwSelectOption<number>[] {
    return this.years.map((year) => ({
      value: year,
      label: year.toString(),
    }));
  }

  selectedYear = new Date().getFullYear();

  races: RaceSchedule[] = [];

  loading = false;

  error: string | null = null;

  private readonly MIN_LOADING_MS = 2500;

  private readonly MAX_RETRIES = 3;

  private readonly overlay = inject(LoadingOverlayService);
  private readonly state = inject(RaceSelectionStateService);
  private readonly raceContext = inject(RaceContextService);

  private readonly MIN_PERFORMANCE_LOADING_MS = 1500;

  constructor(private router: Router) {}

  ngOnInit(): void {
    this.initializeYears();

    this.selectedYear = this.state.selectedYear ?? this.years[0];

    this.state.selectedYear = this.selectedYear;

    this.loadSchedule();
  }

  private initializeYears(): void {
    const currentYear = new Date().getFullYear();

    for (let year = currentYear; year >= 2018; year--) {
      this.years.push(year);
    }
  }

  onYearChange(): void {
    this.state.selectedYear = this.selectedYear;

    this.loadSchedule();
  }

  onYearSelected(year: number): void {
    this.selectedYear = year;
    this.onYearChange();
  }

  async loadSchedule(): Promise<void> {
    this.error = null;

    this.races = [];

    this.overlay.show('Fetching race schedule...');

    const startTime = Date.now();

    try {
      const response = await this.fetchScheduleWithRetry();

      const elapsed = Date.now() - startTime;

      const remaining = Math.max(0, this.MIN_LOADING_MS - elapsed);

      await this.delay(remaining);

      this.races = response.races;
    } catch {
      this.error = 'Unable to load race schedule. Please try again.';
    } finally {
      this.overlay.hide();
    }
  }

  private async fetchScheduleWithRetry(): Promise<YearScheduleResponse> {
    let attempt = 0;

    while (attempt < this.MAX_RETRIES) {
      try {
        return await firstValueFrom(
          this.http.get<YearScheduleResponse>(
            `/api/schedule/${this.selectedYear}`,
          ),
        );
      } catch {
        attempt++;

        if (attempt >= this.MAX_RETRIES) {
          throw new Error();
        }

        this.error = `Connection issue. Retrying (${attempt}/${this.MAX_RETRIES})...`;

        await this.delay(1000);
      }
    }

    throw new Error();
  }

  private async fetchPerformanceLabDataWithRetry(
    round: number,
  ): Promise<DriverSelectionResponse> {
    let attempt = 0;

    while (attempt < this.MAX_RETRIES) {
      try {
        return await firstValueFrom(
          this.http.get<DriverSelectionResponse>(
            `/api/ultimate-pace/${this.selectedYear}/${round}`,
          ),
        );
      } catch {
        attempt++;

        if (attempt >= this.MAX_RETRIES) {
          throw new Error();
        }

        this.overlay.show(
          `Connection issue. Retrying (${attempt}/${this.MAX_RETRIES})...`,
        );

        await this.delay(1000);
      }
    }

    throw new Error();
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => {
      setTimeout(resolve, ms);
    });
  }

  formatDate(dateString: string): string {
    return new Date(dateString).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  async openSimulationLab(race: RaceSchedule): Promise<void> {
    this.raceContext.selectedYear = this.selectedYear;

    this.raceContext.selectedRound = race.round;

    this.raceContext.navigationStep = 'qualifying';

    this.overlay.show('Fetching qualifying results...');

    await this.delay(1500);

    this.router.navigate(['/qualifying', this.selectedYear, race.round]);
  }

  getFlagUrl(country: string): string {
    const code = countryCodeMap[country];

    return `assets/country-flags/${code}.svg`;
  }

  goHome(): void {
    this.router.navigate(['/']);
  }

  async openPerformanceLab(race: RaceSchedule): Promise<void> {
    this.raceContext.selectedYear = this.selectedYear;

    this.raceContext.selectedRound = race.round;

    this.raceContext.selectedRace = race.raceName;

    this.overlay.show('Loading Performance Lab...');

    const startTime = Date.now();

    try {
      const response = await this.fetchPerformanceLabDataWithRetry(race.round);

      this.raceContext.driverSelection = response;

      this.raceContext.selectedSession = 'Q3';

      this.raceContext.selectedDrivers = [];

      this.raceContext.navigationStep = 'performance-lab';

      this.raceContext.save();

      const elapsed = Date.now() - startTime;

      const remaining = Math.max(0, this.MIN_PERFORMANCE_LOADING_MS - elapsed);

      await this.delay(remaining);

      this.overlay.hide();

      this.router.navigate(['/performance-lab']);
    } catch {
      this.overlay.hide();

      this.error = 'Unable to load Performance Lab. Please try another race.';

      await this.delay(3000);

      this.loadSchedule();

      return;
    }
  }
}
