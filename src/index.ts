import { sendAnnouncement } from "./announcement";
import { postValidatedRunNotification } from "./discord";
import type { Env } from "./env";
import { handlePageRequest } from "./page/handlers";
import { getNewlyVerifiedRuns, getProfileId, getVerifiedRunDetails } from "./speedrun-runs";
import { getLiveStream } from "./twitch";

const LAST_ANNOUNCED_KEY = "last_announced_stream_id";
const LAST_VERIFIED_RUN_AT_KEY = "last_verified_run_at";

const announceLiveIfNeeded = async (env: Env): Promise<void> => {
	const stream = await getLiveStream(env, env.TWITCH_LOGIN);
	if (!stream) return;

	const lastAnnouncedId = await env.STATE.get(LAST_ANNOUNCED_KEY);
	if (lastAnnouncedId === stream.id) return;

	await sendAnnouncement(env, env.TWITCH_LOGIN, stream);
	await env.STATE.put(LAST_ANNOUNCED_KEY, stream.id);
};

/** Announces speedrun.com runs verified since the last check. First run after a deploy sets the cursor without announcing. */
const announceValidatedRunsIfNeeded = async (env: Env): Promise<void> => {
	const lastCheckedAt = await env.STATE.get(LAST_VERIFIED_RUN_AT_KEY);
	const since = lastCheckedAt === null ? Date.now() : Number.parseInt(lastCheckedAt, 10);

	const userId = await getProfileId(env);
	const runs = await getNewlyVerifiedRuns(env, userId, since);

	for (const run of runs) {
		const details = await getVerifiedRunDetails(env, userId, run);
		await postValidatedRunNotification(env, details);
		await env.STATE.put(LAST_VERIFIED_RUN_AT_KEY, run.verifiedAt.toString());
	}
};

export default {
	// The announcement page (preview and sending)
	async fetch(request, env): Promise<Response> {
		return handlePageRequest(request, env);
	},

	// Automatic announcement when the Twitch stream goes live, and when a speedrun.com run gets verified
	async scheduled(_controller, env): Promise<void> {
		await announceLiveIfNeeded(env);

		try {
			await announceValidatedRunsIfNeeded(env);
		} catch (error) {
			console.warn(`speedrun.com run verification check failed: ${error instanceof Error ? error.message : String(error)}`);
		}
	},
} satisfies ExportedHandler<Env>;
