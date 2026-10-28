import categoryNames from "../../category-names.json";
import type { Env } from "../env";
import { fetchBytes, readStream, toStream } from "./bytes";
import { encodeColorPixel, encodeFadeStrip, type FadeDirection, type GradientColors } from "./png";
import { createSoftShadow, type ShadowLayer } from "./shadow";
import { createGradientTextLayer, createTextLayer, measureImage, type TextLayer } from "./text-layer";
import {
	getThemeVariables,
	readNumberVariable,
	readPixelVariable,
	readRgbaVariable,
	readVariable,
	type ThemeVariables,
} from "./theme-variables";

export type RenderEnv = Pick<Env, "IMAGES" | "FONT_URL">;

/** speedrun.com category name -> text written on the image, edited in category-names.json at the root. */
const CATEGORY_NAMES: Readonly<Record<string, string>> = categoryNames;

export interface OverlayData {
	/** Twitch game_id: its [data-game="..."] block of theme.css is applied on top of :root. */
	gameId?: string;
	/** Accent gradient, defaults to --accent-color / --accent-color-end of theme.css. */
	accent?: GradientColors;
	backgroundUrl: string;
	/** Logo already in the game's colors (PNG with transparency), resized to fit the theme's logo box. */
	logoUrl: string;
	gameName: string;
	/** Run category under the game name, renamed through category-names.json. Nothing is drawn when empty. */
	subtitle: string;
	channel: string;
	time: string;
}

/** A bitmap placed on the canvas. */
interface Layer {
	bytes: Uint8Array;
	left: number;
	top: number;
	opacity?: number;
}

interface ShadowedText {
	text: TextLayer;
	shadow: ShadowLayer;
}

const OUTPUT_FORMAT = "image/png";

/** Images allows 10 transformations per chain, a margin is kept below that limit. */
const MAX_DRAWS_PER_CHAIN = 8;

const centerLeft = (canvasWidth: number, width: number): number => Math.round((canvasWidth - width) / 2);

const solid = (color: string): GradientColors => ({ from: color, to: color });

const splitInBatches = <T>(items: readonly T[], size: number): T[][] =>
	Array.from({ length: Math.ceil(items.length / size) }, (_, index) => items.slice(index * size, (index + 1) * size));

const createBandLayer = async (
	images: ImagesBinding,
	variables: ThemeVariables,
	canvasWidth: number,
): Promise<Layer> => {
	// An opaque pixel of the band color, stretched to the band size and made translucent when drawn
	const color = readRgbaVariable(variables, "--band-background");
	const stretched = await images
		.input(toStream(encodeColorPixel(color)))
		.transform({ width: canvasWidth, height: readPixelVariable(variables, "--band-height"), fit: "squeeze" })
		.output({ format: OUTPUT_FORMAT });

	return {
		bytes: await readStream(stretched.image()),
		left: 0,
		top: readPixelVariable(variables, "--band-top"),
		opacity: color.alpha,
	};
};

/**
 * Drop shadow of the band: a strip fading out above it and another one below it, like a CSS box-shadow
 * without offset. Built from tiny gradient PNGs, so no blur is needed on a full-width image.
 */
const createBandShadowLayers = async (
	images: ImagesBinding,
	variables: ThemeVariables,
	canvasWidth: number,
): Promise<Layer[]> => {
	const size = readPixelVariable(variables, "--band-shadow-size");
	if (size <= 0) return [];

	const color = readRgbaVariable(variables, "--band-shadow-color");
	const stretch = async (direction: FadeDirection): Promise<Uint8Array> => {
		const result = await images
			.input(toStream(encodeFadeStrip(color, direction)))
			.transform({ width: canvasWidth, height: size, fit: "squeeze" })
			.output({ format: OUTPUT_FORMAT });

		return readStream(result.image());
	};

	const [above, below] = await Promise.all([stretch("up"), stretch("down")]);
	const bandTop = readPixelVariable(variables, "--band-top");

	return [
		{ bytes: above, left: 0, top: bandTop - size },
		{ bytes: below, left: 0, top: bandTop + readPixelVariable(variables, "--band-height") },
	];
};

const fetchOptionalBytes = async (url: string): Promise<Uint8Array | null> => {
	try {
		return await fetchBytes(url);
	} catch (error) {
		console.warn(`Drawing without logo: ${error instanceof Error ? error.message : String(error)}`);
		return null;
	}
};

/**
 * The logo is scaled to fit inside the --logo-width x --logo-height box, keeping its aspect ratio.
 * Returns no layer when the logo cannot be downloaded, so the image can be tested before the logo is uploaded.
 */
const createLogoLayers = async (
	images: ImagesBinding,
	variables: ThemeVariables,
	logoUrl: string,
	canvasWidth: number,
): Promise<Layer[]> => {
	const source = await fetchOptionalBytes(logoUrl);
	if (source === null) return [];

	const { width, height } = await measureImage(images, source);

	const scale = Math.min(
		readPixelVariable(variables, "--logo-width") / width,
		readPixelVariable(variables, "--logo-height") / height,
	);
	const fitted = { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };

	const resized = await images
		.input(toStream(source))
		.transform({ ...fitted, fit: "squeeze" })
		.output({ format: OUTPUT_FORMAT });

	return [
		{
			bytes: await readStream(resized.image()),
			left: centerLeft(canvasWidth, fitted.width),
			top: readPixelVariable(variables, "--logo-top"),
		},
	];
};

/** A text filled with `colors`, and its drop shadow (the same text in the shadow color). */
const createShadowedText = async (
	env: RenderEnv,
	variables: ThemeVariables,
	content: string,
	colors: GradientColors,
	sizeVariable: string,
): Promise<ShadowedText> => {
	const options = { fontUrl: env.FONT_URL, size: readPixelVariable(variables, sizeVariable) };

	const [text, shadowText] = await Promise.all([
		createGradientTextLayer(env.IMAGES, content, options, colors),
		createTextLayer(env.IMAGES, content, { ...options, color: readVariable(variables, "--text-shadow-color") }),
	]);

	// A blur of 0 keeps the shadow as a sharp copy of the text
	const blur = readPixelVariable(variables, "--shadow-blur");
	const shadow =
		blur > 0
			? await createSoftShadow(env.IMAGES, shadowText, {
					blur,
					spread: readPixelVariable(variables, "--shadow-spread"),
					strength: readNumberVariable(variables, "--shadow-strength"),
				})
			: { bytes: shadowText.bytes, padding: 0 };

	return { text, shadow };
};

const placeShadowed = ({ text, shadow }: ShadowedText, left: number, top: number, shadowOffsetY: number): Layer[] => [
	{ bytes: shadow.bytes, left: left - shadow.padding, top: top + shadowOffsetY - shadow.padding },
	{ bytes: text.bytes, left, top },
];

/**
 * Draws the layers in array order (the last one ends up on top). Images refuses chains of more than
 * 10 transformations, so the layers are drawn in batches, each batch starting from the previous result.
 */
const drawLayers = async (images: ImagesBinding, base: Uint8Array, layers: readonly Layer[]): Promise<Uint8Array> => {
	let image = base;

	for (const batch of splitInBatches(layers, MAX_DRAWS_PER_CHAIN)) {
		const composed = batch.reduce(
			(chain, { bytes, left, top, opacity }) =>
				chain.draw(toStream(bytes), { left, top, ...(opacity === undefined ? {} : { opacity }) }),
			images.input(toStream(image)),
		);

		image = await readStream((await composed.output({ format: OUTPUT_FORMAT })).image());
	}

	return image;
};

export const renderOverlay = async (env: RenderEnv, data: OverlayData): Promise<Uint8Array> => {
	const variables = getThemeVariables(data.gameId);
	const px = (name: string): number => readPixelVariable(variables, name);

	const canvas = { width: px("--canvas-width"), height: px("--canvas-height") };
	const shadowOffsetY = px("--shadow-offset-y");
	const white = solid(readVariable(variables, "--text-color"));
	const titleColors = {
		from: readVariable(variables, "--title-color-start"),
		to: readVariable(variables, "--title-color-end"),
	};
	const accent = data.accent ?? {
		from: readVariable(variables, "--accent-color"),
		to: readVariable(variables, "--accent-color-end"),
	};

	const subtitleText = (CATEGORY_NAMES[data.subtitle] ?? data.subtitle).trim().toUpperCase();

	const [background, band, bandShadow, logo, title, subtitle, footerLabel, footerDetails] = await Promise.all([
		fetchBytes(data.backgroundUrl),
		createBandLayer(env.IMAGES, variables, canvas.width),
		createBandShadowLayers(env.IMAGES, variables, canvas.width),
		createLogoLayers(env.IMAGES, variables, data.logoUrl, canvas.width),
		createShadowedText(env, variables, data.gameName.toUpperCase(), titleColors, "--font-size-title"),
		subtitleText === "" ? null : createShadowedText(env, variables, subtitleText, accent, "--font-size-subtitle"),
		// Footer: "twitch.tv/" in white, then "channel - time" in the accent gradient
		createShadowedText(env, variables, "TWITCH.TV/", white, "--font-size-footer"),
		createShadowedText(env, variables, `${data.channel} - ${data.time}`.toUpperCase(), accent, "--font-size-footer"),
	]);

	// Title and subtitle are stacked and centered in the band, the title alone when there is no subtitle
	const subtitleBlockHeight = subtitle === null ? 0 : px("--band-text-gap") + subtitle.text.height;
	const stackHeight = title.text.height + subtitleBlockHeight;
	const titleTop = px("--band-top") + Math.round((px("--band-height") - stackHeight) / 2);
	const subtitleTop = titleTop + title.text.height + px("--band-text-gap");

	// Footer pieces are side by side and centered as a whole. The text images are cropped tight around
	// the letters, so each piece is centered on --footer-center-y instead of being aligned on its top.
	const footerPieces = [footerLabel, footerDetails];
	const footerGap = px("--footer-piece-gap");
	const footerWidth =
		footerPieces.reduce((total, piece) => total + piece.text.width, 0) + footerGap * (footerPieces.length - 1);
	const footerLayers = footerPieces.reduce<{ left: number; layers: Layer[] }>(
		({ left, layers }, piece) => ({
			left: left + piece.text.width + footerGap,
			layers: [
				...layers,
				...placeShadowed(piece, left, px("--footer-center-y") - Math.round(piece.text.height / 2), shadowOffsetY),
			],
		}),
		{ left: centerLeft(canvas.width, footerWidth), layers: [] },
	).layers;

	const layers: Layer[] = [
		...bandShadow,
		band,
		...logo,
		...placeShadowed(title, centerLeft(canvas.width, title.text.width), titleTop, shadowOffsetY),
		...(subtitle === null
			? []
			: placeShadowed(subtitle, centerLeft(canvas.width, subtitle.text.width), subtitleTop, shadowOffsetY)),
		...footerLayers,
	];

	return drawLayers(env.IMAGES, background, layers);
};
