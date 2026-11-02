# Codebase Optimization Review

## High priority

### 1. The book cache does not avoid EPUB parsing

- `app.go:107-145` loads cached metadata, but `scanner.Stream` still parses every EPUB.
- `scanner/scanner.go:28-63` has no cache/modification-time check before `parseBook`.
- Consequently, startup and rescans remain proportional to the size of the entire library. The cache only makes stale results appear sooner.
- Pass cached modification data into the scanner and parse only new or changed files.

### 2. Opening a book eagerly loads and retains its entire text

- `server/server.go:560-578` loads metadata and text for every chapter before displaying the reader.
- `server/server.go:476-497` decompresses every chapter, then parses each chapter twice through `extractChapterTitle` and `extractChapterText`.
- `server/server.go:89-94, 500-557` retains all loaded books indefinitely with no eviction.
- Large books—or many opened books—will cause slow reader startup and steadily increasing memory use. Parse once per chapter, load searchable text lazily, and use a bounded cache.

### 3. The initial chapter is requested twice

- Both reader iframes start with the same URL at `server/reader_shell.html:506-518`.
- Each request opens the EPUB, reads the chapter, parses HTML, rewrites the document, and renders it (`server/server.go:301-371`).
- The buffer iframe should initially be blank or preload a useful adjacent chapter instead.

### 4. Book search performs expensive, uncancelled work on every keystroke

- `server/reader.js:1617-1625` sends a full-book search request for each input event without debouncing or cancellation.
- Older requests can complete after newer requests and overwrite current results at `server/reader.js:1124-1144`.
- The server lowercases every chapter on every query and creates one result per occurrence (`server/server.go:595-617`), with no result limit.
- This can produce high CPU usage, large responses, and stale UI results. Debounce input, cancel/sequence requests, normalize text once, and cap results.

### 5. Scans can overlap and overwrite one another

- Startup scanning is asynchronous at `app.go:77-79`, while `Rescan`, `PickAndScan`, and `SaveConfig` can start additional scans.
- There is no scan mutex, generation identifier, or cancellation.
- Events from different scans can interleave, and whichever scan finishes last replaces `a.lib`, `a.root`, and `a.handler`.
- Serialize scans or cancel superseded scans.

## Medium priority

### 6. Large library searches rebuild the entire UI on every input

- `frontend/app.js:977-980` immediately filters on each keystroke.
- `frontend/app.js:1435-1484` reconstructs and lowercases search strings for every book.
- `frontend/app.js:1512-1527` then destroys and recreates every visible book row and its event handlers.
- Precompute normalized search fields, debounce rendering, and consider incremental rendering or virtualization for large libraries.

### 7. EPUB reads are unbounded

- Several paths use `io.ReadAll` on compressed EPUB entries, including `scanner/epub.go:413-429, 488-539` and `server/server.go:973-989`.
- A malformed or unusually large compressed entry can cause excessive memory consumption.
- Enforce sensible compressed/uncompressed size limits before reading entries.

### 8. Scanning silently hides failures and can replace the library with partial data

- Filesystem errors are discarded at `scanner/scanner.go:69-86`.
- Invalid EPUBs are silently omitted at `scanner/scanner.go:93-97`.
- Cache write failures are ignored at `app.go:160, 184`, while config persistence failures are ignored by `PickAndScan` at `app.go:254`.
- Permission or disk failures therefore look like successful scans. Return or aggregate errors and preserve the previous valid state when scanning is incomplete.

### 9. Cache/config writes are not atomic

- `cache.go:58-62` and `config.go:43-47` write directly to their final files.
- A crash or interrupted write can leave truncated JSON; loading then silently falls back to empty data.
- Write to a temporary file in the same directory and atomically rename it.

### 10. Reader-cache failures are permanently cached

- `server/server.go:508-515, 546-553` stores an error and immediately returns it for every subsequent request.
- A transient read failure cannot recover until the entire handler is recreated.
- Failed entries should be retryable or invalidated based on file modification data.

### 11. Reader cache is discarded for unrelated preference changes

- Every `SaveConfig` recreates the HTTP handler at `app.go:220-222`.
- `NewHandler` creates a new empty reader cache at `server/server.go:96-103`.
- Changing font size or font family therefore discards already parsed books and causes future reloads. Separate mutable appearance settings from library/reader cache ownership.

## Redundant code and operations

### 12. Unused startup-scan map

- `booksByPath` is created and populated at `app.go:109, 115, 139` but never read.

### 13. Duplicated, unreachable handlers

- Script, resource, and library routes are registered in `server.NewHandler` at `server/server.go:109-118`.
- The same paths are intercepted first by `App.ServeHTTP` at `app.go:285-310`, so those handler registrations are currently unreachable.

### 14. Duplicated EPUB opening and lookup

- `loadReaderBookData` opens the EPUB through `ParseReaderData`, then opens it again at `server/server.go:560-572`.
- ZIP-entry helpers repeatedly linearly search `r.File`.
- Reuse one open archive and build an entry lookup map for multi-entry operations.

### 15. Small unused frontend reference

- `logo` is assigned at `frontend/app.js:19` but never used.

## Quality coverage

- `go vet ./...`: passed.
- `go test ./...` and `go test -race ./...`: execute successfully, but the repository contains no tests.
- The scanner, path validation, malformed EPUB handling, concurrent scans, cache behavior, and reader search are important areas currently lacking regression coverage.
