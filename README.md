# Scheduled website checks

Checks a private list of websites every 15 minutes from GitHub's servers and sends an alert when a
site goes down or comes back. It keeps working when the owner's computer is off.

- `check.mjs` does the checks. It needs no packages.
- The list of sites (`SITES_JSON`) and the alert address (`ALERT_WEBHOOK`) are encrypted repository
  secrets. They are never printed.
- The `status` branch holds `status.json`: the time of the last run and how many sites were checked
  and failing. It contains no site names or addresses.

A site counts as down if it does not answer, or answers with a server error (500 or above), twice in
a row 15 seconds apart. The workflow only runs on a schedule or when started by hand.
