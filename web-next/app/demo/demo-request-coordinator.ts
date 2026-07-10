export interface DemoRequestContext {
  readonly signal: AbortSignal
  isCurrent(): boolean
}

export class DemoRequestCoordinator {
  private generation = 0
  private controller: AbortController | null = null

  start(): DemoRequestContext {
    this.controller?.abort()
    this.generation += 1
    const requestGeneration = this.generation
    const controller = new AbortController()
    this.controller = controller

    return {
      signal: controller.signal,
      isCurrent: () => this.generation === requestGeneration && !controller.signal.aborted,
    }
  }

  cancel(): void {
    this.generation += 1
    this.controller?.abort()
    this.controller = null
  }
}
