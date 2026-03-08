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

import { registerWeightsRoute } from '../src/governance/routes/weights.js';
import { registerEpochsRoute } from '../src/governance/routes/epochs.js';

describe('governance route query validation', () => {
  beforeEach(() => {
    dbQueryMock.mockReset();
  });

  it('returns 400 for invalid weights history limit', async () => {
    const app = Fastify();
    app.setValidatorCompiler(() => () => true);
    registerWeightsRoute(app);

    const response = await app.inject({
      method: 'GET',
      url: '/api/governance/weights/history?limit=0',
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: 'ValidationError' });
    expect(dbQueryMock).not.toHaveBeenCalled();

    await app.close();
  });

  it('returns 400 when compare endpoint receives same epoch ids', async () => {
    const app = Fastify();
    app.setValidatorCompiler(() => () => true);
    registerWeightsRoute(app);

    const response = await app.inject({
      method: 'GET',
      url: '/api/governance/weights/compare?epoch1=5&epoch2=5',
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: 'ValidationError' });
    expect(dbQueryMock).not.toHaveBeenCalled();

    await app.close();
  });

  it('returns 400 for invalid epochs list status', async () => {
    const app = Fastify();
    app.setValidatorCompiler(() => () => true);
    registerEpochsRoute(app);

    const response = await app.inject({
      method: 'GET',
      url: '/api/governance/epochs?status=invalid',
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: 'ValidationError' });
    expect(dbQueryMock).not.toHaveBeenCalled();

    await app.close();
  });

  it('returns 400 for invalid epoch id parameter', async () => {
    const app = Fastify();
    app.setValidatorCompiler(() => () => true);
    registerEpochsRoute(app);

    const response = await app.inject({
      method: 'GET',
      url: '/api/governance/epochs/not-a-number',
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: 'ValidationError' });
    expect(dbQueryMock).not.toHaveBeenCalled();

    await app.close();
  });
});
