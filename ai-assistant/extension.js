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
  description:
    'Proposes code edits to be applied to the active editor. Only valid when the user explicitly requested a code change.',
  parameters: {
    type: 'object',
    properties: {
      reason: {
        type: 'string',
        description:
          'Explain why the user request requires modifying code (quote or reference the user request).'
      },
      newText: {
        type: 'string',
        description:
          'The full updated content to replace the current editor content.'
      }, explanation: {
        type: 'string',
        description:
          'Explain what was changed and why, to be shown to the user after edits are applied.'
      }
    },
    required: ['reason', 'newText', 'explanation']
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
  if (apiKey.startsWith('AIza')) return 'Gemini';
  if (apiKey.startsWith('gsk_')) return 'Groq';
  if (apiKey.startsWith('sk-ant-')) return 'Anthropic';
  if (apiKey.startsWith('sk-')) return 'OpenAI';
  return 'unknown';
}

let conversation = [];

let hasAppliedEdits = false;

async function callGemini(contents, apiKey, tools = []) {
  let toolIterations = 0;
  const MAX_TOOL_ITERATIONS = 5;
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

  while (toolIterations < MAX_TOOL_ITERATIONS) {
    toolIterations++;

    const functionCallPart = currentParts.find(p => p.functionCall);

    if (!functionCallPart) {
      break;
    }

    const functionName = functionCallPart.functionCall.name;

    if (functionName === 'get_selected_text') {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        currentContents = [
          ...currentContents,
          data.candidates[0].content,
          {
            role: 'user',
            parts: [
              {
                functionResponse: {
                  name: 'get_selected_text',
                  response: { text: '[NO_ACTIVE_EDITOR]' }
                }
              }
            ]
          }
        ];
        continue;
      }
      const selectedText =
        !editor.selection.isEmpty
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

      return 'Changes applied successfully.'
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

async function callGroq(contents, apiKey, tools = []) {
  let toolIterations = 0;
  let hasAppliedGroqEdits = false;
  const MAX_TOOL_ITERATIONS = 5;

  let messages = [
    {
      role: 'system',
      content:
        `You are an expert IDE code assistant operating inside a code editor.

        STRICT RULES:
        1. NEVER modify code unless the user explicitly asks to write, add, fix, refactor, or change code.
        2. BEFORE calling apply_code_edits, you MUST read context using get_current_file or get_selected_text.
        3. apply_code_edits MUST:
        - Preserve the programming language of the file
        - Return the FULL updated file content (not partial snippets)
        - Make minimal, necessary changes only
        4. When calling apply_code_edits, you MUST include:
        - a clear reason
        - a clear explanation of what changed and why
        5. If no meaningful fix is possible, DO NOT call apply_code_edits. Explain instead.
        6. Never replace the file with placeholders, summaries, or generic text.

        Violation of these rules is considered an error.`
    },
    ...contents.map(c => ({
      role: c.role === 'model' ? 'assistant' : c.role || 'user',
      content: c.parts?.[0]?.text || ''
    }))
  ];

  while (toolIterations < MAX_TOOL_ITERATIONS) {
    toolIterations++;
    if (toolIterations > MAX_TOOL_ITERATIONS) {
      throw new Error('Tool loop exceeded safe limit');
    }

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
          messages,
          tools: tools?.[0]?.functionDeclarations?.map(fn => ({
            type: 'function',
            function: {
              name: fn.name,
              description: fn.description,
              parameters: fn.parameters
            }
          })),
          tool_choice: 'auto'
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
    const message = data.choices?.[0]?.message;

    messages.push({
      role: 'assistant',
      content: message.content || '',
      tool_calls: message.tool_calls
    });

    if (!message.tool_calls || message.tool_calls.length === 0) {
      return message.content || 'No response from Groq';
    }

    for (const toolCall of message.tool_calls) {
      const toolName = toolCall.function.name;
      const args = JSON.parse(toolCall.function.arguments || '{}');

      console.log('[GROQ_TOOL]', toolName);

      let toolResult = '';

      if (toolName === 'get_selected_text') {
        const editor = vscode.window.activeTextEditor;
        toolResult =
          editor && !editor.selection.isEmpty
            ? editor.document.getText(editor.selection)
            : '[NO_SELECTION]';

        messages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          name: 'get_selected_text',
          content: toolResult
        });
        continue;
      }

      else if (toolName === 'get_current_file') {
        const editor = vscode.window.activeTextEditor;
        toolResult = editor
          ? editor.document.getText()
          : '[NO_ACTIVE_FILE]';

        messages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          name: 'get_current_file',
          content: toolResult
        });
        continue;
      }

      else if (toolName === 'get_attached_file') {
        const fs = require('fs');
        try {
          toolResult = fs.readFileSync(args.path, 'utf8');
        } catch {
          toolResult = `Failed to read file at path: ${args.path}`;
        }

        messages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          name: 'get_attached_file',
          content: toolResult
        });
        continue;
      }

      else if (toolName === 'apply_code_edits') {
        if (hasAppliedGroqEdits) {
          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            name: 'apply_code_edits',
            content: 'Edit rejected: edits already applied for this request.'
          });
          continue;
        }
        hasAppliedGroqEdits = true;
        const { reason, newText, explanation } = args;

        const editor = vscode.window.activeTextEditor;
        if (!editor) {
          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            name: 'apply_code_edits',
            content: '[NO_ACTIVE_EDITOR]'
          });
          continue;
        }

        if (!newText || newText.trim().length < 10) {
          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            name: 'apply_code_edits',
            content:
              'Edit rejected: proposed changes are too small or destructive to be a valid fix.'
          });
          continue;
        }


        if (!reason || reason.trim().length < 10) {
          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            name: 'apply_code_edits',
            content:
              'Edit rejected: the request is ambiguous. Ask the user to clarify what kind of fix is required (formatting, logic, refactor, etc.).'
          });
          continue;
        }

        const hasReadContext = messages.some(
          m =>
            m.role === 'tool' &&
            (m.name === 'get_current_file' || m.name === 'get_selected_text')
        );

        if (!hasReadContext) {
          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            name: 'apply_code_edits',
            content:
              'Edit rejected: you must read the file using get_current_file or get_selected_text before proposing edits.'
          });

          continue;
        }

        const confirmation = await vscode.window.showInformationMessage(
          `AI wants to apply the following changes:\n\n${reason}`,
          { modal: true },
          'Apply',
          'Cancel'
        );

        if (confirmation === 'Apply') {
          await editor.edit(editBuilder => {
            const fullRange = new vscode.Range(
              editor.document.positionAt(0),
              editor.document.positionAt(editor.document.getText().length)
            );
            editBuilder.replace(fullRange, newText);
          });

          return `Changes applied successfully.\n\nExplanation:\n${explanation}`;
        } else {
          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            name: 'apply_code_edits',
            content: 'User rejected the proposed edits.'
          });
          continue;
        }
      }
    }
  }
}

async function callLLM(contents, apiKey, tools = []) {
  if (LLM_PROVIDER === 'Gemini') {
    return callGemini(contents, apiKey, tools);
  }

  if (LLM_PROVIDER === 'Groq') {
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
            hasKey: Boolean(apiKey),
            provider
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
              type: 'apiKeySaved',
              provider: LLM_PROVIDER
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

      if (message.type !== 'userPrompt') {
        return;
      }

      const finalPrompt = message.text;

      const attachedFile = message.attachedFile || null;

      conversation.push({
        role: 'user',
        content: finalPrompt
      });

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

