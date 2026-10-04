// Calendar dates as 'YYYY-MM-DD' strings. Stats and click counts use Korea
// time so "today" matches what the site's readers see.
export function kstDate(ms = Date.now()) {
  return new Date(ms + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export function shiftDate(date, days) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
