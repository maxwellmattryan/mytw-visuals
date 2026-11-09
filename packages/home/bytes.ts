/** A Blob of `bytes`, without copying when they sit on a plain `ArrayBuffer`. */
export function blobOf(bytes: Uint8Array, type: string): Blob {
	const part =
		bytes.buffer instanceof ArrayBuffer
			? new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength)
			: bytes.slice()
	return new Blob([part], { type })
}

/** Saves bytes as a file download. */
export function downloadBytes(bytes: Uint8Array, fileName: string): void {
	const url = URL.createObjectURL(blobOf(bytes, 'application/zip'))
	const link = document.createElement('a')
	link.href = url
	link.download = fileName
	link.click()
	// Some browsers start the download after the click returns.
	setTimeout(() => URL.revokeObjectURL(url), 10_000)
}
