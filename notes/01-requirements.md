# MVP Requirements — AI Extension for VS Code

## Goal

Build a VS Code sidebar AI assistant that accepts user input, can optionally include selected editor code as context, sends it to an AI backend, and displays the response in a simple HTML/CSS interface.

## In-Scope (MVP)

- VS Code extension written in JavaScript
- Sidebar panel using WebView
- HTML + CSS based UI
- Text input and response display
- Optional inclusion of selected editor code
- Request/response style AI interaction
- Error handling (empty input, no selection, API failure)

## Future Scope (Post-MVP)

- Streaming responses
- Chat history persistence
- Multi-file context
- Code modification or refactoring
- Autocomplete or inline suggestions
- Advanced UI (animations, markdown rendering)
- Authentication or user accounts

## Constraints

- JavaScript (TypeScript optional)
- Frontend limited to HTML/CSS/JS
- Gemini API recommended (free usage)
- AI integration kept simple (request/response)
- API keys handled in extension backend
- Scope to remain minimal and stable

## MVP Completion Criteria

- Sidebar loads reliably
- User can submit a prompt
- Selected code is included when available
- AI response is displayed correctly
- No crashes during basic usage
