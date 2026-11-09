import { describe, expect, it } from '@jest/globals'

import { shortcutFor } from '../src/shortcuts'
import type { KeyLike, Shortcut } from '../src/shortcuts'

const key = (k: string, mods: Partial<KeyLike> = {}): KeyLike => ({
	key: k,
	ctrlKey: false,
	metaKey: false,
	shiftKey: false,
	altKey: false,
	repeat: false,
	...mods,
})

const body = { tagName: 'BODY' }
const canvas = { tagName: 'canvas' }
const input = { tagName: 'INPUT' }
const textarea = { tagName: 'TEXTAREA' }
const editable = { tagName: 'DIV', isContentEditable: true }
const button = { tagName: 'BUTTON' }
const select = { tagName: 'SELECT' }

describe('shortcutFor', () => {
	it.each<[string, KeyLike, unknown, Shortcut | null]>([
		['Ctrl+Z undoes', key('z', { ctrlKey: true }), body, 'undo'],
		['Cmd+Z undoes', key('z', { metaKey: true }), body, 'undo'],
		['Ctrl+Z with caps lock undoes', key('Z', { ctrlKey: true }), body, 'undo'],
		['Ctrl+Shift+Z redoes', key('Z', { ctrlKey: true, shiftKey: true }), body, 'redo'],
		['Cmd+Shift+Z redoes', key('z', { metaKey: true, shiftKey: true }), body, 'redo'],
		['Ctrl+Y redoes', key('y', { ctrlKey: true }), body, 'redo'],
		['Ctrl+Y (caps) redoes', key('Y', { ctrlKey: true }), body, 'redo'],
		['Cmd+Y does nothing', key('y', { metaKey: true }), body, null],
		['Ctrl+Shift+Y does nothing', key('y', { ctrlKey: true, shiftKey: true }), body, null],
		['Ctrl+Alt+Z does nothing', key('z', { ctrlKey: true, altKey: true }), body, null],
		['plain Z does nothing', key('z'), body, null],
		['Ctrl+Z repeats', key('z', { ctrlKey: true, repeat: true }), body, 'undo'],
		['Ctrl+Z on a button undoes', key('z', { ctrlKey: true }), button, 'undo'],
		['Space toggles play', key(' '), body, 'toggle-play'],
		['Space on the canvas toggles play', key(' '), canvas, 'toggle-play'],
		['Space with no focus toggles play', key(' '), null, 'toggle-play'],
		['held Space does not repeat', key(' ', { repeat: true }), body, null],
		['Shift+Space does nothing', key(' ', { shiftKey: true }), body, null],
		['Space on a button keeps its native press', key(' '), button, null],
		['Space on a select keeps its native behaviour', key(' '), select, null],
		['Space in a text field types', key(' '), input, null],
		['Ctrl+Z in a text field is native undo', key('z', { ctrlKey: true }), input, null],
		[
			'Cmd+Shift+Z in a textarea is native redo',
			key('z', { metaKey: true, shiftKey: true }),
			textarea,
			null,
		],
		['Ctrl+Y in contenteditable is native', key('y', { ctrlKey: true }), editable, null],
		['other keys do nothing', key('Enter'), body, null],
	])('%s', (_label, event, active, expected) => {
		expect(shortcutFor(event, active)).toBe(expected)
	})
})
