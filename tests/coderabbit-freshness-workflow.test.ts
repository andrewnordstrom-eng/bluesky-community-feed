import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

interface Review {
  author: {
    __typename: string;
    login: string;
  };
  commit: {
    oid: string;
  };
  state: string;
  submittedAt: string;
}

interface ScenarioResult {
  failures: string[];
  notices: string[];
  pageCount: number;
}

interface ReviewPage {
  nodes: Array<Review | null>;
  pageInfo: {
    hasNextPage: boolean;
    endCursor: string | null;
  };
}

type WorkflowExecutor = (
  github: unknown,
  context: unknown,
  core: unknown,
) => Promise<void>;

const workflowUrl = new URL(
  '../.github/workflows/coderabbit-freshness.yml',
  import.meta.url,
);
const workflowLines = readFileSync(workflowUrl, 'utf8').split('\n');
const scriptMarker = workflowLines.findIndex((line) => line.trim() === 'script: |');

if (scriptMarker === -1) {
  throw new Error('coderabbit-freshness workflow script block was not found');
}

const workflowScript = workflowLines
  .slice(scriptMarker + 1)
  .map((line) => (line.startsWith('            ') ? line.slice(12) : line))
  .join('\n');
const AsyncFunction = Object.getPrototypeOf(
  async function workflowStub() {},
).constructor as FunctionConstructor;
const executeWorkflow = AsyncFunction(
  'github',
  'context',
  'core',
  workflowScript,
) as WorkflowExecutor;

function approvedReview(
  sha: string,
  login: string,
  actorType: string,
  state = 'APPROVED',
  submittedAt = '2026-07-11T23:31:42Z',
): Review {
  return {
    author: {
      __typename: actorType,
      login,
    },
    commit: {
      oid: sha,
    },
    state,
    submittedAt,
  };
}

async function runScenario(
  reviews: Array<Review | null>,
  options: {
    pages?: ReviewPage[];
    graphqlError?: Error;
  } = {},
): Promise<ScenarioResult> {
  const failures: string[] = [];
  const notices: string[] = [];
  let pageIndex = 0;
  const listCommitStatusesForRef = (): undefined => undefined;
  const listSuitesForRef = (): undefined => undefined;
  const github = {
    rest: {
      pulls: {
        get: async () => ({
          data: {
            number: 340,
            state: 'open',
            draft: false,
            user: {
              login: 'human',
              type: 'User',
            },
            labels: [],
            head: {
              sha: 'head',
            },
          },
        }),
      },
      repos: {
        listCommitStatusesForRef,
      },
      checks: {
        listSuitesForRef,
      },
    },
    paginate: async (
      method: unknown,
      _args: unknown,
      map: ((response: { data: { check_suites: unknown[] } }) => unknown) | undefined,
    ) => {
      if (method === listCommitStatusesForRef) {
        return [];
      }
      if (method === listSuitesForRef) {
        const response = {
          data: {
            check_suites: [],
          },
        };
        return map === undefined ? response : map(response);
      }
      throw new Error('Unexpected pagination method in freshness workflow test');
    },
    graphql: async () => {
      if (options.graphqlError !== undefined) {
        throw options.graphqlError;
      }
      const page = options.pages?.[pageIndex] ?? {
        nodes: reviews,
        pageInfo: {
          hasNextPage: false,
          endCursor: null,
        },
      };
      pageIndex += 1;
      return {
        repository: {
          pullRequest: {
            reviews: page,
          },
        },
      };
    },
  };
  const context = {
    repo: {
      owner: 'andrewnordstrom-eng',
      repo: 'bluesky-community-feed',
    },
    payload: {
      pull_request: {
        number: 340,
      },
    },
  };
  const core = {
    info: (_message: string): undefined => undefined,
    notice: (message: string): void => {
      notices.push(message);
    },
    setFailed: (message: string): void => {
      failures.push(message);
    },
  };

  await executeWorkflow(github, context, core);
  return {
    failures,
    notices,
    pageCount: pageIndex,
  };
}

describe('coderabbit freshness exact-head review identity', () => {
  it('accepts a bare coderabbitai login only for a Bot actor on the exact head', async () => {
    const result = await runScenario([
      approvedReview('head', 'coderabbitai', 'Bot'),
    ]);

    expect(result.failures).toEqual([]);
    expect(result.notices[0]).toMatch(/\[coderabbit-freshness:ok_review\]/);
  });

  it('rejects a User actor with the bare coderabbitai login', async () => {
    const result = await runScenario([
      approvedReview('head', 'coderabbitai', 'User'),
    ]);

    expect(result.failures[0]).toMatch(/exact-head review/);
  });

  it('accepts a mixed-case canonical bot login on the exact head', async () => {
    const result = await runScenario([
      approvedReview('head', 'CodeRabbitAI[bot]', 'Bot'),
    ]);

    expect(result.failures).toEqual([]);
    expect(result.notices[0]).toMatch(/\[coderabbit-freshness:ok_review\]/);
  });

  it('rejects a CodeRabbit Bot review attached to a non-head commit', async () => {
    const result = await runScenario([
      approvedReview('stale-head', 'coderabbitai', 'Bot'),
    ]);

    expect(result.failures[0]).toMatch(/exact-head review/);
  });

  it('accepts an exact-head comment-only review while leaving findings to the thread gate', async () => {
    const result = await runScenario([
      approvedReview('head', 'coderabbitai', 'Bot', 'COMMENTED'),
    ]);

    expect(result.failures).toEqual([]);
    expect(result.notices[0]).toMatch(/ok_review_comment_only/);
  });

  it('rejects a genuinely missing exact-head CodeRabbit review', async () => {
    const result = await runScenario([]);

    expect(result.failures[0]).toMatch(/Missing CodeRabbit status\/check-suite and exact-head review/);
  });

  it('rejects an exact-head changes-requested review', async () => {
    const result = await runScenario([
      approvedReview('head', 'coderabbitai', 'Bot', 'CHANGES_REQUESTED'),
    ]);

    expect(result.failures[0]).toMatch(/CHANGES_REQUESTED/);
  });

  it('uses the newest decisive exact-head state while ignoring a later comment', async () => {
    const result = await runScenario([
      approvedReview('head', 'coderabbitai', 'Bot', 'APPROVED', '2026-07-11T23:31:42Z'),
      approvedReview('head', 'coderabbitai', 'Bot', 'COMMENTED', '2026-07-11T23:31:43Z'),
    ]);

    expect(result.failures).toEqual([]);
    expect(result.notices[0]).toMatch(/\[coderabbit-freshness:ok_review\]/);
  });

  it('rejects when a newer exact-head changes request supersedes approval', async () => {
    const result = await runScenario([
      approvedReview('head', 'coderabbitai', 'Bot', 'APPROVED', '2026-07-11T23:31:42Z'),
      approvedReview('head', 'coderabbitai', 'Bot', 'CHANGES_REQUESTED', '2026-07-11T23:31:43Z'),
    ]);

    expect(result.failures[0]).toMatch(/CHANGES_REQUESTED/);
  });

  it('accepts when a newer exact-head approval supersedes changes requested', async () => {
    const result = await runScenario([
      approvedReview('head', 'coderabbitai', 'Bot', 'CHANGES_REQUESTED', '2026-07-11T23:31:42Z'),
      approvedReview('head', 'coderabbitai', 'Bot', 'APPROVED', '2026-07-11T23:31:43Z'),
    ]);

    expect(result.failures).toEqual([]);
    expect(result.notices[0]).toMatch(/\[coderabbit-freshness:ok_review\]/);
  });

  it('paginates all reviews before trusting an exact-head approval', async () => {
    const result = await runScenario([], {
      pages: [
        {
          nodes: [null, approvedReview('stale-head', 'coderabbitai', 'Bot')],
          pageInfo: { hasNextPage: true, endCursor: 'next-page' },
        },
        {
          nodes: [approvedReview('head', 'coderabbitai', 'Bot')],
          pageInfo: { hasNextPage: false, endCursor: null },
        },
      ],
    });

    expect(result.failures).toEqual([]);
    expect(result.pageCount).toBe(2);
  });

  it('fails closed when review pagination is incomplete', async () => {
    const result = await runScenario([], {
      pages: [{
        nodes: [approvedReview('head', 'coderabbitai', 'Bot')],
        pageInfo: { hasNextPage: true, endCursor: null },
      }],
    });

    expect(result.failures[0]).toMatch(/pagination is incomplete/);
  });

  it('fails closed when the GraphQL review query rejects', async () => {
    const result = await runScenario([], { graphqlError: new Error('GraphQL unavailable') });

    expect(result.failures[0]).toMatch(/Could not verify complete exact-head CodeRabbit review truth/);
    expect(result.failures[0]).toMatch(/GraphQL unavailable/);
  });
});
