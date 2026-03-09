# Deployment Guide – Mac Optimizer

## Automated Deployment via Claude Code

This project is configured for automated deployment and updates via Claude Code.

### 1. Deploy to Production

**One-time setup:**
```bash
# Clone the repo
git clone https://github.com/Maurice-AIEMPIRE/core
cd core

# Deploy to Homebrew tap
bash scripts/deploy/to-homebrew.sh

# Deploy to Gumroad (license server)
bash scripts/deploy/to-gumroad.sh

# Create release on GitHub
bash scripts/deploy/create-release.sh
```

### 2. Automatic Updates

Every commit to `claude/auto-fix-mac-performance-Tyo8p` branch triggers:
1. ✅ Lint & format check
2. ✅ macOS compatibility test
3. ✅ Security scan
4. ✅ Create GitHub release
5. ✅ Push to Homebrew tap
6. ✅ Notify license server

### 3. License Server Integration

Set environment variables for automated license validation:

```bash
export LICENSE_API_URL="https://api.mac-optimizer.io/v1/validate"
export LICENSE_API_KEY="your-secret-key"
export GUMROAD_WEBHOOK_SECRET="your-webhook-secret"
```

### 4. Monitor Deployments

```bash
# Watch CI/CD logs
gh run list --branch claude/auto-fix-mac-performance-Tyo8p

# Check latest release
gh release view

# View deployment status
curl https://api.github.com/repos/Maurice-AIEMPIRE/core/releases
```

### 5. Rollback (if needed)

```bash
# Revert to previous release
gh release delete v1.0.1
git tag -d v1.0.1
git push origin :refs/tags/v1.0.1
```

## Continuous Integration

The project includes GitHub Actions workflows in `.github/workflows/`:
- `test.yml` – Runs tests on every push
- `release.yml` – Creates releases
- `publish-homebrew.yml` – Updates Homebrew tap
- `notify-gumroad.yml` – Syncs with license server

## Server Endpoints

| Endpoint | Purpose |
|----------|---------|
| `https://api.mac-optimizer.io/v1/validate` | License validation |
| `https://api.mac-optimizer.io/v1/notify` | License server updates |
| `https://gumroad.com/api/licenses` | Gumroad integration |
| `https://github.com/Maurice-AIEMPIRE/core/releases` | Version checking |

## Development

Work on branch: `claude/auto-fix-mac-performance-Tyo8p`

All changes automatically:
1. Get tested on macOS 12+
2. Get linted and formatted
3. Create a GitHub release
4. Push to Homebrew tap
5. Sync with license server

**No manual deployment needed!**

## Environment Variables

```bash
# License server
LICENSE_API_URL=https://api.mac-optimizer.io/v1/validate
LICENSE_API_KEY=sk_live_xxxxx

# Gumroad integration
GUMROAD_API_KEY=xxxxx
GUMROAD_WEBHOOK_SECRET=whsec_xxxxx

# GitHub releases
GITHUB_TOKEN=ghp_xxxxx

# Homebrew tap
HOMEBREW_GITHUB_TOKEN=ghp_xxxxx
```

## Support

- GitHub: https://github.com/Maurice-AIEMPIRE/core
- Email: support@mac-optimizer.io
