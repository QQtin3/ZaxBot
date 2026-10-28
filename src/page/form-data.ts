/** An error whose message can be shown to the person as is. */
export class ValidationError extends Error {}

const TWITCH_LOGIN_PATTERN = /^\w{1,25}$/;

export const readStreamer = (form: FormData): string => {
	const value = form.get("streamer");
	const streamer = typeof value === "string" ? value.trim().toLowerCase() : "";

	if (streamer === "") throw new ValidationError("Le nom du streamer est obligatoire.");
	if (!TWITCH_LOGIN_PATTERN.test(streamer)) {
		throw new ValidationError("Le nom du streamer ne doit contenir que des lettres, chiffres et _ (25 maximum).");
	}

	return streamer;
};

export const readPassword = (form: FormData): string => {
	const value = form.get("password");
	return typeof value === "string" ? value : "";
};
