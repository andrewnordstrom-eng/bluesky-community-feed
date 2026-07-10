import { z } from 'zod';
import type { ShadowDemoDisplayPost, ShadowDemoPublicPost } from './types.js';

const HIDDEN_LABELS = new Set(['!no-unauthenticated', '!hide', '!takedown']);
const ADULT_ONLY_LABELS = new Set(['porn', 'sexual', 'nudity', 'graphic-media']);
const POST_AT_URI_PATTERN = /^at:\/\/(did:[a-z0-9]+:[A-Za-z0-9._:%-]+)\/app\.bsky\.feed\.post\/([A-Za-z0-9._~:@!$&'()*+,;=-]+)$/;

const AppViewLabelSchema = z.object({ val: z.string().optional() }).passthrough();
const AppViewAuthorSchema = z.object({
  did: z.string().optional(),
  handle: z.string().optional(),
  displayName: z.string().optional(),
  avatar: z.string().optional(),
  labels: z.array(AppViewLabelSchema).optional(),
}).passthrough();
const AppViewRecordSchema = z.object({
  text: z.string().optional(),
  createdAt: z.string().optional(),
}).passthrough();
const AppViewEmbedSchema = z.object({
  external: z.object({
    uri: z.string().optional(),
    title: z.string().optional(),
    description: z.string().optional(),
    thumb: z.string().optional(),
  }).passthrough().optional(),
}).passthrough();

export const AppViewPostSchema = z.object({
  uri: z.string().optional(),
  cid: z.string().optional(),
  author: AppViewAuthorSchema.optional(),
  record: AppViewRecordSchema.optional(),
  indexedAt: z.string().optional(),
  likeCount: z.unknown().optional(),
  repostCount: z.unknown().optional(),
  replyCount: z.unknown().optional(),
  quoteCount: z.unknown().optional(),
  labels: z.array(AppViewLabelSchema).optional(),
  embed: AppViewEmbedSchema.optional(),
}).passthrough();

const PublicAppViewPostSchema = AppViewPostSchema.extend({
  uri: z.string().regex(POST_AT_URI_PATTERN),
  cid: z.string().trim().min(1),
  author: AppViewAuthorSchema.extend({
    did: z.string().trim().min(1),
    handle: z.string().trim().min(1),
  }),
  record: AppViewRecordSchema.extend({
    text: z.string().trim().min(1),
    createdAt: z.string().trim().min(1),
  }),
  indexedAt: z.string().trim().min(1),
});

type AppViewLabel = z.infer<typeof AppViewLabelSchema>;
type AppViewAuthor = z.infer<typeof AppViewAuthorSchema>;

export type AppViewPost = z.infer<typeof AppViewPostSchema>;

export function hiddenReasonForPublicView(input: unknown): string | null {
  if (input === null || input === undefined) {
    return 'Post unavailable from Bluesky public AppView';
  }
  const parsedPost = AppViewPostSchema.safeParse(input);
  if (!parsedPost.success) {
    return 'Post metadata unavailable from Bluesky public AppView';
  }
  const post = parsedPost.data;

  const labelValues = [
    ...labelValuesFrom(post.labels),
    ...labelValuesFrom(post.author?.labels),
  ];
  const hiddenLabel = labelValues.find((label) => HIDDEN_LABELS.has(label));
  if (hiddenLabel) {
    return `Hidden by Bluesky public-view label ${hiddenLabel}`;
  }

  const adultLabel = labelValues.find((label) => ADULT_ONLY_LABELS.has(label));
  if (adultLabel) {
    return `Hidden by Bluesky adult-content label ${adultLabel}`;
  }

  const record = post.record;
  const text =
    record && typeof record === 'object' && 'text' in record
      ? (record as { text?: unknown }).text
      : null;
  if (typeof text !== 'string' || text.trim().length === 0) {
    return 'Post text unavailable from Bluesky public AppView';
  }

  if (!PublicAppViewPostSchema.safeParse(post).success) {
    return 'Post metadata unavailable from Bluesky public AppView';
  }

  return null;
}

export function publicPostFromAppView(input: unknown): ShadowDemoDisplayPost {
  const hiddenReason = hiddenReasonForPublicView(input);
  if (hiddenReason) {
    return {
      kind: 'hidden_post',
      reason: hiddenReason,
    };
  }

  const parsed = PublicAppViewPostSchema.safeParse(input);
  if (!parsed.success) {
    return hiddenDisplayPost('Post metadata unavailable from Bluesky public AppView');
  }
  const publicPost = parsed.data;
  return {
    kind: 'public_post',
    uri: publicPost.uri,
    cid: publicPost.cid,
    authorDid: publicPost.author.did,
    authorHandle: publicPost.author.handle,
    authorDisplayName: displayNameForAuthor(publicPost.author),
    authorAvatar: typeof publicPost.author.avatar === 'string' ? publicPost.author.avatar : null,
    text: publicPost.record.text,
    likeCount: finiteCount(publicPost.likeCount),
    repostCount: finiteCount(publicPost.repostCount),
    replyCount: finiteCount(publicPost.replyCount),
    quoteCount: finiteCount(publicPost.quoteCount),
    indexedAt: publicPost.indexedAt,
    createdAt: publicPost.record.createdAt,
    bskyUrl: bskyPostUrlFromAtUri(publicPost.uri),
  } satisfies ShadowDemoPublicPost;
}

export function hiddenDisplayPost(reason: string): ShadowDemoDisplayPost {
  return {
    kind: 'hidden_post',
    reason,
  };
}

export function bskyPostUrlFromAtUri(uri: string): string {
  const match = POST_AT_URI_PATTERN.exec(uri);
  if (!match) {
    throw new Error(`Cannot build Bluesky URL for non-post AT-URI: ${uri}`);
  }
  return `https://bsky.app/profile/${encodeURIComponent(match[1])}/post/${encodeURIComponent(match[2])}`;
}

function labelValuesFrom(labels: AppViewLabel[] | undefined): string[] {
  if (!labels) {
    return [];
  }
  return labels
    .map((label) => label.val)
    .filter((label): label is string => typeof label === 'string' && label.length > 0);
}

function displayNameForAuthor(author: AppViewAuthor | undefined): string {
  if (typeof author?.displayName === 'string' && author.displayName.trim().length > 0) {
    return author.displayName;
  }
  return author?.handle ?? '';
}

function finiteCount(value: unknown): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : 0;
}
