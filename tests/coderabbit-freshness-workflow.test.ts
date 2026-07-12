import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

interface Review {
  author: {
    __typename: string;
    login: string;
  } | null;
  commit: {
    oid: string;
  } | null;
  state: string | null;
  submittedAt: string | null;
}

interface ScenarioResult {
  failures: string[];
  notices: string[];
  pageCount: number;
  statusPageCount: number;
}

interface ReviewPage {
  nodes: Array<Review | null | undefined>;
  pageInfo: {
    hasNextPage: boolean;
    endCursor: string | null;
  };
}

interface CommitStatus {
  context: string;
  state: string;
  description: string;
  updated_at: string;
}

interface ScenarioOptions {
  pages?: ReviewPage[];
  graphqlError?: Error;
  missingPullRequest?: boolean;
  statusPages?: CommitStatus[][];
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
): Review {
  return review(
    sha,
    login,
    actorType,
    'APPROVED',
    '2026-07-11T23:31:42Z',
  );
}

function review(
  sha: string,
  login: string,
  actorType: string,
  state: string,
  submittedAt: string,
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
  reviews: Array<Review | null | undefined>,
  options?: ScenarioOptions,
): Promise<ScenarioResult> {
  const failures: string[] = [];
  const notices: string[] = [];
  let pageIndex = 0;
  let statusPageCount = 0;
  const listCommitStatusesForRef = (): undefined => undefined;
  const listSuitesForRef = (): undefined => undefined;
  const github = {
    rest: {
      pulls: {
        get: async (args: unknown) => {
          expect(args).toEqual({
            owner: 'andrewnordstrom-eng',
            repo: 'bluesky-community-feed',
            pull_number: 340,
          });
          return {
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
          };
        },
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
      args: unknown,
      map: ((response: { data: { check_suites: unknown[] } }) => unknown) | undefined,
    ) => {
      if (method === listCommitStatusesForRef) {
        expect(args).toEqual({
          owner: 'andrewnordstrom-eng',
          repo: 'bluesky-community-feed',
          ref: 'head',
          per_page: 100,
        });
        const statusPages = options?.statusPages ?? [[]];
        statusPageCount = statusPages.length;
        return statusPages.flat();
      }
      if (method === listSuitesForRef) {
        expect(args).toEqual({
          owner: 'andrewnordstrom-eng',
          repo: 'bluesky-community-feed',
          ref: 'head',
          per_page: 100,
        });
        const response = {
          data: {
            check_suites: [],
          },
        };
        return map === undefined ? response : map(response);
      }
      throw new Error('Unexpected pagination method in freshness workflow test');
    },
    graphql: async (query: unknown, variables: unknown) => {
      expect(query).toEqual(expect.stringContaining('author { __typename login }'));
      expect(query).toEqual(expect.stringContaining('reviews(first: 100, after: $after)'));
      const priorCursor = pageIndex === 0
        ? null
        : options?.pages?.[pageIndex - 1]?.pageInfo.endCursor ?? null;
      expect(variables).toEqual({
        owner: 'andrewnordstrom-eng',
        repo: 'bluesky-community-feed',
        prNumber: 340,
        after: priorCursor,
      });
      if (options?.graphqlError !== undefined) {
        throw options.graphqlError;
      }
      const page = options?.pages?.[pageIndex] ?? {
        nodes: reviews,
        pageInfo: {
          hasNextPage: false,
          endCursor: null,
        },
      };
      pageIndex += 1;
      return {
        repository: {
          pullRequest: options?.missingPullRequest === true ? null : {
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
    statusPageCount,
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
      review(
        'head',
        'coderabbitai',
        'Bot',
        'COMMENTED',
        '2026-07-11T23:31:42Z',
      ),
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
      review(
        'head',
        'coderabbitai',
        'Bot',
        'CHANGES_REQUESTED',
        '2026-07-11T23:31:42Z',
      ),
    ]);

    expect(result.failures[0]).toMatch(/CHANGES_REQUESTED/);
  });

  it('uses the newest decisive exact-head state while ignoring a later comment', async () => {
    const result = await runScenario([
      review('head', 'coderabbitai', 'Bot', 'APPROVED', '2026-07-11T23:31:42Z'),
      review('head', 'coderabbitai', 'Bot', 'COMMENTED', '2026-07-11T23:31:43Z'),
    ]);

    expect(result.failures).toEqual([]);
    expect(result.notices[0]).toMatch(/\[coderabbit-freshness:ok_review\]/);
  });

  it('rejects when a newer exact-head changes request supersedes approval', async () => {
    const result = await runScenario([
      review('head', 'coderabbitai', 'Bot', 'APPROVED', '2026-07-11T23:31:42Z'),
      review('head', 'coderabbitai', 'Bot', 'CHANGES_REQUESTED', '2026-07-11T23:31:43Z'),
    ]);

    expect(result.failures[0]).toMatch(/CHANGES_REQUESTED/);
  });

  it('accepts when a newer exact-head approval supersedes changes requested', async () => {
    const result = await runScenario([
      review('head', 'coderabbitai', 'Bot', 'CHANGES_REQUESTED', '2026-07-11T23:31:42Z'),
      review('head', 'coderabbitai', 'Bot', 'APPROVED', '2026-07-11T23:31:43Z'),
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

  it('flattens paginated commit statuses before review fallback', async () => {
    const result = await runScenario([], {
      statusPages: [
        [{
          context: 'unrelated-check',
          state: 'success',
          description: '',
          updated_at: '2026-07-11T23:31:41Z',
        }],
        [{
          context: 'CodeRabbit',
          state: 'success',
          description: '',
          updated_at: '2026-07-11T23:31:42Z',
        }],
      ],
    });

    expect(result.failures).toEqual([]);
    expect(result.notices[0]).toMatch(/ok_status/);
    expect(result.statusPageCount).toBe(2);
    expect(result.pageCount).toBe(0);
  });

  it.each([
    ['null node', null],
    ['undefined node', undefined],
    ['null author', { ...approvedReview('head', 'coderabbitai', 'Bot'), author: null }],
    ['null commit', { ...approvedReview('head', 'coderabbitai', 'Bot'), commit: null }],
  ])('rejects malformed nullable review data: %s', async (_name, malformedReview) => {
    const result = await runScenario([malformedReview]);

    expect(result.failures[0]).toMatch(/exact-head review/);
  });

  it.each(['PENDING', 'DISMISSED'])(
    'fails closed on unsupported exact-head review state %s',
    async (state) => {
      const result = await runScenario([
        review(
          'head',
          'coderabbitai',
          'Bot',
          state,
          '2026-07-11T23:31:42Z',
        ),
      ]);

      expect(result.failures[0]).toMatch(/no acceptable APPROVED\/CHANGES_REQUESTED\/COMMENTED state/);
    },
  );

  it('fails closed when review pagination reaches the safety bound', async () => {
    const pages = Array.from({ length: 100 }, (_value, index): ReviewPage => ({
      nodes: [],
      pageInfo: {
        hasNextPage: true,
        endCursor: `page-${index + 1}`,
      },
    }));
    const result = await runScenario([], { pages });

    expect(result.failures[0]).toMatch(/exceeded the 100-page safety bound/);
    expect(result.pageCount).toBe(100);
  });

  it('fails closed when the review query does not return the pull request', async () => {
    const result = await runScenario([], { missingPullRequest: true });

    expect(result.failures[0]).toMatch(/PR #340 was not returned by the review query/);
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
