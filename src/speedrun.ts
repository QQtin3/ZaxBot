/** speedrun.com public API (v1). Read-only requests, no API key needed. */
const API_URL = "https://www.speedrun.com/api/v1";

/** A leaderboard: a category, narrowed by one value per subcategory variable. */
export interface SpeedrunCategory {
	gameId: string;
	categoryId: string;
	/** Category name followed by the subcategories found in the title, e.g. "Any% No Major Glitches". */
	name: string;
	/** Subcategory variable id -> value id. */
	subcategories: Readonly<Record<string, string>>;
}

export interface PersonalBest {
	place: number;
	seconds: number;
}

/** The category of the current run, and the runner's PB in it (null when they have no run in it yet). */
export interface CurrentRun {
	category: SpeedrunCategory;
	personalBest: PersonalBest | null;
}

interface SubcategoryValue {
	id: string;
	label: string;
	/** Lowercase texts that select this value when found in the title: the label, and its acronym. */
	keys: string[];
}

interface SubcategoryVariable {
	id: string;
	/** The value shown by default on speedrun.com, used when the title names none. */
	defaultValueId: string | null;
	values: SubcategoryValue[];
}

interface CategoryCandidate {
	gameId: string;
	categoryId: string;
	name: string;
	/** The main game (not a "Category Extensions" one) wins when two candidates match as well. */
	isMainGame: boolean;
	subcategories: SubcategoryVariable[];
}

interface Match {
	category: SpeedrunCategory;
	isMainGame: boolean;
	/** Number of title characters explained by the category and its subcategories: the highest wins. */
	score: number;
}

/** Acronyms shorter than this ("ns" for "No SRM") would match too many titles by accident. */
const MIN_ACRONYM_LENGTH = 3;

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null;

/** Calls an endpoint and returns its `data` field. */
const getData = async (path: string, params: Record<string, string> = {}): Promise<unknown> => {
	const url = new URL(`${API_URL}/${path}`);
	for (const [name, value] of Object.entries(params)) url.searchParams.set(name, value);

	const response = await fetch(url, {
		headers: { Accept: "application/json", "User-Agent": "zaxbot-live-announcer" },
	});
	if (!response.ok) {
		throw new Error(`speedrun.com ${path} request failed with status ${response.status}`);
	}

	const body: unknown = await response.json();
	if (!isRecord(body)) throw new Error(`Unexpected speedrun.com ${path} response`);

	return body.data;
};

const getRecords = async (path: string, params: Record<string, string> = {}): Promise<Record<string, unknown>[]> => {
	const data = await getData(path, params);
	return Array.isArray(data) ? data.filter(isRecord) : [];
};

const readPrimaryTime = (run: unknown): number | null => {
	if (!isRecord(run) || !isRecord(run.times)) return null;

	return typeof run.times.primary_t === "number" ? run.times.primary_t : null;
};

/** Embedded resources are wrapped in a `data` object. */
const readEmbedded = (value: unknown): Record<string, unknown> | null =>
	isRecord(value) && isRecord(value.data) ? value.data : null;

const readEmbeddedList = (value: unknown): Record<string, unknown>[] =>
	isRecord(value) && Array.isArray(value.data) ? value.data.filter(isRecord) : [];

const isLetterOrDigit = (character: string | undefined): boolean =>
	character !== undefined && /[\p{L}\p{N}]/u.test(character);

/** True when `key` is in `text` as a whole word: "srm" is found in "no srm" but not in "unrestricted srmx". */
const containsWord = (text: string, key: string): boolean => {
	if (key === "") return false;

	for (let index = text.indexOf(key); index !== -1; index = text.indexOf(key, index + 1)) {
		if (!isLetterOrDigit(text[index - 1]) && !isLetterOrDigit(text[index + key.length])) return true;
	}

	return false;
};

/** "No Major Glitches" -> "nmg". Empty for single words and too short acronyms. */
const acronym = (label: string): string => {
	const words = label.split(/[\s-]+/).filter((word) => isLetterOrDigit(word[0]));
	const letters = words.map((word) => word[0] ?? "").join("").toLowerCase();

	return words.length > 1 && letters.length >= MIN_ACRONYM_LENGTH ? letters : "";
};

const findUserId = async (profile: string): Promise<string | null> => {
	const [user] = await getRecords("users", { lookup: profile });
	return typeof user?.id === "string" ? user.id : null;
};

/** A speedrun.com game is linked to the Twitch game through its Twitch name, or its international name. */
const isLinkedToTwitchGame = (game: Record<string, unknown> | null, twitchGameName: string): boolean => {
	if (game === null || !isRecord(game.names)) return false;

	return game.names.twitch === twitchGameName || game.names.international === twitchGameName;
};

const readSubcategoryValues = (values: Record<string, unknown>): SubcategoryValue[] =>
	Object.entries(values).flatMap(([id, value]) => {
		if (!isRecord(value) || typeof value.label !== "string") return [];

		const label = value.label;
		return [{ id, label, keys: [label.toLowerCase(), acronym(label)].filter((key) => key !== "") }];
	});

/** Only the subcategory variables of full-game runs: the others are filters, not separate leaderboards. */
const readSubcategories = (category: Record<string, unknown>): SubcategoryVariable[] =>
	readEmbeddedList(category.variables).flatMap((variable) => {
		const { id, values } = variable;
		const scope = isRecord(variable.scope) ? variable.scope.type : null;
		if (variable["is-subcategory"] !== true || typeof id !== "string" || !isRecord(values)) return [];
		if (scope !== "global" && scope !== "full-game") return [];
		if (!isRecord(values.values)) return [];

		return [
			{
				id,
				defaultValueId: typeof values.default === "string" ? values.default : null,
				values: readSubcategoryValues(values.values),
			},
		];
	});

const getGameCategories = async (gameId: string, isMainGame: boolean): Promise<CategoryCandidate[]> =>
	(await getRecords(`games/${gameId}/categories`, { embed: "variables" }))
		.filter(({ type }) => type === "per-game")
		.flatMap((category) => {
			const { id, name } = category;
			if (typeof id !== "string" || typeof name !== "string") return [];

			return [{ gameId, categoryId: id, name, isMainGame, subcategories: readSubcategories(category) }];
		});

/** The value of a subcategory named in the title (longest key wins), or null when the title names none. */
const findSubcategoryValue = (title: string, variable: SubcategoryVariable): { value: SubcategoryValue; key: string } | null =>
	variable.values
		.flatMap((value) => value.keys.filter((key) => containsWord(title, key)).map((key) => ({ value, key })))
		.reduce<{ value: SubcategoryValue; key: string } | null>(
			(best, current) => (current.key.length > (best?.key.length ?? 0) ? current : best),
			null,
		);

/** Scores a category against the title. Null when neither the category name nor its acronym is in the title. */
const matchCategory = (title: string, candidate: CategoryCandidate): Match | null => {
	const categoryKey = [candidate.name.toLowerCase(), acronym(candidate.name)].find((key) => containsWord(title, key));
	if (categoryKey === undefined) return null;

	const picks = candidate.subcategories.map((variable) => ({ variable, found: findSubcategoryValue(title, variable) }));

	const subcategories = Object.fromEntries(
		picks.flatMap(({ variable, found }) => {
			const valueId = found?.value.id ?? variable.defaultValueId;
			return valueId === null ? [] : [[variable.id, valueId]];
		}),
	);
	const foundLabels = picks.flatMap(({ found }) => (found === null ? [] : [found.value.label]));
	const score = picks.reduce((total, { found }) => total + (found?.key.length ?? 0), categoryKey.length);

	return {
		category: {
			gameId: candidate.gameId,
			categoryId: candidate.categoryId,
			name: [candidate.name, ...foundLabels].join(" "),
			subcategories,
		},
		isMainGame: candidate.isMainGame,
		score,
	};
};

const isBetterMatch = (current: Match, best: Match | null): boolean => {
	if (best === null || current.score > best.score) return true;

	return current.score === best.score && current.isMainGame && !best.isMainGame;
};

/** A full-game PB of the runner on exactly this leaderboard (same category and same subcategories). */
const isPersonalBestOf = (entry: Record<string, unknown>, category: SpeedrunCategory): boolean => {
	const { run } = entry;
	if (!isRecord(run) || run.level !== null) return false;
	if (run.game !== category.gameId || run.category !== category.categoryId) return false;

	const values = isRecord(run.values) ? run.values : {};
	return Object.entries(category.subcategories).every(([variableId, valueId]) => values[variableId] === valueId);
};

const readPersonalBest = (entry: Record<string, unknown> | undefined): PersonalBest | null => {
	const seconds = readPrimaryTime(entry?.run);
	if (typeof entry?.place !== "number" || seconds === null) return null;

	return { place: entry.place, seconds };
};

/**
 * The run written in the live title, searched in the games of the speedrun.com profile only.
 * Every game of the profile linked to the Twitch game is checked (main game, category extensions...).
 * Categories and subcategories are recognized by their name or acronym ("AFR" for "All Fairy Rewards",
 * "NMG" for "No Major Glitches"); the match that
 * explains the most of the title wins, then the main game over its category extensions. Null when none is found.
 */
export const getGamecategoryRaw = async (
	profile: string,
	gameName: string,
	streamTitle: string,
): Promise<CurrentRun | null> => {
	if (gameName === "" || streamTitle === "") return null;

	const userId = await findUserId(profile);
	if (userId === null) {
		console.warn(`speedrun.com profile "${profile}" not found`);
		return null;
	}

	const personalBests = await getRecords(`users/${userId}/personal-bests`, { embed: "game" });
	const linkedGames = new Map(
		personalBests
			.map(({ game }) => readEmbedded(game))
			.filter((game) => isLinkedToTwitchGame(game, gameName))
			.flatMap((game) => {
				const names = isRecord(game?.names) ? game.names : {};
				return typeof game?.id === "string" ? [[game.id, names.international === gameName] as const] : [];
			}),
	);
	if (linkedGames.size === 0) {
		console.warn(`No run of "${profile}" on speedrun.com for the Twitch game "${gameName}"`);
		return null;
	}

	const title = streamTitle.toLowerCase();
	const candidates = (
		await Promise.all([...linkedGames].map(([gameId, isMainGame]) => getGameCategories(gameId, isMainGame)))
	).flat();
	const best = candidates
		.map((candidate) => matchCategory(title, candidate))
		.reduce<Match | null>((best, current) => (current !== null && isBetterMatch(current, best) ? current : best), null);
	if (best === null) return null;

	const personalBest = personalBests.find((entry) => isPersonalBestOf(entry, best.category));
	return { category: best.category, personalBest: readPersonalBest(personalBest) };
};

/** World record time in seconds on the same leaderboard (subcategories included), null when it is empty. */
export const getWorldRecord = async (category: SpeedrunCategory): Promise<number | null> => {
	const subcategoryParams = Object.fromEntries(
		Object.entries(category.subcategories).map(([variableId, valueId]) => [`var-${variableId}`, valueId]),
	);
	const leaderboard = await getData(`leaderboards/${category.gameId}/category/${category.categoryId}`, {
		top: "1",
		...subcategoryParams,
	});
	if (!isRecord(leaderboard) || !Array.isArray(leaderboard.runs)) return null;

	const first: unknown = leaderboard.runs.find((entry: unknown) => isRecord(entry) && entry.place === 1);
	return isRecord(first) ? readPrimaryTime(first.run) : null;
};

export interface LeaderboardStanding {
	/** This run's place on the leaderboard, null when it is not the runner's current best there. */
	place: number | null;
	worldRecordSeconds: number | null;
}

/** A run's place and the current world record, read from the same leaderboard in a single request. */
export const getLeaderboardStanding = async (category: SpeedrunCategory, runId: string): Promise<LeaderboardStanding> => {
	const subcategoryParams = Object.fromEntries(
		Object.entries(category.subcategories).map(([variableId, valueId]) => [`var-${variableId}`, valueId]),
	);
	const leaderboard = await getData(`leaderboards/${category.gameId}/category/${category.categoryId}`, subcategoryParams);
	if (!isRecord(leaderboard) || !Array.isArray(leaderboard.runs)) return { place: null, worldRecordSeconds: null };

	const entries = leaderboard.runs.filter(isRecord);
	const worldRecordEntry = entries.find((entry) => entry.place === 1);
	const ourEntry = entries.find((entry) => isRecord(entry.run) && entry.run.id === runId);

	return {
		place: typeof ourEntry?.place === "number" ? ourEntry.place : null,
		worldRecordSeconds: worldRecordEntry === undefined ? null : readPrimaryTime(worldRecordEntry.run),
	};
};
