# Editor‑Mutating Tool Calling

## Objective

The goal of this phase was to enable the AI assistant to **safely propose and apply code changes directly inside the VS Code editor**, while maintaining strict control, predictability, and user trust.

This feature extends the project from **read‑only context tools** (like reading selected code or the current file) into **controlled editor mutation**, using native Gemini function calling combined with VS Code APIs.

---

## What This Feature Enables

With editor‑mutating tool calling in place, the extension can now:

- Fix syntax errors in the current file
- Refactor existing code
- Add comments or documentation
- Modify logic (e.g., change addition to multiplication)
- Propose structural improvements

All changes are **suggested by Gemini** but **executed by the extension** only after explicit user approval.

---

## Core Design Principles

### 1. The model never edits files directly

Gemini **does not** mutate the editor.

Instead, the flow is:

1. Gemini requests file context using a tool (e.g., `get_current_file`)
2. Gemini reasons about the changes needed
3. Gemini proposes edits in natural language
4. The extension interprets and applies edits using VS Code APIs

This preserves a clean separation between **decision‑making** and **execution**.

---

### 2. Explicit user confirmation is mandatory

Before any editor mutation:

- the extension presents a modal confirmation dialog
- the user must explicitly approve the changes
- rejected changes are safely discarded

This avoids accidental edits and ensures user trust.

---

### 3. File‑level context over partial context

For mutation requests, the extension prioritizes **full‑file context**:

- Gemini is allowed to request `get_current_file`
- the entire file is treated as the source of truth
- selected text is optional and supplementary

This prevents inconsistent or incomplete edits that could arise from partial context.

---

### 4. One mutation cycle per prompt

To prevent runaway behavior:

- only **one editor mutation** is allowed per user prompt
- after a mutation is proposed and handled, the request terminates
- the extension does not re‑enter the tool loop

This avoids repeated modal popups and conflicting edits.

---

## High‑Level Flow

1. User submits a prompt (e.g., “Fix this code and add comments”)
2. Gemini decides whether a tool is required
3. Gemini requests `get_current_file`
4. Extension returns the file content
5. Gemini proposes changes
6. Extension asks the user for confirmation
7. On approval, the editor is mutated using VS Code APIs
8. A final response is returned to the chat UI

---

## Observed Behaviors & Edge Cases

- Multiple mutation proposals in a single response were intentionally blocked
- If no code is available, Gemini asks for context instead of guessing
- Error states (quota, malformed responses) are handled outside mutation logic
- Editor state remains consistent even if the user rejects changes

---

## Why Modal Confirmation Was Chosen

A VS Code modal dialog was used instead of a webview button because:

- it is harder to miss
- it integrates naturally with editor workflows
- it prevents background or accidental execution
- it matches user expectations for destructive actions

A webview‑based confirmation remains a future option but was intentionally deferred for safety.

---

## Future Scope

This editor‑mutating foundation unlocks several advanced capabilities:

### 1. Structured edit proposals

- Gemini can return diffs or patch‑style changes
- Extension can preview edits before applying them

### 2. Granular edit selection

- Allow users to approve or reject individual changes
- Support partial application of edits

### 3. Multi‑file refactoring

- Enable Gemini to request and modify multiple files
- Useful for large refactors or project‑wide changes

### 4. Undo‑aware mutation

- Automatically group changes into a single undo step
- Improve rollback safety

### 5. Webview‑based edit review

- Show side‑by‑side diff previews
- Let users review changes before approval

### 6. Policy‑based safety rules

- Block certain mutations (e.g., deleting files)
- Restrict edits to specific file types

---

## Summary

Editor‑mutating tool calling marks a major milestone:

- The assistant transitions from **advisor** to **collaborator**
- Code changes remain safe, reversible, and user‑controlled
- The architecture stays extensible for future sophistication

This implementation balances **power**, **safety**, and **developer ergonomics**, and serves as a strong foundation for advanced AI‑assisted development workflows.
