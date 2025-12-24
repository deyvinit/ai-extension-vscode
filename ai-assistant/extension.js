const vscode = require('vscode');

let LLM_PROVIDER = null;

const getSelectedTextFunction = {
  name: 'get_selected_text',
  description: 'Returns the currently selected text in the active VS Code editor.',
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

const getAttachedFileFunction = {
  name: 'get_attached_file',
  description: 'Returns the content of a user-attached file using its file path.',
  parameters: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Absolute file path of the attached file'
      }
    },
    required: ['path']
  }
};

const tools = [
  {
    functionDeclarations: [
      getSelectedTextFunction,
      getCurrentFileFunction,
      applyEditorEditsFunction,
      getAttachedFileFunction
    ]
  }
];

function detectProviderFromKey(apiKey) {
  if (apiKey.startsWith('AIza')) return 'gemini';
  if (apiKey.startsWith('gsk_')) return 'groq';
  if (apiKey.startsWith('sk-ant-')) return 'anthropic';
  if (apiKey.startsWith('sk-')) return 'openai';
  return 'unknown';
}

let conversation = [];

let hasAppliedEdits = false;

async function callGemini(contents, apiKey, tools = []) {
  hasAppliedEdits = false;
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
    throw new Error(`LLM API error: ${response.status}\n${errorText}`);
  }

  const data = await response.json();

  const parts = data.candidates?.[0]?.content?.parts || [];

  console.log(
    'LLM response parts: ',
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

    else if (functionName === 'get_attached_file') {
      const fs = require('fs');

      const { path } = functionCallPart.functionCall.args;

      let fileText = '';
      try {
        fileText = fs.readFileSync(path, 'utf8');
      } catch {
        fileText = `Failed to read file at path: ${path}`;
      }

      console.log('Executing tool: get_attached_file');
      console.log('Tool result length: ', fileText.length);

      currentContents = [
        ...currentContents,
        data.candidates[0].content,
        {
          role: 'user',
          parts: [
            {
              functionResponse: {
                name: 'get_attached_file',
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
  return finalTextPart?.text || 'No response from LLM';
}

async function callGroq(contents, apiKey, _tools = []) {
  const response = await fetch(
    'https://api.groq.com/openai/v1/chat/completions',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: contents.map(c => ({
          role: c.role === 'model' ? 'assistant' : c.role,
          content: c.parts?.[0]?.text || ''
        }))
      })
    }
  );

  if (!response.ok) {
    if (response.status === 429) {
      throw new Error('QUOTA_EXCEEDED');
    }

    const errorText = await response.text();
    throw new Error(`GROQ_API_ERROR: ${response.status}\n${errorText}`);
  }

  const data = await response.json();
  return data.choices?.[0]?.message?.content || 'No response from Groq';
}

async function callLLM(contents, apiKey, tools = []) {
  if (LLM_PROVIDER === 'gemini') {
    return callGemini(contents, apiKey, tools);
  }

  if (LLM_PROVIDER === 'groq') {
    return callGroq(contents, apiKey, tools);
  }
  throw new Error(`Unsupported LLM provider: ${LLM_PROVIDER}`);
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
          const apiKey = await this.context.secrets.get('LLMApiKey');
          const provider = await this.context.secrets.get('LLMProvider');

          if (provider) {
            LLM_PROVIDER = provider;
          }
          webviewView.webview.postMessage({
            type: 'apiKeyStatus',
            hasKey: Boolean(apiKey)
          });
          return;
        }

        case 'saveApiKey': {
          try {

            LLM_PROVIDER = detectProviderFromKey(message.key);

            if (LLM_PROVIDER === 'unknown') {
              throw new Error('UNKNOWN PROVIDER');
            }

            await callLLM(
              [{ role: 'user', parts: [{ text: 'Say OK' }] }],
              message.key
            );
            await this.context.secrets.store('LLMApiKey', message.key);
            await this.context.secrets.store('LLMProvider', LLM_PROVIDER);

            webviewView.webview.postMessage({
              type: 'apiKeySaved'
            });
          } catch (err) {
            console.error('API key validation failed:', err.message);

            if (err.message === 'SERVICE_OVERLOADED') {
              webviewView.webview.postMessage({
                type: 'apiKeyInvalid',
                error: 'LLM service is temporarily overloaded. Please try again later.'
              });
            } else if (err.message === 'QUOTA_EXCEEDED') {
              webviewView.webview.postMessage({
                type: 'apiKeyInvalid',
                error: 'API quota exceeded. Please wait or upgrade your plan.'
              });
            } else if (err.message === 'UNKNOWN_PROVIDER') {
              webviewView.webview.postMessage({
                type: 'apiKeyInvalid',
                error: 'Could not detect LLM provider from API key. Please recheck the key.'
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
          await this.context.secrets.delete('LLMApiKey');
          webviewView.webview.postMessage({
            type: 'apiKeyRemoved'
          });
          return;
        }

        case 'pickFile': {
          const result = await vscode.window.showOpenDialog({
            canSelectFiles: true,
            canSelectMany: false
          });

          if (!result || result.length === 0) return;

          const filePath = result[0].fsPath;

          webviewView.webview.postMessage({
            type: 'filePicked',
            file: {
              name: filePath.split('/').pop(),
              path: filePath
            }
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

      const attachedFile = message.attachedFile || null;

      conversation.push({
        role: 'user',
        content: finalPrompt
      });

      console.log('Selected text: ', selectedText);
      console.log('Final prompt sent to LLM:\n', finalPrompt);

      const apiKey = await this.context.secrets.get('LLMApiKey');

      if (!apiKey) {
        webviewView.webview.postMessage({
          type: 'assistantResponse',
          text: 'No API key set. Please add your LLM API key.'
        });
        return;
      }

      try {
        const LLMContents = conversation.map(turn => ({
          role: turn.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: turn.content }]
        }));

        if (attachedFile?.path) {
          LLMContents.push({
            role: 'user',
            parts: [{
              text: `User has attached a file at path: ${attachedFile.path}`
            }]
          });
        }

        const aiResponse = await callLLM(
          LLMContents,
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