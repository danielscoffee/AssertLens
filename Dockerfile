# AssertLens CLI with Git and Bubblewrap. No npm dependencies are installed.
# Sandboxed checks need: --security-opt seccomp=unconfined
#   --security-opt apparmor=unconfined --security-opt systempaths=unconfined
FROM node:24-bookworm-slim@sha256:0e0ff40c39bc087845bfb27465a0df4ea419520094bc35842ff83dd8cbe6f9b6

RUN apt-get update \
	&& apt-get install --yes --no-install-recommends bubblewrap git \
	&& rm -rf /var/lib/apt/lists/*

COPY LICENSE package.json /opt/assertlens/
COPY src /opt/assertlens/src

USER node
WORKDIR /repo
ENTRYPOINT ["node", "/opt/assertlens/src/assertlens.ts"]
