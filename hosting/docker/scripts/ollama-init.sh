#!/bin/bash
set -e

echo "Starting Ollama server..."
ollama serve &
OLLAMA_PID=$!

echo "Waiting for Ollama server to be ready..."
sleep 5

echo "Pulling mxbai-embed-large model..."
ollama pull mxbai-embed-large

echo "Model pulled successfully!"
echo "Ollama is ready to accept requests."

# Keep the Ollama server running
wait $OLLAMA_PID
