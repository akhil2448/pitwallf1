import { Routes } from '@angular/router';
import { LayoutComponent } from './layout/layout.component';

import { selectRaceGuard } from './core/guards/select-race.guard';
import { qualifyingGuard } from './core/guards/qualifying.guard';
import { simulationGuard } from './core/guards/simulation.guard';
import { qualifyingComparisonGuard } from './core/guards/qualifying-comparison.guard';
import { raceComparisonGuard } from './core/guards/race-comparison.guard';
import { performanceLabGuard } from './core/guards/performance-lab.guard';

export const routes: Routes = [
  {
    path: '',
    component: LayoutComponent,
    children: [
      {
        path: '',
        loadComponent: () =>
          import('./pages/home/home.component').then((m) => m.HomeComponent),
      },
      {
        path: 'select-race',
        loadComponent: () =>
          import('./pages/race-selection/race-selection.component').then(
            (m) => m.RaceSelectionComponent,
          ),
        canActivate: [selectRaceGuard],
      },
      {
        path: 'qualifying/:year/:round',
        loadComponent: () =>
          import('./pages/qualifying/qualifying.component').then(
            (m) => m.QualifyingComponent,
          ),
        canActivate: [qualifyingGuard],
      },
      {
        path: 'simulation',
        loadComponent: () =>
          import('./pages/simulation/simulation.component').then(
            (m) => m.SimulationComponent,
          ),
        canActivate: [simulationGuard],
      },
      {
        path: 'qualifying-comparison',
        loadComponent: () =>
          import('./pages/qualifying-comparison-page/qualifying-comparison-page.component').then(
            (m) => m.QualifyingComparisonPageComponent,
          ),
        canActivate: [qualifyingComparisonGuard],
      },
      {
        path: 'race-comparison',
        loadComponent: () =>
          import('./pages/race-comparison-page/race-comparison-page.component').then(
            (m) => m.RaceComparisonPageComponent,
          ),
        canActivate: [raceComparisonGuard],
      },
      {
        path: 'performance-lab',
        loadComponent: () =>
          import('./pages/performance-lab/performance-lab.component').then(
            (m) => m.PerformanceLabComponent,
          ),
        canActivate: [performanceLabGuard],
      },
      {
        path: '**',
        loadComponent: () =>
          import('./pages/not-found/not-found.component').then(
            (m) => m.NotFoundComponent,
          ),
      },
    ],
  },
];
