import { createElement, type ReactNode } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { beforeEach, describe, expect, it, vi } from "vitest"
import SignInPage from "./page"

const authState = vi.hoisted(() => ({
  isAuthenticated: false,
  isLoading: false,
  routerReplace: vi.fn(),
  setOpen: vi.fn(),
  dialogProps: [] as Array<{ open: boolean; onOpenChange: (open: boolean) => void }>,
}))

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>()
  return {
    ...actual,
    useEffect: (effect: () => void | (() => void)) => {
      effect()
    },
    useState: <T,>(initialValue: T | (() => T)): [T, (value: T | ((previousValue: T) => T)) => void] => {
      const resolvedInitialValue =
        typeof initialValue === "function" ? (initialValue as () => T)() : initialValue
      return [resolvedInitialValue, authState.setOpen]
    },
  }
})

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    replace: authState.routerReplace,
  }),
}))

vi.mock("next/image", async () => {
  const react = await import("react")
  return {
    default: (props: { src: string; alt: string; width: number; height: number; className?: string }) =>
      react.createElement("img", props),
  }
})

vi.mock("next/link", async () => {
  const react = await import("react")
  return {
    default: ({ href, children, className }: { href: string; children: ReactNode; className?: string }) =>
      react.createElement("a", { href, className }, children),
  }
})

vi.mock("@/components/app-shell", async () => {
  const react = await import("react")
  return {
    AppShell: ({ children, suppressAuthDialog }: { children: ReactNode; suppressAuthDialog?: boolean }) =>
      react.createElement("div", { "data-auth-dialog": suppressAuthDialog ? "suppressed" : "enabled" }, children),
  }
})

vi.mock("@/components/sign-in-dialog", async () => {
  const react = await import("react")
  return {
    SignInDialog: (props: { open: boolean; onOpenChange: (open: boolean) => void }) => {
      authState.dialogProps.push(props)
      return react.createElement("div", { "data-sign-in-dialog-open": String(props.open) })
    },
  }
})

vi.mock("@/components/auth-provider", () => ({
  useAuth: () => ({
    session: authState.isAuthenticated ? { authenticated: true, handle: "user.test", did: "did:plc:user" } : null,
    isAuthenticated: authState.isAuthenticated,
    isLoading: authState.isLoading,
    login: vi.fn(),
    logout: vi.fn(),
  }),
}))

beforeEach(() => {
  authState.isAuthenticated = false
  authState.isLoading = false
  authState.routerReplace.mockReset()
  authState.setOpen.mockReset()
  authState.dialogProps = []
})

function renderPage() {
  return renderToStaticMarkup(createElement(SignInPage))
}

describe("SignInPage", () => {
  it("shows the session check state while auth is loading", () => {
    authState.isLoading = true

    const markup = renderPage()

    expect(markup).toContain("Checking your session...")
    expect(authState.setOpen).not.toHaveBeenCalled()
    expect(authState.routerReplace).not.toHaveBeenCalled()
    expect(authState.dialogProps).toHaveLength(1)
    expect(authState.dialogProps[0]?.open).toBe(false)
  })

  it("opens the sign-in dialog trigger path and keeps legal links wired when unauthenticated", () => {
    const markup = renderPage()

    expect(markup).toContain("Connect Bluesky")
    expect(markup).toContain('href="/tos"')
    expect(markup).toContain('href="/privacy"')
    expect(authState.setOpen).toHaveBeenCalledWith(true)
    expect(authState.routerReplace).not.toHaveBeenCalled()
  })

  it("redirects authenticated users to the ballot", () => {
    authState.isAuthenticated = true

    const markup = renderPage()

    expect(markup).toContain("Taking you to the ballot...")
    expect(authState.setOpen).toHaveBeenCalledWith(false)
    expect(authState.routerReplace).toHaveBeenCalledWith("/vote")
    expect(authState.dialogProps).toHaveLength(1)
    expect(authState.dialogProps[0]?.open).toBe(false)
  })

  it("prioritizes authenticated redirect state while auth is still loading", () => {
    authState.isAuthenticated = true
    authState.isLoading = true

    const markup = renderPage()

    expect(markup).toContain("Taking you to the ballot...")
    expect(markup).not.toContain("Checking your session...")
    expect(authState.setOpen).toHaveBeenCalledWith(false)
    expect(authState.routerReplace).toHaveBeenCalledWith("/vote")
    expect(authState.dialogProps).toHaveLength(1)
    expect(authState.dialogProps[0]?.open).toBe(false)
  })
})
