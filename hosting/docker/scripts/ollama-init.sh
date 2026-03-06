#!/bin/bash
set -e

echo "Starting Ollama server..."
ollama serve &
OLLAMA_PID=$!

echo "Waiting for Ollama server to be ready..."
sleep 5

EMBEDDING_MODEL="${EMBEDDING_MODEL:-mxbai-embed-large}"
MODEL_NAME="${MODEL:-}"
CHAT_PROVIDER="${CHAT_PROVIDER:-openai}"
OLLAMA_PULL_LLM="${OLLAMA_PULL_LLM:-}"

echo "Pulling embedding model: ${EMBEDDING_MODEL} ..."
ollama pull "${EMBEDDING_MODEL}"

if [[ "${CHAT_PROVIDER}" == "ollama" || "${OLLAMA_PULL_LLM}" == "1" || "${OLLAMA_PULL_LLM}" == "true" ]]; then
  if [[ -n "${MODEL_NAME}" ]]; then
    echo "Pulling chat model for Ollama: ${MODEL_NAME} ..."
    ollama pull "${MODEL_NAME}"
  elif [[ "${CHAT_PROVIDER}" == "ollama" ]]; then
    echo "Warning: CHAT_PROVIDER=ollama but no chat model configured (MODEL empty); skipping chat model pull." >&2
  fi
else
  echo "Skipping chat model pull (CHAT_PROVIDER=${CHAT_PROVIDER})."
fi

echo "Model pulled successfully!"
echo "Ollama is ready to accept requests."

# Keep the Ollama server running
wait $OLLAMA_PID
