const vscode = acquireVsCodeApi();

window.addEventListener('DOMContentLoaded', () => {
    const chat = document.getElementById('chat');
    const sendBtn = document.getElementById('send');
    const input = document.getElementById('prompt');

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

    function addMessage(role, text) {
        const div = document.createElement('div');
        div.className = 'message ' + role;
        div.innerText = (role === 'user' ? 'You' : 'AI') + ': ' + text;
        chat.appendChild(div);
        chat.scrollTop = chat.scrollHeight;
    }

    window.addEventListener('message', (event) => {
        const message = event.data;

        if (message.type === 'assistantResponse') {
            addMessage('assistant', message.text);
        }
    });
});