#!/bin/sh
# Starts the members' room's model on a Vertex AI machine (design §5.10): copies Gemma and EmbeddingGemma from the
# models bucket (filled by the room-model-pull job) onto the machine's disk, then serves them with Ollama on the port
# Vertex AI sends requests to. Vertex AI calls the machine healthy once Ollama answers, after the copy.
set -eu

: "${ROOM_MODELS_BUCKET:?ROOM_MODELS_BUCKET names the models bucket}"
mkdir -p "$OLLAMA_MODELS"

# The account the model is deployed with reads the bucket; rclone finds its credentials on the metadata server.
rclone copy ":gcs,env_auth=true,bucket_policy_only=true:${ROOM_MODELS_BUCKET}" "$OLLAMA_MODELS" \
  --transfers 8 --multi-thread-streams 8 --stats 30s --stats-one-line -v

export OLLAMA_HOST="0.0.0.0:${AIP_HTTP_PORT:-8080}"
exec ollama serve
