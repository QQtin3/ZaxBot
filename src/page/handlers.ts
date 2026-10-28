import { renderAnnouncementImage, sendAnnouncement } from "../announcement";
import type { Env } from "../env";
import { getChannelInfo, type ChannelInfo } from "../twitch";
import { isPasswordValid } from "./auth";
import { readPassword, readStreamer, ValidationError } from "./form-data";
import { renderFormPage, renderMessagePage } from "./views";

type Action = "preview" | "announce";

const htmlResponse = (html: string, status = 200): Response =>
	new Response(html, {
		status,
		headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
	});

const errorPage = (message: string, status: number): Response =>
	htmlResponse(renderMessagePage({ kind: "error", message }), status);

const fetchChannel = async (env: Env, streamer: string): Promise<ChannelInfo> => {
	const channel = await getChannelInfo(env, streamer);
	if (channel === null) throw new ValidationError(`La chaîne Twitch « ${streamer} » est introuvable.`);

	return channel;
};

const performAction = async (env: Env, streamer: string, action: Action): Promise<Response> => {
	const channel = await fetchChannel(env, streamer);

	if (action === "preview") {
		const image = await renderAnnouncementImage(env, streamer, channel);
		return new Response(image, { headers: { "Content-Type": "image/png", "Cache-Control": "no-store" } });
	}

	await sendAnnouncement(env, streamer, channel);
	return htmlResponse(renderMessagePage({ kind: "success", message: "Annonce envoyée sur Discord." }));
};

const handleSubmission = async (request: Request, env: Env, action: Action): Promise<Response> => {
	const form = await request.formData();

	if (!(await isPasswordValid(readPassword(form), env.ADMIN_PASSWORD))) {
		return errorPage("Mot de passe incorrect.", 401);
	}

	try {
		return await performAction(env, readStreamer(form), action);
	} catch (error) {
		if (error instanceof ValidationError) return errorPage(error.message, 400);

		console.error(error);
		const reason = error instanceof Error ? error.message : String(error);
		return errorPage(`La génération ou l'envoi a échoué : ${reason}`, 500);
	}
};

export const handlePageRequest = async (request: Request, env: Env): Promise<Response> => {
	const { pathname } = new URL(request.url);

	if (request.method === "GET" && pathname === "/") return htmlResponse(renderFormPage(env.TWITCH_LOGIN));
	if (request.method === "POST" && pathname === "/preview") return handleSubmission(request, env, "preview");
	if (request.method === "POST" && pathname === "/announce") return handleSubmission(request, env, "announce");

	return new Response("Not found", { status: 404 });
};
