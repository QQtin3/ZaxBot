/**
 * speedrun.com authenticated API (v1). Reads the runner's own run submissions, which the public
 * API does not expose with enough details (verify date) to reliably detect newly verified runs.
 */
import type { Env } from "./env";
import { getLeaderboardStanding, type SpeedrunCategory } from "./speedrun";

const API_URL = "https://www.speedrun.com/api/v1";
const RUNS_PER_REQUEST = "20";
const RUN_HISTORY_PER_CATEGORY = "200";

export interface VerifiedRun {
	id: string;
	gameId: string;
	categoryId: string;
	/** Subcategory variable id -> value id, read straight from the run (no name matching needed). */
	subcategories: Readonly<Record<string, string>>;
	gameName: string;
	categoryName: string;
	seconds: number;
	weblink: string;
	/** Epoch milliseconds the run was verified at. */
	verifiedAt: number;
}

export interface VerifiedRunDetails {
	run: VerifiedRun;
	/** The runner's best time in this exact category/subcategories before this run, null when they had none. */
	previousBestSeconds: number | null;
	/** This run's place on the leaderboard, null when it is not the runner's current best there. */
	place: number | null;
	worldRecordSeconds: number | null;
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

export const getProfileId = async (env: Env): Promise<string> => {
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

const readSubcategoryValues = (values: unknown): Record<string, string> =>
	isRecord(values)
		? Object.fromEntries(Object.entries(values).filter((entry): entry is [string, string] => typeof entry[1] === "string"))
		: {};

/** Null when the run is missing a field this feature needs, or is not actually verified. */
const readVerifiedRun = (entry: Record<string, unknown>): VerifiedRun | null => {
	const { id, status, weblink, game, category, values } = entry;
	if (typeof id !== "string" || !isRecord(status) || status.status !== "verified" || typeof weblink !== "string") return null;

	const verifiedAt = typeof status["verify-date"] === "string" ? Date.parse(status["verify-date"]) : Number.NaN;
	const seconds = readPrimaryTime(entry);
	const gameRecord = readEmbedded(game);
	const categoryRecord = readEmbedded(category);
	const gameNames = isRecord(gameRecord?.names) ? gameRecord.names : null;
	if (Number.isNaN(verifiedAt) || seconds === null) return null;
	if (gameRecord === null || typeof gameRecord.id !== "string") return null;
	if (categoryRecord === null || typeof categoryRecord.id !== "string" || typeof categoryRecord.name !== "string") return null;
	if (gameNames === null || typeof gameNames.international !== "string") return null;

	return {
		id,
		gameId: gameRecord.id,
		categoryId: categoryRecord.id,
		subcategories: readSubcategoryValues(values),
		gameName: gameNames.international,
		categoryName: categoryRecord.name,
		seconds,
		weblink,
		verifiedAt,
	};
};

/** Runs of `userId` verified after `sinceMs`, oldest first. */
export const getNewlyVerifiedRuns = async (env: Env, userId: string, sinceMs: number): Promise<VerifiedRun[]> => {
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

const sameSubcategories = (values: Record<string, unknown>, expected: Readonly<Record<string, string>>): boolean =>
	Object.entries(expected).every(([variableId, valueId]) => values[variableId] === valueId);

/** The runner's best time in this exact category/subcategories before `run`, null when they had none. */
const getPreviousBestSeconds = async (env: Env, userId: string, run: VerifiedRun): Promise<number | null> => {
	const data = await getAuthenticated(env, "runs", {
		user: userId,
		category: run.categoryId,
		status: "verified",
		max: RUN_HISTORY_PER_CATEGORY,
	});
	const runs = Array.isArray(data) ? data.filter(isRecord) : [];

	const times = runs
		.filter((entry) => entry.id !== run.id && isRecord(entry.values) && sameSubcategories(entry.values, run.subcategories))
		.map(readPrimaryTime)
		.filter((seconds): seconds is number => seconds !== null);

	return times.length === 0 ? null : Math.min(...times);
};

/** Everything the Discord notification needs about a newly verified run: its previous best, place and the WR. */
export const getVerifiedRunDetails = async (env: Env, userId: string, run: VerifiedRun): Promise<VerifiedRunDetails> => {
	const category: SpeedrunCategory = {
		gameId: run.gameId,
		categoryId: run.categoryId,
		name: run.categoryName,
		subcategories: run.subcategories,
	};

	const [previousBestSeconds, standing] = await Promise.all([
		getPreviousBestSeconds(env, userId, run),
		getLeaderboardStanding(category, run.id),
	]);

	return { run, previousBestSeconds, place: standing.place, worldRecordSeconds: standing.worldRecordSeconds };
};
