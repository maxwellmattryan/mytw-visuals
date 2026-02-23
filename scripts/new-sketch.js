#!/usr/bin/env node

import { mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync } from 'fs'
import { resolve, join } from 'path'

const TEMPLATES = ['basic', 'shader', 'image', 'audio-reactive']

function parseArgs(args) {
	const result = { name: null, template: 'basic' }
	for (let i = 0; i < args.length; i++) {
		if (args[i] === '--name' && args[i + 1]) {
			result.name = args[i + 1]
			i++
		} else if (args[i] === '--template' && args[i + 1]) {
			result.template = args[i + 1]
			i++
		}
	}
	return result
}

function getNextNumber(sketchesDir) {
	if (!existsSync(sketchesDir)) return 1
	const dirs = readdirSync(sketchesDir, { withFileTypes: true })
		.filter((d) => d.isDirectory())
		.map((d) => d.name)
		.filter((name) => /^\d{3}-/.test(name))
		.map((name) => parseInt(name.slice(0, 3), 10))
		.sort((a, b) => a - b)
	return dirs.length > 0 ? dirs[dirs.length - 1] + 1 : 1
}

function main() {
	const args = parseArgs(process.argv.slice(2))

	if (!args.name) {
		console.error('Usage: node scripts/new-sketch.js --name <sketch-name> [--template <template>]')
		console.error(`Templates: ${TEMPLATES.join(', ')}`)
		process.exit(1)
	}

	if (!TEMPLATES.includes(args.template)) {
		console.error(`Unknown template "${args.template}". Available: ${TEMPLATES.join(', ')}`)
		process.exit(1)
	}

	const sketchesDir = resolve('sketches')
	const num = getNextNumber(sketchesDir)
	const dirName = `${String(num).padStart(3, '0')}-${args.name}`
	const sketchDir = join(sketchesDir, dirName)

	mkdirSync(sketchDir, { recursive: true })

	// Copy template
	const templatePath = resolve('templates', `${args.template}.js`)
	const templateContent = readFileSync(templatePath, 'utf-8')
	writeFileSync(join(sketchDir, 'sketch.js'), templateContent)

	// Generate index.html
	const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${dirName}</title>
    <style>
      html, body {
        margin: 0;
        padding: 0;
        overflow: hidden;
        background: #000;
      }
    </style>
  </head>
  <body>
    <script type="module" src="./sketch.js"></script>
  </body>
</html>
`
	writeFileSync(join(sketchDir, 'index.html'), html)

	console.log(`Created sketch: ${sketchDir}`)
	console.log(`  Template: ${args.template}`)
	console.log(`  Open: http://localhost:5173/sketches/${dirName}/index.html`)
}

main()
