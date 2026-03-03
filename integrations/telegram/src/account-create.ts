import axios from 'axios';

const TELEGRAM_API_BASE = 'https://api.telegram.org';

export async function integrationCreate(data: any) {
  const { apiKey } = data;

  const botToken = apiKey || data.bot_token;

  if (!botToken) {
    throw new Error('Bot token is required. Get one from @BotFather on Telegram.');
  }

  let botInfo = null;

  try {
    const response = await axios.get(`${TELEGRAM_API_BASE}/bot${botToken}/getMe`);

    if (!response.data.ok) {
      throw new Error(`Telegram API error: ${response.data.description}`);
    }

    botInfo = response.data.result;
  } catch (error: any) {
    const message = error.response?.data?.description || error.message;
    throw new Error(`Failed to verify bot token: ${message}`);
  }

  const integrationConfiguration = {
    bot_token: botToken,
    bot_id: String(botInfo.id),
    bot_username: botInfo.username,
    bot_first_name: botInfo.first_name,
    can_join_groups: botInfo.can_join_groups,
    can_read_all_group_messages: botInfo.can_read_all_group_messages,
    supports_inline_queries: botInfo.supports_inline_queries,
  };

  const payload = {
    settings: {},
    accountId: integrationConfiguration.bot_id,
    config: integrationConfiguration,
  };

  return [
    {
      type: 'account',
      data: payload,
    },
  ];
}
