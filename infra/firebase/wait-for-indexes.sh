#!/usr/bin/env bash
# Waits until every index of the (default) Firestore database is READY: the composite indexes and the single-field
# overrides of firestore.indexes.json (design §15). The release workflow runs it after deploying the indexes and before
# rolling the services, whose queries fail with FAILED_PRECONDITION ("index currently building") until the indexes they
# need are built. Needs gcloud signed in as someone who may list indexes (ustp-release holds Cloud Datastore Index
# Admin) and jq.
#
#   bash infra/firebase/wait-for-indexes.sh <project> [timeout in seconds, default 1800]
set -euo pipefail
shopt -s inherit_errexit
project=${1:?usage: wait-for-indexes.sh <project> [timeout-seconds]}
timeout=${2:-1800}
deadline=$((SECONDS + timeout))

# One line per index that is not READY: its state, then what it indexes.
pending() {
  gcloud firestore indexes composite list --project="$project" --database='(default)' --format=json |
    jq -r '.[] | select(.state != "READY") | "\(.state) \(.name)"'
  gcloud firestore indexes fields list --project="$project" --database='(default)' --format=json |
    jq -r '.[] | .name as $field | (.indexConfig.indexes // [])[] | select(.state != "READY") | "\(.state) \($field) (\(.queryScope))"'
}

while :; do
  waiting=$(pending)
  if [ -z "$waiting" ]; then
    echo "Every index is ready."
    exit 0
  fi
  if grep -q '^NEEDS_REPAIR ' <<<"$waiting"; then
    echo "An index needs repair (see the Firestore console's Indexes page); nothing was rolled out:" >&2
    echo "$waiting" >&2
    exit 1
  fi
  if [ "$SECONDS" -ge "$deadline" ]; then
    echo "Indexes still building after ${timeout} s; nothing was rolled out. Run the release again once they are ready:" >&2
    echo "$waiting" >&2
    exit 1
  fi
  echo "Waiting for $(wc -l <<<"$waiting") index(es) to build:"
  echo "$waiting"
  sleep 15
done
