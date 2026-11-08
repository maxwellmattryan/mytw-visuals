/** Any value that survives `JSON.stringify` and `JSON.parse` unchanged. */
export type JsonValue =
	| null
	| boolean
	| number
	| string
	| readonly JsonValue[]
	| { readonly [key: string]: JsonValue }

/** A location in a document. A string names an own object key, a number indexes an array. */
export type Path = readonly (string | number)[]

/** Replaces the value at `path`, or adds a new object key. `path: []` replaces the whole document. */
export interface SetCommand {
	readonly op: 'set'
	readonly path: Path
	readonly value: JsonValue
}

/** Deletes an object key, or splices out an array element. */
export interface RemoveCommand {
	readonly op: 'remove'
	readonly path: Path
}

/** Inserts into an array. The last segment is an index from 0 to the array's length. */
export interface InsertCommand {
	readonly op: 'insert'
	readonly path: Path
	readonly value: JsonValue
}

/** Moves the element at index `from` of the array at `path` to index `to`. */
export interface MoveCommand {
	readonly op: 'move'
	readonly path: Path
	readonly from: number
	readonly to: number
}

/** Applies a list of commands as one unit. Batches can nest. */
export interface BatchCommand {
	readonly op: 'batch'
	readonly commands: readonly Command[]
}

export type Command = SetCommand | RemoveCommand | InsertCommand | MoveCommand | BatchCommand

export interface ApplyOptions {
	/** Merges into the previous history step when it has the same key and the run is unbroken. */
	readonly mergeKey?: string
}

export type CommandErrorCode = 'malformed' | 'path' | 'invalid'

export interface CommandError {
	readonly code: CommandErrorCode
	readonly message: string
	/** The validator's issues, when `code` is `'invalid'`. */
	readonly issues?: readonly unknown[]
}

export type ApplyResult =
	| { readonly ok: true }
	| { readonly ok: false; readonly error: CommandError }

export type DocumentValidation =
	| { readonly ok: true }
	| { readonly ok: false; readonly issues: readonly unknown[] }

export type DocumentValidator = (doc: unknown) => DocumentValidation

export type ChangeSource = 'apply' | 'undo' | 'redo' | 'load'

export interface DocumentChange<D> {
	readonly document: D
	readonly previous: D
	/** One path per primitive operation. A `move` reports its array's path. */
	readonly paths: readonly Path[]
	readonly source: ChangeSource
}

export type DocumentListener<D> = (change: DocumentChange<D>) => void

export interface DocumentStoreOptions<D> {
	readonly document: D
	readonly validate: DocumentValidator
}

export interface DocumentStore<D> {
	/** The current root. Never mutated: each commit replaces it. */
	readonly document: D
	readonly canUndo: boolean
	readonly canRedo: boolean
	/**
	 * Checks, applies and validates a command as one atomic step. The command is re-checked at
	 * runtime, so one parsed from untrusted JSON is safe to pass.
	 */
	apply(command: Command, options?: ApplyOptions): ApplyResult
	undo(): boolean
	redo(): boolean
	/** Ends the current merge run, so the next `mergeKey` apply starts a new step. */
	seal(): void
	/** Validates and replaces the document, and clears history. Throws `DocumentLoadError`. */
	load(document: D): void
	subscribe(fn: DocumentListener<D>): () => void
}
