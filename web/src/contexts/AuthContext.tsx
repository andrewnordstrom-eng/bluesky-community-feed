import { useState, useEffect, useCallback } from 'react';
import type { ReactNode } from 'react';
import { authApi } from '../api/client';
import { AuthContext } from './auth-context';
import type { AuthContextType } from './auth-context';

interface AuthProviderProps {
  children: ReactNode;
}

function extractErrorMessage(error: unknown, fallback: string): string {
  if (error && typeof error === 'object') {
    const candidate = error as {
      response?: { data?: { message?: string } };
      message?: string;
    };
    return candidate.response?.data?.message ?? candidate.message ?? fallback;
  }

  return fallback;
}

export function AuthProvider({ children }: AuthProviderProps) {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [userDid, setUserDid] = useState<string | null>(null);
  const [userHandle, setUserHandle] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const checkSession = useCallback(async () => {
    setIsLoading(true);

    try {
      const session = await authApi.getSession();
      setIsAuthenticated(session.authenticated);
      setUserDid(session.did);
      setUserHandle(session.handle);
      setError(null);
    } catch {
      // Session invalid or expired
      setIsAuthenticated(false);
      setUserDid(null);
      setUserHandle(null);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const login = useCallback(async (handle: string, appPassword: string) => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await authApi.login(handle, appPassword);

      setIsAuthenticated(true);
      setUserDid(response.did);
      setUserHandle(response.handle);
    } catch (err: unknown) {
      const message = extractErrorMessage(err, 'Authentication failed');
      setError(message);
      throw new Error(message);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const logout = useCallback(async () => {
    setIsLoading(true);

    try {
      await authApi.logout();
    } catch {
      // Ignore logout errors
    }

    setIsAuthenticated(false);
    setUserDid(null);
    setUserHandle(null);
    setError(null);
    setIsLoading(false);
  }, []);

  // Check session on mount
  useEffect(() => {
    let isMounted = true;
    async function loadSession() {
      setIsLoading(true);

      try {
        const session = await authApi.getSession();
        if (!isMounted) return;
        setIsAuthenticated(session.authenticated);
        setUserDid(session.did);
        setUserHandle(session.handle);
        setError(null);
      } catch {
        if (!isMounted) return;
        // Session invalid or expired
        setIsAuthenticated(false);
        setUserDid(null);
        setUserHandle(null);
      } finally {
        if (isMounted) setIsLoading(false);
      }
    }
    void loadSession();
    return () => {
      isMounted = false;
    };
  }, []);

  const value: AuthContextType = {
    isAuthenticated,
    isLoading,
    userDid,
    userHandle,
    login,
    logout,
    checkSession,
    error,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
