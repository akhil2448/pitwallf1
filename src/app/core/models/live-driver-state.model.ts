/* ===================================================== */
/* RUNTIME DERIVED DRIVER STATE                          */
/* ===================================================== */

export interface LiveDriverState {
  /* -------------------- Identity -------------------- */
  driver: string; // ALO
  driverNumber: string;
  team: string;

  /* -------------------- Timing (AUTHORITATIVE) ------ */
  currentLap: number;
  completedLaps: number;

  currentSector: 1 | 2 | 3;

  /**
   * Official position based on timing data
   * (NEVER from telemetry)
   */
  timingPosition: number | null;

  /**
   * Gap to leader in seconds
   * null = hidden (race start, SC, etc.)
   */
  gapToLeader: number | null;
  intervalGap: number | null;
  lapsDown: number;

  /* --------------  MID LAP POSITION SWAPS ---------------------------- */
  displayPosition?: number;
  provisionalStatus?: 'UP' | 'DOWN' | null;

  /* -------------------- Telemetry (VISUAL ONLY) ----- */
  lapDistance: number;
  x: number;
  y: number;

  /* -------------------- State Flags ----------------- */
  isLeader: boolean;
  isFinished: boolean;
  isInPit: boolean;

  compound: string;
  tyreLife: number | null;
}
