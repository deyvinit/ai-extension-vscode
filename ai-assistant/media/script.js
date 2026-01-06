const vscode = acquireVsCodeApi();

window.addEventListener('DOMContentLoaded', () => {
    const chat = document.getElementById('chat');
    const sendBtn = document.getElementById('send');
    const stopBtn = document.getElementById('stop');
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
    let currentAssistantBubble = null;
    let attachedFile = null;
    removeFileBtn.style.display = 'none';

    function setChatEnabled(enabled) {
        chatSection.style.opacity = enabled ? '1' : '0.5';
        sendBtn.disabled = !enabled;
        input.disabled = !enabled;
    }

    setChatEnabled(false);

    function renderMarkdown(text) {
        const codeBlocks = [];

        text = text.replace(/```(\w+)?\n?([\s\S]*?)```/g, (match, lang, code) => {
            const placeholder = `__CODE_BLOCK_${codeBlocks.length}__`;
            codeBlocks.push({ code: code.trim(), lang: lang || '' });
            return placeholder;
        });

        text = text.replace(/`([^`]+)`/g, '<code>$1</code>');
        text = text.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
        text = text.replace(/\*(.*?)\*/g, '<em>$1</em>');
        text = text.replace(/\n/g, '<br>');

        codeBlocks.forEach((block, index) => {
            const placeholder = `__CODE_BLOCK_${index}__`;
            const escapedCode = block.code
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;');

            text = text.replace(
                placeholder,
                `<div class="code-block-wrapper" data-lang="${block.lang}" data-code="${encodeURIComponent(block.code)}"><pre><code>${escapedCode}</code></pre></div>`
            );
        });

        return text;
    }

    function enhanceCodeBlocks(container) {
        const codeWrappers = container.querySelectorAll('.code-block-wrapper');

        codeWrappers.forEach(wrapper => {
            if (wrapper.querySelector('.code-block-header')) return;

            const lang = wrapper.dataset.lang || 'code';
            const code = decodeURIComponent(wrapper.dataset.code);

            const header = document.createElement('div');
            header.className = 'code-block-header';

            const langLabel = document.createElement('span');
            langLabel.className = 'code-language';
            langLabel.textContent = lang;

            const copyBtn = document.createElement('button');
            copyBtn.className = 'copy-code-btn';
            copyBtn.innerHTML = '<span class="copy-text">Copy</span>';

            copyBtn.addEventListener('click', async () => {
                try {
                    await navigator.clipboard.writeText(code);

                    const copyText = copyBtn.querySelector('.copy-text');

                    copyText.textContent = 'Copied!';
                    copyBtn.classList.add('copied');

                    setTimeout(() => {
                        copyText.textContent = 'Copy';
                        copyBtn.classList.remove('copied');
                    }, 2000);
                } catch (err) {
                    console.error('Failed to copy:', err);
                }
            });

            header.appendChild(langLabel);
            header.appendChild(copyBtn);
            wrapper.insertBefore(header, wrapper.firstChild);

            const codeElement = wrapper.querySelector('code');
            if (codeElement && window.hljs) {
                if (lang && lang !== 'code') {
                    codeElement.className = `language-${lang}`;
                }

                window.hljs.highlightElement(codeElement);
            }
        });
    }

    function addMessageControls(bubble) {
        const controlsDiv = document.createElement('div');
        controlsDiv.className = 'message-controls';

        const versionCount = parseInt(bubble.dataset.versionCount) || 1;
        const currentVersion = parseInt(bubble.dataset.currentVersion) || 1;

        if (versionCount > 1) {
            const versionNav = document.createElement('div');
            versionNav.className = 'version-navigator';

            const prevBtn = document.createElement('button');
            prevBtn.className = 'version-btn';
            prevBtn.innerHTML = '<';
            prevBtn.disabled = currentVersion === 1;
            prevBtn.onclick = () => switchVersion(bubble, currentVersion - 1);

            const versionLabel = document.createElement('span');
            versionLabel.className = 'version-label';
            versionLabel.textContent = `${currentVersion}/${versionCount}`;

            const nextBtn = document.createElement('button');
            nextBtn.className = 'version-btn';
            nextBtn.innerHTML = '>';
            nextBtn.disabled = currentVersion === versionCount;
            nextBtn.onclick = () => switchVersion(bubble, currentVersion + 1);

            versionNav.appendChild(prevBtn);
            versionNav.appendChild(versionLabel);
            versionNav.appendChild(nextBtn);
            controlsDiv.appendChild(versionNav);
        }

        const regenBtn = document.createElement('button');
        regenBtn.className = 'regen-btn-inline';
        regenBtn.textContent = '⟳';
        regenBtn.onclick = () => {
            const conversationIndex = parseInt(bubble.dataset.conversationIndex);
            if (isNaN(conversationIndex)) {
                console.error('Invalid conversation index');
                return;
            }
            const allMessages = Array.from(chat.querySelectorAll('.message'));
            const currentMessageIndex = allMessages.indexOf(bubble);

            for (let i = currentMessageIndex; i < allMessages.length; i++) {
                allMessages[i].remove();
            }

            addMessage('assistant', 'Regenerating...', true);
            stopBtn.style.display = 'inline-block';
            sendBtn.disabled = true;

            vscode.postMessage({
                type: 'regenerateAt',
                conversationIndex: conversationIndex
            });
        };

        controlsDiv.appendChild(regenBtn);
        bubble.appendChild(controlsDiv);
    }

    function switchVersion(bubble, newVersion) {
        const conversationIndex = parseInt(bubble.dataset.conversationIndex);
        if (isNaN(conversationIndex)) return;

        vscode.postMessage({
            type: 'switchVersion',
            conversationIndex: conversationIndex,
            versionIndex: newVersion - 1
        });
    }

    vscode.postMessage({ type: 'getApiKeyStatus' });

    sendBtn.addEventListener('click', () => {
        delete chat.dataset.isRegenerating;

        const text = input.value.trim();
        if (!text) return;

        sendBtn.disabled = true;
        stopBtn.style.display = 'inline-block';

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

    stopBtn.addEventListener('click', () => {
        console.log(`[UI] Stop button clicked`)
        vscode.postMessage({ type: 'stop-generation' });

        const temp = chat.querySelector('.message.thinking');
        if (temp) temp.remove();

        if (currentAssistantBubble) {
            const stoppedMsg = document.createElement('em');
            stoppedMsg.textContent = ` [Stopped]`;
            stoppedMsg.style.color = '#888';
            currentAssistantBubble.appendChild(stoppedMsg);
            currentAssistantBubble = null;
        }

        sendBtn.disabled = false;
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

        if (message.type === 'assistantChunk') {
            const temp = chat.querySelector('.message.thinking');
            if (temp) temp.remove();

            if (!currentAssistantBubble || currentAssistantBubble.dataset.conversationIndex !== String(message.conversationIndex)) {
                currentAssistantBubble = document.createElement('div');
                currentAssistantBubble.className = 'message assistant';
                currentAssistantBubble.dataset.rawText = '';

                if (message.conversationIndex !== undefined) {
                    currentAssistantBubble.dataset.conversationIndex = message.conversationIndex;
                }

                chat.appendChild(currentAssistantBubble);
            }

            currentAssistantBubble.dataset.rawText += message.text;

            currentAssistantBubble.textContent = currentAssistantBubble.dataset.rawText;
            currentAssistantBubble.style.whiteSpace = 'pre-wrap';

            chat.scrollTop = chat.scrollHeight;
            return;
        }

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

        if (message.type === 'streamComplete') {
            sendBtn.disabled = false;
            stopBtn.style.display = 'none';

            const temp = chat.querySelector('.message.thinking');
            if (temp) {
                temp.remove();
            }

            if (currentAssistantBubble) {
                const fullText = currentAssistantBubble.dataset.rawText || currentAssistantBubble.textContent;
                currentAssistantBubble.style.whiteSpace = '';
                currentAssistantBubble.innerHTML = renderMarkdown(fullText);
                delete currentAssistantBubble.dataset.rawText;

                if (message.versionInfo) {
                    currentAssistantBubble.dataset.versionCount = message.versionInfo.total;
                    currentAssistantBubble.dataset.currentVersion = message.versionInfo.current;
                }

                if (message.conversationIndex !== undefined) {
                    currentAssistantBubble.dataset.conversationIndex = message.conversationIndex;
                }

                enhanceCodeBlocks(currentAssistantBubble);
                addMessageControls(currentAssistantBubble);
            }

            currentAssistantBubble = null;
            return;
        }

        if (message.type === 'assistantResponse') {
            sendBtn.disabled = false;
            stopBtn.style.display = 'none';

            const temp = chat.querySelector('.message.thinking');
            if (temp) {
                temp.remove();
            }

            if (!currentAssistantBubble) {
                const div = document.createElement('div');
                div.className = 'message assistant';
                div.innerHTML = renderMarkdown(message.text);

                if (message.conversationIndex !== undefined) {
                    div.dataset.conversationIndex = message.conversationIndex;
                }

                chat.appendChild(div);
                enhanceCodeBlocks(div);
                addMessageControls(div);
            }

            currentAssistantBubble = null;
            return;
        }

        if (message.type === 'versionSwitched') {
            const conversationIndex = message.conversationIndex;
            const messages = chat.querySelectorAll('.message.assistant');
            let targetBubble = null;

            messages.forEach(bubble => {
                if (parseInt(bubble.dataset.conversationIndex) === conversationIndex) {
                    targetBubble = bubble;
                }
            });

            if (targetBubble) {
                targetBubble.dataset.currentVersion = message.versionInfo.current;
                targetBubble.dataset.versionCount = message.versionInfo.total;

                const oldControls = targetBubble.querySelector('.message-controls');
                if (oldControls) oldControls.remove();

                targetBubble.innerHTML = renderMarkdown(message.content);
                enhanceCodeBlocks(targetBubble);
                addMessageControls(targetBubble);
            }

            return;
        }

        if (message.type === 'chatCleared') {
            chat.innerHTML = '';
            currentAssistantBubble = null;
            attachedFile = null;
            attachedFileName.textContent = '';
            removeFileBtn.style.display = 'none';
            conversationIndexCounter = 0;
            return;
        }
    });
});