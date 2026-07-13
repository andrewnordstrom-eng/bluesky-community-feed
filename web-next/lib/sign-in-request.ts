import { z } from "zod"

const notApprovedResponseSchema = z.object({
  error: z.literal("NotApproved"),
  waitlist: z.literal(true),
}).passthrough()

interface HttpClientError {
  isAxiosError: true
  response?: {
    status?: unknown
    data?: unknown
  }
}

function isHttpClientError(error: unknown): error is HttpClientError {
  return typeof error === "object" && error !== null && "isAxiosError" in error
    && (error as { isAxiosError?: unknown }).isAxiosError === true
}

export type SignInFailureKind = "bad-credentials" | "not-approved" | "service"

export function classifySignInFailure(error: unknown): SignInFailureKind {
  if (!isHttpClientError(error)) return "service"
  if (error.response?.status === 401) return "bad-credentials"
  if (
    error.response?.status === 403
    && notApprovedResponseSchema.safeParse(error.response.data).success
  ) {
    return "not-approved"
  }
  return "service"
}

export function isCurrentDialogRequest(
  activeToken: number,
  requestToken: number,
  mounted: boolean,
): boolean {
  return mounted && activeToken === requestToken
}
