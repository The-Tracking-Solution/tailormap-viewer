export interface MissingPoint { lon: number; lat: number }
export interface MissingIntake {
  name: string; description: string; clothing: string; reporter: string; telephone: string; details: string;
}
export interface MissingCaseInput {
  version: number;
  lastSeenAt: string;
  lastSeen: MissingPoint;
  age: number | null;
  sex: string;
  speedKmh: number | null;
  speedConfirmed: boolean;
  waterRisk: boolean;
  urgent: boolean;
  ownerOrganisation: string;
  organisations: string[];
  intake: MissingIntake;
}
export interface MissingEvent { id: string; occurredAt: string; kind: string; body: string }
export interface MissingCase extends MissingCaseInput {
  id: string;
  hasPhoto: boolean;
  events?: MissingEvent[];
}
export interface MissingConfiguration {
  organisations: { id: string; label: string; member: boolean }[];
  retainExactLocations: boolean;
  statisticsRetentionDays: number;
}
export interface MissingCloseInput {
  version: number;
  outcome: string;
  found: MissingPoint | null;
  foundAt: string | null;
  personVerified: boolean;
  policeConsidered: boolean;
  careConsidered: boolean;
  confirmDelete: boolean;
}
export interface MissingSearchArea { geometry: string; crs: string; radiusMeters: number; calculatedAt: string; method: string }
export interface MissingStatistic {
  id: string; age: number | null; sex: string; outcome: string; closedAt: string;
  lastSeenAt: string; foundAt: string | null; lastSeenGeometry: string | null; foundGeometry: string | null;
}
