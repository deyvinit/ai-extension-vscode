const vscode = require('vscode');

const getSelectedTextFunction = {
  name: 'get_selected_text',
  description: 'Returns the currently selected text in the acitve VS Code editor.',
  parameters: {
    type: 'object',
    properties: {},
    required: []
  }
};

const tools = [
  {
    functionDeclarations: [getSelectedTextFunction]
  }
];

let conversation = [];

async function callGemini(contents, apiKey, tools = []) {

  const response = await fetch(
    'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey
      },
      body: JSON.stringify({
        contents,
        tools
      })
    }
  );

  if (!response.ok) {
    if (response.status === 503) {
      throw new Error('SERVICE_OVERLOADED');
    }

    if (response.status === 429) {
      throw new Error('QUOTA_EXCEEDED');
    }

    const errorText = await response.text();
    throw new Error(`Gemini API error: ${response.status}\n${errorText}`);
  }

  const data = await response.json();

  const parts = data.candidates?.[0]?.content?.parts || [];

  console.log(
    'Gemini response parts: ',
    JSON.stringify(parts, null, 2)
  );

  const functionCallPart = parts.find(p => p.functionCall);

  console.log('Detected functionCallPart: ', functionCallPart);

  if (functionCallPart) {
    const functionName = functionCallPart.functionCall.name;

    if (functionName === 'get_selected_text') {
      const editor = vscode.window.activeTextEditor;
      const selectedText =
        editor && !editor.selection.isEmpty
          ? editor.document.getText(editor.selection)
          : '';

      console.log('Executing tool: get_selected_text');
      console.log('Tool result: ', selectedText);

      const followUpContents = [
        ...contents,
        data.candidates[0].content,
        {
          role: 'user',
          parts: [
            {
              functionResponse: {
                name: 'get_selected_text',
                response: { text: selectedText }
              }
            }
          ]
        }
      ];

      const finalResponse = await callGemini(
        followUpContents,
        apiKey,
        [
          {
            functionDeclarations: [getSelectedTextFunction]
          }
        ]
      );

      return finalResponse;
    }
  }

  console.log(
    'Function calls from Gemini:',
    data.candidates?.[0]?.content?.parts?.filter(p => p.functionCall)
  );

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
            await callGemini(
              [{ role: 'user', parts: [{ text: 'Say OK' }] }],
              message.key
            );
            await this.context.secrets.store('geminiApiKey', message.key);

            webviewView.webview.postMessage({
              type: 'apiKeySaved'
            });
          } catch (err) {
            console.error('API key validation failed:', err.message);

            if (err.message === 'SERVICE_OVERLOADED') {
              webviewView.webview.postMessage({
                type: 'apiKeyInvalid',
                error: 'Gemini service is temporarily overloaded. Please try again later.'
              });
            } else if (err.message === 'QUOTA_EXCEEDED') {
              webviewView.webview.postMessage({
                type: 'apiKeyInvalid',
                error: 'API quota exceeded. Please wait or upgrade your plan.'
              });
            } else {
              webviewView.webview.postMessage({
                type: 'apiKeyInvalid',
                error: 'Invalid API key. Please check and try again.'
              });
            }
          }
          return;
        }

        case 'removeApiKey': {
          conversation = [];
          await this.context.secrets.delete('geminiApiKey');
          webviewView.webview.postMessage({
            type: 'apiKeyRemoved'
          });
          return;
        }

        case 'clearChat': {
          conversation = [];

          webviewView.webview.postMessage({
            type: 'chatCleared'
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

      const finalPrompt = message.text;

      conversation.push({
        role: 'user',
        content: finalPrompt
      });

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
        const geminiContents = conversation.map(turn => ({
          role: turn.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: turn.content }]
        }));

        const aiResponse = await callGemini(
          geminiContents,
          apiKey,
          tools
        );

        conversation.push({
          role: 'assistant',
          content: aiResponse
        });

        if (conversation.length > 20) {
          conversation = conversation.slice(-20);
        }

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