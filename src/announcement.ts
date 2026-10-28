import { postAnnouncement } from "./discord";
import type { Env } from "./env";
import { formatNotificationTime } from "./format-time";
import { getGameTheme } from "./games";
import { renderOverlay } from "./overlay/render";
import { getGamecategoryRaw, getWorldRecord, type CurrentRun } from "./speedrun";
import type { ChannelInfo } from "./twitch";

/** speedrun.com is optional: when a lookup fails, the announcement is sent without that data. */
const orNull = async <T>(promise: Promise<T | null>, label: string): Promise<T | null> => {
	try {
		return await promise;
	} catch (error) {
		console.warn(`speedrun.com ${label} lookup failed: ${error instanceof Error ? error.message : String(error)}`);
		return null;
	}
};

const findCurrentRun = (env: Env, channel: ChannelInfo): Promise<CurrentRun | null> =>
	orNull(getGamecategoryRaw(env.SPEEDRUN_PROFILE, channel.gameName, channel.title), "category");

const drawImage = (env: Env, login: string, channel: ChannelInfo, run: CurrentRun | null): Promise<Uint8Array> => {
	const theme = getGameTheme(channel.gameId);

	return renderOverlay(env, {
		gameId: channel.gameId,
		backgroundUrl: theme.backgroundUrl,
		logoUrl: theme.logoUrl,
		gameName: theme.displayName ?? channel.gameName,
		subtitle: run?.category.name ?? "",
		channel: login,
		time: formatNotificationTime(new Date()),
	});
};

/** Draws the announcement image of a channel, with the theme of its current game and the run category. */
export const renderAnnouncementImage = async (env: Env, login: string, channel: ChannelInfo): Promise<Uint8Array> =>
	drawImage(env, login, channel, await findCurrentRun(env, channel));

export const sendAnnouncement = async (env: Env, login: string, channel: ChannelInfo): Promise<void> => {
	console.log(`Announcing ${login} (Twitch game_id: ${channel.gameId})`);

	const run = await findCurrentRun(env, channel);
	const [image, worldRecord] = await Promise.all([
		drawImage(env, login, channel, run),
		run === null ? null : orNull(getWorldRecord(run.category), "world record"),
	]);

	await postAnnouncement(env, {
		channelUrl: `https://twitch.tv/${login}`,
		gameName: channel.gameName,
		category: run?.category.name ?? null,
		personalBest: run?.personalBest ?? null,
		worldRecord,
		image,
	});
};
