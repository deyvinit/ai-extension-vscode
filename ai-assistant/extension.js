const vscode = require('vscode');

async function callGemini(prompt, apiKey) {

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

    webviewView.webview.html = getHtml(webviewView.webview, this.context);

    webviewView.webview.onDidReceiveMessage(async (message) => {
      switch (message.type) {
        case 'getApiKeyStatus': {
          const apiKey = await this.context.secrets.get('geminiApiKey');
          webviewView.webview.postMessage({
            type: 'apiKeyStatus',
            hasKey: Boolean(apiKey)
          });
          return;
        }

        case 'saveApiKey': {
          try {
            await callGemini('Say OK', message.key);
            await this.context.secrets.store('geminiApiKey', message.key);

            webviewView.webview.postMessage({
              type: 'apiKeySaved'
            });
          } catch (err) {
            console.error('API key validation failed: ', err.message);

            webviewView.webview.postMessage({
              type: 'apiKeyInvalid',
              error: 'Invalid API key. Please check and try again.'
            });
          }
          return;
        }

        case 'removeApiKey': {
          await this.context.secrets.delete('geminiApiKey');
          webviewView.webview.postMessage({
            type: 'apiKeyRemoved'
          });
          return;
        }

        case 'userPrompt':
          break;

        default:
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

      const apiKey = await this.context.secrets.get('geminiApiKey');

      if (!apiKey) {
        webviewView.webview.postMessage({
          type: 'assistantResponse',
          text: 'No API key set. Please add your Gemini API key.'
        });
        return;
      }

      try {
        const aiResponse = await callGemini(finalPrompt, apiKey);
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
}

function getHtml(webview, context) {
  const fs = require('fs');

  const htmlPath = vscode.Uri.joinPath(context.extensionUri, 'media', 'index.html');
  const cssPath = vscode.Uri.joinPath(context.extensionUri, 'media', 'styles.css');
  const jsPath = vscode.Uri.joinPath(context.extensionUri, 'media', 'script.js');

  const cssUri = webview.asWebviewUri(cssPath);
  const jsUri = webview.asWebviewUri(jsPath);

  let html = fs.readFileSync(htmlPath.fsPath, 'utf8');

  html = html
    .replace('{{STYLE_URI}}', cssUri)
    .replace('{{SCRIPT_URI}}', jsUri);

  return html;
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