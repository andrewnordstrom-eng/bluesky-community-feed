export class AuthRequestCoordinator {
  private activeController: AbortController | null = null

  begin(): AbortSignal {
    this.cancel()
    const controller = new AbortController()
    this.activeController = controller
    return controller.signal
  }

  isCurrent(signal: AbortSignal): boolean {
    return this.activeController?.signal === signal && !signal.aborted
  }

  complete(signal: AbortSignal): void {
    if (this.activeController?.signal === signal) {
      this.activeController = null
    }
  }

  cancel(): void {
    this.activeController?.abort()
    this.activeController = null
  }
}
