# LLM Provider Switching & Flow Stabilization

## Objective

The purpose of this phase was to **decouple the extension from a single LLM provider** and introduce a **stable, explicit provider-selection mechanism**, while preserving all existing capabilities built so far.

This phase focuses purely on **control, clarity, and correctness** in how the extension selects and interacts with an LLM backend.

---

## Why This Change Was Necessary

Up until this point, the extension was tightly coupled to a single provider (Gemini).
As the project grew in complexity—adding tools, editor mutation, file context, and multi-step reasoning—it became clear that:

- Provider-specific assumptions were leaking into core logic
- Future expansion (e.g., adding Groq) would be risky without isolation
- Debugging was harder without knowing _which_ provider was active

This phase establishes a **clean abstraction boundary** around the LLM layer.

---

## Removal of Provider Auto-Detection

An early attempt was made to **auto-detect the LLM provider** based on the API key format.

This approach was intentionally removed.

### Why auto-detection was dropped

- It relied on brittle heuristics
- It obscured user intent
- It created silent failure modes
- It became fragile as more providers were added

Instead, the extension now follows a simple rule:

> **The user explicitly chooses the provider. The system does not guess.**

This decision significantly improves predictability and trust.

---

## Explicit Provider Selection

### UI-Level Change

The extension UI now exposes a **provider selector** (e.g., dropdown), allowing the user to:

1. Choose the LLM provider explicitly
2. Enter the corresponding API key
3. Save and validate that key in the correct provider context

There is no fallback or reassignment once selected.

---

### Provider-Scoped API Keys

Each provider is treated as an **isolated execution context**:

- API keys are validated only against the selected provider
- Errors are provider-specific and explicit
- Switching providers does not overwrite existing keys

This prevents accidental cross-provider misuse and confusion.

---

## Internal Architecture Changes

### Unified LLM Call Routing

A provider-agnostic routing layer was introduced that:

- Accepts a normalized request shape
- Routes execution to the selected provider implementation
- Returns responses in a consistent internal format

This allows the rest of the extension (tools, editor mutation, UI) to remain **provider-neutral**.

---

### Provider Implementations Are Isolated

Each provider implementation is responsible for:

- Request construction
- Endpoint configuration
- Authentication
- Response parsing

Gemini remains the reference implementation at this stage, with the architecture prepared for additional providers.

---

## Stability Improvements Introduced

Alongside provider switching, several stability improvements were made:

- Clear separation between provider selection and request execution
- Removal of ambiguous fallback logic
- More explicit API key validation errors
- State reset when switching providers to avoid stale context

These changes ensure the extension behaves **deterministically**.

---

## Compatibility with Existing Features

This phase **did not break or alter** any previously implemented capabilities:

- Native tool calling
- Editor-mutating workflows
- File and selected-text context tools
- User confirmation safeguards
- One-mutation-per-prompt rule

Provider selection was introduced as an **orthogonal concern**, not a rewrite.

---

## Updated High-Level Flow

1. User selects an LLM provider explicitly
2. User enters and saves the provider’s API key
3. The key is validated against the selected provider
4. User submits a prompt
5. Request is routed to the active provider
6. Tool calling and editor mutation proceed as before
7. Response is returned to the UI

---

## Design Principles Reinforced

This phase reinforced several core principles:

- **Explicit is better than implicit**
- **User intent must be unambiguous**
- **Providers are interchangeable**

These principles guide all future expansion.

---

## Future Scope

With this foundation in place, the extension is now ready for:

### 1. Multiple provider support

- Keep multiple providers configured
- Switch providers without re-entering keys

### 2. Provider-specific feature gating

- Enable/disable features per provider
- Graceful degradation where capabilities differ

### 3. Clear provider visibility

- Show active provider in the UI
- Provider-specific diagnostics and messaging

---

## Summary

This phase transitioned the extension from a **single-provider tool** to a **provider-agnostic AI platform**:

- Provider auto-detection was removed
- Explicit provider selection was introduced
- Existing advanced features remained intact
- The system became clearer, safer, and easier to extend

This work establishes a stable foundation for future capabilities without compromising existing behavior.
