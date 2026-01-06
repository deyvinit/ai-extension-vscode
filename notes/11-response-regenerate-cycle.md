# Response Regeneration & Version Cycling

## Context

With split diff preview in place, AI-generated code edits became **reviewable, explicit, and safe**.
However, while editor mutation was now trustworthy, **response generation itself** still had an implicit weakness:

LLM responses are _non-deterministic_.

Even with the same prompt and the same context, regenerated responses can:

- Differ in structure
- Offer better or worse reasoning
- Miss or include details inconsistently

Previously, regenerating a response meant **replacing** it.
This introduced a subtle but important UX problem:

> The user had no way to compare, revert, or trust that regeneration was an improvement.

This phase addresses that gap.

---

## Objective

The goal of this phase was to make **response regeneration transparent, reversible, and user-controlled**, without introducing branching conversations or complex UI metaphors.

Specifically, the system should:

- Allow regenerating any assistant response
- Preserve previous responses instead of overwriting them
- Let users cycle through multiple versions of the same response
- Keep the conversation model linear and understandable
- Avoid hidden state or implicit replacement

In short:

> Regeneration should feel like _exploration_, not _destruction_.

---

## Why Simple Replacement Was Not Enough

Before this phase, regeneration worked by:

- Deleting the assistant response
- Asking the model to generate again
- Rendering the new response in its place

While simple, this approach had several drawbacks:

- The original response was permanently lost
- Users could not compare alternatives
- A worse regenerated response created frustration
- Trust depended entirely on “hoping” the new response was better

This became more problematic as responses grew longer, more technical, and more consequential (especially when tools or code were involved).

---

## High-Level Design Decision

Instead of treating regeneration as **replacement**, it is treated as **versioning**.

Each assistant message becomes a container for:

- One or more generated responses
- Exactly one active response at a time

Regeneration **adds** a new version.
It never deletes or overwrites existing ones.

---

## Conversation Model Changes

Assistant turns now store **multiple versions**.

```js
{
  role: 'assistant',
  versions: [
    {
      id: 'v1',
      content: string,
      createdAt: number,
      metadata: {
        regenerated: false
      }
    },
    {
      id: 'v2',
      content: string,
      createdAt: number,
      metadata: {
        regenerated: true
      }
    }
  ],
  activeVersionIndex: number
}
```
