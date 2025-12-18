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

    webviewView.webview.html = getHtml(webviewView.webview, this.context);

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