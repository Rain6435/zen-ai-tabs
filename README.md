# Zen AI Tabs

AI tab grouping for [Zen Browser](https://zen-browser.app) (Firefox-based), as a standard WebExtension. No `userChrome.js`, no autoconfig, no Sine mods.

- Bring your own key: Google Gemini, Anthropic Claude, or OpenAI. Requests go directly from your browser to the provider. No proxy, no telemetry.
- "Tidy Ungrouped" groups ungrouped, unpinned tabs in the current window into named, colored groups. Existing group names are reused.
- "Undo" restores the previous layout: tab indexes, group membership, and group titles and colors. The last 10 states are kept.
- Pinned tabs, hidden tabs, and tabs in non-default containers are never touched.

## Requirements

- Zen Browser or Firefox with the `tabGroups` WebExtension API (Firefox 138+). Confirm your browser exposes `browser.tabGroups` before relying on this (see Caveats).
- An API key for at least one provider.

## Install (development, temporary)

1. Clone this repo.
2. Open `about:debugging#/runtime/this-firefox`.
3. Click **Load Temporary Add-on…** and select `manifest.json`.
4. Click the extension's toolbar button, choose a provider, paste your key, and optionally set a model.

Temporary add-ons are removed when the browser restarts. Reload them from the same page.

## Install (permanent, self-distributed)

Firefox and Zen only keep add-ons that are signed by Mozilla.

1. `./scripts/package.sh` → creates `dist/zen-ai-tabs.xpi`.
2. Submit the `.xpi` to [addons.mozilla.org](https://addons.mozilla.org/developers/) as an **unlisted** add-on to get it signed.
3. Install the signed `.xpi` from `about:addons` (gear menu → *Install Add-on From File…*).

## Providers and defaults

| Provider | Default model | Endpoint | Notes |
|---|---|---|---|
| Gemini | `gemini-3.1-flash-lite` | `generativelanguage.googleapis.com` | `responseSchema` structured output |
| Claude | `claude-haiku-5-5` | `api.anthropic.com/v1/messages` | forced single tool call |
| OpenAI | `gpt-6-luna` | `api.openai.com/v1/chat/completions` | `reasoning_effort: none`, strict `json_schema` |

Leave the model field blank to use the default. Any model ID that your key can access will work in the field.

Output from the model is validated before anything moves: names are truncated to 18 characters, colors are restricted to the allowed set, tab IDs must have been sent in the request, no tab appears twice, and groups with fewer than two tabs are dropped.

## Privacy

- Only `[ID | domain | title]` is sent. URLs, query strings, and fragments are never sent.
- API keys are stored in `browser.storage.local` in plaintext on your machine.

## Benchmark

```sh
node bench/bench.mjs <gemini|claude|openai> <API_KEY> [model] [runs]
```

Runs on a synthetic 50-tab set. Reports sanitize, API round trip, and validation times per run. The apply step needs a live browser and is not included. Use the popup's timing readout for end-to-end numbers.

## Layout

```
manifest.json            MV3 manifest (tabs, tabGroups, storage)
src/background.js        message router, serialized operations
src/core/sanitize.js     URL stripping, title cleaning, eligibility filter
src/core/tabManager.js   capture, apply, snapshot ring, rollback
src/adapters/aiProvider.js  Gemini / Claude / OpenAI adapters + output validation
src/ui/popup.{html,js}   popup UI
bench/bench.mjs          latency benchmark
scripts/package.sh       builds dist/zen-ai-tabs.xpi
```

## Caveats

- **Unverified on Zen.** The Firefox `tabGroups` API is the assumed backend. If Zen does not expose it, *Tidy* will fail and the popup will show the error. Check `browser.tabGroups` in the background console first.
- **Live provider calls are not covered by tests.** The benchmark exercises them only when run with a real key.
- **Scope.** Grouping works on the current window. Zen workspaces are not read.
- **Ungroup on rollback** requires `browser.tabs.ungroup`. If unavailable, undo restores membership but cannot remove groups from tabs that were ungrouped.

## License

No license specified yet.
