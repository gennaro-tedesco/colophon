# Standalone EPUB Reader Mode

Implementation plan for opening one EPUB directly without changing the configured library.

## Expected behavior

- Add an **Open in Reader Mode** button to the existing in-window application menu that opens a single-file picker restricted to `.epub` files.
- Open the selected EPUB in the existing reader overlay, starting at its first chapter.
- Keep the configured library directory, scanned books, cache, filters, and current library view unchanged.
- Closing the reader returns to the existing library interface.
- Register Colophon as an EPUB viewer so macOS Finder can offer **Open With > Colophon** and allow Colophon to be selected as the default EPUB app.
- Opening an EPUB from Finder launches or activates Colophon and opens that file directly in reader mode.

## Backend reader entry point

Update `app.go` with one shared standalone-open flow used by both the menu and operating-system file-open events:

1. Accept one absolute file path and confirm that it is an existing `.epub` file.
2. Register the exact file with a standalone reader handler without changing `App.root`, `App.lib`, `Config.LibraryDir`, or the library cache.
3. Produce an internal reader URL containing an opaque standalone-book identifier rather than exposing the absolute path to the frontend.
4. Emit a new frontend event, such as `reader:open`, when the frontend is ready.
5. Retain a pending URL when a file-open event arrives before frontend event listeners are installed, and expose a small bound method that lets the frontend consume that pending request during initialization.

Add a bound method for the native picker. It will call Wails `runtime.OpenFileDialog` with a single `*.epub` filter and pass the selected path through the same standalone-open flow. Cancelling the picker leaves the current screen unchanged.

## Standalone file serving

Extend `server/server.go` with a standalone reader handler or resolver that reuses the current reader shell, chapter, asset, table-of-contents, and search implementation while allowing only explicitly registered files.

- Map an opaque identifier to one canonical absolute EPUB path.
- Resolve standalone identifiers only through that exact map; do not treat URL content as a filesystem path.
- Use the filename without the extension as the fallback reader title when library metadata is unavailable.
- Keep standalone routes distinct from normal library-relative book routes so library books continue to resolve only beneath the configured library root.
- Ensure shared reader assets remain available when no library directory has been configured.
- Keep the active standalone registration for the application session so chapter navigation and reader search continue to work after the initial open.

Update `app.go` HTTP dispatch so standalone reader, chapter, asset, and search requests go to the standalone handler, while all existing library routes continue to use the library handler.

## Frontend integration

Add the standalone-open event name to `internal/contract/contract.go` and consume it in `frontend/app.js`.

- Route event URLs through the existing `openReaderURL` function so standalone books use the same loading state and reader overlay as library books.
- After installing the event listener, consume any pending startup URL from the backend to cover EPUBs opened from Finder while Colophon was not running.
- Continue using the reader's existing close action, which calls `window.closeReader()` and reveals the unchanged library interface.
- Add the picker action to the existing application menu using the same button styling as its **Choose** and **Refresh** actions.

Mark standalone reader shells in `server/reader_shell.html` and `server/reader.js` so they do not overwrite the library-only “continue reading” record with an opaque, session-scoped standalone URL.

## File association

Update `main.go` to:

- Configure Wails macOS options with `mac.Options.OnFileOpen` and forward the received path to the shared standalone-open flow.
- Treat an initial `.epub` command-line argument as a standalone reader request while preserving the existing directory argument behavior for library startup.

Update `wails.json` with one EPUB file association:

- extension: `epub`
- document name: `EPUB Book`
- macOS role: `Viewer`
- icon: reuse the existing application icon from `build/appicon.png`

The generated macOS bundle metadata will then advertise EPUB support to Finder, enabling **Open With** and default-app selection without manually editing the generated bundle.

## Files affected

- `main.go`: startup argument classification and macOS file-open callback.
- `app.go`: picker method, pending-open coordination, standalone reader state, and HTTP dispatch.
- `internal/contract/contract.go`: standalone reader-open event.
- `server/standalone.go`: exact-file standalone resolver and reader routes.
- `server/reader.js`: preserve library “continue reading” state for standalone books.
- `frontend/index.html`, `frontend/app.js`, and `frontend/i18n.js`: existing-menu picker action, event subscription, and pending startup open.
- `frontend/wailsjs/go/main/App.js` and `frontend/wailsjs/go/main/App.d.ts`: regenerated bindings for the new bound methods.
- `wails.json`: EPUB file association metadata.
