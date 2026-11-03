import type { SketchEntry } from '../vite-plugins/sketch-list'

const container = document.getElementById('sketches') as HTMLElement
const version = document.getElementById('version') as HTMLElement

version.textContent = `v${__APP_VERSION__}`

// /__sketches.json only exists on the dev server, so a production build shows the empty message.
const sketches: SketchEntry[] = await fetch('/__sketches.json')
	.then((r) => r.json())
	.catch(() => [])

container.textContent = ''

if (sketches.length === 0) {
	const span = document.createElement('span')
	span.className = 'empty'
	span.textContent = 'No sketches yet. Run: yarn new --name my-sketch'
	container.appendChild(span)
} else {
	sketches.forEach((s) => {
		const a = document.createElement('a')
		a.href = s.path
		a.textContent = s.name
		container.appendChild(a)
	})
}
