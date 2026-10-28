export interface Env {
	IMAGES: ImagesBinding;
	STATE: KVNamespace;
	TWITCH_LOGIN: string;
	/** speedrun.com profile of the runner, where the run category and the PB are searched. */
	SPEEDRUN_PROFILE: string;
	/** speedrun.com API key of the runner, used to poll their own run submissions for verification. */
	SPEEDRUN_API_KEY: string;
	TWITCH_CLIENT_ID: string;
	TWITCH_CLIENT_SECRET: string;
	DISCORD_WEBHOOK_URL: string;
	/** Discord webhook announcing newly verified speedrun.com runs. */
	SPEEDRUN_RUN_WEBHOOK_URL: string;
	/** Password protecting the announcement page. */
	ADMIN_PASSWORD: string;
	/** Public URL of the Montserrat Black font file (.ttf, .otf, .woff or .woff2). */
	FONT_URL: string;
}
