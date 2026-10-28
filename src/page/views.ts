import pageCss from "./page.css";
import pageThemeCss from "./page-theme.css";
import { CLIENT_SCRIPT } from "./client-script";

export interface Notice {
	kind: "success" | "error";
	message: string;
}

const escapeHtml = (value: string): string =>
	value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&#39;");

interface FieldProps {
	name: string;
	label: string;
	type?: string;
	placeholder?: string;
	maxLength?: number;
	autocomplete?: string;
	value?: string;
}

const Field = ({ name, label, type = "text", placeholder, maxLength, autocomplete, value }: FieldProps): string => `
	<label class="field">
		<span class="field__label">${escapeHtml(label)}</span>
		<input class="field__input" type="${type}" name="${name}" required
			${placeholder === undefined ? "" : `placeholder="${escapeHtml(placeholder)}"`}
			${maxLength === undefined ? "" : `maxlength="${maxLength}"`}
			${autocomplete === undefined ? "" : `autocomplete="${autocomplete}"`}
			${value === undefined ? "" : `value="${escapeHtml(value)}"`} />
	</label>`;

const NoticeBanner = ({ kind, message }: Notice): string =>
	`<p class="notice notice--${kind}" role="${kind === "error" ? "alert" : "status"}">${escapeHtml(message)}</p>`;

const Layout = (body: string, script = ""): string => `<!doctype html>
<html lang="fr">
	<head>
		<meta charset="utf-8" />
		<meta name="viewport" content="width=device-width, initial-scale=1" />
		<meta name="robots" content="noindex" />
		<title>Annonce de live</title>
		<style>
			${pageThemeCss}
			${pageCss}
		</style>
	</head>
	<body>
		${body}
		${script === "" ? "" : `<script>${script}</script>`}
	</body>
</html>`;

/** `defaultStreamer` pre-fills the field, the browser then remembers the last name used. */
export const renderFormPage = (defaultStreamer: string): string =>
	Layout(
		`<form id="announce-form" class="card" method="post">
			<h1 class="card__title">Annonce de live</h1>
			<p class="card__subtitle">Le jeu et le titre sont récupérés sur Twitch, même hors live.</p>
			${Field({ name: "streamer", label: "Nom du streamer", placeholder: defaultStreamer, maxLength: 25, autocomplete: "off", value: defaultStreamer })}
			${Field({ name: "password", label: "Mot de passe", type: "password", autocomplete: "current-password" })}
			<div class="actions">
				<button class="button" type="submit" formaction="/preview" formtarget="_blank" data-action="preview">Prévisualiser</button>
				<button class="button button--primary" type="submit" formaction="/announce" data-action="announce">Envoyer sur Discord</button>
			</div>
		</form>`,
		CLIENT_SCRIPT,
	);

export const renderMessagePage = (notice: Notice): string =>
	Layout(
		`<main class="card">
			<h1 class="card__title">Annonce de live</h1>
			${NoticeBanner(notice)}
			<div class="actions">
				<a class="button button--primary" href="/">Retour au formulaire</a>
			</div>
		</main>`,
	);
