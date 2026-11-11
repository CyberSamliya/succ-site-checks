// Scheduled website checks that run on GitHub's servers, independent of any one computer.
// Reads the site list and alert address from encrypted repository secrets, checks each site,
// alerts when the set of failing sites changes, and writes a status file containing only
// times and counts (no site names or addresses).
import crypto from 'node:crypto';
import fs from 'node:fs';

const TIMEOUT_MS = 20000;
const sites = JSON.parse(process.env.SITES_JSON || '[]');
const webhook = process.env.ALERT_WEBHOOK || '';
const previous = (() => { try { return JSON.parse(fs.readFileSync('previous-status.json', 'utf8')); } catch { return {}; } })();

async function checkOnce(url) {
  try {
    const res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(TIMEOUT_MS), headers: { 'User-Agent': 'succ-site-checks/1.0' } });
    await res.body?.cancel();
    return res.status < 500 ? null : `HTTP ${res.status}`;
  } catch (err) { return err?.cause?.code ?? err?.name ?? 'no response'; }
}
async function check(site) {
  let problem = await checkOnce(site.url);
  if (problem) { await new Promise((r) => setTimeout(r, 15000)); problem = await checkOnce(site.url); } // one retry before calling it down
  return { ...site, problem };
}

export async function sendAlert(url, title, text) {
  const host = new URL(url).hostname;
  const json = host.endsWith('slack.com') ? { text: `*${title}*\n${text}` } : host.endsWith('discord.com') || host.endsWith('discordapp.com') ? { content: `**${title}**\n${text}` } : null;
  const res = await fetch(url, json
    ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(json), signal: AbortSignal.timeout(TIMEOUT_MS) }
    : { method: 'POST', headers: { 'Content-Type': 'text/plain; charset=utf-8', Title: title, Priority: 'high', Tags: 'warning' }, body: text, signal: AbortSignal.timeout(TIMEOUT_MS) });
  return res.ok;
}

// Salted with the private alert address so the public fingerprint cannot be matched to site names.
const fp = (ids) => crypto.createHash('sha256').update(`${webhook}#${ids}`).digest('hex').slice(0, 16);
const results = await Promise.all(sites.map(check));
const failing = results.filter((r) => r.problem);
// A fingerprint of which sites are failing, so an alert goes out when that changes, not every run.
const fingerprint = fp(failing.map((f) => f.id).sort().join('|'));
let alert = 'none';
if (webhook && fingerprint !== (previous.failingFingerprint ?? fp(''))) {
  const title = failing.length ? `${failing.length} website${failing.length === 1 ? '' : 's'} down` : 'All websites are back up';
  const text = failing.length ? failing.map((f) => `${f.url} (${f.problem})`).join('\n') : `All ${results.length} monitored websites answered.`;
  alert = (await sendAlert(webhook, title, text).catch(() => false)) ? 'sent' : 'failed';
}
fs.writeFileSync('status.json', `${JSON.stringify({ generatedAt: new Date().toISOString(), checked: results.length, failed: failing.length, failingFingerprint: fingerprint, alert, alertConfigured: Boolean(webhook) }, null, 2)}\n`);
console.log(`checked ${results.length} sites, ${failing.length} failing, alert: ${alert}`); // counts only: this log is public
if (alert === 'failed') process.exitCode = 1;
