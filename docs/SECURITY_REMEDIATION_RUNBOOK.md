# Security Remediation Runbook — Credential Rotation & History Rewrite

**Status:** PREPARED 2026-09-14 (Phase 1). Steps 1–3 below are
**owner-only actions** that require access to Railway, the live DNS/provider
accounts, and the ability to force-push to GitHub. They cannot be performed
from this workspace and MUST be completed before the repository can be made
public-history-clean.

---

## 1. Rotate the compromised Railway PostgreSQL password (finding NB1)

A production Railway PostgreSQL DSN (with password) was committed to git
history in commits `881b028` and `ada869b` (see `.gitleaks.toml` and
`docs/DATA_CHANGES.md` entry 002). Treat the old password as compromised.

1. Railway dashboard → your Postgres service → **Settings → Change password**
   (or delete/recreate the credential pair).
2. Generate a new 32+ char password:
   ```bash
   node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))"
   ```
3. Set the new password as the `DATABASE_URL` Railway variable on the
   application service (and any other consumer).
4. Redeploy the application and confirm `/ping` → 200 and
   `prisma migrate status` is clean.
5. Update `server/.env` locally (and any laptop copies) with the new
   password so local tooling keeps working.

## 2. Rewrite history to purge the leaked DSN (git filter-repo)

Do this AFTER step 1 — the leaked password must be dead before history is
published again. Requires pushing to GitHub, so it is intentionally deferred
per the current "no push" freeze.

```bash
# One-time tool install (any machine with git):
pip install git-filter-repo   # or: winget install --id GitFilterRepo.GitFilterRepo

# In a FRESH clone (never rewrite the working repo in place):
git clone --mirror git@github.com:dr-rsmart/TimeTrack.git timetrack-rewrite.git
cd timetrack-rewrite.git

git filter-repo --invert-paths --replace-text <(cat <<'EOF'
regex:postgres(ql)?://[^\s:@/]+:[^\s@]+@==>postgresql://REDACTED@
EOF
)

# Alternatively, purge the two offending commits outright if the DSN appears
# nowhere else (verify with: git grep 'postgresql://' $(git rev-list --all)):
git filter-repo --replace-text expressions.txt

git push --force --mirror
```

Then in every working clone (this one included):

```bash
git fetch origin --prune
git reset --hard origin/main   # after backing up any local-only work
```

And finally remove the now-unnecessary allowlist entries from
`.gitleaks.toml` (`RicJer24`, the `commits` block) and re-enable a clean
`npx gitleaks detect --redact` gate.

## 3. Move third-party secrets out of the local workspace

The following live credentials currently sit in plaintext files on this
machine (all gitignored, but still a laptop-theft exposure):

| Secret                       | Current location                                 | Target                                                                                                                 |
| ---------------------------- | ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| Namecheap API key + password | root `.env` (`NAMECHEAP_*`)                      | 1Password / Railway variables; update `scripts/update-namecheap-dns.mjs` + `scripts/dns-watchdog.mjs` to read env only |
| iOS build credentials        | root `.env` (`iOS_Build_*`)                      | 1Password; scripts already read env                                                                                    |
| App Store Connect API key    | `asc-api-key.json`, `asc-api-key.p8` (repo root) | Secret manager; revoke + reissue if the machine was shared                                                             |

After migrating, delete the local copies and run:

```bash
Get-ChildItem -Recurse -Force | Where-Object { $_.Name -match 'asc-api-key|\.p8$|\.env$' }
```

Expect only `.env.example` files to remain.

## 4. Rotate the local development database password

The tracked docs previously echoed the local dev password (`RicJer24`);
it was redacted from tracked files on 2026-09-14. Rotate the local Postgres
password anyway:

```bash
psql -h localhost -p 5433 -U postgres -c "ALTER ROLE postgres PASSWORD '<new>';"
```

…then update `server/.env` and any helper scripts.

## Verification checklist (post-owner-actions)

```bash
git grep -n -E "(postgres(ql)?|rediss?)://[^\s:@/]+:[^\s@]+@" $(git rev-list --all) || echo CLEAN
git log --all --oneline | head
npx gitleaks detect --redact
```

`gitleaks` must exit 0 with NO allowlist entries remaining.
