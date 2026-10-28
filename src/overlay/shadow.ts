import { readStream, toStream } from "./bytes";
import { encodeTransparentPixel } from "./png";
import type { TextLayer } from "./text-layer";

/** A blurred shadow bitmap, with `padding` transparent pixels added on every side to hold the blur. */
export interface ShadowLayer {
	bytes: Uint8Array;
	padding: number;
}

export interface ShadowOptions {
	blur: number;
	/** How far the shadow grows around the letters before being blurred, like the spread of a CSS box-shadow. */
	spread: number;
	/**
	 * How many times the blurred shadow is stacked on itself: each copy makes it more opaque.
	 * Decimals work: 1.5 adds a second copy at half opacity.
	 */
	strength: number;
}

const PADDING_PER_BLUR_PIXEL = 3;
const OUTPUT_FORMAT = "image/png";

/** 8 directions around the letters: drawing the text at each of them makes it thicker on every side. */
const SPREAD_DIRECTIONS: readonly (readonly [number, number])[] = [
	[1, 0],
	[-1, 0],
	[0, 1],
	[0, -1],
	[Math.SQRT1_2, Math.SQRT1_2],
	[Math.SQRT1_2, -Math.SQRT1_2],
	[-Math.SQRT1_2, Math.SQRT1_2],
	[-Math.SQRT1_2, -Math.SQRT1_2],
];

/** The shadow text on a larger transparent canvas, thickened by `spread` pixels in every direction. */
const spreadOnCanvas = async (
	images: ImagesBinding,
	shadow: TextLayer,
	padding: number,
	spread: number,
): Promise<Uint8Array> => {
	const offsets = spread > 0 ? SPREAD_DIRECTIONS : [[0, 0] as const];

	const canvas = images
		.input(toStream(encodeTransparentPixel()))
		.transform({ width: shadow.width + padding * 2, height: shadow.height + padding * 2, fit: "squeeze" });

	// 1 transform + 8 draws, below the limit of 10 transformations per chain
	const result = await offsets
		.reduce(
			(chain, [x, y]) =>
				chain.draw(toStream(shadow.bytes), {
					left: padding + Math.round(x * spread),
					top: padding + Math.round(y * spread),
				}),
			canvas,
		)
		.output({ format: OUTPUT_FORMAT });

	return readStream(result.image());
};

/**
 * Text bitmaps are cropped tight around the letters, so blurring one directly would cut the blur at
 * its edges. The shadow text is first drawn on a larger transparent canvas, thickened, then blurred,
 * and finally stacked on itself to make it more opaque.
 */
export const createSoftShadow = async (
	images: ImagesBinding,
	shadow: TextLayer,
	{ blur, spread, strength }: ShadowOptions,
): Promise<ShadowLayer> => {
	const padding = Math.ceil(blur * PADDING_PER_BLUR_PIXEL) + spread;
	const spreadBytes = await spreadOnCanvas(images, shadow, padding, spread);

	const blurred = await readStream(
		(await images.input(toStream(spreadBytes)).transform({ blur }).output({ format: OUTPUT_FORMAT })).image(),
	);
	if (strength <= 1) return { bytes: blurred, padding };

	// One opacity per extra copy: full copies first, then the decimal part of the strength
	const extraCopies = strength - 1;
	const fraction = extraCopies % 1;
	const opacities = [
		...Array.from({ length: Math.floor(extraCopies) }, () => 1),
		...(fraction > 0 ? [fraction] : []),
	];

	const stacked = await opacities
		.reduce<ReturnType<ImagesBinding["input"]>>(
			(chain, opacity) => chain.draw(toStream(blurred), { opacity }),
			images.input(toStream(blurred)),
		)
		.output({ format: OUTPUT_FORMAT });

	return { bytes: await readStream(stacked.image()), padding };
};
