const vscode = acquireVsCodeApi();

let currentChatId = null;
let chats = [];
let currentAssistantBubble = null;
let attachedFile = null;

window.addEventListener('DOMContentLoaded', () => {
    const chat = document.getElementById('chat');
    const sendBtn = document.getElementById('send');
    const stopBtn = document.getElementById('stop');
    const clearBtn = document.getElementById('clear-chat');
    const input = document.getElementById('prompt');
    const openSettingsBtn = document.getElementById('openSettings');
    const closeSettingsBtn = document.getElementById('closeSettings');
    const settingsOverlay = document.getElementById('settings-overlay');
    const apiKeyInput = document.getElementById('apiKeyInput');
    const saveKeyBtn = document.getElementById('saveKeyBtn');
    const removeKeyBtn = document.getElementById('removeKeyBtn');
    const keyStatus = document.getElementById('keyStatus');
    const attachFileBtn = document.getElementById('attachFileBtn');
    const attachedFileName = document.getElementById('attachedFileName');
    const removeFileBtn = document.getElementById('removeFileBtn');
    const providerSelect = document.getElementById('providerSelect');
    const currentChatTitle = document.getElementById('currentChatTitle');
    const renameChatBtn = document.getElementById('renameChatBtn');
    const newChatBtn = document.getElementById('newChatBtn');
    const chatList = document.getElementById('chatList');
    const chatSearchInput = document.getElementById('chatSearchInput');

    removeFileBtn.style.display = 'none';

    vscode.postMessage({ type: 'getApiKeyStatus' });
    vscode.postMessage({ type: 'loadChats' });

    openSettingsBtn.addEventListener('click', () => {
        settingsOverlay.style.display = 'flex';
    });

    closeSettingsBtn.addEventListener('click', () => {
        settingsOverlay.style.display = 'none';
    });

    settingsOverlay.addEventListener('click', (e) => {
        if (e.target === settingsOverlay) {
            settingsOverlay.style.display = 'none';
        }
    });

    function clearButtonVisibility() {
        const hasMessages = chat.children.length > 0;
        clearBtn.style.display = hasMessages ? 'inline-block' : 'none';
    }

    function createNewChat() {
        vscode.postMessage({ type: 'createNewChat' });
    }

    function switchToChat(chatId) {
        vscode.postMessage({
            type: 'switchChat',
            chatId: chatId
        });
    }

    function deleteChat(chatId, event) {
        console.log('Delete button clicked for chatId:', chatId);
        event.stopPropagation();
        vscode.postMessage({
            type: 'requestDeleteConfirmation',
            chatId: chatId
        });
    }

    function pinChat(chatId, event) {
        console.log('Pin button clicked for chatId:', chatId);
        event.stopPropagation();
        vscode.postMessage({
            type: 'pinChat',
            chatId: chatId
        });
    }

    function renameChat() {
        console.log('Rename button clicked, currentChatId:', currentChatId);

        if (!currentChatId) {
            const tempMsg = document.createElement('div');
            tempMsg.className = 'message assistant';
            tempMsg.textContent = 'No active chat to rename. Please create or select a chat first.';
            chat.appendChild(tempMsg);
            setTimeout(() => tempMsg.remove(), 3000);
            return;
        }

        const currentTitle = currentChatTitle.textContent;

        const input = document.createElement('input');
        input.type = 'text';
        input.value = currentTitle;
        input.style.cssText = `
            background-color: #2d2d2d;
            color: #ffffff;
            border: 1px solid #0e639c;
            border-radius: 4px;
            padding: 4px 8px;
            font-size: 14px;
            width: 200px;
            outline: none;
        `;

        currentChatTitle.style.display = 'none';
        currentChatTitle.parentNode.insertBefore(input, currentChatTitle);
        input.focus();
        input.select();

        const finishRename = () => {
            const newTitle = input.value.trim();
            input.remove();
            currentChatTitle.style.display = 'block';

            if (newTitle && newTitle !== currentTitle) {
                console.log('Sending rename request for chatId:', currentChatId, 'New title:', newTitle);
                vscode.postMessage({
                    type: 'renameChat',
                    chatId: currentChatId,
                    title: newTitle
                });
            }
        };

        input.addEventListener('blur', finishRename);
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                finishRename();
            } else if (e.key === 'Escape') {
                input.value = currentTitle;
                finishRename();
            }
        });
    }

    function renderChatList(chatData, searchTerm = '') {
        const filteredChats = searchTerm
            ? chatData.filter(chat =>
                chat.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
                chat.preview?.toLowerCase().includes(searchTerm.toLowerCase())
            )
            : chatData;

        const chatCount = document.querySelector('.chat-count');
        chatCount.textContent = `${filteredChats.length} chat${filteredChats.length !== 1 ? 's' : ''}`;

        if (filteredChats.length === 0) {
            chatList.innerHTML = '<div class="empty-chat-list">No chats found</div>';
            return;
        }

        chatList.innerHTML = filteredChats.map(chat => {
            const isActive = chat.id === currentChatId;
            const isPinned = chat.isPinned;
            const date = new Date(chat.lastModified).toLocaleDateString();
            const time = new Date(chat.lastModified).toLocaleTimeString([], {
                hour: '2-digit',
                minute: '2-digit'
            });

            return `
                <div class="chat-item ${isActive ? 'active' : ''} ${isPinned ? 'pinned' : ''}"
                     data-chat-id="${chat.id}">
                    <div class="chat-item-content">
                        <div class="chat-item-title">${escapeHtml(chat.title)}</div>
                        ${chat.preview ? `<div class="chat-item-preview">${escapeHtml(chat.preview)}</div>` : ''}
                        <div class="chat-item-meta">
                            <span>${date} ${time}</span>
                            ${chat.messageCount ? `<span>• ${chat.messageCount} messages</span>` : ''}
                        </div>
                    </div>
                    <div class="chat-item-actions">
                        <button class="chat-action-btn pin-btn" data-chat-id="${chat.id}" title="${isPinned ? 'Unpin' : 'Pin'}"></button>
                        <button class="chat-action-btn delete-btn" data-chat-id="${chat.id}" title="Delete"></button>
                    </div>
                </div>
            `;
        }).join('');

        chatList.querySelectorAll('.chat-item').forEach(item => {
            const chatId = item.dataset.chatId;
            item.addEventListener('click', (e) => {
                if (!e.target.closest('.chat-item-actions')) {
                    switchToChat(chatId);
                }
            });
        });

        chatList.querySelectorAll('.pin-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                pinChat(btn.dataset.chatId, e);
            });
        });

        chatList.querySelectorAll('.delete-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                deleteChat(btn.dataset.chatId, e);
            });
        });
    }

    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    function renderChat(messages) {
        chat.innerHTML = '';

        messages.forEach((msg, index) => {
            if (msg.role === 'user') {
                addMessage('user', msg.content);
            } else if (msg.role === 'assistant') {
                const div = document.createElement('div');
                div.className = 'message assistant';
                div.innerHTML = renderMarkdown(msg.versions[msg.activeVersionIndex].content);

                if (msg.versions) {
                    div.dataset.versionCount = msg.versions.length;
                    div.dataset.currentVersion = msg.activeVersionIndex + 1;
                }
                div.dataset.conversationIndex = index;

                chat.appendChild(div);
                enhanceCodeBlocks(div);
                addMessageControls(div);
            }
        });

        chat.scrollTop = chat.scrollHeight;
        clearButtonVisibility();
    }

    newChatBtn.addEventListener('click', createNewChat);
    renameChatBtn.addEventListener('click', renameChat);

    chatSearchInput.addEventListener('input', (e) => {
        renderChatList(chats, e.target.value);
    });

    sendBtn.addEventListener('click', () => {
        const text = input.value.trim();
        if (!text) return;

        sendBtn.disabled = true;
        stopBtn.style.display = 'inline-block';

        addMessage('user', text);
        addMessage('assistant', 'Thinking...', true);

        const payload = {
            type: 'userPrompt',
            text,
            chatId: currentChatId
        };

        if (attachedFile && attachedFile.path) {
            payload.attachedFile = attachedFile;
        }

        vscode.postMessage(payload);
        input.value = '';
    });

    stopBtn.addEventListener('click', () => {
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
        stopBtn.style.display = 'none';
    });

    clearBtn.addEventListener('click', () => {
        vscode.postMessage({
            type: 'requestClearConfirmation',
            chatId: currentChatId
        });
    });

    saveKeyBtn.addEventListener('click', () => {
        const key = apiKeyInput.value.trim();
        const provider = providerSelect.value;

        if (!key) {
            keyStatus.textContent = 'Please enter an API key.';
            return;
        }

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
        vscode.postMessage({ type: 'removeApiKey' });
    });

    attachFileBtn.addEventListener('click', () => {
        vscode.postMessage({ type: 'pickFile' });
    });

    removeFileBtn.addEventListener('click', () => {
        attachedFile = null;
        attachedFileName.textContent = '';
        removeFileBtn.style.display = 'none';
    });

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
            if (isNaN(conversationIndex)) return;

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
                conversationIndex: conversationIndex,
                chatId: currentChatId
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
            versionIndex: newVersion - 1,
            chatId: currentChatId
        });
    }

    function addMessage(role, text, isTemporary = false) {
        const div = document.createElement('div');
        div.className = 'message ' + role;

        if (isTemporary) {
            div.classList.add('thinking');
            div.dataset.temp = 'true';
        }

        div.innerText = text;
        chat.appendChild(div);
        chat.scrollTop = chat.scrollHeight;
        clearButtonVisibility();
    }

    window.addEventListener('message', (event) => {
        const message = event.data;

        switch (message.type) {
            case 'chatsLoaded':
                chats = message.chats;
                renderChatList(chats);
                break;

            case 'chatCreated':
                currentChatId = message.chat.id;
                chats.unshift(message.chat);
                renderChatList(chats);
                currentChatTitle.textContent = message.chat.title;
                const existingMessages = chat.querySelectorAll('.message');
                if (existingMessages.length === 0) {
                    renderChat(message.conversation || []);
                }
                settingsOverlay.style.display = 'none';
                break;

            case 'chatSwitched':
                currentChatId = message.chatId;
                currentChatTitle.textContent = message.title;
                renderChat(message.conversation);
                renderChatList(chats);
                settingsOverlay.style.display = 'none';
                break;

            case 'chatDeleted':
                chats = chats.filter(c => c.id !== message.chatId);
                renderChatList(chats);
                if (message.chatId === currentChatId) {
                    chat.innerHTML = '';
                    currentChatTitle.textContent = 'New Chat';
                    currentChatId = null;
                }
                break;

            case 'chatRenamed':
                const renamedChat = chats.find(c => c.id === message.chatId);
                if (renamedChat) {
                    renamedChat.title = message.title;
                    renderChatList(chats);
                }
                if (message.chatId === currentChatId) {
                    currentChatTitle.textContent = message.title;
                }
                break;

            case 'chatPinned':
                const pinnedChat = chats.find(c => c.id === message.chatId);
                if (pinnedChat) {
                    pinnedChat.isPinned = message.isPinned;
                    chats.sort((a, b) => {
                        if (a.isPinned && !b.isPinned) return -1;
                        if (!a.isPinned && b.isPinned) return 1;
                        return b.lastModified - a.lastModified;
                    });
                    renderChatList(chats);
                }
                break;

            case 'assistantChunk':
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
                break;

            case 'streamComplete':
                sendBtn.disabled = false;
                stopBtn.style.display = 'none';

                const thinkingMsg = chat.querySelector('.message.thinking');
                if (thinkingMsg) thinkingMsg.remove();

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

                vscode.postMessage({ type: 'loadChats' });
                break;

            case 'assistantResponse':
                sendBtn.disabled = false;
                stopBtn.style.display = 'none';

                const tempMsg = chat.querySelector('.message.thinking');
                if (tempMsg) tempMsg.remove();

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
                break;

            case 'versionSwitched':
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
                break;

            case 'chatCleared':
                chat.innerHTML = '';
                clearButtonVisibility();
                currentAssistantBubble = null;
                attachedFile = null;
                attachedFileName.textContent = '';
                removeFileBtn.style.display = 'none';
                vscode.postMessage({ type: 'loadChats' });
                break;

            case 'apiKeyStatus':
                if (message.hasKey) {
                    const providerLabel = message.provider
                        ? `${message.provider} API key saved!`
                        : 'API key saved!';
                    keyStatus.textContent = providerLabel;
                    apiKeyInput.value = '';
                    sendBtn.disabled = false;
                } else {
                    keyStatus.textContent = 'No API key set';
                    sendBtn.disabled = true;
                }
                break;

            case 'apiKeySaved':
                const providerLabel = message.provider
                    ? `${message.provider} API Key saved!`
                    : 'API key saved!';
                keyStatus.textContent = providerLabel;
                apiKeyInput.value = '';
                providerSelect.value = '';
                sendBtn.disabled = false;
                break;

            case 'apiKeyInvalid':
                keyStatus.textContent = message.error || 'Invalid API Key.';
                break;

            case 'apiKeyRemoved':
                keyStatus.textContent = 'API key removed.';
                apiKeyInput.value = '';
                providerSelect.value = '';
                sendBtn.disabled = true;
                break;

            case 'filePicked':
                attachedFile = message.file;
                attachedFileName.textContent = `Attached: ${message.file.name}`;
                removeFileBtn.style.display = 'inline-block';
                break;
        }
    });

    clearButtonVisibility();
});