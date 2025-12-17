# AI Backend Integration

## Objective

The goal of this step was to integrate an AI backend into the VS Code sidebar
extension so that user prompts can be processed and responded to in real time.

---

## High-Level Architecture

- The sidebar UI runs inside a VS Code Webview
- User input is sent from the webview to the extension backend
- The backend is responsible for all AI-related logic
- The AI response is sent back to the webview for display

This separation ensures that sensitive logic and credentials remain on the
extension side and are not exposed to the frontend.

---

## Communication Flow

1. The user enters a prompt in the sidebar UI
2. The webview sends the prompt to the extension using `postMessage`
3. The extension backend receives the message
4. A request is made to the AI provider
5. The generated response is returned to the webview

---

## Choice of AI API

The Google Gemini REST API was used for response generation.

Reasons for using the REST API:

- No dependency on large SDKs
- Explicit control over requests and responses
- Easier debugging during development

---

## API Configuration

- Model: `gemini-2.5-flash`
- API version: `v1beta`
- Request method: `generateContent`
- Authentication: API key passed via request header

These values were selected based on the official Gemini API documentation.

---

## Error Handling

- Non-success HTTP responses are explicitly handled
- Error details are logged during development
- Temporary service errors (such as model overload) are surfaced to the user

---

## Conversation UI Rendering

Initially, each new AI response replaced the previous content in the sidebar.
This was changed to a chat-style rendering approach where user prompts and AI
responses are appended as separate, role-labeled messages.

This ensures conversation history remains visible while keeping rendering
logic separate from backend AI state management.

---

## Key Learnings

- Correct API versioning is critical for model availability
- Authentication method must match the API specification
- Cloud APIs may return transient errors even when integration is correct
