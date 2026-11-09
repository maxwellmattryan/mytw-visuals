# @mytw/storage

Projects on the user's device, with no login. `@mytw/storage` keeps projects in IndexedDB behind a `ProjectStore` interface, saves edits automatically, and moves a project with its images in and out of the browser as one `.mytw.zip` bundle. It has no UI, Svelte or WebGL; the project list lives in `@mytw/home`.

```ts
import { createAutosave, createLocalProjectStore, newProject } from '@mytw/storage'
import { createDocumentStore } from '@mytw/document'

const store = await createLocalProjectStore()
const meta = await store.create(newProject('My loop'))
const { project } = await store.open(meta.id)
const document = createDocumentStore(project)
const autosave = createAutosave({ store, id: meta.id, document })
```

## `ProjectStore`

Every method rejects with a `ProjectStoreError` whose `code` is one of:

| Code              | When                                                                                |
| ----------------- | ----------------------------------------------------------------------------------- |
| `not-found`       | The project id doesn't exist                                                        |
| `invalid-project` | The document fails `validateProject` or `parseProject`; `issues` lists the problems |
| `newer-version`   | The stored document has a `schemaVersion` newer than this app understands           |
| `invalid-name`    | A name is empty after trimming or longer than 200 characters                        |
| `invalid-bundle`  | A bundle can't be imported (see [Bundles](#bundles))                                |
| `quota-exceeded`  | The browser refused a write because storage is full (`QuotaExceededError`)          |
| `unavailable`     | IndexedDB is missing or can't be opened, as in some private browsing modes          |
| `failed`          | Any other IndexedDB failure, with its message                                       |

| Method                                                   | Does                                                                                                                                 |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `list()`                                                 | `ProjectMeta[]` (id, name, timestamps, `schemaVersion`, `hasThumbnail`), newest `updatedAt` first, without reading documents         |
| `create(project)`                                        | Validates and stores the project under a new id                                                                                      |
| `importProject({ project, assets, thumbnail })`          | Creates a project with its asset bytes and thumbnail in one transaction (bundle import uses it)                                      |
| `open(id, { remember? })`                                | Reads and parses the document, migrating and writing back older versions (`migratedFrom` reports it), and records the last opened id |
| `save(id, project)`                                      | Validates, then writes the document and updates the meta name and `updatedAt` together                                               |
| `rename(id, name)`                                       | Trims the name and updates the meta and the document's `name`                                                                        |
| `duplicate(id)`                                          | Copies the document, meta and thumbnail as `<name> copy`; assets are shared, not copied                                              |
| `delete(id)`                                             | Removes the project, and every asset it referenced that no remaining project references                                              |
| `putAsset(bytes)` / `read(hash)`                         | Stores bytes under their SHA-256 hex hash (deduplicated); `read` makes the store an `AssetSource` for `ImageAssets`                  |
| `setThumbnail(id, bytes, mimeType)` / `getThumbnail(id)` | The card image for the project list                                                                                                  |
| `lastOpened()` / `setLastOpened(id \| null)`             | The project to reopen after a reload                                                                                                 |
| `storageStatus()` / `requestPersistence()`               | See [Persistence](#persistence)                                                                                                      |

`newProject(name = 'Untitled')` builds a starting document: 1080×1080, 30 fps, black background, a 60-frame loop, and no assets, modulators, tracks or effects.

The project document keys an asset as `sha256:<hex>` (see [docs/project-format.md](../../docs/project-format.md)); the store's `putAsset` and `read` use the bare hex.

`createLocalProjectStore(options?)` takes `indexedDB`, `dbName`, `storage` (a `StorageManager`, or `null`), `now` and `newId`, so tests can pass a fresh `IDBFactory` from `fake-indexeddb` and fake the rest.

## IndexedDB layout

Database `mytw-visuals`, version 1. Bytes are stored as `Uint8Array`, never `Blob`.

| Object store | Key             | Value                                              |
| ------------ | --------------- | -------------------------------------------------- |
| `projects`   | `id`            | `ProjectMeta`, with ISO timestamps                 |
| `documents`  | `id`            | `{ id, doc }`, where `doc` is the raw project JSON |
| `assets`     | `hash` (64 hex) | `{ hash, bytes, size }`                            |
| `thumbnails` | project id      | `{ bytes, mimeType }`                              |
| `settings`   | `key`           | `{ key: 'lastOpened', value: string \| null }`     |

Operations that touch several stores (save, delete with asset collection, duplicate, import) each run in one `readwrite` transaction, so they finish completely or not at all.

### Versioning

The database version (`DB_VERSION`) is separate from the project `schemaVersion`. Project documents migrate when they are opened or imported, through `parseProject`, and are written back in place. To change the database layout, raise `DB_VERSION` and add a step to `upgrade` in `local-store.ts` guarded by `oldVersion < n`, so a database at any older version upgrades step by step. Never edit an existing step.

## Autosave

`createAutosave({ store, id, document })` watches a `DocumentStore<Project>` from `@mytw/document` and saves every change, including undo, redo and load:

- A save runs 500 ms (`delayMs`) after the last change, and at least every 5 s (`maxWaitMs`) while changes keep arriving, so a crash loses at most the last 5 s of edits.
- Saves never overlap. A change during a save schedules one more save with the latest document once it finishes.
- `status` is `saved`, `pending`, `saving` or `error`, also reported through `onStatus`. A failed save keeps the changes pending and retries on the next change or `flush()`. A full disk reports "Storage is full. Export projects you want to keep and delete others to free space."
- `flush()` saves now. Autosave also flushes on `pagehide` and when the page becomes hidden. `dispose()` flushes, stores a final thumbnail and stops listening.
- With a `thumbnail` callback (such as `thumbnailFromCanvas` from `@mytw/home`), a thumbnail is stored after a successful save at most every 5 s (`thumbnailIntervalMs`). Thumbnail failures only log a warning.

## Bundles

`exportProjectBundle(store, id)` resolves `{ bytes, fileName }`. The file is a plain zip, named after the project (`my-loop.mytw.zip`), that any unzip tool can open. Entries are stored without compression, since images are already compressed.

| Entry                        | Contents                                                                  |
| ---------------------------- | ------------------------------------------------------------------------- |
| `mytw-bundle.json`           | `{ "format": "mytw-bundle", "bundleVersion": 1, "missingAssets": [...] }` |
| `project.json`               | The project, written with `serializeProject`                              |
| `assets/<hex>`               | The bytes of every referenced asset the store has, named by SHA-256 hash  |
| `thumbnail.<png\|webp\|jpg>` | The thumbnail, when there is one                                          |

Assets the store lacks are listed in `missingAssets` instead of failing, so a damaged project can still be exported.

`importProjectBundle(store, bytes)` resolves `{ meta, missingAssets }`. It checks the manifest, parses `project.json` with `parseProject` (so older projects migrate), checks that each asset's bytes hash to its name, and creates the project under a new id with its assets deduplicated. Referenced assets with no file are returned in `missingAssets`; `ImageAssets` draws placeholders for them. An import rejects with `invalid-bundle`, and writes nothing, when the input isn't a zip, is over 512 MiB, declares over 1 GiB uncompressed (checked before inflating), comes from a newer `bundleVersion`, lacks the manifest or `project.json`, or has an asset whose name isn't a hash or whose bytes don't match it. A project that fails to parse rejects with `invalid-project`.

Raise `BUNDLE_VERSION` only for changes an older app can't read, and keep importing every older version.

## Persistence

Browsers may clear site data under storage pressure unless the site's storage is persistent. `storageStatus()` resolves `{ persisted, usage, quota }` from `navigator.storage.persisted()` and `estimate()`, with `null` for anything the browser doesn't provide. `requestPersistence()` calls `navigator.storage.persist()` and resolves its answer, or `null` when unsupported.

`@mytw/home` uses them for the storage notice: while data isn't persisted, a banner says projects are kept in this browser and can be lost if browser data is cleared, and to export bundles to keep a copy. It offers **Keep data on this device** when the browser can be asked, asks automatically on the first New project or Import (a user gesture), and warns when usage reaches 80% of the quota.

## Tests

`packages/storage/__tests__/` runs against `fake-indexeddb`, with a fresh `IDBFactory` per test. Shared helpers live in `packages/storage/testing/fixtures.ts`.
