#!/bin/bash
# M0Claw Telegram Bot Starter
# Usage: ./start.sh

export TELEGRAM_BOT_TOKEN="8650716833:AAE5g3JjkJjnKjKMrWuAh7hYeeSl5lSLgYs"
export OLLAMA_BASE_URL="http://localhost:11434/v1"
export AI_MODEL="glm4:9b-chat"
# Set your target channel for auto-posting (channel ID or @username)
# export TELEGRAM_TARGET_CHANNEL="@mychannel"

echo "Starting M0Claw bot..."
echo "Model: $AI_MODEL"
echo "Ollama: $OLLAMA_BASE_URL"
if [ -n "$TELEGRAM_TARGET_CHANNEL" ]; then
  echo "Target channel: $TELEGRAM_TARGET_CHANNEL"
else
  echo "Target channel: nicht gesetzt (manuelles Kopieren)"
fi
echo ""

npx tsx src/bot.ts
