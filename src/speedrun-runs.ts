/**
 * speedrun.com authenticated API (v1). Reads the runner's own run submissions, which the public
 * API does not expose with enough details (verify date) to reliably detect newly verified runs.
 */
import type { Env } from "./env";

const API_URL = "https://www.speedrun.com/api/v1";
const RUNS_PER_REQUEST = "20";

export interface VerifiedRun {
	gameName: string;
	categoryName: string;
	seconds: number;
	weblink: string;
	/** Epoch milliseconds the run was verified at. */
	verifiedAt: number;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null;

const getAuthenticated = async (env: Env, path: string, params: Record<string, string> = {}): Promise<unknown> => {
	const url = new URL(`${API_URL}/${path}`);
	for (const [name, value] of Object.entries(params)) url.searchParams.set(name, value);

	const response = await fetch(url, {
		headers: {
			Accept: "application/json",
			"User-Agent": "zaxbot-live-announcer",
			"X-API-Key": env.SPEEDRUN_API_KEY,
		},
	});
	if (!response.ok) {
		throw new Error(`speedrun.com ${path} request failed with status ${response.status}`);
	}

	const body: unknown = await response.json();
	if (!isRecord(body)) throw new Error(`Unexpected speedrun.com ${path} response`);

	return body.data;
};

const findProfileId = async (env: Env): Promise<string> => {
	const profile = await getAuthenticated(env, "profile");
	if (!isRecord(profile) || typeof profile.id !== "string") {
		throw new Error("speedrun.com profile request returned no id");
	}

	return profile.id;
};

const readEmbedded = (value: unknown): Record<string, unknown> | null =>
	isRecord(value) && isRecord(value.data) ? value.data : null;

const readPrimaryTime = (run: Record<string, unknown>): number | null =>
	isRecord(run.times) && typeof run.times.primary_t === "number" ? run.times.primary_t : null;

/** Null when the run is missing a field this feature needs, or is not actually verified. */
const readVerifiedRun = (entry: Record<string, unknown>): VerifiedRun | null => {
	const { status, weblink, game, category } = entry;
	if (!isRecord(status) || status.status !== "verified" || typeof weblink !== "string") return null;

	const verifiedAt = typeof status["verify-date"] === "string" ? Date.parse(status["verify-date"]) : Number.NaN;
	const seconds = readPrimaryTime(entry);
	const gameNames = readEmbedded(game)?.names;
	const categoryName = readEmbedded(category)?.name;
	if (Number.isNaN(verifiedAt) || seconds === null) return null;
	if (!isRecord(gameNames) || typeof gameNames.international !== "string" || typeof categoryName !== "string") return null;

	return { gameName: gameNames.international, categoryName, seconds, weblink, verifiedAt };
};

/** Runs of the profile's owner verified after `sinceMs`, oldest first. */
export const getNewlyVerifiedRuns = async (env: Env, sinceMs: number): Promise<VerifiedRun[]> => {
	const userId = await findProfileId(env);
	const data = await getAuthenticated(env, "runs", {
		user: userId,
		status: "verified",
		embed: "game,category",
		orderby: "verify-date",
		direction: "desc",
		max: RUNS_PER_REQUEST,
	});
	const runs = Array.isArray(data) ? data.filter(isRecord) : [];

	return runs
		.map(readVerifiedRun)
		.filter((run): run is VerifiedRun => run !== null && run.verifiedAt > sinceMs)
		.sort((a, b) => a.verifiedAt - b.verifiedAt);
};
