# zaxbot

A Cloudflare Worker that announces when a Twitch stream goes live, straight to a Discord channel.
It generates a custom 1920x1080 announcement image on the fly, posts it through a Discord webhook, and
also tracks the streamer's speedrun.com submissions to announce newly verified runs.

Everything runs on Cloudflare — nothing has to run on a PC or a dedicated server.

## Features

- **Live announcements**: polls the Twitch API every minute and posts a Discord embed (with a custom
  generated image, a "Watch the stream" button, and speedrun PB/WR fields) as soon as the streamer goes live.
- **Speedrun theming**: the announcement image and embed automatically pick up the game being played,
  and the speedrun.com category named in the stream title (including subcategories, matched by name or
  acronym, e.g. "NMG" for "No Major Glitches").
- **Verified run announcements**: polls the streamer's own speedrun.com submissions and posts a Discord
  message whenever one of their runs gets verified.
- **Admin page**: a small password-protected page to preview and manually trigger an announcement.

## How it works

| File | Role |
| --- | --- |
| `src/index.ts` | Worker entry point. `fetch` serves the admin page, `scheduled` (Cron) checks for a new live stream and for newly verified speedrun.com runs. |
| `src/announcement.ts` | Builds a live announcement: picks the game theme, resolves the speedrun category and PB, draws the image, fetches the world record. |
| `src/games.ts` | Maps a Twitch `game_id` to a theme (background, logo, display name). Unknown games fall back to a default theme. |
| `src/speedrun.ts` | speedrun.com public API. Matches the category (and subcategories) named in the stream title against the streamer's speedrun.com games, and returns their PB for it. |
| `src/speedrun-runs.ts` | speedrun.com authenticated API (needs an API key). Detects the streamer's runs that were verified since the last check. |
| `src/twitch.ts` | Twitch Helix API client. Caches the app access token in KV, exposes `getLiveStream` and `getChannelInfo`. |
| `src/discord.ts` | Posts to Discord webhooks: the live announcement (image + embed + link button) and the verified-run notification (plain text). |
| `src/overlay/` | Draws the announcement image using the Cloudflare Images binding. |
| `src/page/` | The server-rendered admin page (streamer name + password, preview and manual trigger). |
| `category-names.json` | Maps a speedrun.com category/subcategory name to the shorter text drawn on the image. |
| `theme.css` | Single source of truth for the image's colors, sizes and layout (also used by the browser preview). |

## Setup

### Prerequisites

- Node.js
- A [Cloudflare account](https://dash.cloudflare.com/) with Workers and Images enabled
- A Twitch application (client id + secret, from the [Twitch Developer Console](https://dev.twitch.tv/console))
- A Discord webhook per channel you want to post to
- A speedrun.com account and [API key](https://www.speedrun.com/api/auth) if you want verified-run announcements

### Install

```
npm install
```

### Create the KV namespace

Stores the cached Twitch token and the Worker's state (last announced stream, last verified run):

```
npx wrangler kv namespace create STATE
```

Copy the returned id into the `[[kv_namespaces]]` block of `wrangler.toml`.

### Configure `wrangler.toml`

Set the plain (non-secret) variables under `[vars]`:

- `TWITCH_LOGIN`: the Twitch login of the streamer to watch
- `SPEEDRUN_PROFILE`: the streamer's speedrun.com profile name
- `FONT_URL`: a public URL to the font file used on the announcement image

### Set the secrets

```
npx wrangler secret put TWITCH_CLIENT_ID
npx wrangler secret put TWITCH_CLIENT_SECRET
npx wrangler secret put DISCORD_WEBHOOK_URL
npx wrangler secret put ADMIN_PASSWORD
npx wrangler secret put SPEEDRUN_API_KEY
npx wrangler secret put SPEEDRUN_RUN_WEBHOOK_URL
```

> **`SPEEDRUN_API_KEY` and `SPEEDRUN_RUN_WEBHOOK_URL` are optional.** Without them, the Worker does not
> fail or log a visible error — it silently skips the verified-run check on every Cron tick, so live
> announcements keep working as usual. Set both secrets if you also want verified-run notifications.

### Enable the Cron trigger

Keep the `[triggers]` block in `wrangler.toml` to get automatic announcements. Remove it if you only want
to announce manually from the admin page (otherwise announcements would be doubled).

## Commands

```
npx wrangler dev --remote      # run locally with the real Cloudflare Images binding
npx wrangler deploy            # publish the Worker
npx wrangler tail              # stream logs (shows the Twitch game_id of each announcement)
npx tsc --noEmit               # type-check
```

> `draw` / `text` (used to render the announcement image) only work through `npx wrangler dev --remote`;
> local dev mode does not support Cloudflare Images transforms.
