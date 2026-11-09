import { describe, expect, it } from '@jest/globals'

import { sniffImage } from '../sniff'
import type { ImageHeader } from '../sniff'

function ascii(text: string): number[] {
	return [...text].map((char) => char.charCodeAt(0))
}

function u16be(value: number): number[] {
	return [(value >>> 8) & 0xff, value & 0xff]
}

function u32be(value: number): number[] {
	return [...u16be(value >>> 16), ...u16be(value)]
}

function u16le(value: number): number[] {
	return [value & 0xff, (value >>> 8) & 0xff]
}

function u24le(value: number): number[] {
	return [value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff]
}

function u32le(value: number): number[] {
	return [...u16le(value), ...u16le(value >>> 16)]
}

/** A PNG signature and IHDR chunk. */
function png(width: number, height: number): Uint8Array {
	return new Uint8Array([
		0x89,
		...ascii('PNG\r\n\x1a\n'),
		...u32be(13),
		...ascii('IHDR'),
		...u32be(width),
		...u32be(height),
		8,
		6,
		0,
		0,
		0,
		...u32be(0),
	])
}

/** SOI, an APP0 segment, then a start-of-frame segment with marker `sof`. */
function jpeg(sof: number, width: number, height: number): Uint8Array {
	return new Uint8Array([
		0xff,
		0xd8,
		0xff,
		0xe0,
		...u16be(16),
		...ascii('JFIF\0'),
		1,
		1,
		0,
		...u16be(1),
		...u16be(1),
		0,
		0,
		0xff,
		sof,
		...u16be(17),
		8,
		...u16be(height),
		...u16be(width),
		3,
		...new Array<number>(9).fill(0),
	])
}

function riff(chunk: string, payload: number[]): Uint8Array {
	return new Uint8Array([
		...ascii('RIFF'),
		...u32le(payload.length + 12),
		...ascii('WEBP'),
		...ascii(chunk),
		...u32le(payload.length),
		...payload,
	])
}

function webpLossy(width: number, height: number): Uint8Array {
	return riff('VP8 ', [0, 0, 0, 0x9d, 0x01, 0x2a, ...u16le(width), ...u16le(height)])
}

function webpLossless(width: number, height: number): Uint8Array {
	return riff('VP8L', [0x2f, ...u32le((width - 1) | ((height - 1) << 14))])
}

function webpExtended(width: number, height: number): Uint8Array {
	return riff('VP8X', [0, 0, 0, 0, ...u24le(width - 1), ...u24le(height - 1)])
}

const cases: [string, Uint8Array, ImageHeader | null][] = [
	['PNG', png(640, 480), { format: 'png', width: 640, height: 480 }],
	['JPEG baseline (SOF0)', jpeg(0xc0, 1920, 1080), { format: 'jpeg', width: 1920, height: 1080 }],
	['JPEG progressive (SOF2)', jpeg(0xc2, 300, 400), { format: 'jpeg', width: 300, height: 400 }],
	['WebP lossy (VP8 )', webpLossy(800, 600), { format: 'webp', width: 800, height: 600 }],
	['WebP lossless (VP8L)', webpLossless(16383, 2), { format: 'webp', width: 16383, height: 2 }],
	['WebP extended (VP8X)', webpExtended(20000, 3), { format: 'webp', width: 20000, height: 3 }],
	['GIF', new Uint8Array([...ascii('GIF89a'), 1, 0, 1, 0, 0, 0, 0]), null],
	['empty input', new Uint8Array(), null],
	['truncated PNG', png(640, 480).slice(0, 20), null],
	['truncated JPEG', jpeg(0xc0, 1920, 1080).slice(0, 30), null],
	['JPEG without a frame', jpeg(0xc0, 1, 1).slice(0, 20), null],
	['truncated WebP lossy', webpLossy(800, 600).slice(0, 28), null],
	['truncated WebP lossless', webpLossless(800, 600).slice(0, 22), null],
	['truncated WebP extended', webpExtended(800, 600).slice(0, 28), null],
	['WebP with an unknown chunk', riff('ALPH', [0, 0, 0, 0]), null],
	['zero-sized PNG', png(0, 10), null],
]

describe('sniffImage', () => {
	it.each(cases)('sniffs format and size: %s', (_name, bytes, expected) => {
		expect(sniffImage(bytes)).toEqual(expected)
	})

	it('reads a header from a view into a larger buffer', () => {
		const padded = new Uint8Array(64)
		padded.set(png(5, 7), 16)
		expect(sniffImage(padded.subarray(16, 16 + 33))).toEqual({ format: 'png', width: 5, height: 7 })
	})
})
