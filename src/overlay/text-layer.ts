import { readStream, toStream } from "./bytes";
import { encodeGradientStrip, type GradientColors } from "./png";

/** A piece of text rendered as a transparent PNG, with its measured size (needed to center it). */
export interface TextLayer {
	bytes: Uint8Array;
	width: number;
	height: number;
}

export interface TextOptions {
	fontUrl: string;
	size: number;
}

export interface TextLayerOptions extends TextOptions {
	color: string;
}

export const measureImage = async (
	images: ImagesBinding,
	bytes: Uint8Array,
): Promise<{ width: number; height: number }> => {
	const info = await images.info(toStream(bytes));
	if (!("width" in info)) {
		throw new Error(`Expected a raster image but got ${info.format}`);
	}

	return { width: info.width, height: info.height };
};

export const createTextLayer = async (
	images: ImagesBinding,
	content: string,
	{ fontUrl, color, size }: TextLayerOptions,
): Promise<TextLayer> => {
	const result = await images.text(content, { font: { url: fontUrl }, color, size }).output({ format: "image/png" });
	const bytes = await readStream(result.image());

	return { bytes, ...(await measureImage(images, bytes)) };
};

/**
 * Text filled with a vertical two-color gradient. Images cannot fill text with a gradient, so the
 * text is rendered in white and a gradient is drawn over it with the "in" composite mode, which
 * keeps the gradient only where the text is opaque.
 */
export const createGradientTextLayer = async (
	images: ImagesBinding,
	content: string,
	options: TextOptions,
	colors: GradientColors,
): Promise<TextLayer> => {
	if (colors.from === colors.to) {
		return createTextLayer(images, content, { ...options, color: colors.from });
	}

	const mask = await createTextLayer(images, content, { ...options, color: "#ffffff" });
	const gradient = images
		.input(toStream(encodeGradientStrip(colors)))
		.transform({ width: mask.width, height: mask.height, fit: "squeeze" });

	const result = await images
		.input(toStream(mask.bytes))
		.draw(gradient, { composite: "in" })
		.output({ format: "image/png" });

	return { ...mask, bytes: await readStream(result.image()) };
};
