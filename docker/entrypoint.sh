#!/bin/sh
# CoreBrain Gateway container entrypoint.
#
# Responsibilities:
#   1. (As root) Re-chown the volume mount points so the `corebrain` user
#      can write to them. Named volumes attached to existing data keep their
#      previous ownership — if a user upgrades from an older image where
#      /app was root-owned, the new build's chown wouldn't help. Doing it at
#      boot is idempotent and survives every volume layout.
#   2. Drop to the `corebrain` user via `runuser` and re-exec this script.
#   3. (As corebrain) Wire up git credentials from $GITHUB_TOKEN (if present)
#      so `git clone` and agent-driven `git push` succeed for private repos.
#      Author identity is fetched from the GitHub API once at boot using the
#      same token — no separate name/email env vars to manage.
#   4. Pre-mark claude-code's onboarding as complete so the headless agent
#      doesn't sit at the welcome screen.
#   5. Hand off to `corebrain gateway start --foreground` so PID 1 becomes
#      the gateway process and signals flow straight through.
#
# Coding-agent auth (CLAUDE_CODE_OAUTH_TOKEN / OPENAI_API_KEY) is read
# directly by the agent binaries when they spawn — no setup needed here.

set -eu

# ---------- root phase: fix volume ownership, then drop privileges ----------
if [ "$(id -u)" = "0" ]; then
  # Mount points covered by named volumes inherit the volume's ownership,
  # not the image's. Fix them so corebrain can read/write. `|| true` because
  # ownership may already be correct, and we don't want a noisy non-zero
  # exit on a no-op chown of a huge tree.
  chown -R corebrain:corebrain /app /home/corebrain 2>/dev/null || true

  # Re-exec this script as corebrain. `runuser` (util-linux) is in the base
  # node:22-slim image and doesn't require PAM, unlike `su`.
  exec runuser -u corebrain -- "$0" "$@"
fi

# ---------- git credential helper + identity ----------
# Credential helper reads $GITHUB_TOKEN at lookup time so the secret stays in
# RAM and rotated tokens take effect on container restart without rewriting
# any on-disk file.
if [ -n "${GITHUB_TOKEN:-}" ]; then
  git config --global credential.helper \
    '!f() { echo "username=x-access-token"; echo "password=$GITHUB_TOKEN"; }; f'

  # Fetch author identity from the GitHub API. Requires the token to have
  # `read:user` (and optionally `user:email`) — works for both classic and
  # fine-grained PATs configured with profile read access. If anything is
  # missing or the API is unreachable, fall back to neutral defaults.
  GIT_NAME=""
  GIT_EMAIL=""
  if command -v curl >/dev/null 2>&1; then
    USER_JSON=$(curl -fsS \
      -H "Authorization: Bearer ${GITHUB_TOKEN}" \
      -H "Accept: application/vnd.github+json" \
      -H "User-Agent: corebrain-gateway" \
      https://api.github.com/user 2>/dev/null || true)
    if [ -n "${USER_JSON}" ]; then
      # Tiny ad-hoc parse: avoid a jq dep. `name` may be null.
      GIT_NAME=$(printf '%s' "${USER_JSON}" \
        | sed -n 's/.*"name":[[:space:]]*"\([^"]*\)".*/\1/p' | head -n 1)
      GIT_LOGIN=$(printf '%s' "${USER_JSON}" \
        | sed -n 's/.*"login":[[:space:]]*"\([^"]*\)".*/\1/p' | head -n 1)
      GIT_EMAIL=$(printf '%s' "${USER_JSON}" \
        | sed -n 's/.*"email":[[:space:]]*"\([^"]*\)".*/\1/p' | head -n 1)

      if [ -z "${GIT_EMAIL}" ] && [ -n "${GIT_LOGIN}" ]; then
        # GitHub's privacy-protected noreply form. Picked up correctly by
        # GitHub for attribution. Used when the API doesn't expose email.
        GIT_EMAIL="${GIT_LOGIN}@users.noreply.github.com"
      fi
      if [ -z "${GIT_NAME}" ]; then
        GIT_NAME="${GIT_LOGIN:-CoreBrain Gateway}"
      fi
    fi
  fi

  git config --global user.name "${GIT_NAME:-CoreBrain Gateway}"
  git config --global user.email "${GIT_EMAIL:-gateway@getcore.me}"
fi

# ---------- claude-code onboarding bypass ----------
# `claude` shows an interactive welcome / "complete onboarding" screen on the
# very first run, even when CLAUDE_CODE_OAUTH_TOKEN is set. That blocks the
# headless gateway flow because the spawned PTY just sits at the prompt. We
# pre-mark onboarding as complete in ~/.claude.json so the auth token path
# starts a real session immediately. Idempotent: merges the flag into an
# existing config (preserving anything the user added) or creates a fresh
# one. Survives volume mounts because it runs every boot.
python3 - <<'PY'
import json, os
p = os.path.expanduser("~/.claude.json")
data = {}
if os.path.exists(p):
    try:
        with open(p) as f:
            data = json.load(f) or {}
    except Exception:
        data = {}
# `hasCompletedOnboarding` is the bool flag claude checks on boot.
# `lastOnboardingVersion` is bumped by claude when new onboarding steps are
# added; setting it to a high sentinel keeps future versions from re-prompting.
patch = {"hasCompletedOnboarding": True, "lastOnboardingVersion": "999.0.0"}
if any(data.get(k) != v for k, v in patch.items()):
    data.update(patch)
    with open(p, "w") as f:
        json.dump(data, f, indent=2)
PY

# ---------- pin Brave as the browser ----------
# The image ships Brave instead of Playwright's bundled Chromium. Run the
# CLI's set-browser command so prefs.browser.{browserType,browserExecutable}
# are populated; downstream code reads these via `getBrowserExecutable()` and
# passes the path into Playwright's `executablePath` at launch. Idempotent —
# rewrites the same prefs every boot, which lets us survive a wiped
# /home/corebrain volume without losing the setting.
corebrain browser set-browser brave >/dev/null 2>&1 || true

# ---------- hand off to the gateway ----------
# `exec` replaces the shell so the gateway becomes PID 1 and Docker's
# stop-signal routing + stdout capture go straight to it.
exec corebrain gateway start --foreground "$@"
