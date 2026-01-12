# Chat Session Management & Conversation Isolation

## Context

With **response regeneration and version cycling** in place, the assistant reached message-level maturity:
responses were no longer destructive, and exploration became safe.

However, a broader limitation remained.

All interactions still existed inside a **single, global conversation**.

As usage expanded, this began to break down:

- Different tasks polluted each other’s context
- Regeneration felt risky across unrelated topics
- Users could not “start fresh” without losing history
- Long-running workflows became cognitively heavy

At this point, the system needed **conversation-level structure**, not just better responses.

---

## Problem Statement

A single linear conversation is sufficient for short sessions, but fails when the assistant is used as a daily workspace.

Without explicit chat separation:

- Context bleed becomes inevitable
- Regeneration loses clarity
- Users hesitate to explore in parallel
- Trust in model behavior degrades over time

This revealed a clear gap:

> Message-level versioning solves _how_ responses evolve,
> but chat session management solves _where_ those responses belong.

---

## Objective

The goal of this phase was to introduce **multi-chat session management**, while preserving:

- A simple mental model
- Linear conversations within each chat
- Explicit user control over context
- No implicit memory or hidden state reuse

Specifically, the system should:

- Support multiple independent chats
- Isolate conversation state per chat
- Allow safe switching between chats
- Integrate seamlessly with response regeneration
- Keep all context boundaries explicit and predictable

---

## High-Level Design Decisions

### 1. Sessions, Not Threads

Instead of introducing branching threads or nested trees, each chat is treated as a **self-contained session**.

- Exactly one chat is active at a time
- Each chat owns its full conversation history
- Chats are siblings, not branches
- Switching chats performs a hard context swap

This keeps the system intuitive and avoids exponential complexity.

---

### 2. Isolation Over Convenience

The model never infers or reuses context across chats.

If the user switches chats:

- Previous messages are not summarized
- No hidden memory is carried forward
- The active chat defines the _entire_ model context

This prioritizes **predictability and trust** over “smart” behavior.

---

## Chat Data Model

A top-level chat structure was introduced:

```js
{
  id: string,
  title: string,
  preview: string | null,
  conversation: Turn[],
  createdAt: number,
  lastModified: number,
  messageCount: number,
  isPinned: boolean
}
```
