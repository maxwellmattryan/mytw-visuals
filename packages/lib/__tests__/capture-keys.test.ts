import { afterEach, describe, expect, it, jest } from '@jest/globals'
import type p5 from 'p5'

import { isTypingTarget, SketchCapture } from '@lib/capture'

type FakeP5 = { key: string; keyPressed?: () => void; keyReleased?: () => void }

const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document')

function setActiveElement(activeElement: unknown): void {
	Object.defineProperty(globalThis, 'document', {
		value: { activeElement },
		configurable: true,
		writable: true,
	})
}

function setup() {
	const cap = new SketchCapture({} as unknown as HTMLCanvasElement)
	const start = jest.spyOn(cap, 'start').mockImplementation(async () => {})
	const stop = jest.spyOn(cap, 'stop').mockImplementation(() => {})
	const screenshot = jest.spyOn(cap, 'screenshot').mockImplementation(() => {})
	const existing = jest.fn()
	const p: FakeP5 = { key: 'r', keyPressed: existing }
	cap.bindKeys(p as unknown as p5)
	const press = (key: string) => {
		p.key = key
		p.keyPressed?.()
	}
	const release = (key: string) => {
		p.key = key
		p.keyReleased?.()
	}
	return { start, stop, screenshot, existing, press, release }
}

afterEach(() => {
	if (originalDocument) Object.defineProperty(globalThis, 'document', originalDocument)
	else Reflect.deleteProperty(globalThis, 'document')
})

describe('SketchCapture.bindKeys', () => {
	it('ignores R and S while typing', () => {
		setActiveElement({ tagName: 'INPUT' })
		const keys = setup()

		keys.press('r')
		keys.press('S')
		expect(keys.start).not.toHaveBeenCalled()
		expect(keys.screenshot).not.toHaveBeenCalled()
		expect(keys.existing).toHaveBeenCalledTimes(2)

		keys.release('r')
		expect(keys.stop).toHaveBeenCalledTimes(1)

		setActiveElement({ tagName: 'BODY' })
		keys.press('R')
		keys.press('s')
		expect(keys.start).toHaveBeenCalledTimes(1)
		expect(keys.screenshot).toHaveBeenCalledTimes(1)
	})

	it('handles R and S when there is no document', () => {
		Reflect.deleteProperty(globalThis, 'document')
		const keys = setup()

		keys.press('r')
		keys.press('s')
		expect(keys.start).toHaveBeenCalledTimes(1)
		expect(keys.screenshot).toHaveBeenCalledTimes(1)
	})
})

describe('isTypingTarget', () => {
	it.each([
		[{ tagName: 'INPUT' }, true],
		[{ tagName: 'TEXTAREA' }, true],
		[{ tagName: 'SELECT' }, true],
		[{ tagName: 'DIV', isContentEditable: true }, true],
		[{ tagName: 'DIV', isContentEditable: false }, false],
		[{ tagName: 'BODY' }, false],
		[null, false],
		[undefined, false],
	])('classifies %p as %p', (el, expected) => {
		expect(isTypingTarget(el)).toBe(expected)
	})
})
