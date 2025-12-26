const vscode = acquireVsCodeApi();

window.addEventListener('DOMContentLoaded', () => {
    const chat = document.getElementById('chat');
    const sendBtn = document.getElementById('send');
    const clearBtn = document.getElementById('clear-chat');
    const input = document.getElementById('prompt');
    const chatSection = document.getElementById('chat-section');
    const apiKeyInput = document.getElementById('apiKeyInput');
    const saveKeyBtn = document.getElementById('saveKeyBtn');
    const removeKeyBtn = document.getElementById('removeKeyBtn');
    const keyStatus = document.getElementById('keyStatus');
    const attachFileBtn = document.getElementById('attachFileBtn');
    const attachedFileName = document.getElementById('attachedFileName');
    const removeFileBtn = document.getElementById('removeFileBtn');
    const providerSelect = document.getElementById('providerSelect');
    let attachedFile = null;
    removeFileBtn.style.display = 'none';

    function setChatEnabled(enabled) {
        chatSection.style.opacity = enabled ? '1' : '0.5';
        sendBtn.disabled = !enabled;
        input.disabled = !enabled;
    }

    setChatEnabled(false);

    function renderMarkdown(text) {
        text = text.replace(/```([\s\S]*?)```/g, '<pre><code>$1</code></pre>');
        text = text.replace(/`([^`]+)`/g, '<code>$1</code>');
        text = text.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
        text = text.replace(/\*(.*?)\*/g, '<em>$1</em>');
        text = text.replace(/\n/g, '<br>');
        return text;
    }

    vscode.postMessage({ type: 'getApiKeyStatus' });

    sendBtn.addEventListener('click', () => {
        const text = input.value.trim();
        if (!text) return;

        sendBtn.disabled = true;

        addMessage('user', text);
        addMessage('assistant', 'Thinking...', true);

        const payload = {
            type: 'userPrompt',
            text
        };

        if (attachedFile && attachedFile.path) {
            payload.attachedFile = attachedFile;
        }

        vscode.postMessage(payload);
        input.value = '';
    });

    clearBtn.addEventListener('click', () => {
        vscode.postMessage({
            type: 'clearChat'
        });
    });

    saveKeyBtn.addEventListener('click', () => {
        const key = apiKeyInput.value.trim();

        if (!key) {
            keyStatus.textContent = 'Please enter an API key.';
            return;
        }

        const provider = providerSelect.value;

        if (!provider) {
            keyStatus.textContent = 'Please select an LLM Provider.';
            return;
        }

        vscode.postMessage({
            type: 'saveApiKey',
            key,
            provider
        });
    });

    removeKeyBtn.addEventListener('click', () => {
        vscode.postMessage({
            type: 'removeApiKey'
        });
    });

    function addMessage(role, text, isTemporary = false) {
        const div = document.createElement('div');
        div.className = 'message ' + role;

        if (isTemporary) {
            div.classList.add('thinking');
            div.dataset.temp = 'true';
            div.innerText = text;
        } else if (role === 'assistant') {
            div.innerHTML = renderMarkdown(text);
        } else {
            div.innerText = text;
        }

        chat.appendChild(div);
        chat.scrollTop = chat.scrollHeight;
    }

    attachFileBtn.addEventListener('click', () => {
        vscode.postMessage({ type: 'pickFile' });
    });

    removeFileBtn.addEventListener('click', () => {
        attachedFile = null;
        attachedFileName.textContent = '';
        removeFileBtn.style.display = 'none';

        vscode.postMessage({
            type: 'removeAttachedFile'
        });
    });

    window.addEventListener('message', (event) => {
        const message = event.data;

        if (message.type === 'apiKeyStatus') {
            if (message.hasKey) {
                const providerLabel = message.provider
                    ? `${message.provider} API key saved!`
                    : 'API key saved!';

                keyStatus.textContent = providerLabel;
                apiKeyInput.value = '';
                setChatEnabled(true);
            } else {
                keyStatus.textContent = 'No API key has been set!';
                setChatEnabled(false);
            }
            return;
        }

        if (message.type === 'apiKeySaved') {
            const providerLabel = message.provider
                ? `${message.provider} API Key saved!`
                : 'API key saved!';

            keyStatus.textContent = providerLabel;
            apiKeyInput.value = '';
            providerSelect.value = '';
            setChatEnabled(true);
            return;
        }

        if (message.type === 'apiKeyInvalid') {
            keyStatus.textContent = message.error || 'Invalid API Key.';
            setChatEnabled(false);
            return;
        }

        if (message.type === 'apiKeyRemoved') {
            keyStatus.textContent = 'API key removed.';
            apiKeyInput.value = '';
            providerSelect.value = '';
            setChatEnabled(false);
            return;
        }

        if (message.type === 'filePicked') {
            attachedFile = message.file;
            if (attachedFileName) {
                attachedFileName.textContent = `Attached: ${message.file.name}`;
            }
            removeFileBtn.style.display = 'inline-block';
            return;
        }

        if (message.type === 'assistantResponse') {
            sendBtn.disabled = false;
            const temp = chat.querySelector('.message.thinking');
            if (temp) {
                temp.remove();
            }

            addMessage('assistant', message.text);
        }

        if (message.type === 'chatCleared') {
            chat.innerHTML = '';
            return;
        }
    });
});