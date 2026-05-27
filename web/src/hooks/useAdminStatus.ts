/**
 * useAdminStatus Hook
 *
 * Fetches admin status from the API and provides loading/error states.
 * Used by AdminGuard to check if the current user is an admin.
 */

import { useState, useEffect, useCallback } from 'react';
import { isAxiosError } from 'axios';
import { adminApi } from '../api/admin';
import type { AdminStatus } from '../api/admin';
import { useAuth } from '../contexts/useAuth';

export function useAdminStatus() {
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const [status, setStatus] = useState<AdminStatus | null>(null);
  const [statusLoading, setStatusLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // While auth is loading we should report loading too; once auth is settled,
  // we surface the local status fetch state.
  const isLoading = authLoading || statusLoading;

  const fetchStatus = useCallback(async () => {
    // Avoid admin endpoint probes for logged-out users.
    if (!isAuthenticated) {
      setStatus(null);
      setError(null);
      setStatusLoading(false);
      return;
    }

    try {
      setStatusLoading(true);
      const data = await adminApi.getStatus();
      setStatus(data);
      setError(null);
    } catch (err) {
      // 401/403 means user is authenticated but not admin (or session expired).
      if (isAxiosError(err) && (err.response?.status === 401 || err.response?.status === 403)) {
        setStatus(null);
        setError(null);
        return;
      }
      setError(err instanceof Error ? err.message : 'Failed to fetch status');
      setStatus(null);
    } finally {
      setStatusLoading(false);
    }
  }, [isAuthenticated]);

  useEffect(() => {
    if (authLoading) {
      return;
    }

    async function loadStatus() {
      // Avoid admin endpoint probes for logged-out users.
      if (!isAuthenticated) {
        setStatus(null);
        setError(null);
        setStatusLoading(false);
        return;
      }

      try {
        setStatusLoading(true);
        const data = await adminApi.getStatus();
        setStatus(data);
        setError(null);
      } catch (err) {
        // 401/403 means user is authenticated but not admin (or session expired).
        if (isAxiosError(err) && (err.response?.status === 401 || err.response?.status === 403)) {
          setStatus(null);
          setError(null);
          return;
        }
        setError(err instanceof Error ? err.message : 'Failed to fetch status');
        setStatus(null);
      } finally {
        setStatusLoading(false);
      }
    }

    void loadStatus();
  }, [authLoading, isAuthenticated]);

  return {
    status,
    isAdmin: status?.isAdmin ?? false,
    isLoading,
    error,
    refetch: fetchStatus
  };
}
