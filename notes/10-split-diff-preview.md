# Split Diff Preview & Safe Editor Mutation

## Objective

The goal of this phase was to make **AI-proposed code edits safer, more transparent, and more professional**, by allowing users to _review changes before they are applied_.

This phase introduced a **split diff preview workflow** that mirrors industry-grade tooling (Git, IDE refactors, code review systems), while preserving the existing editor-mutating tool architecture.

The focus was on:

- Visual clarity
- Explicit user consent
- Editor safety
- Predictable cleanup
- Long-term maintainability

---

## Why This Phase Was Necessary

Prior to this phase, editor-mutating tools applied changes after a modal confirmation.
While functional, this approach had limitations:

- Users could not **visually inspect** the full diff
- Changes felt opaque for larger edits
- There was no opportunity to _compare before vs after_
- Trust depended heavily on explanation text alone

To elevate the UX and align with professional standards, AI edits needed to be **previewable before application**.

---

## High-Level Feature Overview

When the AI proposes code edits:

1. The original file remains untouched
2. A **split diff preview** opens in the editor:
   - Left: Original file (read-only)
   - Right: Proposed AI-modified version
3. The user is explicitly asked to:
   - **Apply changes**, or
   - **Cancel**
4. Only after confirmation are edits written to disk

At no point are changes silently applied.

---

## Split Diff Preview Architecture

### Core Design Principles

- **No mutation without consent**
- **No hidden edits**
- **No partial state**
- **No editor assumptions**
- **Clean teardown on cancel or completion**

---

## Implementation Breakdown

### 1. Virtual Preview Document

Instead of modifying the active editor directly, a **virtual document** is created containing the AI-generated code.

- The preview document is not saved to disk
- It exists solely for visual comparison
- A timestamped URI ensures uniqueness

This prevents:

- Accidental overwrites
- Editor race conditions
- State corruption

---

### 2. Opening the Diff View

VS Code’s native diff editor is used:

- Left side: original document URI
- Right side: virtual preview URI
- Both are shown side-by-side

This leverages:

- Built-in diff rendering
- Familiar UX patterns
- Zero custom diff logic

---

### 3. Explicit User Decision

The user is prompted with a **clear choice**:

- Apply changes
- Cancel

This is not heuristic-driven or auto-triggered.
The user must actively confirm.

---

### 4. Applying Changes Safely

When the user accepts:

- The extension verifies the active editor
- If the editor has changed, it is reopened safely
- A full-document replacement is performed atomically
- No partial edits occur

If the user cancels:

- No mutation occurs
- The preview is disposed
- State is fully cleaned

---

## Tool Calling Integration

Split diff preview integrates seamlessly with **editor-mutating tool calls**.

The tool flow remains:

1. Model requests `apply_code_edits`
2. Tool handler extracts:
   - Reason
   - Proposed code
   - Explanation
3. Instead of applying immediately:
   - A diff preview is opened
4. Tool execution only completes **after user confirmation**

This preserves:

- Deterministic tool flow
- Clear reasoning boundaries
- Full auditability

---

## Resource Cleanup & Stability

### Disposable Management

All diff-related resources are tracked via disposables.

On:

- Apply
- Cancel
- Extension deactivation

All preview resources are explicitly disposed.

This prevents:

- Memory leaks
- Orphaned editors
- Zombie diff views

---

## Error Handling & UX Safeguards

Several stability improvements were added during this phase:

- Abort-related errors are never shown to the user
- Failed previews do not modify editor state
- Cancel actions do not spawn new UI bubbles
- Tool execution resumes cleanly after preview resolution

All failure paths are **non-destructive**.

---

## Updated Editor Mutation Flow

1. AI proposes edits via tool call
2. Extension prepares preview content
3. Split diff view opens
4. User reviews changes
5. User confirms or cancels
6. Changes are applied _only if approved_
7. All preview resources are cleaned up

---

## Design Principles Reinforced

This phase reinforced several architectural principles:

- **Trust through visibility**
- **User agency over automation**
- **Editor safety above convenience**
- **Native IDE primitives over custom UI**
- **Predictable cleanup paths**

---

## Compatibility with Existing Features

This feature is fully compatible with:

- Streaming responses (SSE)
- Stop generation
- Tool calling
- Provider selection
- File and selected-text tools
- User confirmation safeguards

No existing functionality was removed or weakened.

---

## Future Scope

With split diff preview in place, the extension is now positioned for:

- Inline diff annotations
- Multi-file edit previews
- Partial-accept workflows
- Git-aware previews
- Review comments on AI changes

---

## Summary

This phase transformed editor mutation from a **modal action** into a **review-first workflow**.

By introducing split diff previews, explicit confirmation, and robust cleanup, AI-generated code edits now feel:

- Safe
- Transparent
- Professional
- Trustworthy

This marks a major step toward production-grade AI-assisted development inside VS Code.
