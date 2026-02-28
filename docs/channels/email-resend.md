# Email Channel with Resend

This guide covers setting up the email channel using [Resend](https://resend.com) for inbound and outbound email communication with CORE.

## Overview

The email channel allows users to interact with CORE by sending emails. CORE processes incoming emails, runs them through the AI pipeline, and sends replies back via email.

**Capabilities:**
- Inbound email processing via Resend webhooks
- Outbound email replies via Resend API
- Plain text email responses

**Limitations:**
- No typing indicators (email doesn't support this)
- No acknowledge messages (no intermediate "processing..." emails)
- No email threading via Message-ID/In-Reply-To headers (threading is subject-line based only)
- Plain text replies only (no rich HTML formatting in AI responses)
- No attachment support
- No webhook signature verification (see Security Notes)

## Prerequisites

1. A [Resend](https://resend.com) account
2. A verified domain in Resend for sending emails
3. Resend Inbound configured to receive emails

## Environment Variables

Add these to your `.env` file:

```bash
# Required: Set transport to resend
EMAIL_TRANSPORT=resend

# Required: Your Resend API key
RESEND_API_KEY=re_xxxxxxxxxx

# Required: The email address that receives inbound emails
# This must match your Resend inbound configuration
FROM_EMAIL=brain@yourdomain.com
```

## Resend Configuration

### 1. Get Your API Key

1. Go to [Resend Dashboard](https://resend.com/api-keys)
2. Create a new API key with **full access** (needed for both sending and receiving)
3. Copy the key to `RESEND_API_KEY`

### 2. Verify Your Domain

1. Go to [Resend Domains](https://resend.com/domains)
2. Add your domain and follow DNS verification steps
3. Wait for verification to complete

### 3. Configure Inbound Email

1. Go to [Resend Inbound](https://resend.com/inbound)
2. Set up an inbound address (e.g., `brain@yourdomain.com`)
3. Add MX records as instructed by Resend
4. Configure the webhook endpoint:
   ```
   https://your-core-domain.com/api/v1/channels/email
   ```
5. Select the `email.received` event type

### 4. Set FROM_EMAIL

Set `FROM_EMAIL` to match your inbound email address:
```bash
FROM_EMAIL=brain@yourdomain.com
```

This is used to:
- Filter incoming emails (only emails addressed to this address are processed)
- Set the Reply-To header on outbound emails

## Webhook Route

Inbound emails are received at:

```
POST /api/v1/channels/email
```

The webhook handler:
1. Validates the event type is `email.received`
2. Checks the recipient matches `FROM_EMAIL`
3. Fetches the full email body from Resend API
4. Looks up the sender by email address in your user database
5. Routes the message through the CORE AI pipeline
6. Sends a reply to the sender

## How It Works

### Inbound Flow

1. User sends email to `brain@yourdomain.com`
2. Resend receives the email and sends a webhook to `/api/v1/channels/email`
3. CORE fetches the email body using `resend.emails.receiving.get(email_id)`
4. If the sender is a registered user, the message is processed
5. AI generates a response
6. Response is sent back via email

### Outbound Flow

1. AI generates a response
2. CORE sends email via `resend.emails.send()`
3. Subject is prefixed with `Re: ` if replying to a thread

## User Registration

Only registered users can interact via email. The sender's email address must exist in the CORE user database with an associated workspace.

Emails from unknown senders are logged but not processed.

## File Locations

| File | Purpose |
|------|---------|
| `apps/webapp/app/services/channels/email/inbound.ts` | Webhook parsing |
| `apps/webapp/app/services/channels/email/outbound.ts` | Reply sending |
| `apps/webapp/app/services/channels/email/index.ts` | Channel registration |
| `packages/emails/src/transports/resend.ts` | Resend transport |
| `apps/webapp/app/routes/api.v1.channels.$channel.tsx` | Webhook route |

## Troubleshooting

### Emails not being received

1. Check Resend Inbound logs for delivery status
2. Verify MX records are correctly configured
3. Confirm webhook URL is accessible from the internet
4. Check `FROM_EMAIL` matches the inbound address

### Emails received but not processed

1. Verify sender is a registered user in CORE
2. Check logs for "Email from unknown sender" warnings
3. Confirm user has an associated workspace

### Replies not being sent

1. Check `RESEND_API_KEY` has send permissions
2. Verify domain is verified in Resend
3. Check application logs for Resend API errors

### Empty email body

1. Some email clients send HTML-only emails
2. The handler extracts `text` first, then falls back to `html`
3. Check Resend logs to see the raw email content

## Security Notes

- **No webhook signature verification**: The `RESEND_WEBHOOK_SECRET` environment variable is defined but not currently implemented. Anyone who knows your webhook URL could potentially send fake events.
- **Sender validation**: Only processes emails from registered users, which provides some protection.
- **Recipient filtering**: Only processes emails addressed to `FROM_EMAIL`.

## Comparison with Other Channels

| Feature | Email | WhatsApp | Slack |
|---------|-------|----------|-------|
| Typing indicators | No | No | Yes |
| Acknowledge messages | No | Yes | Yes |
| Rich formatting | No (plain text) | Limited | Yes |
| Thread tracking | Subject-based | Yes | Yes |
| Attachments | No | Yes | Yes |
