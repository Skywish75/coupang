// Every scheduled job runs from ONE cron expression (wrangler.toml), so the
// free plan's limit of 5 cron triggers per account is never at risk. The
// job is chosen from the Korea-time clock of the scheduled run:
//   daily     09:00            -> auto-publish (posts, prices, comparisons)
//   Saturday  10:00-12:00      -> weekly Telegram lotto numbers (batches)
//   Saturday  22:00, Sunday 00:00 and 10:00 -> fetch that night's draw result
export const CRON = '0 0,1,2,3,13,15 * * *';

export function scheduledJob(scheduledTime) {
  const kst = new Date(scheduledTime + 9 * 60 * 60 * 1000);
  const day = kst.getUTCDay(); // 0 = Sunday, 6 = Saturday
  const hour = kst.getUTCHours();
  if (hour === 9) return 'publish';
  if (day === 6 && hour >= 10 && hour <= 12) return 'lotto-send';
  if ((day === 6 && hour === 22) || (day === 0 && (hour === 0 || hour === 10))) return 'lotto-results';
  return null;
}
