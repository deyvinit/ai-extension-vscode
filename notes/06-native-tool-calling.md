# Native Gemini Tool Calling

## Objective

The goal of this phase was to integrate **native Gemini function calling** into the VS Code extension so that the model can:

- decide _when_ editor context is required
- request that context via structured tool calls
- receive real editor data from the extension
- continue reasoning with the tool result

This replaces earlier prompt-based approaches and aligns fully with the official Gemini API design.

---

## Design Decisions

### 1. Native function calling (no prompt simulation)

The extension does **not** instruct Gemini via system prompts to return JSON.

Instead:

- tools are declared using Gemini’s `functionDeclarations`
- Gemini autonomously decides whether to call a tool
- the backend executes the tool when requested

This avoids brittle logic and keeps reasoning and execution separate.

---

### 2. Minimal, focused editor tools

Only editor-related tools that provide clear value are declared.

Currently implemented:

- `get_selected_text`
- `get_current_file`

Each tool has:

- a single responsibility
- no arguments
- deterministic execution

This keeps tool selection reliable and predictable.

---

### 3. No hard-coded trigger logic

The extension does **not** attempt to guess user intent.

Instead:

- tools are always available to Gemini
- Gemini decides whether a tool is relevant based on the prompt and context
- unrelated prompts do not trigger tool calls

This preserves flexibility and scalability.

---

### 4. Explicit follow-up turn for tool results

Gemini is stateless.

Whenever a tool is executed:

- the tool result is sent back explicitly
- the original model response is preserved
- Gemini generates a final user-facing response using real editor data

This matches the official Gemini function calling flow.

---

## Implemented Tools

### get_selected_text

Returns the currently selected text in the active VS Code editor.

- returns an empty string if no selection exists
- safe against missing editor state
- used when explaining or transforming selected code

---

### get_current_file

Returns the full content of the currently active file.

- reads the entire document text
- used when broader context is required
- complements selected-code explanations

---

## Architecture Overview

The tool calling flow follows a deterministic loop:

1. User submits a prompt
2. Prompt + tool declarations are sent to Gemini
3. Gemini either:
   - responds with text, or
   - requests a function call
4. If a function call is requested:
   - the extension executes the tool
   - the tool result is sent back to Gemini
5. Gemini generates the final response

The model never executes code directly.

---

## Tool Registration

All tools are registered via the `tools` configuration:

```ts
const tools = [
  {
    functionDeclarations: [getSelectedTextFunction, getCurrentFileFunction],
  },
];
```
