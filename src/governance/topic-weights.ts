import { z } from 'zod';

const StoredTopicWeightsSchema = z.record(
  z.number().finite().min(0).max(1)
);

export class InvalidStoredTopicWeightsError extends Error {
  constructor(context: string, issueSummary: string) {
    super(`Invalid stored topic weights for ${context}: ${issueSummary}`);
    this.name = 'InvalidStoredTopicWeightsError';
  }
}

export function parseStoredTopicWeights(
  raw: unknown,
  context: string
): Record<string, number> {
  if (raw === null || raw === undefined) {
    return {};
  }

  const result = StoredTopicWeightsSchema.safeParse(raw);
  if (!result.success) {
    const issueSummary = result.error.issues
      .map((issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`)
      .join('; ');
    throw new InvalidStoredTopicWeightsError(context, issueSummary);
  }

  return result.data;
}

export function parseStoredProposedTopicWeights(
  raw: unknown,
  context: string
): Record<string, number> | null {
  if (raw === null || raw === undefined) {
    return null;
  }

  return parseStoredTopicWeights(raw, context);
}
