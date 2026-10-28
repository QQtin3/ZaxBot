import type { Env } from "./env";

/** What the overlay needs from a channel, live or not. */
export interface ChannelInfo {
	gameId: string;
	gameName: string;
	title: string;
}

export interface LiveStream extends ChannelInfo {
	id: string;
}

type TwitchEnv = Pick<Env, "STATE" | "TWITCH_CLIENT_ID" | "TWITCH_CLIENT_SECRET">;

const TOKEN_CACHE_KEY = "twitch_app_token";
const TOKEN_SAFETY_MARGIN_SECONDS = 300;
const KV_MIN_TTL_SECONDS = 60;

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null;

const requestAccessToken = async (env: TwitchEnv): Promise<string> => {
	const params = new URLSearchParams({
		client_id: env.TWITCH_CLIENT_ID,
		client_secret: env.TWITCH_CLIENT_SECRET,
		grant_type: "client_credentials",
	});

	const response = await fetch("https://id.twitch.tv/oauth2/token", {
		method: "POST",
		body: params,
	});
	if (!response.ok) {
		throw new Error(`Twitch token request failed with status ${response.status}`);
	}

	const data: unknown = await response.json();
	if (!isRecord(data) || typeof data.access_token !== "string" || typeof data.expires_in !== "number") {
		throw new Error("Unexpected Twitch token response");
	}

	const ttl = Math.max(data.expires_in - TOKEN_SAFETY_MARGIN_SECONDS, KV_MIN_TTL_SECONDS);
	await env.STATE.put(TOKEN_CACHE_KEY, data.access_token, { expirationTtl: ttl });

	return data.access_token;
};

const getAccessToken = async (env: TwitchEnv): Promise<string> => {
	const cachedToken = await env.STATE.get(TOKEN_CACHE_KEY);
	return cachedToken ?? requestAccessToken(env);
};

/** Calls a Helix endpoint and returns the first item of its `data` array, if any. */
const getFirstHelixItem = async (
	env: TwitchEnv,
	path: string,
	params: Record<string, string>,
): Promise<Record<string, unknown> | null> => {
	const token = await getAccessToken(env);

	const url = new URL(`https://api.twitch.tv/helix/${path}`);
	for (const [name, value] of Object.entries(params)) url.searchParams.set(name, value);

	const response = await fetch(url, {
		headers: {
			"Client-Id": env.TWITCH_CLIENT_ID,
			Authorization: `Bearer ${token}`,
		},
	});
	if (!response.ok) {
		throw new Error(`Twitch ${path} request failed with status ${response.status}`);
	}

	const body: unknown = await response.json();
	if (!isRecord(body) || !Array.isArray(body.data)) {
		throw new Error(`Unexpected Twitch ${path} response`);
	}

	const item: unknown = body.data[0];
	return isRecord(item) ? item : null;
};

const readChannelInfo = ({ game_id: gameId, game_name: gameName, title }: Record<string, unknown>): ChannelInfo | null => {
	if (typeof gameId !== "string" || typeof gameName !== "string" || typeof title !== "string") return null;

	return { gameId, gameName, title };
};

export const getLiveStream = async (env: TwitchEnv, login: string): Promise<LiveStream | null> => {
	const stream = await getFirstHelixItem(env, "streams", { user_login: login });
	if (stream?.type !== "live" || typeof stream.id !== "string") return null;

	const info = readChannelInfo(stream);
	return info === null ? null : { id: stream.id, ...info };
};

/** Current game and title of a channel, also available while it is offline. Null when the login does not exist. */
export const getChannelInfo = async (env: TwitchEnv, login: string): Promise<ChannelInfo | null> => {
	const user = await getFirstHelixItem(env, "users", { login });
	if (typeof user?.id !== "string") return null;

	const channel = await getFirstHelixItem(env, "channels", { broadcaster_id: user.id });
	return channel === null ? null : readChannelInfo(channel);
};
