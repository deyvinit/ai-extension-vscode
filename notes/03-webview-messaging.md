# WebView ↔ Extension Messaging

## Goal

Establish a complete interaction loop between the WebView UI and the VS Code extension backend.

## WebView → Extension

- User input is captured in the WebView
- Data is sent using `vscode.postMessage`
- Messages include a `type` field to support multi-type message handling

Example:

- type: `userPrompt`
- payload: user-entered text

## Extension Handling

- The extension listens using `webview.onDidReceiveMessage`
- Messages are filtered by type
- A mock response is generated to simulate AI output

## Extension → WebView

- The extension sends data back using `webview.postMessage`
- Response messages use a different type (`assistantResponse`)

## WebView Rendering

- The WebView listens for messages using `window.addEventListener('message')`
- Responses are rendered into a dedicated UI container

## Outcome

- A full bidirectional communication loop is established
- The system is now ready for real AI integration
