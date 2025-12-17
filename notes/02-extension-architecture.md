# Extension Architecture Overview

## Entry Point

- `extension.js` exports `activate` and `deactivate`
- VS Code calls `activate(context)` when the sidebar view is opened

## Sidebar Provider

- `AIAssistantViewProvider` implements the Webview View Provider contract
- `static viewType = 'aiAssistant.sidebar'` links provider to the view ID in `package.json`

## WebView Lifecycle

- VS Code calls `resolveWebviewView(webviewView)` to render the sidebar
- JavaScript is enabled explicitly via `webviewView.webview.options`
- HTML is injected using `getHtml()`

## Cleanup

- Disposables are registered via `context.subscriptions`
- VS Code handles cleanup automatically on deactivation
