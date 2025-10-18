export interface RiskViolation {
  readonly code: string;
  readonly message: string;
  readonly observed: number;
  readonly limit: number;
}
