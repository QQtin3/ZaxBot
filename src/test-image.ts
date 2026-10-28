import type { Env } from "./env";
import { getGameTheme } from "./games";
import { renderOverlay } from "./overlay/render";

type TestEnv = Pick<Env, "IMAGES" | "FONT_URL" | "TWITCH_LOGIN">;

/**
 * Test endpoint: open it in the browser to see the generated overlay.
 *
 * Query parameters (all optional):
 *   game_id   Twitch game id, picks the theme from games.ts and the [data-game] block of theme.css
 *   color1    top color of the accent gradient, e.g. 1fd13a (without the #)
 *   color2    bottom color of the accent gradient
 *   bg        overrides the background image URL
 *   logo      overrides the logo URL
 *   game      game name shown in the title
 *   subtitle  text under the title
 *   time      text after the channel (default: 20H)
 */
export default {
	async fetch(request, env): Promise<Response> {
		const params = new URL(request.url).searchParams;
		const gameId = params.get("game_id") ?? "";
		const theme = getGameTheme(gameId);
		const color1 = params.get("color1");
		const color2 = params.get("color2");

		try {
			const image = await renderOverlay(env, {
				gameId,
				...(color1 !== null && color2 !== null ? { accent: { from: `#${color1}`, to: `#${color2}` } } : {}),
				backgroundUrl: params.get("bg") ?? theme.backgroundUrl,
				logoUrl: params.get("logo") ?? theme.logoUrl,
				gameName: params.get("game") ?? theme.displayName ?? "Ocarina of Time",
				subtitle: params.get("subtitle") ?? "Medallions Stones Trials",
				channel: env.TWITCH_LOGIN,
				time: params.get("time") ?? "20H",
			});

			return new Response(image, {
				headers: { "Content-Type": "image/png", "Cache-Control": "no-store" },
			});
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return new Response(`Overlay generation failed: ${message}`, { status: 500 });
		}
	},
} satisfies ExportedHandler<TestEnv>;
