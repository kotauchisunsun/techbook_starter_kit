/** Artifact-relative image links consumed by the trusted report publisher. */
export interface DifferenceImages {
  before: string | null;
  after: string | null;
  diff: string | null;
}
export interface Difference {
  page?: string;
  reason: string;
  images?: DifferenceImages;
}
export interface ComparisonReport { errors: Difference[] }

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
export function requireCondition(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
