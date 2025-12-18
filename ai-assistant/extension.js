const vscode = require('vscode');

async function callGemini(prompt) {
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not set');
  }

  const response = await fetch(
    'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey
      },
      body: JSON.stringify({
        contents: [
          {
            parts: [{ text: prompt }]
          }
        ]
      })
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    const error = new Error(
      `Gemini API error: ${response.status}\nResponse body: ${errorText}`
    );
    console.error(error);
    throw error;
  }

  const data = await response.json();

  const candidate = data.candidates?.[0];

  return (
    candidate?.content?.parts?.[0]?.text ||
    candidate?.content?.text ||
    candidate?.output_text ||
    'No response from Gemini'
  );
}
class AIAssistantViewProvider {
  static viewType = 'aiAssistant.sidebar';

  constructor(context) {
    this.context = context;
  }

  resolveWebviewView(webviewView) {
    webviewView.webview.options = {
      enableScripts: true
    };

    webviewView.webview.html = this.getHtml();

    webviewView.webview.onDidReceiveMessage(async (message) => {
      if (message.type !== 'userPrompt') {
        return;
      }

      const editor = vscode.window.activeTextEditor;
      let selectedText = '';

      if (editor) {
        const selection = editor.selection;

        if (!selection.isEmpty) {
          selectedText = editor.document.getText(selection);
        }
      }

      let finalPrompt = message.text;

      if (selectedText.trim()) {
        finalPrompt = `Context:\n${selectedText}\n\nUser prompt:\n${message.text}`;
      }

      console.log('Selected text: ', selectedText);
      console.log('Final prompt sent to Gemini:\n', finalPrompt);

      try {
        const aiResponse = await callGemini(finalPrompt);
        webviewView.webview.postMessage({
          type: 'assistantResponse',
          text: aiResponse
        });
      } catch (error) {
        webviewView.webview.postMessage({
          type: 'assistantResponse',
          text: 'Error: ' + error.message
        });
      }
    });
  }

  getHtml() {
    return `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>AI Assistant</title>
        <style>
          body {
            font-family: sans-serif;
            padding: 10px;
          }
          h2 {
            margin-top: 0;
          }
          textarea {
            width: 100%;
            height: 80px;
            resize: vertical;
          }
          button {
            margin-top: 8px;
            padding: 6px 10px;
            cursor: pointer;
          }
          #chat {
            margin-top: 12px;
          }
          .message {
            margin-bottom: 8px;
            padding: 6px 8px;
            border-radius: 4px;
          }
          .message.user {
            background-color: #e0f0ff;
            font-weight: 500;
          }
          .message.assistant {
            background-color: #f4f4f4;
          }
        </style>
      </head>
      <body>
        <h2>AI Assistant</h2>
        <textarea id="prompt" placeholder="Ask something..."></textarea>
        <button id="send">Send</button>
        <div id="chat"></div>

        <script>
          const vscode = acquireVsCodeApi();

          document.getElementById('send').addEventListener('click', () => {
            const input = document.getElementById('prompt');
            const text = input.value.trim();

            if (!text) return;

            addMessage('user', text);

            vscode.postMessage({
              type: 'userPrompt',
              text
            });

            input.value = '';
          });

          const chat = document.getElementById('chat');

          function addMessage(role, text) {
            const div = document.createElement('div');
            div.className = 'message ' + role;
            div.innerText = (role === 'user' ? 'You' : 'AI') + ': ' + text;
            chat.appendChild(div);
          }

          window.addEventListener('message', (event) => {
            const message = event.data;

            if (message.type === 'assistantResponse') {
              addMessage('assistant', message.text);
            }
          });
        </script>
      </body>
      </html>
    `;
  }
}

function activate(context) {
  const provider = new AIAssistantViewProvider(context);

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      AIAssistantViewProvider.viewType,
      provider
    )
  );

  console.log('AI Assistant sidebar activated');
}

function deactivate() { }

module.exports = {
  activate,
  deactivate
};