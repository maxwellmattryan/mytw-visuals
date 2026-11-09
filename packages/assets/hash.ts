const CONTENT_HASH = /^[0-9a-f]{64}$/

/** The lowercase hex SHA-256 of `bytes` (64 characters), the address of an asset. */
export async function hashBytes(bytes: Uint8Array): Promise<string> {
	const digest = await crypto.subtle.digest('SHA-256', new Uint8Array(bytes))
	let hex = ''
	for (const byte of new Uint8Array(digest)) hex += byte.toString(16).padStart(2, '0')
	return hex
}

/** Whether `value` is a content hash: exactly 64 lowercase hex characters. */
export function isContentHash(value: string): boolean {
	return CONTENT_HASH.test(value)
}
