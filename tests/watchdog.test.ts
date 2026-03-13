import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { isReadyMock } = vi.hoisted(() => ({
  isReadyMock: vi.fn(),
}));

vi.mock('../src/lib/health.js', () => ({
  isReady: isReadyMock,
}));

vi.mock('../src/lib/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    fatal: vi.fn(),
  },
}));

import { sdNotifyReady, startWatchdog, stopWatchdog } from '../src/lib/watchdog.js';

describe('watchdog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    // Remove NOTIFY_SOCKET from env for test isolation
    delete process.env.NOTIFY_SOCKET;
  });

  afterEach(() => {
    stopWatchdog();
    vi.useRealTimers();
  });

  it('sdNotifyReady is a no-op without NOTIFY_SOCKET', () => {
    // Should not throw when NOTIFY_SOCKET is not set
    expect(() => sdNotifyReady()).not.toThrow();
  });

  it('startWatchdog is a no-op without NOTIFY_SOCKET', () => {
    // Should not throw or start intervals when NOTIFY_SOCKET is not set
    expect(() => startWatchdog()).not.toThrow();
  });

  it('stopWatchdog is safe to call even if not started', () => {
    expect(() => stopWatchdog()).not.toThrow();
  });

  it('stopWatchdog can be called multiple times', () => {
    expect(() => {
      stopWatchdog();
      stopWatchdog();
    }).not.toThrow();
  });
});
