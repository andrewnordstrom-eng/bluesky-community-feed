/**
 * Ambient typing for the globalSetup -> inject() handoff shared across every
 * file in the A1 simulation-harness integration suite. See global-setup.ts.
 */
declare module 'vitest' {
  export interface ProvidedContext {
    corgiSimPgUrl: string;
    corgiSimRedisUrl: string;
  }
}
