import { mount } from 'svelte'
import App from './App.svelte'
import { createErrorFeed, describeError } from './errors'

// First, so errors during mount and afterwards show as banners instead of a blank page.
const errors = createErrorFeed()
window.addEventListener('error', (event) => errors.push(event.error ?? event.message))
window.addEventListener('unhandledrejection', (event) => errors.push(event.reason))

/** The full-page failure, in plain DOM because the app itself couldn't start. */
function showFatal(target: HTMLElement, error: unknown): void {
	const box = document.createElement('div')
	box.setAttribute('role', 'alert')
	box.style.cssText = 'max-width:40rem;margin:0 auto;padding:4rem 1.5rem;font-size:14px'
	const heading = document.createElement('h1')
	heading.textContent = 'The editor hit an error'
	heading.style.cssText = 'margin:0 0 12px;font-size:18px'
	const message = document.createElement('p')
	message.textContent = describeError(error)
	message.style.cssText = 'margin:0 0 16px;color:#ffb3b3;overflow-wrap:anywhere'
	const reload = document.createElement('button')
	reload.type = 'button'
	reload.textContent = 'Reload'
	reload.addEventListener('click', () => location.reload())
	box.append(heading, message, reload)
	target.replaceChildren(box)
}

const target = document.getElementById('app') ?? document.body
const fixture = new URLSearchParams(location.search).get('fixture')

try {
	mount(App, { target, props: { fixture, errors } })
} catch (error) {
	showFatal(target, error)
}
