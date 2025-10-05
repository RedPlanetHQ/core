# Unraid Integration for CORE

Monitor and track your Unraid server activity in the CORE knowledge graph.

## Features

- **Docker Container Monitoring**: Track container starts, stops, deployments, and updates
- **Virtual Machine Tracking**: Monitor VM lifecycle events (start, stop, pause, resume)
- **Array Status**: Track array state changes, parity checks, and disk operations
- **System Metrics**: Alert on high CPU (>80%) and memory usage (>90%)
- **Version Tracking**: Detect Unraid system updates
- **Real-time Activities**: All changes appear as activities in your CORE timeline

## Prerequisites

1. **Unraid Server** running version 6.9.2 or later
2. **Unraid API Plugin** installed (search "Unraid Connect" in Apps tab)
3. **API Key** generated on your Unraid server

## Setup Instructions

### Step 1: Install Unraid API Plugin

On your Unraid server:
1. Go to **Apps** tab
2. Search for "Unraid Connect"
3. Install the plugin
4. Wait for installation to complete

### Step 2: Generate API Key

SSH into your Unraid server and run:

```bash
unraid-api key --help
```

Follow the instructions to create a new API key. Save this key securely.

### Step 3: Configure Integration in CORE

1. In CORE, navigate to Integrations
2. Select "Unraid extension"
3. Provide:
   - **Server URL**: Your Unraid server URL (e.g., `http://192.168.1.100`)
   - **API Key**: The key you generated in Step 2
4. Click "Connect"

## What Gets Tracked

### Docker Containers
- Container started/stopped
- New container deployed
- Container image updated
- Update available notifications

### Virtual Machines
- VM started/stopped/paused/resumed
- New VM created
- VM removed

### Array Status
- Array started/stopped
- Parity check started/completed
- Parity check errors detected

### System Metrics
- High CPU usage alerts (>80%)
- High memory usage alerts (>90%)

### System Updates
- Unraid version updates detected

## Sync Frequency

The integration polls your Unraid server every **5 minutes** to check for changes.

## GraphQL API Queries

The integration uses the following Unraid GraphQL queries:

- `docker { containers {...} }` - Docker container status
- `vms { domains {...} }` - Virtual machine status
- `array { state, parityCheckStatus, ... }` - Array information
- `info { version, ... }` - System information
- `metrics { cpu, memory }` - Resource metrics

## Troubleshooting

### Connection Failed
- Verify your Unraid server is accessible from CORE
- Check that the server URL is correct (include `http://` or `https://`)
- Ensure the API key is valid

### No Activities Appearing
- Check that the integration is connected in CORE settings
- Verify changes are actually happening on your Unraid server
- Check integration logs for errors

### API Key Issues
- Regenerate the API key on Unraid: `unraid-api key`
- Update the key in CORE integration settings

## Development

### Build

```bash
npm install --legacy-peer-deps
npm run build
```

### Test

```bash
# Test spec output
node bin/index.cjs spec

# Test setup (requires valid credentials)
node bin/index.cjs setup '{"serverUrl":"http://your-server","apiKey":"your-key"}'
```

## Architecture

- **Language**: TypeScript
- **Build Tool**: tsup
- **GraphQL Client**: axios
- **Authentication**: API Key (Authorization header)
- **Sync Strategy**: Polling every 5 minutes

## Files

- `src/index.ts` - CLI entry point
- `src/account-create.ts` - Setup/validation handler
- `src/schedule.ts` - Main sync logic
- `src/utils.ts` - GraphQL client utilities
- `src/types.ts` - TypeScript type definitions
- `spec.json` - Integration metadata
- `tsup.config.ts` - Build configuration

## License

Part of the CORE project. See root LICENSE file.
