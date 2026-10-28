import type { Env } from "./env";
import { formatSpeedrunDelta, formatSpeedrunTime } from "./format-time";
import type { PersonalBest } from "./speedrun";
import type { VerifiedRunDetails } from "./speedrun-runs";

export interface Announcement {
	channelUrl: string;
	gameName: string;
	/** speedrun.com category found in the live title, null when none. */
	category: string | null;
	personalBest: PersonalBest | null;
	/** World record time in seconds. */
	worldRecord: number | null;
	image: Uint8Array;
}

const IMAGE_FILE_NAME = "overlay.png";

/** Message text above the embed: mentions only notify people from here, not from inside the embed. */
const MESSAGE_CONTENT = "@everyone";

const EMBED_AUTHOR = {
	name: "Zax",
	url: "https://zaxpeaks.fr",
	icon_url: "https://files.zaxpeaks.fr/files/img/logo.png",
};
const EMBED_TITLE = "SiirZax est en live! <:scrown:1560792166593462382>";
const EMBED_COLOR = 16716856;
const BUTTON_LABEL = "Regarder le stream";

/** Discord refuses empty field names, a zero-width space keeps the field without a visible title. */
const EMPTY_FIELD_NAME = "​";

const ACTION_ROW = 1;
const BUTTON = 2;
const LINK_BUTTON_STYLE = 5;

const describe = (gameName: string, category: string | null): string =>
	category === null
		? `Rejoins nous sur **${gameName}** !`
		: `Rejoins nous sur **${gameName}** pour du speedrun **${category}**`;

const ordinal = (place: number): string => `${place}${place === 1 ? "er" : "ème"}`;

const personalBestText = (personalBest: PersonalBest | null): string => {
	if (personalBest === null) return "Pas encore de PB existant pour cette catégorie !";

	return `Actuellement **${ordinal(personalBest.place)}** avec un **${formatSpeedrunTime(personalBest.seconds)}** <:flag:1560792135391903915>`;
};

const worldRecordText = (worldRecord: number | null): string =>
	worldRecord === null
		? "Pas de record du monde à ce jour pour la catégorie !"
		: `Record du monde en : ${formatSpeedrunTime(worldRecord)}`;

/** PB and WR lines, only when a category was found in the live title. */
const speedrunFields = ({ category, personalBest, worldRecord }: Announcement) =>
	category === null
		? []
		: [personalBestText(personalBest), worldRecordText(worldRecord)].map((value) => ({
				name: EMPTY_FIELD_NAME,
				value,
				inline: false,
			}));

export const postAnnouncement = async (env: Env, announcement: Announcement): Promise<void> => {
	const { channelUrl, gameName, category, image } = announcement;

	const payload = {
		content: MESSAGE_CONTENT,
		// Only @everyone may notify: a mention typed by mistake in the embed texts never pings anyone
		allowed_mentions: { parse: ["everyone"] },
		embeds: [
			{
				author: EMBED_AUTHOR,
				title: EMBED_TITLE,
				url: channelUrl,
				description: describe(gameName, category),
				color: EMBED_COLOR,
				fields: speedrunFields(announcement),
				image: { url: `attachment://${IMAGE_FILE_NAME}` },
			},
		],
		components: [
			{
				type: ACTION_ROW,
				components: [{ type: BUTTON, style: LINK_BUTTON_STYLE, label: BUTTON_LABEL, url: channelUrl }],
			},
		],
	};

	const form = new FormData();
	form.append("payload_json", JSON.stringify(payload));
	form.append("files[0]", new Blob([image], { type: "image/png" }), IMAGE_FILE_NAME);

	// Without this flag, a webhook not owned by an application ignores the link button
	const url = new URL(env.DISCORD_WEBHOOK_URL);
	url.searchParams.set("with_components", "true");

	const response = await fetch(url, { method: "POST", body: form });
	if (!response.ok) {
		throw new Error(`Discord webhook failed with status ${response.status}: ${await response.text()}`);
	}
};

const RUN_EMBED_TITLE = "🎉 Nouvelle run validée sur Speedrun.com !";

const timeText = ({ run, previousBestSeconds }: VerifiedRunDetails): string => {
	const newTime = `**${formatSpeedrunTime(run.seconds)}**`;
	if (previousBestSeconds === null) return `${newTime} (premier temps sur cette catégorie)`;
	if (previousBestSeconds === run.seconds) return `${newTime} (identique à l'ancien temps)`;

	return `${newTime} (ancien : ${formatSpeedrunTime(previousBestSeconds)})`;
};

const deltaText = ({ run, previousBestSeconds }: VerifiedRunDetails): string => {
	if (previousBestSeconds === null) return "N/A";
	if (previousBestSeconds === run.seconds) return "Égalité";

	return formatSpeedrunDelta(run.seconds - previousBestSeconds);
};

const placeText = (place: number | null): string =>
	place === null ? "Non classé sur ce leaderboard" : ordinal(place);

const worldRecordFieldText = (worldRecord: number | null): string =>
	worldRecord === null ? "Aucun à ce jour" : formatSpeedrunTime(worldRecord);

export const postValidatedRunNotification = async (env: Env, details: VerifiedRunDetails): Promise<void> => {
	const { run, worldRecordSeconds } = details;

	const payload = {
		embeds: [
			{
				author: EMBED_AUTHOR,
				title: RUN_EMBED_TITLE,
				url: run.weblink,
				description: `**${run.gameName}** - ${run.categoryName}`,
				color: EMBED_COLOR,
				fields: [
					{ name: "Temps", value: timeText(details), inline: false },
					{ name: "Delta", value: deltaText(details), inline: true },
					{ name: "Classement", value: placeText(details.place), inline: true },
					{ name: "Record du monde", value: worldRecordFieldText(worldRecordSeconds), inline: true },
				],
			},
		],
	};

	const response = await fetch(env.SPEEDRUN_RUN_WEBHOOK_URL, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(payload),
	});
	if (!response.ok) {
		throw new Error(`Discord webhook failed with status ${response.status}: ${await response.text()}`);
	}
};
