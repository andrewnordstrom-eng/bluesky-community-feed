import Fastify from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { dbQueryMock } = vi.hoisted(() => ({
  dbQueryMock: vi.fn(),
}));

vi.mock('../src/db/client.js', () => ({
  db: {
    query: dbQueryMock,
  },
}));

vi.mock('../src/auth/admin.js', () => ({
  getAdminDid: () => 'did:plc:admin',
}));

import { registerEpochRoutes } from '../src/admin/routes/epochs.js';

describe('admin epoch transition route', () => {
  beforeEach(() => {
    dbQueryMock.mockReset();
  });

  it('rejects normal direct transitions in favor of reviewed approval', async () => {
    const app = Fastify();
    registerEpochRoutes(app);

    const response = await app.inject({
      method: 'POST',
      url: '/epochs/transition',
      payload: { force: false },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({
      error: 'DirectTransitionDisabled',
    });
    expect(dbQueryMock).not.toHaveBeenCalled();

    await app.close();
  });

  it('does not allow force to bypass results review', async () => {
    const app = Fastify();
    registerEpochRoutes(app);

    const response = await app.inject({
      method: 'POST',
      url: '/epochs/transition',
      payload: { force: true },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ error: 'DirectTransitionDisabled' });
    expect(dbQueryMock).not.toHaveBeenCalled();

    await app.close();
  });
});
