# Part 5 — API Key Management

## Objective

The goal of this phase was to give users full control over how the Gemini API key is provided to the extension.

Instead of relying on environment variables or hardcoded secrets, the API key is now:

- entered manually by the user
- stored securely
- replaceable at any time
- removable when no longer needed

This makes the extension safer, more flexible, and closer to real-world usage.

---

## Design Decisions

### 1. Sidebar-based API key input

The API key is entered directly from the VS Code sidebar.
This avoids:

- environment variable setup
- external configuration files
- restarting VS Code to change keys

The user can manage the key from the same place where the AI assistant is used.

---

### 2. Secure storage using VS Code Secrets API

The API key is stored using:

- `context.secrets.store`
- `context.secrets.get`
- `context.secrets.delete`

This ensures:

- the key is encrypted
- the key is never committed to Git
- the key is scoped per user and per extension

At no point is the API key logged or exposed.

---

### 3. Chat gated by API key presence

The chat interface is disabled by default.

Only when a valid API key is present:

- the chat input is enabled
- prompts can be sent to the Gemini API

This prevents accidental API calls and provides clear user feedback.

---

### 4. Lazy API key validation

The extension does not validate the API key at the time it is saved.

Instead, the key is validated lazily on first actual usage, when a request is made to the Gemini API. This means:

- Any string can be stored as an API key
- The key is only verified by Gemini when a prompt is sent
- Invalid keys are rejected by the Gemini API and surfaced as runtime errors in the chat

This approach keeps the save flow lightweight and avoids unnecessary validation calls.

---

## Architecture Overview

The API key management flow follows a simple message-based architecture:

1. The sidebar UI sends messages to the extension backend
2. The backend reads or updates the stored API key using the Secrets API
3. The backend responds with the current API key state
4. The UI updates itself based on the response

All communication between UI and backend happens via explicit message types.

---

## User Flows

### First-time user

- Sidebar loads
- No API key is found
- Chat is disabled
- User enters API key and clicks Save
- Key is stored securely
- Chat becomes enabled

---

### Updating the API key

- User enters a new API key
- Clicks Save / Update
- Existing key is overwritten in secure storage
- New key is used immediately

---

### Entering an invalid API key

- User enters an invalid or malformed API key
- Key is saved locally without immediate validation
- Chat becomes enabled
- On sending a prompt, the Gemini API rejects the request
- The error response is displayed in the conversation

This behavior reflects the current lazy validation strategy.

---

### Removing the API key

- User clicks Remove
- Stored API key is deleted
- Chat is disabled again
- User is prompted to enter a new key if needed

---

### Reloading the extension

- On sidebar load, the UI requests API key status
- If a key exists, chat is enabled automatically
- If no key exists, chat remains disabled

---

## Future Improvement: Eager API Key Validation

A possible enhancement is to validate the API key at the time it is saved.

In this approach:

- A lightweight test request would be made to the Gemini API during the save operation
- Only valid keys would be stored
- Invalid keys would be rejected immediately with user-friendly feedback
- The chat interface would remain disabled until a valid key is provided

This would improve user experience at the cost of an additional API call.

---

## Security Considerations

- The API key is never hardcoded
- The API key is never committed to the repository
- The API key is never printed to logs
- The API key is stored using VS Code’s encrypted secrets storage

This approach aligns with recommended practices for handling sensitive credentials in VS Code extensions.

---

## Outcome

With API key management implemented, the extension is now:

- safer to distribute
- easier to use for new users
- independent of local environment configuration
