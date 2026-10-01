export interface TelemetryCar {
  driver: string;
  lap: number;
  lapDistance: number;
  raceDistance: number;
  timingLoopIndex: number;

  x: number;
  y: number;
}

export interface TelemetryFrame {
  raceTime: number;
  cars: TelemetryCar[];
}
