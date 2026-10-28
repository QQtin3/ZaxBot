export interface GameTheme {
	/** Shorter name shown on the overlay, falls back to the Twitch game name. */
	displayName?: string;
	backgroundUrl: string;
	logoUrl: string;
}

const BACKGROUNDS_BASE_URL = "https://files.zaxpeaks.fr/files/img/zaxbot";

const background = (fileName: string): string => `${BACKGROUNDS_BASE_URL}/${fileName}.jpg`;

type LogoColor = "red" | "orange" | "blue" | "purple" | "green";

/** One transparent PNG per color family: logo-red.png, logo-orange.png... in the same folder as the backgrounds. */
const logo = (color: LogoColor): string => `${BACKGROUNDS_BASE_URL}/logo-${color}.png`;

const DEFAULT_THEME: GameTheme = {
	backgroundUrl: background("default"),
	logoUrl: logo("purple"),
};

/**
 * Keyed by Twitch game_id. The Worker logs the game_id of each announcement to help fill this in.
 * The accent colors of a game live in the [data-game="<game_id>"] block of theme.css.
 */
const GAME_THEMES: Readonly<Record<string, GameTheme>> = {
	"11557": {
		displayName: "Ocarina of Time",
		backgroundUrl: background("oot"),
		logoUrl: logo("green"),
	},
	"12482": {
		displayName: "Majora's Mask",
		backgroundUrl: background("mm"),
		logoUrl: logo("purple"),
	},
	"16967": {
		displayName: "The Wind Waker",
		backgroundUrl: background("tww"),
		logoUrl: logo("green"),
	},
	"17828": {
		displayName: "Twilight Princess",
		backgroundUrl: background("tp"),
		logoUrl: logo("orange"),
	},
	"110758": {
		displayName: "Breath of the Wild",
		// Assumed file name, not provided yet
		backgroundUrl: background("botw"),
		logoUrl: logo("blue"),
	},
	"512998": {
		displayName: "Tears of the Kingdom",
		// Assumed file name, not provided yet
		backgroundUrl: background("totk"),
		logoUrl: logo("blue"),
	},
	"12086": {
		displayName: "Ty the Tasmanian Tiger",
		backgroundUrl: background("ty"),
		logoUrl: logo("orange"),
	},
	"17189": {
		displayName: "Mario Kart Double Dash",
		backgroundUrl: background("mkdd"),
		logoUrl: logo("red"),
	},
};

export const getGameTheme = (gameId: string): GameTheme => GAME_THEMES[gameId] ?? DEFAULT_THEME;