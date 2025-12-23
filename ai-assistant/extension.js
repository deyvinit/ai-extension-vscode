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

const getCurrentFileFunction = {
  name: 'get_current_file',
  description: 'Returns the full text content of the currently active VS Code editor file.',
  parameters: {
    type: 'object',
    properties: {},
    required: []
  }
};

const applyEditorEditsFunction = {
  name: 'apply_code_edits',
  description: 'Proposes code edits to be applied to the active editor. Requires user confirmation.',
  parameters: {
    type: 'object',
    properties: {
      reason: {
        type: 'string',
        description: 'Why these edits are being suggested'
      },
      newText: {
        type: 'string',
        description: 'The full updated content to replace the current editor content'
      }
    },
    required: ['reason', 'newText']
  }
};

const tools = [
  {
    functionDeclarations: [
      getSelectedTextFunction,
      getCurrentFileFunction,
      applyEditorEditsFunction
    ]
  }
];

let conversation = [];

let hasAppliedEdits = false;

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

  let currentContents = contents;
  let currentParts = parts;

  while (true) {
    const functionCallPart = currentParts.find(p => p.functionCall);

    if (!functionCallPart) {
      break;
    }

    const functionName = functionCallPart.functionCall.name;

    if (functionName === 'get_selected_text') {
      const editor = vscode.window.activeTextEditor;
      const selectedText =
        editor && !editor.selection.isEmpty
          ? editor.document.getText(editor.selection)
          : '';

      console.log('Executing tool: get_selected_text');
      console.log('Tool result: ', selectedText);

      currentContents = [
        ...currentContents,
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
    }

    else if (functionName === 'get_current_file') {
      const editor = vscode.window.activeTextEditor;
      const fileText = editor ? editor.document.getText() : '';

      console.log('Executing tool: get_current_file');
      console.log('Tool result length: ', fileText.length);

      currentContents = [
        ...currentContents,
        data.candidates[0].content,
        {
          role: 'user',
          parts: [
            {
              functionResponse: {
                name: 'get_current_file',
                response: { text: fileText }
              }
            }
          ]
        }
      ];
    }

    else if (functionName === 'apply_code_edits') {

      if (hasAppliedEdits) {
        console.log('Skipping additional editor edits');
        break;
      }

      hasAppliedEdits = true;

      const { reason, newText } = functionCallPart.functionCall.args;

      console.log('Proposed editor edits: ', reason);

      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        break;
      }

      const confirmation = await vscode.window.showInformationMessage(
        `AI wants to apply changes:\n\n${reason}`,
        { modal: true },
        'Apply',
        'Cancel'
      );

      if (confirmation !== 'Apply') {
        break;
      }

      await editor.edit(editBuilder => {
        const fullRange = new vscode.Range(
          editor.document.positionAt(0),
          editor.document.positionAt(editor.document.getText().length)
        );
        editBuilder.replace(fullRange, newText);
      });

      currentContents = [
        ...currentContents,
        {
          role: 'user',
          parts: [
            {
              functionResponse: {
                name: 'apply_code_edits',
                response: { success: true }
              }
            }
          ]
        }
      ];

      return 'Changes applied succesfully.'
    }

    const followUpResponse = await fetch(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': apiKey
        },
        body: JSON.stringify({
          contents: currentContents,
          tools
        })
      }
    );
    const followUpData = await followUpResponse.json();

    data.candidates[0].content = followUpData.candidates[0].content;

    currentParts = followUpData.candidates?.[0]?.content?.parts || [];
  }

  const finalTextPart = currentParts.find(p => p.text);
  return finalTextPart?.text || 'No response from Gemini';
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
        if (error.message === 'QUOTA_EXCEEDED') {
          webviewView.webview.postMessage({
            type: 'assistantResponse',
            text: 'API quota exceeded. Please try again later.'
          });

          return;
        }

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