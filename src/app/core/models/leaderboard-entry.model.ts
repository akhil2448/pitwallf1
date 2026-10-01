export interface LeaderboardEntry {
  position: number;
  driver: string;
  lap: number;

  /** Gap to leader in seconds, null = hidden */
  gapToLeader: number | null;

  /** Gap to car ahead, null = hidden */
  intervalGap: number | null;

  lapsDown?: number;

  /* ---------------- Telemetry (visual only) ----------- */
  lapDistance: number;

  /* ---------------- State ----------------------------- */
  isInPit: boolean;
  compound: string;

  // positionArrow?: 'up' | 'down';

  tyreLife?: number | null;
  pitStops?: number;

  /** PROVISIONAL UI ONLY */
  provisional?: 'UP' | 'DOWN' | null; // gained / lost position mid-lap

  /** Driver state at race time */
  status?: 'OUT' | null;

  displayGap?: string;
  points?: number;
  isOfficialClassification?: boolean;
}

export type GapMode = 'LEADER' | 'INTERVAL';
