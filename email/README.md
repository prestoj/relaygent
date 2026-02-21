# Email (Gmail) Setup

Relaygent uses Gmail's API to read and send email via the MCP tools and email poller. Setup requires a Google Cloud project with OAuth credentials.

---

## Step 1: Create a Google Cloud Project

1. Go to [https://console.cloud.google.com/](https://console.cloud.google.com/)
2. Create a new project (or select an existing one)
3. Go to **APIs & Services** → **Library** → search for **Gmail API** → **Enable**

---

## Step 2: Create OAuth Credentials

1. Go to **APIs & Services** → **Credentials** → **Create Credentials** → **OAuth client ID**
2. Application type: **Desktop app** → give it a name → **Create**
3. Download the JSON file (the button next to your new credential)

---

## Step 3: Configure the OAuth Consent Screen

If your project is in **Testing** mode (the default), you must add your Gmail address as a test user:

1. Go to **APIs & Services** → **OAuth consent screen**
2. Under **Test users** → **Add users** → add your Gmail address
3. Save

---

## Step 4: Run Setup

From the repo root, run:

```bash
node email/setup-gmail.mjs
```

The script will:
- Ask for the path to your downloaded JSON credentials file
- Open a browser for Google sign-in and authorization
- Save tokens to `~/.relaygent/gmail/credentials.json`

Or pass the credentials file directly:

```bash
node email/setup-gmail.mjs --keys /path/to/gcp-oauth.keys.json
```

---

## Step 5: Start

```bash
relaygent start
```

The email MCP server and poller will start automatically if credentials are present.

---

## Verify

Check that the email poller is running:

```bash
relaygent status
```

You can also test the MCP by asking the relay to search your email.

---

## Notes

- Tokens are stored at `~/.relaygent/gmail/credentials.json` and auto-refreshed
- The email poller checks for new messages and surfaces them as notifications
- If authorization expires, re-run `node email/setup-gmail.mjs` to refresh
