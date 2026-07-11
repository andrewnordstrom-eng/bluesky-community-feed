import { describe, expect, it } from "vitest"
import { DemoRequestCoordinator } from "../demo-request-coordinator"

describe("DemoRequestCoordinator", () => {
  it("invalidates a pending request when the workbench resets", () => {
    const coordinator = new DemoRequestCoordinator()
    const pendingRequest = coordinator.start()

    coordinator.cancel()

    expect(pendingRequest.signal.aborted).toBe(true)
    expect(pendingRequest.isCurrent()).toBe(false)
  })

  it("keeps only the newest request current", () => {
    const coordinator = new DemoRequestCoordinator()
    const firstRequest = coordinator.start()
    const secondRequest = coordinator.start()

    expect(firstRequest.signal.aborted).toBe(true)
    expect(firstRequest.isCurrent()).toBe(false)
    expect(secondRequest.signal.aborted).toBe(false)
    expect(secondRequest.isCurrent()).toBe(true)
  })

  it("allows reuse after idempotent cancellation while every older request stays stale", () => {
    const coordinator = new DemoRequestCoordinator()
    const first = coordinator.start()
    coordinator.cancel()
    coordinator.cancel()
    const second = coordinator.start()
    const third = coordinator.start()

    expect(first.isCurrent()).toBe(false)
    expect(first.signal.aborted).toBe(true)
    expect(second.isCurrent()).toBe(false)
    expect(second.signal.aborted).toBe(true)
    expect(third.isCurrent()).toBe(true)
    expect(third.signal.aborted).toBe(false)
  })
})
