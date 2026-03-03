#!/bin/bash
# M0Claw Telegram Bot Starter
# Usage: ./start.sh

export TELEGRAM_BOT_TOKEN="8650716833:AAE5g3JjkJjnKjKMrWuAh7hYeeSl5lSLgYs"
export OLLAMA_BASE_URL="http://localhost:11434/v1"
export AI_MODEL="llama3.2"

echo "Starting M0Claw bot..."
echo "Model: $AI_MODEL"
echo "Ollama: $OLLAMA_BASE_URL"
echo ""

npx tsx src/bot.ts
