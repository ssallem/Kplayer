# Security and privacy

KPLAYER is designed for a trusted home network. Do not expose a local server port through a router or reverse proxy to the internet.

## Public web player

- Local playback uses browser object URLs without transmission. Casting PC files uses a user-connected loopback companion window: selected files are temporarily copied to the user's PC, never uploaded to a public server. No analytics, account database, cookies, localStorage or IndexedDB is used by the application.
- Media and subtitle names are not included in page URLs. Clearing the session revokes object URLs and releases file references. Internet addresses remain in memory until cleared or the tab closes.
- Loading a remote media address contacts its origin. The Google Cast SDK is loaded from Google only when the user starts Cast. GitHub Pages may retain site access logs independently of this application.
- HTTPS media/track URLs use the Google Cast SDK. Local files use the companion's existing LAN streaming and Cast controls. Local blob URLs are not sent to the receiver.
- The companion window checks the exact opener reference, `https://ssallem.github.io` origin and one-time nonce, and requires a click in its own top-level UI before transferring a MessagePort. It cannot be framed. Direct cross-origin API requests remain denied; no public-origin CORS exception was added. Trust applies to the entire ssallem.github.io origin, including its other projects. `KPLAYER_WEB_ORIGIN` is an explicit server-side override for self-hosting, not a web request parameter.
- The MessagePort permits only state, selected File upload, scan, connect, load, playback control and session clear. File loads are restricted to IDs imported through that window; other session file lists are filtered out. Arbitrary paths, native picker invocation, conversion, shutdown and arbitrary API forwarding are not exposed through the bridge. The web and local app share TV playback and session clear. Keep the companion window open during use; close all local player windows to trigger idle cleanup, or explicitly clear the session.

## Local internet/offline players

- Web file import uses at most 4 MiB ArrayBuffer transfers read by the selecting tab, followed by same-origin HTTP chunk requests from the companion. Disk-backed File handles are not forwarded across origins. Upload IDs are scoped to that companion window; the server enforces byte order, declared length, file-type/size limits and generated filenames. Partial files are not published as media. Failed transfers are aborted; inactive partial transfers expire after two minutes and are also removed by normal session cleanup.

- EXE launchers run with the current user's privileges, start the bundled Node runtime directly without a shell, and use a per-mode mutex to avoid duplicate tray processes. They do not install a service, modify startup settings, request administrator access, or add playback history. The tray exit command uses the server's normal cleanup endpoint. Current release binaries are not Authenticode-signed.

- Controls only accept loopback clients and matching local Host/Origin. LAN clients can only access scoped media URLs or the offline pairing page/protocol.
- Media URLs use 192-bit random tokens and random IDs. Cast streams are limited to the selected TV IP and loopback. Offline tokens are bound to the pairing client's IP; pairing codes expire after 5 minutes and permit 5 attempts per minute per IP.
- Native file selection is the only source of original filesystem paths. The API does not accept arbitrary filesystem paths. Only same-directory, same-stem SRT/VTT companions are read. The native picker sets `OFN_DONTADDTORECENT`.
- File lists, original paths and captions are kept in memory. Native media is streamed from the original without copying it. Drag/drop media and conversion results use temporary copies in `data/private-session` (offline: `data/offline/private-session`).
- Session clear, graceful shutdown and loss of all PC polling tabs for approximately 30 seconds stop playback, revoke tokens, empty memory and unlink temporary copies. Crash residue is cleaned at next launch. Do not force-kill the process during import/conversion if prompt cleanup matters.
- Legacy `library.json` entries are moved into the first temporary session and the JSON history is deleted. Original user files are never deleted.
- Media/API responses use `Cache-Control: no-store` and `Referrer-Policy: no-referrer`. The application does not log file names or URLs; minimal startup/error logs remain. Cast metadata uses the generic title `KPLAYER`.
- Video streams use HTTP on the LAN. Cast V2 control uses the community `castv2-client` implementation; its device TLS certificate validation is disabled by the upstream protocol implementation. Offline receiver control and streaming are HTTP, not encrypted. An untrusted LAN is outside the security boundary.
- Deletion is normal filesystem unlinking, not guaranteed secure erasure. Browser history, page cache from older versions, OS/antivirus logs, swap/crash dumps, backups and TV/platform records are outside the app's control.

Do not include media, subtitles, pairing tokens, IP addresses, or logs containing private data in public issues. Report vulnerabilities through GitHub's private vulnerability reporting when enabled.
