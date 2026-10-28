const sha256 = (value: string): Promise<ArrayBuffer> => crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));

/**
 * Compares the hashes of both passwords in constant time, so neither the content nor the length
 * of the expected password can be guessed from the response time.
 */
export const isPasswordValid = async (candidate: string, expected: string): Promise<boolean> => {
	if (expected === "") return false;

	const [candidateHash, expectedHash] = await Promise.all([sha256(candidate), sha256(expected)]);
	return crypto.subtle.timingSafeEqual(candidateHash, expectedHash);
};
