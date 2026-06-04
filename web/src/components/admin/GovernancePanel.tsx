import { useCallback, useEffect, useState } from 'react';
import { adminApi, type GovernanceStatus } from '../../api/admin';
import { AdminPanelSkeleton } from '../Skeleton';
import { CurrentRoundCard } from './CurrentRoundCard';
import { WeightsCard } from './WeightsCard';
import { ContentFiltersCard } from './ContentFiltersCard';
import { SchedulingCard } from './SchedulingCard';
import { RoundHistoryCard } from './RoundHistoryCard';

interface MessageState {
  type: 'success' | 'error';
  text: string;
}

export function GovernancePanel() {
  const [data, setData] = useState<GovernanceStatus | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [message, setMessage] = useState<MessageState | null>(null);

  const fetchGovernanceStatus = useCallback(async () => {
    try {
      const response = await adminApi.getGovernanceStatus();
      setData(response);
    } catch (error) {
      setMessage({
        type: 'error',
        text: error instanceof Error ? error.message : 'Failed to load governance status',
      });
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    async function loadGovernanceStatus() {
      try {
        const response = await adminApi.getGovernanceStatus();
        setData(response);
      } catch (error) {
        setMessage({
          type: 'error',
          text: error instanceof Error ? error.message : 'Failed to load governance status',
        });
      } finally {
        setIsLoading(false);
      }
    }
    void loadGovernanceStatus();
  }, []);

  function handleNotify(type: 'success' | 'error', text: string) {
    setMessage({ type, text });
    window.setTimeout(() => {
      setMessage((current) => (current?.text === text ? null : current));
    }, 4000);
  }

  if (isLoading || !data) {
    return <AdminPanelSkeleton />;
  }

  return (
    <div className="governance-panel content-loaded">
      {message ? <div className={`alert alert-${message.type}`}>{message.text}</div> : null}

      <CurrentRoundCard round={data.currentRound} onAction={fetchGovernanceStatus} onNotify={handleNotify} />

      <WeightsCard weights={data.weights} onUpdate={fetchGovernanceStatus} onNotify={handleNotify} />

      <ContentFiltersCard
        includeKeywords={data.includeKeywords}
        excludeKeywords={data.excludeKeywords}
        onUpdate={fetchGovernanceStatus}
        onNotify={handleNotify}
      />

      <SchedulingCard round={data.currentRound} onUpdate={fetchGovernanceStatus} onNotify={handleNotify} />

      <RoundHistoryCard rounds={data.rounds} />
    </div>
  );
}
