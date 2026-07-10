import { z } from 'zod';
import { logger } from '../lib/logger.js';
import { AppViewPostSchema, publicPostFromAppView, type AppViewPost } from './public-view.js';
import type { ShadowDemoCorpusItem } from './types.js';

export const APPVIEW_GET_POSTS_MAX_URIS = 25;
const APPVIEW_PUBLIC_ORIGIN = 'https://public.api.bsky.app';
const APPVIEW_GET_POSTS_PATH = '/xrpc/app.bsky.feed.getPosts';

export interface FetchRequestInit {
  method: 'GET';
  signal: AbortSignal;
}

export type DemoFetchFunction = (input: string, init: FetchRequestInit) => Promise<{
  ok: boolean;
  status: number;
  text: () => Promise<string>;
}>;

const AppViewGetPostsResponseSchema = z.object({
  posts: z.array(z.unknown()).optional(),
}).passthrough();

export function buildAppViewGetPostsUrl(uris: string[]): string {
  const url = new URL(APPVIEW_GET_POSTS_PATH, APPVIEW_PUBLIC_ORIGIN);
  for (const uri of uris) {
    url.searchParams.append('uris', uri);
  }
  return url.toString();
}

export async function hydrateCorpusItemsWithAppView(options: {
  items: ShadowDemoCorpusItem[];
  fetchFn: DemoFetchFunction;
  timeoutMs: number;
}): Promise<ShadowDemoCorpusItem[]> {
  const byUri = new Map<string, AppViewPost>();
  for (let index = 0; index < options.items.length; index += APPVIEW_GET_POSTS_MAX_URIS) {
    const batch = options.items.slice(index, index + APPVIEW_GET_POSTS_MAX_URIS);
    let response: AppViewPost[];
    try {
      response = await fetchAppViewPosts({
        uris: batch.map((item) => item.postUri),
        fetchFn: options.fetchFn,
        timeoutMs: options.timeoutMs,
      });
    } catch (err) {
      logger.warn(
        { err, batchStart: index, batchSize: batch.length },
        'Shadow demo AppView batch failed; withholding only that batch'
      );
      continue;
    }
    for (const post of response) {
      if (typeof post.uri === 'string') {
        byUri.set(post.uri, post);
      }
    }
  }

  return options.items.map((item) => {
    const post = byUri.get(item.postUri) ?? null;
    if (!post) {
      return {
        ...item,
        displayPost: {
          kind: 'hidden_post',
          reason: 'Post unavailable from Bluesky public AppView',
        },
      };
    }
    return {
      ...item,
      displayPost: publicPostFromAppView(post),
    };
  });
}

async function fetchAppViewPosts(options: {
  uris: string[];
  fetchFn: DemoFetchFunction;
  timeoutMs: number;
}): Promise<AppViewPost[]> {
  if (options.uris.length > APPVIEW_GET_POSTS_MAX_URIS) {
    throw new Error(`app.bsky.feed.getPosts accepts at most ${APPVIEW_GET_POSTS_MAX_URIS} URIs`);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs);
  try {
    const response = await options.fetchFn(buildAppViewGetPostsUrl(options.uris), {
      method: 'GET',
      signal: controller.signal,
    });
    const body = await response.text();
    if (!response.ok) {
      throw new Error(`Bluesky AppView getPosts failed with HTTP ${response.status}: ${body.slice(0, 500)}`);
    }
    let json: unknown;
    try {
      json = JSON.parse(body) as unknown;
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(`Bluesky AppView getPosts returned malformed JSON: ${detail}`);
    }
    const parsed = AppViewGetPostsResponseSchema.safeParse(json);
    if (!parsed.success) {
      throw new Error(
        `Bluesky AppView getPosts returned an invalid payload: ${parsed.error.issues
          .map((issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`)
          .join('; ')}`
      );
    }
    return (parsed.data.posts ?? []).flatMap((candidate) => {
      const post = AppViewPostSchema.safeParse(candidate);
      return post.success ? [post.data] : [];
    });
  } finally {
    clearTimeout(timeout);
  }
}
