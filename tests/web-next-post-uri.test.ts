import { describe, expect, it } from "vitest"
import { parseBlueskyUrlOrAtUri } from "../web-next/lib/post-uri"

describe("Bluesky post reference parsing", () => {
  const atUri = "at://did:plc:abcdefghijklmnopqrstuvwx/app.bsky.feed.post/3lexample"

  it("passes canonical AT-URIs through after trimming", () => {
    expect(parseBlueskyUrlOrAtUri(`  ${atUri}  `)).toBe(atUri)
  })

  it("converts DID-based Bluesky post URLs to AT-URIs", () => {
    expect(
      parseBlueskyUrlOrAtUri("https://bsky.app/profile/did:plc:abcdefghijklmnopqrstuvwx/post/3lexample"),
    ).toBe(atUri)
  })

  it.each([
    "",
    "not a URL",
    "at://did:plc:/app.bsky.feed.post/3lwrong",
    "at://did:PLC:abcdefghijklmnopqrstuvwx/app.bsky.feed.post/3lwrong",
    "at://did:plc:abcdefghijklmnopqrstuvwx:/app.bsky.feed.post/3lwrong",
    "at://did:plc:abcdefghijklmnopqrstuvwx/app.bsky.feed.post/",
    "at://did:plc:abcdefghijklmnopqrstuvwx/app.bsky.feed.post/.",
    "at://did:plc:abcdefghijklmnopqrstuvwx/app.bsky.feed.post/..",
    "at://did:plc:abcdefghijklmnopqrstuvwx/app.bsky.feed.like/3lwrong",
    "at://did:plc:abcdefghijklmnopqrstuvwx/app.bsky.feed.post/3lwrong?view=thread",
    "at://did:plc:abcdefghijklmnopqrstuvwx/app.bsky.feed.post/3l%2Fwrong",
    "at://did:plc:abcdefghijklmnopqrstuvwx/app.bsky.feed.post/3l%3Fwrong",
    "at://did:plc:abcdefghijklmnopqrstuvwx/app.bsky.feed.post/3l%23wrong",
    "at://did:plc:abc%25def/app.bsky.feed.post/3lwrong",
    "at://did:plc:abc%ZZdef/app.bsky.feed.post/3lwrong",
    "https://example.com/profile/did:plc:abcdefghijklmnopqrstuvwx/post/3lwrong",
    "https://bsky.app/profile/did:plc:abcdefghijklmnopqrstuvwx/post/%E0%A4%A",
    "https://bsky.app/profile/did:plc:abcdefghijklmnopqrstuvwx/post/3l%2Fwrong",
    "https://bsky.app/profile/did:plc:abc%25def/post/3lwrong",
    "https://bsky.app/profile/did:plc:abcdefghijklmnopqrstuvwx/post/3lwrong?view=thread",
    "https://bsky.app/profile/did:plc:abcdefghijklmnopqrstuvwx/post/3lwrong#replies",
  ])("rejects unsupported references: %s", (value) => {
    expect(() => parseBlueskyUrlOrAtUri(value)).toThrow(/AT-URI|Bluesky post URL/i)
  })

  it("explains why handle-based Bluesky URLs cannot be resolved locally", () => {
    expect(() => parseBlueskyUrlOrAtUri("https://bsky.app/profile/alice.bsky.social/post/3lexample")).toThrow(
      /uses a handle/i,
    )
  })

  it.each([null, undefined])("rejects non-string runtime input: %s", (value) => {
    expect(() => parseBlueskyUrlOrAtUri(value as unknown as string)).toThrow(/AT-URI|Bluesky post URL/i)
  })
})
