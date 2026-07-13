import type { ContentFilterResult, ContentRules } from './governance.types.js';

const ASCII_KEYWORD_PATTERN = /^[a-z0-9][a-z0-9\s-]*$/;
const UNICODE_WORD_CLASS = '\\p{L}\\p{N}';
const keywordMatcherCache = new Map<string, (text: string) => boolean>();

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function getKeywordMatcher(keyword: string, prefixMatch: boolean): (text: string) => boolean {
  const normalizedKeyword = keyword.trim().toLowerCase();
  const cacheKey = `${normalizedKeyword}:${prefixMatch ? 'prefix' : 'strict'}`;
  const cached = keywordMatcherCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  if (!ASCII_KEYWORD_PATTERN.test(normalizedKeyword)) {
    const matcher = (text: string) => text.includes(normalizedKeyword);
    keywordMatcherCache.set(cacheKey, matcher);
    return matcher;
  }

  const phrasePattern = normalizedKeyword
    .split(/\s+/)
    .filter((part) => part.length > 0)
    .map(escapeRegex)
    .join('[\\s_-]+');
  const trailingBoundary = prefixMatch ? '' : `(?=$|[^${UNICODE_WORD_CLASS}])`;
  const regex = new RegExp(
    `(^|[^${UNICODE_WORD_CLASS}])${phrasePattern}${trailingBoundary}`,
    'u'
  );
  const matcher = (text: string) => regex.test(text);
  keywordMatcherCache.set(cacheKey, matcher);
  return matcher;
}

function matchesKeyword(text: string, keyword: string, prefixMatch: boolean): boolean {
  const normalizedKeyword = keyword.trim().toLowerCase();
  if (normalizedKeyword.length === 0) {
    return false;
  }
  return getKeywordMatcher(normalizedKeyword, prefixMatch)(text);
}

/** Apply production include/exclude matching without loading storage dependencies. */
export function checkContentRules(
  text: string | null,
  rules: ContentRules
): ContentFilterResult {
  if (rules.includeKeywords.length === 0 && rules.excludeKeywords.length === 0) {
    return { passes: true };
  }

  if (!text) {
    return rules.includeKeywords.length > 0
      ? { passes: false, reason: 'no_text_with_include_filter' }
      : { passes: true };
  }

  const lowerText = text.toLowerCase();
  for (const keyword of rules.excludeKeywords) {
    if (matchesKeyword(lowerText, keyword, true)) {
      return {
        passes: false,
        reason: 'excluded_keyword',
        matchedKeyword: keyword,
      };
    }
  }

  if (rules.includeKeywords.length > 0) {
    for (const keyword of rules.includeKeywords) {
      if (matchesKeyword(lowerText, keyword, false)) {
        return { passes: true, matchedKeyword: keyword };
      }
    }
    return { passes: false, reason: 'no_include_match' };
  }

  return { passes: true };
}
