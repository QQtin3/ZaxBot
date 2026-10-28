export const fetchBytes = async (url: string): Promise<Uint8Array> => {
	const response = await fetch(url);
	if (!response.ok) {
		throw new Error(`Could not fetch ${url} (status ${response.status})`);
	}

	return new Uint8Array(await response.arrayBuffer());
};

/** A stream can only be read once, so a new one is created each time the bytes are needed. */
export const toStream = (bytes: Uint8Array): ReadableStream<Uint8Array> => new Blob([bytes]).stream();

export const readStream = async (stream: ReadableStream<Uint8Array>): Promise<Uint8Array> =>
	new Uint8Array(await new Response(stream).arrayBuffer());
