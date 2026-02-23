# Relaygent — persistent AI agent in a container.
# Usage: docker compose up -d
#   Then connect via http://localhost:8080 (hub + noVNC)
#
# First run: authenticate Claude via noVNC desktop, then `relaygent start`
# Subsequent runs: credentials persist via volume mounts

FROM ubuntu:24.04 AS base

ENV DEBIAN_FRONTEND=noninteractive \
    DISPLAY=:99 \
    HOME=/home/relaygent \
    LANG=en_US.UTF-8 \
    TZ=UTC

# System deps: desktop, VNC, browser, dev tools
RUN apt-get update && apt-get install -y --no-install-recommends \
    # Desktop
    xvfb gnome-shell gnome-terminal dbus-x11 wmctrl xdotool \
    # VNC
    x11vnc \
    # Browser
    wget curl gnupg ca-certificates \
    # Dev tools
    git python3 python3-venv python3-pip \
    # Computer-use deps
    scrot imagemagick python3-pyatspi at-spi2-core \
    # System
    tini sudo locales \
    && locale-gen en_US.UTF-8 \
    && rm -rf /var/lib/apt/lists/*

# Node.js 22
RUN curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
    && apt-get install -y nodejs && rm -rf /var/lib/apt/lists/*

# Browser: Chrome (amd64) or Chromium via Debian bookworm (arm64 — no Chrome arm64 Linux)
RUN ARCH=$(dpkg --print-architecture) && \
    if [ "$ARCH" = "amd64" ]; then \
      wget -q -O - https://dl.google.com/linux/linux_signing_key.pub | gpg --dearmor -o /usr/share/keyrings/google.gpg && \
      echo "deb [arch=amd64 signed-by=/usr/share/keyrings/google.gpg] http://dl.google.com/linux/chrome/deb/ stable main" \
        > /etc/apt/sources.list.d/google-chrome.list && \
      apt-get update && apt-get install -y google-chrome-stable; \
    else \
      echo "deb [trusted=yes arch=$ARCH] http://deb.debian.org/debian bookworm main" \
        > /etc/apt/sources.list.d/bookworm.list && \
      apt-get update && apt-get install -y --no-install-recommends chromium && \
      rm /etc/apt/sources.list.d/bookworm.list; \
    fi && rm -rf /var/lib/apt/lists/*

# Claude Code CLI
RUN npm install -g @anthropic-ai/claude-code

# Create non-root user (chown needed because earlier root RUNs may have created HOME)
RUN useradd -m -s /bin/bash -d $HOME relaygent \
    && echo "relaygent ALL=(ALL) NOPASSWD:ALL" >> /etc/sudoers.d/relaygent \
    && chown -R relaygent:relaygent $HOME

USER relaygent
WORKDIR $HOME

# Copy relaygent source
COPY --chown=relaygent:relaygent . $HOME/relaygent/

# Run non-interactive setup (installs deps, builds hub, creates config)
RUN cd $HOME/relaygent && bash setup.sh --docker

# Ports: hub (8080), VNC (5900)
EXPOSE 8080 5900

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
    CMD curl -sf http://localhost:8080/api/health || exit 1

ENTRYPOINT ["tini", "--"]
CMD ["bash", "/home/relaygent/relaygent/docker/entrypoint.sh"]
