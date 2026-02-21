import { afterEach, describe, expect, it, vi } from 'vitest';

const { wsCtorMock, dbQueryMock } = vi.hoisted(() => ({
  wsCtorMock: vi.fn(),
  dbQueryMock: vi.fn(),
}));

class MockWebSocket {
  static OPEN = 1;
  static CONNECTING = 0;
  static CLOSED = 3;

  public readyState = MockWebSocket.CONNECTING;
  private handlers: Record<string, (...args: unknown[]) => void> = {};

  constructor(url: string) {
    wsCtorMock(url);
  }

  on(event: string, handler: (...args: unknown[]) => void): void {
    this.handlers[event] = handler;
  }

  close(code?: number, reason?: string): void {
    this.readyState = MockWebSocket.CLOSED;
    this.handlers.close?.(code ?? 1000, Buffer.from(reason ?? 'closed'));
  }
}

vi.mock('ws', () => ({
  default: MockWebSocket,
}));

vi.mock('../src/db/client.js', () => ({
  db: {
    query: dbQueryMock,
  },
}));

describe('jetstream lifecycle', () => {
  afterEach(async () => {
    vi.resetModules();
    wsCtorMock.mockReset();
    dbQueryMock.mockReset();
  });

  it('can reconnect after a stop/start cycle', async () => {
    dbQueryMock.mockResolvedValue({ rows: [] });

    const { startJetstream, stopJetstream } = await import('../src/ingestion/jetstream.js');

    await startJetstream();
    expect(wsCtorMock).toHaveBeenCalledTimes(1);

    await stopJetstream();
    await startJetstream();
    expect(wsCtorMock).toHaveBeenCalledTimes(2);

    await stopJetstream();
  });
});
