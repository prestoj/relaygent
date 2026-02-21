# Slack Setup

Relaygent uses two Slack tokens:
- **User token** (`xoxp-*`) — for reading/sending messages via the MCP tools
- **App-level token** (`xapp-*`) — for Socket Mode real-time message delivery

Both require a Slack app. Follow the steps below once, then run `relaygent start`.

---

## Step 1: Create a Slack App

1. Go to [https://api.slack.com/apps](https://api.slack.com/apps) → **Create New App** → **From scratch**
2. Give it a name (e.g. "Relaygent") and select your workspace

---

## Step 2: Configure User Token Scopes

1. In your app settings → **OAuth & Permissions** → **Redirect URLs**, add:
   ```
   https://localhost:3333/callback
   ```
2. Under **User Token Scopes**, add all of:
   - `channels:history`, `channels:read`, `channels:write`
   - `chat:write`
   - `groups:history`, `groups:read`, `groups:write`
   - `im:history`, `im:read`, `im:write`
   - `mpim:history`, `mpim:read`, `mpim:write`
   - `reactions:write`, `search:read`, `users:read`
3. Click **Install to Workspace** and approve

---

## Step 3: Get the User Token

Run the interactive setup script from the repo root:

```bash
node slack/setup-token.mjs
```

It will prompt for your app's **Client ID** and **Client Secret** (found in your app's **Basic Information** page), then open a browser for OAuth authorization.

Alternatively, if you already have an `xoxp-` token:

```bash
node slack/setup-token.mjs --token xoxp-your-token-here
```

The token is saved to `~/.relaygent/slack/token.json`.

---

## Step 4: Enable Socket Mode (real-time delivery)

Socket Mode lets the relay receive messages instantly without polling.

1. In your app settings → **Socket Mode** → toggle **Enable Socket Mode** on
2. It will prompt you to create an **App-Level Token** — name it anything (e.g. "relaygent-socket"), grant the `connections:write` scope, and click **Generate**
3. Copy the `xapp-` token and save it:
   ```bash
   mkdir -p ~/.relaygent/slack
   echo "xapp-your-token-here" > ~/.relaygent/slack/app-token
   ```

### Event Subscriptions (required for Socket Mode)

In your app settings → **Event Subscriptions** → **Enable Events** → **Subscribe to events on behalf of users**, add:
- `message.channels`
- `message.groups`
- `message.im`
- `message.mpim`

Save changes, then reinstall the app to your workspace (**OAuth & Permissions** → **Reinstall**).

---

## Step 5: Start

```bash
relaygent start
```

The Slack MCP server and Socket Mode listener will start automatically.

---

## Verify

Check that the socket listener is running:

```bash
relaygent status
cat /tmp/relaygent-slack-socket-cache.json
```

You should see recent messages in the cache within a few seconds of receiving a Slack message.
