const POST_COLLECTION = "app.bsky.feed.post"
const DID_PATTERN = /^did:[a-z]+:[A-Za-z0-9._:-]*[A-Za-z0-9._-]$/
const RKEY_PATTERN = /^[A-Za-z0-9._~:-]{1,512}$/

function isValidDid(value: string): boolean {
  return value.length <= 2048 && DID_PATTERN.test(value)
}

function invalidPostReference(): Error {
  return new Error("Enter an AT-URI or a Bluesky post URL that contains a DID.")
}

export function parseBlueskyUrlOrAtUri(value: string): string {
  if (typeof value !== "string") throw invalidPostReference()
  const trimmed = value.trim()
  if (trimmed === "") throw invalidPostReference()

  if (trimmed.startsWith("at://")) {
    let segments: string[]
    try {
      segments = trimmed.slice("at://".length).split("/").map((segment) => decodeURIComponent(segment))
    } catch {
      throw invalidPostReference()
    }
    if (
      segments.length === 3 &&
      isValidDid(segments[0]) &&
      segments[1] === POST_COLLECTION &&
      RKEY_PATTERN.test(segments[2]) &&
      segments[2] !== "." &&
      segments[2] !== ".."
    ) {
      return `at://${segments[0]}/${POST_COLLECTION}/${segments[2]}`
    }
    throw invalidPostReference()
  }

  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    throw invalidPostReference()
  }

  let segments: string[]
  try {
    segments = url.pathname.split("/").filter(Boolean).map((segment) => decodeURIComponent(segment))
  } catch {
    throw invalidPostReference()
  }
  if (
    url.origin !== "https://bsky.app" ||
    url.search !== "" ||
    url.hash !== "" ||
    segments.length !== 4 ||
    segments[0] !== "profile" ||
    segments[2] !== "post"
  ) {
    throw invalidPostReference()
  }

  const actor = segments[1]
  const rkey = segments[3]
  if (!actor.startsWith("did:")) {
    throw new Error("That Bluesky URL uses a handle. Paste the post's AT-URI or a DID-based Bluesky URL instead.")
  }
  if (!isValidDid(actor) || !RKEY_PATTERN.test(rkey) || rkey === "." || rkey === "..") {
    throw invalidPostReference()
  }

  return `at://${actor}/${POST_COLLECTION}/${rkey}`
}
