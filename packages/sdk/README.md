# Echo SDK

The Echo SDK provides tools and utilities for building integrations with the Echo platform.

## Integration System

The Echo integration system uses a CLI-based approach where each integration is a command-line tool that responds to specific events. This makes integrations portable, testable, and easy to debug.

### Integration Event Types

Each integration CLI handles 5 core event types:

#### 1. `spec`
Returns the integration's metadata and configuration.

**Usage:**
```bash
my-integration spec
```

**Returns:** Integration specification including name, description, auth config, etc.

#### 2. `setup`
Processes authentication data and returns tokens/credentials to be saved.

**Usage:**
```bash
my-integration setup --event-body '{"code":"oauth_code","state":"state"}' --integration-definition '{}'
```

**Returns:** Configuration data (tokens, credentials) to be stored for the account.

#### 3. `identify`
Extracts accountId from webhook data to route webhooks to the correct account.

**Usage:**
```bash
my-integration identify --webhook-data '{"team_id":"T123","event":{}}'
```

**Returns:** Account identifier for webhook routing.

#### 4. `process`
Handles webhook events and returns activity data.

**Usage:**
```bash
my-integration process --event-data '{"type":"reaction_added","reaction":"=M"}' --config '{"access_token":"token"}'
```

**Returns:** Activity messages representing user actions.

#### 5. `sync`
Performs scheduled data synchronization for integrations that don't support webhooks.

**Usage:**
```bash
my-integration sync --config '{"access_token":"token","last_sync":"2023-01-01T00:00:00Z"}'
```

**Returns:** Activity messages and updated state for next sync.

### Message Types

All integration responses are wrapped in a `Message` object with a `type` field:

- **`spec`** - Integration metadata and configuration
- **`activity`** - User actions/events from the integration
- **`state`** - Sync state for polling integrations
- **`identifier`** - Account identification for webhook routing

### Building an Integration

1. **Install the SDK:**
```bash
npm install @echo/core-sdk
```

2. **Create your integration class:**
```typescript
import { IntegrationCLI } from '@echo/core-sdk';

class MyIntegration extends IntegrationCLI {
  constructor() {
    super('my-integration', '1.0.0');
  }

  protected async handleEvent(eventPayload: IntegrationEventPayload): Promise<any> {
    switch (eventPayload.event) {
      case 'SETUP':
        return this.handleSetup(eventPayload);
      case 'PROCESS':
        return this.handleProcess(eventPayload);
      case 'IDENTIFY':
        return this.handleIdentify(eventPayload);
      case 'SYNC':
        return this.handleSync(eventPayload);
      default:
        throw new Error(`Unknown event type: ${eventPayload.event}`);
    }
  }

  protected async getSpec(): Promise<Spec> {
    return {
      name: 'My Integration',
      key: 'my-integration',
      description: 'Integration with My Service',
      icon: 'https://example.com/icon.png',
      auth: {
        OAuth2: {
          token_url: 'https://api.example.com/oauth/token',
          authorization_url: 'https://api.example.com/oauth/authorize',
          scopes: ['read', 'write']
        }
      }
    };
  }

  private async handleSetup(eventPayload: IntegrationEventPayload): Promise<any> {
    // Process OAuth response and return tokens to save
    const { code } = eventPayload.eventBody;
    // Exchange code for tokens...
    return {
      access_token: 'token',
      refresh_token: 'refresh_token',
      expires_at: Date.now() + 3600000
    };
  }

  private async handleProcess(eventPayload: IntegrationEventPayload): Promise<any> {
    // Handle webhook events
    const { eventData } = eventPayload.eventBody;
    // Process event and return activity...
    return {
      type: 'message',
      user: 'user123',
      content: 'Hello world',
      timestamp: new Date()
    };
  }

  private async handleIdentify(eventPayload: IntegrationEventPayload): Promise<any> {
    // Extract account ID from webhook
    const { team_id } = eventPayload.eventBody;
    return { id: team_id };
  }

  private async handleSync(eventPayload: IntegrationEventPayload): Promise<any> {
    // Perform scheduled sync
    const { config } = eventPayload;
    // Fetch data since last sync...
    return {
      activities: [/* activity data */],
      state: { last_sync: new Date().toISOString() }
    };
  }
}

// CLI entry point
const integration = new MyIntegration();
integration.parse();
```

3. **Build and package your integration:**
```bash
npm run build
npm pack
```

### Integration Development

The `IntegrationCLI` base class provides:

- **Automatic CLI setup** with all required commands
- **JSON input/output handling** for all event types
- **Error handling** with proper exit codes
- **Consistent message formatting** for all responses

### Testing

Test your integration by running commands directly:

```bash
# Test spec
node dist/index.js spec

# Test setup
node dist/index.js setup --event-body '{"code":"test"}' --integration-definition '{}'

# Test webhook processing
node dist/index.js process --event-data '{"type":"test"}' --config '{"token":"test"}'
```

### Best Practices

1. **Always validate input data** before processing
2. **Handle errors gracefully** with meaningful error messages
3. **Use consistent data structures** for activities
4. **Include proper timestamps** in all activity data
5. **Store minimal state** for sync operations
6. **Test all event types** thoroughly

For more examples, see the integrations in the `integrations/` directory.