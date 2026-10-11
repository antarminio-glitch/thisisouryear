// Rebuilds the site once a day, so the "years since" counters and share cards
// are never more than a day behind.
//
// It only does anything if BUILD_HOOK_URL is set in Netlify. To get one:
// Project configuration > Build & deploy > Build hooks > Add build hook.
export default async () => {
  const hook = process.env.BUILD_HOOK_URL;
  if (!hook) {
    console.log('BUILD_HOOK_URL is not set, so the daily rebuild was skipped.');
    return;
  }
  const res = await fetch(hook, { method: 'POST' });
  console.log(`Daily rebuild requested: ${res.status}`);
};

// 09:15 UTC is early morning across the US, after the date has changed everywhere.
export const config = { schedule: '15 9 * * *' };
