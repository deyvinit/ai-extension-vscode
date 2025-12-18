# API Key Management

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

The API key is entered directly from the VS Code sidebar. This avoids:

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

### 4. Eager API key validation

The extension now validates the API key eagerly at the time it is saved.

When the user clicks **Save**, the backend performs a lightweight test request to the Gemini API using the provided key.

- If the request succeeds, the key is stored securely and the chat interface is enabled
- If the request fails, the key is rejected, the chat remains disabled, and an inline error message is shown to the user

This ensures that:

- Invalid API keys are never persisted
- Users receive immediate feedback
- The assistant is never enabled with a broken configuration

This validation is performed by reusing the same Gemini request path that is used for actual prompt generation, ensuring a single source of truth.

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
- Clicks Save
- The backend attempts a lightweight Gemini validation request
- The request fails
- The key is not stored
- An inline error message is displayed
- The chat interface remains disabled

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
- immediate validation of API credentials
