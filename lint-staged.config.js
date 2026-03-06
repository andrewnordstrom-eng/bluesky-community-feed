/**
 * lint-staged configuration
 *
 * Uses function syntax for tsc to prevent lint-staged from appending
 * matched file paths — tsc needs to check the whole project.
 */
export default {
  '*.{ts,tsx}': () => 'tsc --noEmit',
};
