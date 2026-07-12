export class ScoringPipelineTimeoutError extends Error {
  readonly code = 'SCORING_PIPELINE_TIMEOUT';

  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'ScoringPipelineTimeoutError';
  }
}
