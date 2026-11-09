// Compact relative time for commit rows: "now", "12m", "3h", "2d".
export function fmtAgo(t, now = Date.now()) {
  const m = Math.round((now - t) / 60000);
  if (m < 1) return 'now';
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.round(h / 24)}d`;
}
