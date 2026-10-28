const TIME_ZONE = "Europe/Paris";

const timeFormatter = new Intl.DateTimeFormat("fr-FR", {
	timeZone: TIME_ZONE,
	hour: "2-digit",
	minute: "2-digit",
	hourCycle: "h23",
});

/** Formats a date as "20H" on the hour, or "20H30" otherwise. */
export const formatNotificationTime = (date: Date): string => {
	const parts = timeFormatter.formatToParts(date);
	const hour = parts.find((part) => part.type === "hour")?.value ?? "00";
	const minute = parts.find((part) => part.type === "minute")?.value ?? "00";

	return minute === "00" ? `${hour}H` : `${hour}H${minute}`;
};

const twoDigits = (value: number): string => value.toString().padStart(2, "0");

/** Formats a run time as "1:02:03", or "2:03" under one hour. */
export const formatSpeedrunTime = (totalSeconds: number): string => {
	const hours = Math.floor(totalSeconds / 3600);
	const minutes = Math.floor((totalSeconds % 3600) / 60);
	const seconds = Math.floor(totalSeconds % 60);

	return hours > 0 ? `${hours}:${twoDigits(minutes)}:${twoDigits(seconds)}` : `${minutes}:${twoDigits(seconds)}`;
};

/** Formats a time difference as "-1:02" (faster) or "+1:02" (slower). */
export const formatSpeedrunDelta = (deltaSeconds: number): string =>
	`${deltaSeconds < 0 ? "-" : "+"}${formatSpeedrunTime(Math.abs(deltaSeconds))}`;
