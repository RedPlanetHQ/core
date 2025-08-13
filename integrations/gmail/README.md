# Gmail Integration for Sol

This integration allows you to connect your Gmail account to Sol, enabling you to monitor emails, send messages, and manage your email workflow.

## Features

- **Email Monitoring**: Track incoming emails and create activities
- **Email Sending**: Send emails programmatically
- **Email Search**: Search for emails using Gmail's query syntax
- **Starred Emails**: Monitor and process starred emails
- **Sent Email Tracking**: Track sent emails and create activities

## Prerequisites

1. Google Cloud Console project with Gmail API enabled
2. OAuth2 credentials configured
3. Proper scopes configured for Gmail access

## Installation

1. Install dependencies:
   ```bash
   npm install
   ```

2. Build the integration:
   ```bash
   npm run build
   ```

## Configuration

The integration uses OAuth2 for authentication with the following scopes:

- `https://www.googleapis.com/auth/gmail.readonly` - Read emails
- `https://www.googleapis.com/auth/gmail.send` - Send emails
- `https://www.googleapis.com/auth/gmail.modify` - Modify emails (mark as read, star, etc.)
- `https://www.googleapis.com/auth/gmail.compose` - Compose emails
- `https://www.googleapis.com/auth/gmail.labels` - Manage labels
- `https://www.googleapis.com/auth/gmail.metadata` - Read email metadata
- `https://www.googleapis.com/auth/gmail.settings.basic` - Read basic settings
- `https://www.googleapis.com/auth/userinfo.email` - Read user email
- `https://www.googleapis.com/auth/userinfo.profile` - Read user profile

## Usage

The integration handles the following events:

### Email Received
Triggered when a new email is received. Creates an activity with:
- Sender information
- Subject line
- Email content
- Permalink to the email in Gmail

### Email Sent
Triggered when an email is sent. Creates an activity with:
- Recipient information
- Subject line
- Email content
- Permalink to the sent email

### Email Starred
Triggered when an email is starred. Creates an activity with:
- Sender information
- Subject line
- Email content
- Permalink to the starred email

## Development

### Build
```bash
npm run build
```

### Lint
```bash
npm run lint
```

### Format
```bash
npm run prettier
```

## File Structure

```
src/
├── index.ts              # Main integration file with CLI and event handling
├── account-create.ts     # Account creation and OAuth setup
├── create-activity.ts    # Activity creation from Gmail events
└── utils.ts             # Utility functions for Gmail API interactions
```

## API Reference

### Utils Functions

- `getGmailClient(config)` - Creates authenticated Gmail client
- `parseEmailContent(payload)` - Parses email content from Gmail payload
- `formatEmailSender(from)` - Formats sender information
- `getUserProfile(config)` - Gets user profile information
- `searchEmails(config, query, maxResults)` - Searches emails
- `sendEmail(config, to, subject, body)` - Sends an email

## Error Handling

The integration includes proper error handling for:
- Authentication failures
- API rate limits
- Network errors
- Invalid email formats

## Security

- OAuth2 tokens are securely stored
- Refresh tokens are used for long-term authentication
- Proper scope validation ensures minimal permissions

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Run linting and formatting
6. Submit a pull request

## License

This project is licensed under the same license as the parent Sol project. 