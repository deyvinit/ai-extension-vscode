const vscode = acquireVsCodeApi();

window.addEventListener('DOMContentLoaded', () => {
    const chat = document.getElementById('chat');
    const sendBtn = document.getElementById('send');
    const input = document.getElementById('prompt');
    const chatSection = document.getElementById('chat-section');
    const apiKeyInput = document.getElementById('apiKeyInput');
    const saveKeyBtn = document.getElementById('saveKeyBtn');
    const removeKeyBtn = document.getElementById('removeKeyBtn');
    const keyStatus = document.getElementById('keyStatus');

    function setChatEnabled(enabled) {
        chatSection.style.opacity = enabled ? '1' : '0.5';
        sendBtn.disabled = !enabled;
        input.disabled = !enabled;
    }

    setChatEnabled(false);

    vscode.postMessage({ type: 'getApiKeyStatus' });

    sendBtn.addEventListener('click', () => {
        const text = input.value.trim();
        if (!text) return;

        addMessage('user', text);

        vscode.postMessage({
            type: 'userPrompt',
            text
        });

        input.value = '';
    });

    saveKeyBtn.addEventListener('click', () => {
        const key = apiKeyInput.value.trim();

        if (!key) {
            keyStatus.textContent = 'Please enter an API key.';
            return;
        }

        vscode.postMessage({
            type: 'saveApiKey',
            key
        });
    });

    removeKeyBtn.addEventListener('click', () => {
        vscode.postMessage({
            type: 'removeApiKey'
        });
    });

    function addMessage(role, text) {
        const div = document.createElement('div');
        div.className = 'message ' + role;
        div.innerText = (role === 'user' ? 'You' : 'AI') + ': ' + text;
        chat.appendChild(div);
        chat.scrollTop = chat.scrollHeight;
    }

    window.addEventListener('message', (event) => {
        const message = event.data;

        if (message.type === 'apiKeyStatus') {
            if (message.hasKey) {
                keyStatus.textContent = 'API key saved!';
                apiKeyInput.value = '';
                setChatEnabled(true);
            } else {
                keyStatus.textContent = 'No API key has been set!';
                setChatEnabled(false);
            }
            return;
        }

        if (message.type === 'apiKeySaved') {
            keyStatus.textContent = 'API key saved!';
            apiKeyInput.value = '';
            setChatEnabled(true);
            return;
        }

        if (message.type === 'apiKeyRemoved') {
            keyStatus.textContent = 'API key removed.';
            apiKeyInput.value = '';
            setChatEnabled(false);
            return;
        }

        if (message.type === 'assistantResponse') {
            addMessage('assistant', message.text);
        }
    });
});