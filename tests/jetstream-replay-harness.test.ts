import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { JetstreamMessageProcessResult } from '../src/ingestion/jetstream.js';
import type { JetstreamReplayState } from '../src/harness/jetstream-replay.js';

const { processMessageMock, resetQueueMock } = vi.hoisted(() => ({
  processMessageMock: vi.fn(),
  resetQueueMock: vi.fn(),
}));

vi.mock('../src/ingestion/jetstream.js', () => ({
  __testJetstreamQueue: {
    processMessage: processMessageMock,
    reset: resetQueueMock,
  },
}));

import { runJetstreamReplay } from '../src/harness/jetstream-replay.js';

const emptyReplayState: JetstreamReplayState = {
  postsTotal: 0,
  postsDeleted: 0,
  likesTotal: 0,
  likesDeleted: 0,
  repostsTotal: 0,
  repostsDeleted: 0,
  followsTotal: 0,
  followsDeleted: 0,
  engagementRows: 0,
  likeCountSum: 0,
  repostCountSum: 0,
  replyCountSum: 0,
  persistedCursorUs: null,
};

function stateRow(state: JetstreamReplayState): Record<string, unknown> {
  return {
    postsTotal: state.postsTotal,
    postsDeleted: state.postsDeleted,
    likesTotal: state.likesTotal,
    likesDeleted: state.likesDeleted,
    repostsTotal: state.repostsTotal,
    repostsDeleted: state.repostsDeleted,
    followsTotal: state.followsTotal,
    followsDeleted: state.followsDeleted,
    engagementRows: state.engagementRows,
    likeCountSum: state.likeCountSum,
    repostCountSum: state.repostCountSum,
    replyCountSum: state.replyCountSum,
    persistedCursorUs: state.persistedCursorUs,
  };
}

function ignoredProcessResult(): JetstreamMessageProcessResult {
  return {
    acquired: true,
    dropped: false,
    parsed: true,
    processed: true,
    ingestionOutcome: 'non-commit-ignored',
    cursorUs: '1800000000000001',
    cursorSaved: false,
    errorMessage: null,
    eventCounter: 1,
    queueState: {
      active: 0,
      queued: 0,
    },
  };
}

describe('jetstream replay harness', () => {
  beforeEach(() => {
    processMessageMock.mockReset();
    resetQueueMock.mockReset();
  });

  it('compares durable state against fixture expectations, not observed no-ops', async () => {
    processMessageMock.mockResolvedValue(ignoredProcessResult());
    const db = {
      query: vi
        .fn()
        .mockResolvedValueOnce({ rows: [stateRow(emptyReplayState)] })
        .mockResolvedValueOnce({ rows: [stateRow(emptyReplayState)] }),
    };

    const summary = await runJetstreamReplay({
      db,
      eventCount: 1,
      startCursorUs: 1_800_000_000_000_000,
      runScoring: null,
    });

    expect(summary.eventMix['post-inserted']).toBe(1);
    expect(summary.observedOutcomes['non-commit-ignored']).toBe(1);
    expect(summary.stateMismatches).toBe(1);
    expect(summary.outcomeMismatches).toBe(2);
  });
});
