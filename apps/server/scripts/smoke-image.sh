#!/usr/bin/env bash
# Smoke test of the server image (apps/server/Dockerfile), run by CI: the image runs as an unprivileged user, carries
# no build or development tooling, and all four entrypoints (api, worker, mcp, discord) start in production mode and answer
# their health check. It is given no Google credentials and no reachable site, so nothing beyond the image is exercised.
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

# Link previews' card images (design §15) set their text in Lato with opentype.js and render it with sharp: draw one in
# the image, which has no fonts of its own, to show all three are there and work.
docker run --rm "$image" node --input-type=module -e "
  const { renderCard } = await import('/app/apps/server/dist/link-previews/card-image.js');
  const png = await renderCard({ kicker: 'Smoke test', title: 'A card drawn in the image', lines: ['Ünïcödé'] }, { name: 'USTP Vote', party: 'U.S. Transhumanist Party', host: 'vote.example.org' });
  if (png.length < 5000 || png.subarray(1, 4).toString() !== 'PNG') throw new Error('no card');
  console.log('card image: ' + png.length + ' bytes');
"

cleanup() { docker rm -f ustp-api ustp-worker ustp-mcp ustp-discord >/dev/null 2>&1 || true; }
trap cleanup EXIT

# As Cloud Run runs them (infra/terraform/modules/ustpvote/run.tf, mcp.tf): the default command for the api.
docker run -d --name ustp-api -p 18080:8080 -e PORT=8080 -e GOOGLE_CLOUD_PROJECT=demo-ustpvote "$image" >/dev/null
docker run -d --name ustp-worker -p 18081:8080 -e PORT=8080 -e GOOGLE_CLOUD_PROJECT=demo-ustpvote "$image" \
  node dist/main-worker.js >/dev/null
docker run -d --name ustp-mcp -p 18082:8080 -e PORT=8080 -e USTP_SITE=https://vote.example.org "$image" \
  node /app/apps/mcp/dist/main.js --http --host 0.0.0.0 >/dev/null

docker run -d --name ustp-discord -p 18083:8080 -e PORT=8080 -e USTP_SITE=https://vote.example.org "$image" \
  node /app/apps/discord/dist/main.js --host 0.0.0.0 >/dev/null

# The mcp and the Discord commands service serve /health, not /healthz.
for target in ustp-api:18080:healthz ustp-worker:18081:healthz ustp-mcp:18082:health ustp-discord:18083:health; do
  IFS=: read -r name port path <<<"$target"
  for _ in $(seq 1 30); do
    if body=$(curl -fsS "http://127.0.0.1:$port/$path" 2>/dev/null); then
      echo "$name: $body"
      continue 2
    fi
    sleep 1
  done
  echo "$name did not answer /$path within 30 seconds" >&2
  docker logs "$name" >&2
  exit 1
done

docker image ls "$image" --format 'image size: {{.Size}}'
