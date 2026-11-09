import { describe, expect, it } from '@jest/globals'

import { DocumentLoadError } from '@mytw/document'
import { EngineError } from '@mytw/engine'
import { SceneError } from '@mytw/scene'

import { describeError } from '../src/errors'

describe('describeError', () => {
	it.each<[string, unknown, string]>([
		['an Error', new Error('boom'), 'boom'],
		['a TypeError', new TypeError('x is not a function'), 'x is not a function'],
		['an Error with no message', new RangeError(), 'RangeError'],
		['a string', 'went wrong', 'went wrong'],
		['an empty string', '', 'Unknown error'],
		['a number', 42, 'Unknown error'],
		['null', null, 'Unknown error'],
		['undefined', undefined, 'Unknown error'],
		['a plain object', { message: 'not an error' }, 'Unknown error'],
		[
			'an EngineError',
			new EngineError('webgl2-unavailable', 'WebGL2 is not available'),
			'WebGL2 is not available',
		],
		[
			'a SceneError, with its path',
			new SceneError('tracks[0].clips[0].layers[0].kind', 'sketch layers are not rendered'),
			'tracks[0].clips[0].layers[0].kind: sketch layers are not rendered',
		],
		[
			'a DocumentLoadError, with its first ProjectIssue',
			new DocumentLoadError('the document failed validation', [
				{ path: 'output.fps', code: 'range', message: 'output.fps: must be at most 120' },
				{ path: 'name', code: 'missing', message: 'name: is missing' },
			]),
			'the document failed validation: output.fps: must be at most 120',
		],
		[
			'a DocumentLoadError whose issue message has no path',
			new DocumentLoadError('bad', [{ path: 'name', message: 'is missing' }]),
			'bad: name: is missing',
		],
		[
			'a DocumentLoadError without issues',
			new DocumentLoadError('document is not plain JSON'),
			'document is not plain JSON',
		],
		['a DocumentLoadError with a non-issue', new DocumentLoadError('bad', ['oops']), 'bad'],
	])('formats %s', (_label, error, expected) => {
		expect(describeError(error)).toBe(expected)
	})
})
