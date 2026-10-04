#!/usr/bin/env bash
# Build, smoke-test, and push the AssertLens image to GHCR under each given tag.
# Run only from trusted refs with GITHUB_TOKEN scoped to packages: write.
set -euo pipefail
image="ghcr.io/${GITHUB_REPOSITORY_OWNER,,}/assertlens"
docker build --pull \
  --label "org.opencontainers.image.source=$GITHUB_SERVER_URL/$GITHUB_REPOSITORY" \
  --label "org.opencontainers.image.revision=$GITHUB_SHA" \
  --label org.opencontainers.image.licenses=Apache-2.0 \
  "${@/#/--tag=$image:}" .
docker run --rm "$image:$1" --help | grep -q '^AssertLens'
printf '%s' "$GITHUB_TOKEN" | docker login ghcr.io --username "$GITHUB_ACTOR" --password-stdin
unset GITHUB_TOKEN
for tag in "$@"; do docker push "$image:$tag"; done
docker logout ghcr.io
