/**
 * Minimal PNG encoder for tiny generated images (a gradient strip, an empty pixel), so they can be
 * created without any image library. Rows are stored uncompressed (zlib "stored" block).
 */
export interface GradientColors {
	from: string;
	to: string;
}

type Rgb = readonly [number, number, number];

const PNG_SIGNATURE = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
const HEX_COLOR_PATTERN = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i;
const MAX_STORED_BLOCK_SIZE = 0xffff;
const DEFAULT_STEPS = 64;
const COLOR_TYPE_RGB = 2;
const COLOR_TYPE_RGBA = 6;

const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, index) => {
	let crc = index;
	for (let bit = 0; bit < 8; bit++) {
		crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
	}
	return crc >>> 0;
});

const crc32 = (bytes: Uint8Array): number =>
	(bytes.reduce((crc, byte) => (CRC_TABLE[(crc ^ byte) & 0xff] ?? 0) ^ (crc >>> 8), 0xffffffff) ^ 0xffffffff) >>> 0;

const adler32 = (bytes: Uint8Array): number => {
	const { a, b } = bytes.reduce(
		(state, byte) => {
			const nextA = (state.a + byte) % 65521;
			return { a: nextA, b: (state.b + nextA) % 65521 };
		},
		{ a: 1, b: 0 },
	);

	return ((b << 16) | a) >>> 0;
};

const concat = (parts: readonly Uint8Array[]): Uint8Array => {
	const output = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
	parts.reduce((offset, part) => {
		output.set(part, offset);
		return offset + part.length;
	}, 0);

	return output;
};

/** zlib stream made of a single, final, uncompressed block. */
const zlibStored = (data: Uint8Array): Uint8Array => {
	if (data.length > MAX_STORED_BLOCK_SIZE) {
		throw new Error("Image is too large to be stored in a single block");
	}

	const output = new Uint8Array(2 + 5 + data.length + 4);
	const view = new DataView(output.buffer);
	output.set([0x78, 0x01, 0x01]);
	view.setUint16(3, data.length, true);
	view.setUint16(5, ~data.length & 0xffff, true);
	output.set(data, 7);
	view.setUint32(7 + data.length, adler32(data));

	return output;
};

const chunk = (type: string, data: Uint8Array): Uint8Array => {
	const output = new Uint8Array(12 + data.length);
	const view = new DataView(output.buffer);
	view.setUint32(0, data.length);
	output.set(new TextEncoder().encode(type), 4);
	output.set(data, 8);
	view.setUint32(8 + data.length, crc32(output.subarray(4, 8 + data.length)));

	return output;
};

/** `scanlines` holds each row as a filter byte (0 = none) followed by its pixels. */
const buildPng = (width: number, height: number, colorType: number, scanlines: Uint8Array): Uint8Array => {
	const header = new Uint8Array(13);
	const headerView = new DataView(header.buffer);
	headerView.setUint32(0, width);
	headerView.setUint32(4, height);
	// 8 bits per channel, default compression / filter, no interlacing
	header.set([8, colorType, 0, 0, 0], 8);

	return concat([
		PNG_SIGNATURE,
		chunk("IHDR", header),
		chunk("IDAT", zlibStored(scanlines)),
		chunk("IEND", new Uint8Array(0)),
	]);
};

export const parseHexColor = (hex: string): Rgb => {
	const match = HEX_COLOR_PATTERN.exec(hex);
	if (!match) {
		throw new Error(`Expected a #RRGGBB color but got "${hex}"`);
	}

	const [, red, green, blue] = match;
	const channel = (value: string | undefined): number => Number.parseInt(value ?? "0", 16);

	return [channel(red), channel(green), channel(blue)];
};

const mixChannel = (from: number, to: number, ratio: number): number => Math.round(from + (to - from) * ratio);

const mix = ([r1, g1, b1]: Rgb, [r2, g2, b2]: Rgb, ratio: number): Rgb => [
	mixChannel(r1, r2, ratio),
	mixChannel(g1, g2, ratio),
	mixChannel(b1, b2, ratio),
];

/** A 1 x `steps` PNG going from the first color (top) to the second one (bottom). */
export const encodeGradientStrip = ({ from, to }: GradientColors, steps = DEFAULT_STEPS): Uint8Array => {
	const start = parseHexColor(from);
	const end = parseHexColor(to);

	const rows = Array.from({ length: steps }, (_, index) => [0, ...mix(start, end, index / (steps - 1))]);

	return buildPng(1, steps, COLOR_TYPE_RGB, Uint8Array.from(rows.flat()));
};

export interface RgbaColor {
	red: number;
	green: number;
	blue: number;
	/** From 0 to 1. */
	alpha: number;
}

/** "up": transparent at the top, full color at the bottom. "down": the opposite. */
export type FadeDirection = "up" | "down";

/** Eases the fade like a blurred edge instead of a hard linear ramp. */
const smoothstep = (ratio: number): number => ratio * ratio * (3 - 2 * ratio);

/** A 1 x `steps` PNG of a single color whose opacity fades out, used as a soft shadow edge. */
export const encodeFadeStrip = (
	{ red, green, blue, alpha }: RgbaColor,
	direction: FadeDirection,
	steps = DEFAULT_STEPS,
): Uint8Array => {
	const rows = Array.from({ length: steps }, (_, index) => {
		const towardsColor = index / (steps - 1);
		const ratio = direction === "up" ? towardsColor : 1 - towardsColor;

		return [0, red, green, blue, Math.round(255 * alpha * smoothstep(ratio))];
	});

	return buildPng(1, steps, COLOR_TYPE_RGBA, Uint8Array.from(rows.flat()));
};

/** An opaque 1x1 PNG of the color (its alpha is ignored, it is applied when the pixel is drawn). */
export const encodeColorPixel = ({ red, green, blue }: RgbaColor): Uint8Array =>
	buildPng(1, 1, COLOR_TYPE_RGB, Uint8Array.of(0, red, green, blue));

/** A fully transparent 1x1 PNG: stretched to any size, it is an empty canvas to draw on. */
export const encodeTransparentPixel = (): Uint8Array => buildPng(1, 1, COLOR_TYPE_RGBA, new Uint8Array(5));
