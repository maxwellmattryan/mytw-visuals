// Pure command parsing and copy-on-write application, with no DOM or WebGL dependency.
import type { Command, CommandError, JsonValue, Path } from './types'

type JsonObject = { readonly [key: string]: JsonValue }

export type ParseCommandResult =
	| { readonly ok: true; readonly command: Command }
	| { readonly ok: false; readonly error: CommandError }

export type ApplyCommandResult =
	| {
			readonly ok: true
			readonly doc: JsonValue
			/** Commands that undo this one when applied in order. */
			readonly inverse: Command[]
			/** One changed path per primitive operation. */
			readonly paths: Path[]
	  }
	| { readonly ok: false; readonly error: CommandError }

export type CopyJsonResult =
	| { readonly ok: true; readonly value: JsonValue }
	| { readonly ok: false; readonly message: string }

/** Keys that could reach an object's prototype. Rejected in paths and in values. */
const FORBIDDEN_KEY = '__proto__'

function malformed(message: string): { ok: false; error: CommandError } {
	return { ok: false, error: { code: 'malformed', message } }
}

function pathError(message: string): { ok: false; error: CommandError } {
	return { ok: false, error: { code: 'path', message } }
}

function prefixed(index: number, error: CommandError): CommandError {
	return { ...error, message: `commands[${index}]: ${error.message}` }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
	const proto: unknown = Object.getPrototypeOf(value)
	return proto === Object.prototype || proto === null
}

function isJsonObject(value: JsonValue): value is JsonObject {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function describe(value: unknown): string {
	if (value === null) return 'null'
	if (Array.isArray(value)) return 'an array'
	return `a ${typeof value}`
}

function formatPath(path: Path): string {
	return JSON.stringify(path)
}

function copyAt(value: unknown, at: string, ancestors: Set<object>): CopyJsonResult {
	if (value === null || typeof value === 'string' || typeof value === 'boolean') {
		return { ok: true, value }
	}
	if (typeof value === 'number') {
		if (Number.isFinite(value)) return { ok: true, value }
		return { ok: false, message: `${at} is ${value}, which is not a finite number` }
	}
	if (typeof value !== 'object') {
		return { ok: false, message: `${at} is ${describe(value)}, which is not JSON` }
	}
	if (ancestors.has(value)) return { ok: false, message: `${at} is a cycle` }
	if (Array.isArray(value)) {
		if (Object.getPrototypeOf(value) !== Array.prototype) {
			return { ok: false, message: `${at} is not a plain array` }
		}
		ancestors.add(value)
		const out: JsonValue[] = []
		for (let i = 0; i < value.length; i++) {
			if (!Object.hasOwn(value, i)) {
				ancestors.delete(value)
				return { ok: false, message: `${at}[${i}] is a hole in a sparse array` }
			}
			const item = copyAt(value[i], `${at}[${i}]`, ancestors)
			if (!item.ok) {
				ancestors.delete(value)
				return item
			}
			out.push(item.value)
		}
		ancestors.delete(value)
		return { ok: true, value: out }
	}
	if (!isPlainObject(value)) {
		return { ok: false, message: `${at} is a class instance, not a plain object` }
	}
	ancestors.add(value)
	const entries: [string, JsonValue][] = []
	for (const key of Object.keys(value)) {
		if (key === FORBIDDEN_KEY) {
			ancestors.delete(value)
			return { ok: false, message: `${at} has the forbidden key ${FORBIDDEN_KEY}` }
		}
		const item = copyAt(value[key], `${at}.${key}`, ancestors)
		if (!item.ok) {
			ancestors.delete(value)
			return item
		}
		entries.push([key, item.value])
	}
	ancestors.delete(value)
	// `Object.fromEntries` defines own data properties, so no key can reach a prototype.
	return { ok: true, value: Object.fromEntries(entries) }
}

/**
 * Deep-copies a plain JSON value. Rejects `undefined`, functions, symbols, bigints, non-finite
 * numbers, class instances, sparse arrays, cycles and `__proto__` keys.
 */
export function copyJson(value: unknown, label = 'value'): CopyJsonResult {
	return copyAt(value, label, new Set())
}

const KEYS: Readonly<Record<Command['op'], readonly string[]>> = {
	set: ['op', 'path', 'value'],
	remove: ['op', 'path'],
	insert: ['op', 'path', 'value'],
	move: ['op', 'path', 'from', 'to'],
	batch: ['op', 'commands'],
}

function isOp(value: unknown): value is Command['op'] {
	return typeof value === 'string' && Object.hasOwn(KEYS, value)
}

function parsePath(input: unknown): { ok: true; path: Path } | { ok: false; error: CommandError } {
	if (!Array.isArray(input)) return malformed(`path must be an array, got ${describe(input)}`)
	const path: (string | number)[] = []
	for (let i = 0; i < input.length; i++) {
		const segment: unknown = input[i]
		if (typeof segment === 'string' || Number.isSafeInteger(segment)) {
			path.push(segment as string | number)
			continue
		}
		return malformed(`path[${i}] must be a string or an integer, got ${describe(segment)}`)
	}
	return { ok: true, path }
}

function parseIndex(
	input: unknown,
	name: string
): { ok: true; index: number } | { ok: false; error: CommandError } {
	if (typeof input === 'number' && Number.isSafeInteger(input)) return { ok: true, index: input }
	return malformed(`${name} must be an integer, got ${describe(input)}`)
}

/** Checks a command's shape and returns a deep copy made of plain JSON. */
export function parseCommand(input: unknown): ParseCommandResult {
	if (!isPlainObject(input)) return malformed(`a command must be an object, got ${describe(input)}`)
	const op = input.op
	if (!isOp(op)) return malformed(`op must be one of ${Object.keys(KEYS).join(', ')}`)
	const allowed = KEYS[op]
	for (const key of Object.keys(input)) {
		if (!allowed.includes(key)) return malformed(`a ${op} command has no ${key} field`)
	}
	for (const key of allowed) {
		if (!Object.hasOwn(input, key)) return malformed(`a ${op} command needs a ${key} field`)
	}

	if (op === 'batch') {
		const list = input.commands
		if (!Array.isArray(list)) return malformed(`commands must be an array, got ${describe(list)}`)
		const commands: Command[] = []
		for (let i = 0; i < list.length; i++) {
			const parsed = parseCommand(list[i])
			if (!parsed.ok) return { ok: false, error: prefixed(i, parsed.error) }
			commands.push(parsed.command)
		}
		return { ok: true, command: { op, commands } }
	}

	const parsedPath = parsePath(input.path)
	if (!parsedPath.ok) return parsedPath
	const path = parsedPath.path

	if (op === 'remove') return { ok: true, command: { op, path } }
	if (op === 'move') {
		const from = parseIndex(input.from, 'from')
		if (!from.ok) return from
		const to = parseIndex(input.to, 'to')
		if (!to.ok) return to
		return { ok: true, command: { op, path, from: from.index, to: to.index } }
	}
	const value = copyJson(input.value)
	if (!value.ok) return malformed(value.message)
	return { ok: true, command: { op, path, value: value.value } }
}

type Step = { ok: true; value: JsonValue } | { ok: false; error: CommandError }

/** A replaced parent container and the command that restores it. */
type Edit = { ok: true; value: JsonValue; inverse: Command } | { ok: false; error: CommandError }

/** Resolves one segment against a node, by own key or in-range index only. */
function child(node: JsonValue, segment: string | number, at: Path): Step {
	if (Array.isArray(node)) {
		if (typeof segment !== 'number') {
			return pathError(`${formatPath(at)}: key ${JSON.stringify(segment)} used on an array`)
		}
		if (segment < 0 || segment >= node.length) {
			return pathError(`${formatPath(at)}: index ${segment} is out of range 0-${node.length - 1}`)
		}
		return { ok: true, value: node[segment] }
	}
	if (isJsonObject(node)) {
		if (typeof segment !== 'string') {
			return pathError(`${formatPath(at)}: index ${segment} used on an object`)
		}
		if (segment === FORBIDDEN_KEY)
			return pathError(`${formatPath(at)}: key ${FORBIDDEN_KEY} is forbidden`)
		if (!Object.hasOwn(node, segment)) {
			return pathError(`${formatPath(at)}: no key ${JSON.stringify(segment)}`)
		}
		return { ok: true, value: node[segment] }
	}
	return pathError(`${formatPath(at)}: cannot look inside ${describe(node)}`)
}

/** Returns a copy of `node` with `segment` replaced by `value`. `segment` must already resolve. */
function withChild(node: JsonValue, segment: string | number, value: JsonValue): JsonValue {
	if (Array.isArray(node)) {
		const copy = [...node]
		copy[segment as number] = value
		return copy
	}
	return { ...(node as JsonObject), [segment]: value }
}

/**
 * Rebuilds the spine from `doc` down to the parent of `path`'s last segment, copying only the
 * containers on the way, and lets `edit` replace that parent.
 */
function updateParent(
	doc: JsonValue,
	path: Path,
	edit: (parent: JsonValue, last: string | number) => Edit
): Edit {
	const nodes: JsonValue[] = [doc]
	for (let depth = 0; depth < path.length - 1; depth++) {
		const next = child(nodes[depth], path[depth], path.slice(0, depth + 1))
		if (!next.ok) return next
		nodes.push(next.value)
	}
	const edited = edit(nodes[nodes.length - 1], path[path.length - 1])
	if (!edited.ok) return edited
	let value = edited.value
	for (let depth = path.length - 2; depth >= 0; depth--) {
		value = withChild(nodes[depth], path[depth], value)
	}
	return { ok: true, value, inverse: edited.inverse }
}

function resolve(doc: JsonValue, path: Path): Step {
	let node = doc
	for (let depth = 0; depth < path.length; depth++) {
		const next = child(node, path[depth], path.slice(0, depth + 1))
		if (!next.ok) return next
		node = next.value
	}
	return { ok: true, value: node }
}

function checkIndex(index: number, length: number, at: Path, what: string): CommandError | null {
	if (index >= 0 && index < length) return null
	const range = length === 0 ? 'the array is empty' : `range is 0-${length - 1}`
	return { code: 'path', message: `${formatPath(at)}: ${what} ${index} is out of range (${range})` }
}

/**
 * Applies a parsed command to `doc` without mutating it. Unchanged subtrees keep their identity.
 * Returns the new root, the commands that undo it, and the changed paths.
 */
export function applyCommand(doc: JsonValue, command: Command): ApplyCommandResult {
	switch (command.op) {
		case 'batch': {
			let current = doc
			const inverses: Command[][] = []
			const paths: Path[] = []
			for (let i = 0; i < command.commands.length; i++) {
				const result = applyCommand(current, command.commands[i])
				if (!result.ok) return { ok: false, error: prefixed(i, result.error) }
				current = result.doc
				inverses.push(result.inverse)
				paths.push(...result.paths)
			}
			return { ok: true, doc: current, inverse: inverses.reverse().flat(), paths }
		}

		case 'set': {
			const { path, value } = command
			if (path.length === 0) {
				return { ok: true, doc: value, inverse: [{ op: 'set', path: [], value: doc }], paths: [[]] }
			}
			const result = updateParent(doc, path, (parent, last): Edit => {
				if (Array.isArray(parent)) {
					const found = child(parent, last, path)
					if (!found.ok) return found
					const inverse: Command = { op: 'set', path, value: found.value }
					return { ok: true, value: withChild(parent, last, value), inverse }
				}
				if (!isJsonObject(parent)) {
					return pathError(`${formatPath(path)}: cannot set a key on ${describe(parent)}`)
				}
				if (typeof last !== 'string') {
					return pathError(`${formatPath(path)}: index ${last} used on an object`)
				}
				if (last === FORBIDDEN_KEY) {
					return pathError(`${formatPath(path)}: key ${FORBIDDEN_KEY} is forbidden`)
				}
				const inverse: Command = Object.hasOwn(parent, last)
					? { op: 'set', path, value: parent[last] }
					: { op: 'remove', path }
				return { ok: true, value: withChild(parent, last, value), inverse }
			})
			if (!result.ok) return result
			return { ok: true, doc: result.value, inverse: [result.inverse], paths: [path] }
		}

		case 'remove': {
			const { path } = command
			if (path.length === 0) return pathError('[]: the root cannot be removed')
			const result = updateParent(doc, path, (parent, last): Edit => {
				const found = child(parent, last, path)
				if (!found.ok) return found
				if (Array.isArray(parent)) {
					const inverse: Command = { op: 'insert', path, value: found.value }
					return { ok: true, value: parent.filter((_, i) => i !== last), inverse }
				}
				const copy: Record<string, JsonValue> = { ...(parent as JsonObject) }
				delete copy[last as string]
				return { ok: true, value: copy, inverse: { op: 'set', path, value: found.value } }
			})
			if (!result.ok) return result
			return { ok: true, doc: result.value, inverse: [result.inverse], paths: [path] }
		}

		case 'insert': {
			const { path, value } = command
			if (path.length === 0) return pathError('[]: insert needs an array index as its last segment')
			const result = updateParent(doc, path, (parent, last): Edit => {
				if (!Array.isArray(parent)) {
					return pathError(`${formatPath(path)}: cannot insert into ${describe(parent)}`)
				}
				if (typeof last !== 'number') {
					return pathError(`${formatPath(path)}: key ${JSON.stringify(last)} used on an array`)
				}
				const error = checkIndex(last, parent.length + 1, path, 'index')
				if (error) return { ok: false, error }
				return {
					ok: true,
					value: [...parent.slice(0, last), value, ...parent.slice(last)],
					inverse: { op: 'remove', path },
				}
			})
			if (!result.ok) return result
			return { ok: true, doc: result.value, inverse: [result.inverse], paths: [path] }
		}

		case 'move': {
			const { path, from, to } = command
			const target = resolve(doc, path)
			if (!target.ok) return target
			const list = target.value
			if (!Array.isArray(list)) {
				return pathError(`${formatPath(path)}: cannot move inside ${describe(list)}`)
			}
			const error =
				checkIndex(from, list.length, path, 'from') ?? checkIndex(to, list.length, path, 'to')
			if (error) return { ok: false, error }
			const moved = [...list]
			const [item] = moved.splice(from, 1)
			moved.splice(to, 0, item)
			const inverse: Command = { op: 'move', path, from: to, to: from }
			if (path.length === 0) return { ok: true, doc: moved, inverse: [inverse], paths: [path] }
			const result = updateParent(
				doc,
				path,
				(parent, last): Edit => ({
					ok: true,
					value: withChild(parent, last, moved),
					inverse,
				})
			)
			if (!result.ok) return result
			return { ok: true, doc: result.value, inverse: [inverse], paths: [path] }
		}
	}
}
