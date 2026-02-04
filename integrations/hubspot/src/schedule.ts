import axios, { AxiosInstance } from 'axios';

interface HubSpotConfig {
  access_token: string;
  refresh_token?: string;
  client_id?: string;
  client_secret?: string;
  portalId?: string;
}

interface HubSpotSettings {
  lastSyncTime?: string;
  lastUserEventTime?: string;
  portalId?: string;
}

interface HubSpotActivityCreateParams {
  text: string;
  sourceURL: string;
}

/**
 * Creates an activity message based on HubSpot data
 */
function createActivityMessage(params: HubSpotActivityCreateParams) {
  return {
    type: 'activity',
    data: {
      text: params.text,
      sourceURL: params.sourceURL,
    },
  };
}

/**
 * Gets default sync time (24 hours ago)
 */
function getDefaultSyncTime(): string {
  return new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
}

/**
 * Create HubSpot API client
 */
async function getHubSpotClient(config: HubSpotConfig): Promise<AxiosInstance> {
  // Try to refresh token if needed
  let accessToken = config.access_token;

  if (config.refresh_token && config.client_id && config.client_secret) {
    try {
      const tokenResponse = await axios.post('https://api.hubapi.com/oauth/v1/token', null, {
        params: {
          grant_type: 'refresh_token',
          client_id: config.client_id,
          client_secret: config.client_secret,
          refresh_token: config.refresh_token,
        },
      });

      accessToken = tokenResponse.data.access_token;
    } catch (error) {
      console.error('Failed to refresh token:', error);
    }
  }

  return axios.create({
    baseURL: 'https://api.hubapi.com',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
  });
}

/**
 * Fetch and process recent deals
 */
async function processRecentDeals(
  client: AxiosInstance,
  lastSyncTime: string,
  portalId: string
): Promise<any[]> {
  const activities = [];
  const lastSyncTimestamp = new Date(lastSyncTime).getTime();

  try {
    // Search for recently updated deals
    const response = await client.post('/crm/v3/objects/deals/search', {
      filterGroups: [
        {
          filters: [
            {
              propertyName: 'hs_lastmodifieddate',
              operator: 'GTE',
              value: lastSyncTimestamp.toString(),
            },
          ],
        },
      ],
      limit: 50,
      properties: ['dealname', 'amount', 'dealstage', 'closedate', 'hs_lastmodifieddate'],
    });

    const deals = response.data.results || [];

    for (const deal of deals) {
      try {
        const dealName = deal.properties.dealname || 'Unnamed Deal';
        const amount = deal.properties.amount ? `$${deal.properties.amount}` : 'N/A';
        const stage = deal.properties.dealstage || 'Unknown';
        const sourceURL = `https://app.hubspot.com/contacts/${portalId}/deal/${deal.id}`;

        const text = `## 💼 Deal Updated: ${dealName}

**Amount:** ${amount}
**Stage:** ${stage}
**Deal ID:** ${deal.id}`;

        activities.push(
          createActivityMessage({
            text,
            sourceURL,
          })
        );
      } catch (error) {
        console.error('Error processing deal:', error);
      }
    }
  } catch (error) {
    console.error('Error fetching deals:', error);
  }

  return activities;
}

/**
 * Fetch and process recent contacts
 */
async function processRecentContacts(
  client: AxiosInstance,
  lastSyncTime: string,
  portalId: string
): Promise<any[]> {
  const activities = [];
  const lastSyncTimestamp = new Date(lastSyncTime).getTime();

  try {
    // Search for recently created contacts
    const response = await client.post('/crm/v3/objects/contacts/search', {
      filterGroups: [
        {
          filters: [
            {
              propertyName: 'createdate',
              operator: 'GTE',
              value: lastSyncTimestamp.toString(),
            },
          ],
        },
      ],
      limit: 50,
      properties: ['email', 'firstname', 'lastname', 'company', 'jobtitle'],
    });

    const contacts = response.data.results || [];

    for (const contact of contacts) {
      try {
        const email = contact.properties.email || 'No email';
        const name = `${contact.properties.firstname || ''} ${contact.properties.lastname || ''}`.trim() || 'Unknown';
        const company = contact.properties.company || 'N/A';
        const jobTitle = contact.properties.jobtitle || 'N/A';
        const sourceURL = `https://app.hubspot.com/contacts/${portalId}/contact/${contact.id}`;

        const text = `## 👤 New Contact: ${name}

**Email:** ${email}
**Company:** ${company}
**Job Title:** ${jobTitle}
**Contact ID:** ${contact.id}`;

        activities.push(
          createActivityMessage({
            text,
            sourceURL,
          })
        );
      } catch (error) {
        console.error('Error processing contact:', error);
      }
    }
  } catch (error) {
    console.error('Error fetching contacts:', error);
  }

  return activities;
}

/**
 * Fetch and process recent tickets
 */
async function processRecentTickets(
  client: AxiosInstance,
  lastSyncTime: string,
  portalId: string
): Promise<any[]> {
  const activities = [];
  const lastSyncTimestamp = new Date(lastSyncTime).getTime();

  try {
    // Search for recently updated tickets
    const response = await client.post('/crm/v3/objects/tickets/search', {
      filterGroups: [
        {
          filters: [
            {
              propertyName: 'hs_lastmodifieddate',
              operator: 'GTE',
              value: lastSyncTimestamp.toString(),
            },
          ],
        },
      ],
      limit: 50,
      properties: ['subject', 'content', 'hs_pipeline_stage', 'hs_ticket_priority'],
    });

    const tickets = response.data.results || [];

    for (const ticket of tickets) {
      try {
        const subject = ticket.properties.subject || 'Untitled Ticket';
        const stage = ticket.properties.hs_pipeline_stage || 'Unknown';
        const priority = ticket.properties.hs_ticket_priority || 'N/A';
        const sourceURL = `https://app.hubspot.com/contacts/${portalId}/ticket/${ticket.id}`;

        const text = `## 🎫 Ticket Updated: ${subject}

**Status:** ${stage}
**Priority:** ${priority}
**Ticket ID:** ${ticket.id}`;

        activities.push(
          createActivityMessage({
            text,
            sourceURL,
          })
        );
      } catch (error) {
        console.error('Error processing ticket:', error);
      }
    }
  } catch (error) {
    console.error('Error fetching tickets:', error);
  }

  return activities;
}

export const handleSchedule = async (
  config?: Record<string, string>,
  state?: Record<string, string>
) => {
  try {
    // Check if we have a valid access token
    if (!config?.access_token) {
      return [];
    }

    // Get settings or initialize if not present
    let settings = (state || {}) as HubSpotSettings;

    // Default to 24 hours ago if no last sync time
    const lastSyncTime = settings.lastSyncTime || getDefaultSyncTime();

    // Get portal ID from config or state
    const portalId = config.portalId || settings.portalId || '';

    // Create HubSpot client
    const hubspotConfig: HubSpotConfig = {
      access_token: config.access_token,
      refresh_token: config.refresh_token || '',
      client_id: config.client_id || '',
      client_secret: config.client_secret || '',
      portalId: portalId,
    };

    const client = await getHubSpotClient(hubspotConfig);

    // Collect all messages
    const messages = [];

    // Process recent deals
    const dealActivities = await processRecentDeals(client, lastSyncTime, portalId);
    messages.push(...dealActivities);

    // Process recent contacts
    const contactActivities = await processRecentContacts(client, lastSyncTime, portalId);
    messages.push(...contactActivities);

    // Process recent tickets
    const ticketActivities = await processRecentTickets(client, lastSyncTime, portalId);
    messages.push(...ticketActivities);

    // Update last sync time
    const newSyncTime = new Date().toISOString();

    // Add state message for saving settings
    messages.push({
      type: 'state',
      data: {
        ...settings,
        lastSyncTime: newSyncTime,
        lastUserEventTime: newSyncTime,
        portalId: portalId,
      },
    });

    return messages;
  } catch (error) {
    console.error('Error in handleSchedule:', error);
    return [];
  }
};
