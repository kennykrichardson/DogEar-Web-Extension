# Security notes

DogEar is a local-first browser extension. The extension runtime makes no network requests and does not send saved content to an external service. Its build-time dependencies are fetched from npm during development only.

- Required page access is temporary through `activeTab`, after a toolbar click, context-menu action, or extension keyboard command.
- Persistent page access is requested per HTTP/HTTPS origin only after an explicit user action and is optional.
- Saved notes and preferences live in `chrome.storage.local`.
- Imported backups are parsed as untrusted data, restricted to HTTP/HTTPS source URLs, and rejected as a whole if an entry is invalid.
- Page matching is performed in the content-script isolated world. The highlighter uses the CSS Custom Highlight API instead of changing webpage HTML.
- DogEar does not access cookies, browser history, network traffic, downloads, or page forms.

For a security report, contact the maintainer through the project's repository security contact once the repository is public. Do not include private annotations or browsing data in a report.
