#!/usr/bin/env bash
# Smoke test of the server image (apps/server/Dockerfile), run by CI: the image runs as an unprivileged user, carries
# no build or development tooling, and both entrypoints start in production mode and answer /healthz. It is given no
# Google credentials, so nothing that reaches Google Cloud is exercised.
#
#   bash apps/server/scripts/smoke-image.sh <image>
set -euo pipefail
image=${1:?usage: smoke-image.sh <image>}

uid=$(docker run --rm "$image" id -u)
if [ "$uid" = 0 ]; then
  echo "the image runs as root" >&2
  exit 1
fi

for pkg in typescript vitest firebase-tools vue; do
  if docker run --rm "$image" test -e "/app/node_modules/$pkg"; then
    echo "the image contains $pkg" >&2
    exit 1
  fi
done

cleanup() { docker rm -f ustp-api ustp-worker >/dev/null 2>&1 || true; }
trap cleanup EXIT

# As Cloud Run runs them (infra/terraform/modules/ustpvote/run.tf): the default command for the api.
docker run -d --name ustp-api -p 18080:8080 -e PORT=8080 -e GOOGLE_CLOUD_PROJECT=demo-ustpvote "$image" >/dev/null
docker run -d --name ustp-worker -p 18081:8080 -e PORT=8080 -e GOOGLE_CLOUD_PROJECT=demo-ustpvote "$image" \
  node dist/main-worker.js >/dev/null

for target in ustp-api:18080 ustp-worker:18081; do
  name=${target%:*}
  port=${target#*:}
  for _ in $(seq 1 30); do
    if body=$(curl -fsS "http://127.0.0.1:$port/healthz" 2>/dev/null); then
      echo "$name: $body"
      continue 2
    fi
    sleep 1
  done
  echo "$name did not answer /healthz within 30 seconds" >&2
  docker logs "$name" >&2
  exit 1
done

docker image ls "$image" --format 'image size: {{.Size}}'
