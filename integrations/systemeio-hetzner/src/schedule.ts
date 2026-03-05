import {
  getContacts,
  getSales,
  listServers,
  provisionCustomerServer,
} from './utils';

interface SyncState {
  lastSyncTime?: string;
  lastSaleId?: string;
  provisionedCustomers?: string; // JSON array of customer IDs
  totalRevenue?: string;
  activeServers?: string;
}

function createActivityMessage(text: string, sourceURL: string = '') {
  return {
    type: 'activity' as const,
    data: { text, sourceURL },
  };
}

/**
 * Scheduled sync that:
 * 1. Checks Systeme.io for new sales/contacts
 * 2. Auto-provisions Hetzner servers for new customers
 * 3. Tracks revenue and active subscriptions
 * 4. Reports status as activity messages
 */
export async function handleSchedule(
  config?: Record<string, string>,
  state?: Record<string, string>,
) {
  try {
    if (!config?.systeme_api_key || !config?.hetzner_api_token) {
      return [
        createActivityMessage(
          'Sync übersprungen: Systeme.io API Key oder Hetzner API Token fehlt. Bitte Integration neu konfigurieren.',
        ),
      ];
    }

    const settings = (state || {}) as SyncState;
    const messages: any[] = [];
    const provisionedCustomers: string[] = JSON.parse(settings.provisionedCustomers || '[]');

    // ============================================================
    // 1. CHECK NEW SALES IN SYSTEME.IO
    // ============================================================
    try {
      const salesData = await getSales(config.systeme_api_key);
      const sales = salesData?.items || [];

      for (const sale of sales) {
        const saleId = String(sale.id);

        // Skip already processed sales (numeric comparison for reliable ordering)
        if (settings.lastSaleId && Number(saleId) <= Number(settings.lastSaleId)) {
          continue;
        }

        const customerEmail = sale.contactEmail || sale.contact?.email;
        const customerName = sale.contactName || sale.contact?.firstName || 'Kunde';
        const amount = sale.amount || sale.planAmount || 99;

        messages.push(
          createActivityMessage(
            `Neuer Verkauf: ${customerName} (${customerEmail}) hat das KI-Power Abo für €${amount}/Monat gebucht!`,
            `https://app.systeme.io/contacts`,
          ),
        );

        // 2. AUTO-PROVISION SERVER FOR NEW CUSTOMER
        if (!provisionedCustomers.includes(customerEmail)) {
          try {
            const result = await provisionCustomerServer({
              systemeApiKey: config.systeme_api_key,
              hetznerApiToken: config.hetzner_api_token,
              customerEmail,
              customerId: saleId,
              customerName,
            });

            provisionedCustomers.push(customerEmail);

            messages.push(
              createActivityMessage(
                `Server automatisch bereitgestellt für ${customerName}: IP ${result.serverIp} | Open WebUI: ${result.accessUrls.openWebUI} | n8n: ${result.accessUrls.n8n}`,
                `https://console.hetzner.cloud/servers`,
              ),
            );
          } catch (error: any) {
            messages.push(
              createActivityMessage(
                `FEHLER: Server-Provisioning fehlgeschlagen für ${customerEmail}: ${error.message}`,
              ),
            );
          }
        }

        settings.lastSaleId = saleId;
      }
    } catch (error: any) {
      messages.push(
        createActivityMessage(
          `Systeme.io API Fehler: ${error?.response?.status ? `HTTP ${error.response.status}` : error?.message || 'Unbekannter Fehler'} - wird beim nächsten Sync erneut versucht`,
        ),
      );
    }

    // ============================================================
    // 3. CHECK HETZNER SERVER STATUS
    // ============================================================
    try {
      const serversData = await listServers(config.hetzner_api_token);
      const servers = serversData?.servers || [];

      // Count managed servers
      const managedServers = servers.filter(
        (s: any) => s.labels?.managed_by === 'ki-fastfood-system',
      );

      const activeCount = managedServers.filter((s: any) => s.status === 'running').length;
      const totalMonthlyRevenue = activeCount * 99;

      // Report any server issues
      for (const server of managedServers) {
        if (server.status !== 'running') {
          messages.push(
            createActivityMessage(
              `WARNUNG: Server ${server.name} (${server.labels?.customer_email}) Status: ${server.status}`,
              `https://console.hetzner.cloud/servers/${server.id}`,
            ),
          );
        }
      }

      // Periodic revenue report (on first sync or server count change)
      const previousActiveServers = settings.activeServers;
      settings.activeServers = String(activeCount);
      settings.totalRevenue = String(totalMonthlyRevenue);

      if (previousActiveServers !== String(activeCount) || !settings.lastSyncTime) {
        messages.push(
          createActivityMessage(
            `Dashboard: ${activeCount} aktive Server | €${totalMonthlyRevenue}/Monat Umsatz | ${provisionedCustomers.length} Kunden total`,
          ),
        );
      }
    } catch (error: any) {
      messages.push(
        createActivityMessage(
          `Hetzner API Fehler: ${error?.response?.status ? `HTTP ${error.response.status}` : error?.message || 'Unbekannter Fehler'} - wird beim nächsten Sync erneut versucht`,
        ),
      );
    }

    // ============================================================
    // 4. CHECK FOR NEW CONTACTS (LEADS)
    // ============================================================
    try {
      const contactsData = await getContacts(config.systeme_api_key, 1, 10);
      const contacts = contactsData?.items || [];

      const lastSync = settings.lastSyncTime
        ? new Date(settings.lastSyncTime)
        : new Date(Date.now() - 24 * 60 * 60 * 1000);

      for (const contact of contacts) {
        const createdAt = new Date(contact.registeredAt || contact.createdAt);
        if (createdAt > lastSync) {
          messages.push(
            createActivityMessage(
              `Neuer Lead: ${contact.firstName || ''} ${contact.lastName || ''} (${contact.email}) hat sich registriert`,
              `https://app.systeme.io/contacts`,
            ),
          );
        }
      }
    } catch (error: any) {
      messages.push(
        createActivityMessage(
          `Kontakte-Sync Fehler: ${error?.response?.status ? `HTTP ${error.response.status}` : error?.message || 'Unbekannter Fehler'} - wird beim nächsten Sync erneut versucht`,
        ),
      );
    }

    // Update state
    messages.push({
      type: 'state',
      data: {
        ...settings,
        lastSyncTime: new Date().toISOString(),
        provisionedCustomers: JSON.stringify(provisionedCustomers),
      },
    });

    return messages;
  } catch (error: any) {
    return [
      createActivityMessage(
        `Kritischer Sync-Fehler: ${error?.message || 'Unbekannter Fehler'} - bitte Integration prüfen`,
      ),
    ];
  }
}
