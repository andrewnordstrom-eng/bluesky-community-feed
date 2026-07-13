/**
 * Announcement Text Generators
 *
 * Functions to generate announcement text for different governance events.
 */

import { config } from '../config.js';
import type { GovernanceWeights } from '../governance/governance.types.js';
import type {
  AnnouncementPayload,
  VotingOpenedPayload,
  EpochTransitionPayload,
  ManualAnnouncementPayload,
  LegalUpdatePayload,
} from './bot.types.js';

/**
 * Format weights as percentages for display.
 */
function formatWeights(weights: GovernanceWeights): string {
  return [
    `Recency: ${(weights.recency * 100).toFixed(0)}%`,
    `Engagement: ${(weights.engagement * 100).toFixed(0)}%`,
    `Bridging: ${(weights.bridging * 100).toFixed(0)}%`,
    `Source Diversity: ${(weights.sourceDiversity * 100).toFixed(0)}%`,
    `Relevance: ${(weights.relevance * 100).toFixed(0)}%`,
  ].join('\n');
}

/**
 * Format weight changes with arrows.
 */
function formatWeightChanges(oldWeights: GovernanceWeights, newWeights: GovernanceWeights): string {
  const changes: string[] = [];

  const components: Array<{ key: keyof GovernanceWeights; label: string }> = [
    { key: 'recency', label: 'Recency' },
    { key: 'engagement', label: 'Engagement' },
    { key: 'bridging', label: 'Bridging' },
    { key: 'sourceDiversity', label: 'Source Diversity' },
    { key: 'relevance', label: 'Relevance' },
  ];

  for (const { key, label } of components) {
    const oldVal = oldWeights[key] * 100;
    const newVal = newWeights[key] * 100;
    const diff = newVal - oldVal;

    if (Math.abs(diff) < 0.5) {
      changes.push(`${label}: ${newVal.toFixed(0)}% (unchanged)`);
    } else if (diff > 0) {
      changes.push(`${label}: ${oldVal.toFixed(0)}% -> ${newVal.toFixed(0)}% (+${diff.toFixed(0)}%)`);
    } else {
      changes.push(`${label}: ${oldVal.toFixed(0)}% -> ${newVal.toFixed(0)}% (${diff.toFixed(0)}%)`);
    }
  }

  return changes.join('\n');
}

/**
 * Generate text for voting opened announcement.
 */
export function generateVotingOpenedText(payload: VotingOpenedPayload): string {
  const feedUrl = `https://${config.FEEDGEN_HOSTNAME}/vote`;

  let text = `Voting is now open for Epoch ${payload.epochId}!\n\n`;
  text += `Approved pilot participants can propose how this feed ranks posts:\n${feedUrl}\n\n`;

  if (payload.weights) {
    text += `Current weights:\n${formatWeights(payload.weights)}\n\n`;
  }

  text += 'Voting closes at the configured deadline. Results are reviewed before an approved policy can affect the feed.';

  return text;
}

/**
 * Generate text for epoch transition announcement.
 */
export function generateEpochTransitionText(payload: EpochTransitionPayload): string {
  const transparencyUrl = `https://${config.FEEDGEN_HOSTNAME}/transparency`;

  let text = `Epoch ${payload.newEpochId} is now active!\n\n`;
  text += `${payload.voteCount} community members voted. The algorithm has been updated:\n\n`;
  text += formatWeightChanges(payload.oldWeights, payload.newWeights);
  text += `\n\nView full breakdown: ${transparencyUrl}`;

  return text;
}

/**
 * Generate text for manual announcement.
 */
export function generateManualAnnouncementText(payload: ManualAnnouncementPayload): string {
  return payload.message;
}

/**
 * Generate text for legal document update announcement.
 */
export function generateLegalUpdateText(payload: LegalUpdatePayload): string {
  const docLabel =
    payload.documentType === 'both'
      ? 'Terms of Service and Privacy Policy have'
      : payload.documentType === 'tos'
        ? 'Terms of Service has'
        : 'Privacy Policy has';

  return (
    `Important: Our ${docLabel} been updated.\n\n` +
    `Review the changes: ${payload.url}\n\n` +
    `Your continued use of the feed constitutes acceptance of the updated terms.`
  );
}

/**
 * Generate announcement text based on payload type.
 */
export function generateAnnouncementText(payload: AnnouncementPayload): string {
  switch (payload.type) {
    case 'voting_opened':
      return generateVotingOpenedText(payload);
    case 'epoch_transition':
      return generateEpochTransitionText(payload);
    case 'manual':
      return generateManualAnnouncementText(payload);
    case 'legal_update':
      return generateLegalUpdateText(payload);
    default:
      throw new Error(`Unknown announcement type: ${(payload as AnnouncementPayload).type}`);
  }
}
