"use client"

import { createContext, useCallback, useContext, useMemo, type ReactNode } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { authApi, type SessionResponse } from "@/lib/api/client"

/** Query key for the current session — invalidated after login/logout. */
export const SESSION_QUERY_KEY = ["auth", "session"] as const

interface AuthContextValue {
  /** The live session, or null when unauthenticated / still resolving. */
  session: SessionResponse | null
  /** True only when the backend confirms an authenticated session. */
  isAuthenticated: boolean
  /** True while the very first session probe is in flight. */
  isLoading: boolean
  /** Log in with a Bluesky handle + app password. Rejects on failure (e.g. 401). */
  login: (handle: string, appPassword: string) => Promise<void>
  /** Clear the session cookie and reset auth state. */
  logout: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient()

  // Auth state is derived ONLY from the session endpoint. When the user is not
  // signed in, getSession() rejects (401) and `data` stays undefined — so we
  // never retry that expected "not authenticated" answer.
  const sessionQuery = useQuery({
    queryKey: SESSION_QUERY_KEY,
    queryFn: authApi.getSession,
    retry: false,
  })

  const loginMutation = useMutation({
    mutationFn: ({ handle, appPassword }: { handle: string; appPassword: string }) =>
      authApi.login(handle, appPassword),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: SESSION_QUERY_KEY }),
  })

  const logoutMutation = useMutation({
    mutationFn: () => authApi.logout(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: SESSION_QUERY_KEY }),
  })

  const login = useCallback(
    async (handle: string, appPassword: string) => {
      await loginMutation.mutateAsync({ handle, appPassword })
    },
    [loginMutation]
  )

  const logout = useCallback(async () => {
    await logoutMutation.mutateAsync()
  }, [logoutMutation])

  const session = sessionQuery.data ?? null
  const isAuthenticated = sessionQuery.data?.authenticated === true

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      isAuthenticated,
      isLoading: sessionQuery.isLoading,
      login,
      logout,
    }),
    [session, isAuthenticated, sessionQuery.isLoading, login, logout]
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) {
    throw new Error("useAuth must be used within an AuthProvider")
  }
  return ctx
}
