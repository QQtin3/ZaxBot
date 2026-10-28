/**
 * Browser script of the announcement page: remembers the streamer name (never the password)
 * and prevents sending twice by mistake.
 */
export const CLIENT_SCRIPT = `
const form = document.querySelector("#announce-form");
const STORAGE_KEY = "announce-streamer";

try {
	const savedStreamer = localStorage.getItem(STORAGE_KEY);
	if (savedStreamer) form.elements.streamer.value = savedStreamer;
} catch {
	// Storage can be unavailable (private window), the page still works without it
}

form.addEventListener("input", () => {
	try {
		localStorage.setItem(STORAGE_KEY, form.elements.streamer.value);
	} catch {
		// Same as above
	}
});

form.addEventListener("submit", (event) => {
	const submitter = event.submitter;
	if (submitter?.dataset.action !== "announce") return;

	// Disabled after the submission started, otherwise the button's own formaction would be lost
	setTimeout(() => {
		submitter.disabled = true;
		submitter.textContent = "Envoi en cours…";
	}, 0);
});
`;
