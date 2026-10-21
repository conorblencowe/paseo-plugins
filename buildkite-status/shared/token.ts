const DAY_MS = 86_400_000;

// A warning once a token has three days or less left; null for no expiry or plenty of time.
export function expiryWarning(
  expiresAt: string | null | undefined,
  now = Date.now(),
): string | null {
  if (!expiresAt) return null;
  const left = Date.parse(expiresAt) - now;
  if (left > 3 * DAY_MS) return null;
  if (left <= 0) return "Your Buildkite token has expired.";
  const days = Math.floor(left / DAY_MS);
  return days === 0
    ? "Your Buildkite token expires today."
    : `Your Buildkite token expires in ${days} ${days === 1 ? "day" : "days"}.`;
}
