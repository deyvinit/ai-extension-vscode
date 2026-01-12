# Workspace Awareness, Navigation & Search

## Context

Up until this phase, the assistant operated primarily with **editor-level context**:
the currently open file, selected text, and user-provided prompts.

While sufficient for localized edits, this model broke down when:

- Reasoning about larger codebases
- Locating relevant files
- Answering structural or architectural questions
- Preparing safe, multi-file changes
- Supporting future retrieval-based systems (RAG)

Without explicit access to the workspace, the assistant was forced to infer or guess.

This phase introduces **grounded, deterministic workspace awareness**.

---

## Problem Statement

An assistant that edits or reasons about code must answer a fundamental question reliably:

> “Where does this code live?”

Without authoritative workspace access:

- File paths are hallucinated
- Irrelevant files are inspected
- Context is incomplete or outdated
- Tool calls become unsafe

Editor-only context is insufficient for non-trivial projects.

---

## Objective

The goal of this phase was to introduce **workspace-aware tooling**, while preserving:

- Explicit, tool-driven access (no implicit assumptions)
- Strict workspace sandboxing
- Read-only guarantees before navigation or editing
- Compatibility with existing session, persistence, and edit workflows

This phase intentionally precedes any semantic retrieval or RAG layer.

---

## Design Philosophy

Workspace capabilities were introduced using a **progressive escalation model**:

- **Phase A** — Read-only awareness
- **Phase B** — Safe navigation
- **Phase C** — Editing (deferred)

Key principles:

- The assistant must _discover_, not assume
- All access must be explicit via tools
- No mutation without user-visible confirmation
- Workspace truth takes precedence over memory

---

## Workspace Awareness (Phase A)

Phase A provides **read-only visibility** into the workspace.

The assistant can:

- Inspect project structure
- Identify the active file
- Read exact file contents
- Reason about architecture using ground truth

No navigation or editing occurs at this stage.

---

## Workspace Awareness Tools

The following tools were introduced for Phase A:

- **`get_current_file_info`**
  Returns metadata about the active editor file, including:

  - File name
  - Full path
  - Language
  - Containing directory
  - Workspace root

- **`list_workspace_files`**
  Lists files in the workspace, with support for recursive or top-level listing.

- **`list_workspace_folders`**
  Lists top-level workspace folders (supports multi-root workspaces).

- **`read_file`**
  Reads the full contents of a file, strictly scoped to the workspace.

These tools establish **authoritative workspace truth**.

---

## Workspace Search

Listing files alone does not scale for large projects.

To bridge the gap between discovery and inspection, **workspace search** was introduced.

Search enables the assistant to:

- Locate symbols, identifiers, or strings
- Narrow down relevant files
- Avoid brute-force reading
- Emulate human “search-first” workflows

Search is deterministic and exact — not semantic.

---

## Workspace Search Tool

- **`search_workspace`**

Searches for a text pattern across workspace files and returns structured results:

- File path
- Line number
- Short preview snippet

Results are capped to avoid flooding context and are strictly workspace-scoped.

Search operates as a **targeting mechanism**, not a retrieval system.

---

## Safe Navigation (Phase B)

With read-only awareness established, Phase B introduces **non-mutating navigation**.

Navigation allows the assistant to guide the user without altering content.

---

## Navigation Tools

The following tools were added:

- **`open_file`**
  Opens a file in the editor, even if the folder is collapsed or the file was never opened.

- **`open_folder`**
  Reveals a folder in the VS Code Explorer.

These actions are:

- User-visible
- Reversible
- Non-destructive

---

## Safety & Guardrails

Strong guardrails are enforced across all workspace tools:

- All paths must belong to the active workspace
- Access outside the workspace is rejected
- No implicit filesystem access
- No background indexing or scanning

To reduce noise and token waste, the following directories are excluded by default:

- `node_modules`
- `.git`
- `dist`
- `build`
- `out`

Search and listing results are intentionally bounded.

---

## Interaction With Existing Systems

Workspace tooling integrates cleanly with prior features:

- **Chat Session Management**
  Workspace access is per-session and does not leak context across chats.

- **Chat Persistence**
  Workspace interactions do not affect stored conversation state.

- **Guarded Editing Flow**
  All edits continue to flow through diff preview and explicit approval.

No existing safety or isolation guarantees were weakened.

---

## What This Enables

With workspace awareness in place, the assistant can now:

- Reason about entire projects, not just single files
- Locate relevant code before reading or editing
- Answer structural and architectural questions
- Prepare precise, localized changes
- Serve as a foundation for retrieval-based systems (RAG)

This marks a transition from **editor-aware** to **workspace-aware** intelligence.

---

## Explicit Non-Goals

This phase intentionally does **not** include:

- Semantic retrieval or embeddings
- Background indexing
- Automatic summarization
- Cross-file editing without preview
- RAG or memory-based retrieval

Those are layered on top, not baked in.

---

## Outcome

With workspace awareness, navigation, and search in place, the assistant now operates with:

- Grounded, deterministic context
- Safe discovery and inspection workflows
- Clear boundaries between awareness and action
- A solid foundation for future RAG integration

This completes the workspace tooling phase and establishes the final prerequisite for retrieval-augmented reasoning.
