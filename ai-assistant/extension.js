const vscode = require('vscode');
const ToolHandler = require('./tools/handlers');
const { validateGeminiApiKey } = require('./tools/validators');
const { getAllTools } = require('./tools/definitions');

let LLM_PROVIDER = null;
let generationWasAborted = false;
let currentAbortController = null;
let conversation = [];

let activeDiffDisposables = [];

const tools = getAllTools();

async function openDiffPreview(originalDoc, newText) {
  const originalUri = originalDoc.uri;

  const timestamp = Date.now();
  const previewUri = vscode.Uri.parse(
    `ai-preview:${originalUri.path}.ai-preview-${timestamp}`
  );

  const provider = {
    provideTextDocumentContent: () => newText
  };

  const registration = vscode.workspace.registerTextDocumentContentProvider(
    'ai-preview',
    provider
  );

  activeDiffDisposables.push(registration);

  await vscode.commands.executeCommand(
    'vscode.diff',
    originalUri,
    previewUri,
    `AI Suggested Changes: ${originalUri.fsPath.split('/').pop()}`
  );

  const messageItems = [
    { title: 'Apply Changes', action: 'accept' },
    { title: 'Reject', action: 'reject' }
  ];

  const choice = await vscode.window.showInformationMessage(
    'AI has proposed edits in a new window.',
    { modal: false },
    ...messageItems
  );

  const cleanup = async () => {
    await vscode.commands.executeCommand('workbench.action.closeActiveEditor');

    registration.dispose();

    const index = activeDiffDisposables.indexOf(registration);
    if (index > -1) {
      activeDiffDisposables.splice(index, 1);
    }
  };

  if (choice?.action === 'accept') {
    await cleanup();
    return true;
  } else {
    await cleanup();
    return false;
  }
}

async function applyChanges(editor, newText) {
  const success = await editor.edit(editBuilder => {
    const fullRange = new vscode.Range(
      editor.document.positionAt(0),
      editor.document.positionAt(editor.document.getText().length)
    );
    editBuilder.replace(fullRange, newText);
  });

  if (success) {
    vscode.window.showInformationMessage('Changes applied successfully');
  } else {
    vscode.window.showErrorMessage('Failed to apply changes');
  }

  return success;
}

async function callGemini(contents, apiKey, tools = [], onChunk = null) {
  const toolHandler = new ToolHandler();
  toolHandler.reset();

  let toolIterations = 0;
  const MAX_TOOL_ITERATIONS = 5;

  let currentContents = contents;
  let accumulatedText = "";

  if (currentContents.length > 0 && currentContents[0].role === 'user' && !currentContents[0].parts[0].text.includes('You are an expert IDE code assistant')) {
    currentContents = [
      {
        role: 'user',
        parts: [{
          text: `You are an expert IDE code assistant operating inside a VS Code editor. You help users understand, analyze, and modify code.

        CAPABILITIES:
        - Analyze and explain code in detail
        - Answer questions about code functionality
        - Provide code examples and best practices in the chat
        - Suggest improvements and optimizations
        - Help debug and fix issues
        - Modify code in the editor ONLY when the user explicitly says "apply" or "make changes to the file"

        IMPORTANT: When users ask you to "write", "create", or "generate" code, show it in the chat with code blocks. Only use the apply_code_edits tool when the user explicitly asks to modify the currently open file.`
        }]
      },
      {
        role: 'model',
        parts: [{ text: 'Understood. I will show code examples in the chat unless explicitly asked to modify the active file.' }]
      },
      ...currentContents
    ];
  }

  currentAbortController = new AbortController();
  const { signal } = currentAbortController;

  while (toolIterations < MAX_TOOL_ITERATIONS) {
    toolIterations++;

    let functionCallPart = null;
    let fullModelContent = null;

    if (signal.aborted) {
      console.log(`[STREAM] Aborted at start of iteration, stopping`);
      return accumulatedText || `[Generation stopped by user]`;
    }

    const response = await fetch(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:streamGenerateContent?alt=sse',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': apiKey
        },
        signal,
        body: JSON.stringify({
          contents: currentContents,
          ...(tools.length > 0 ? { tools } : {})
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

    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    let lineBuffer = "";

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        lineBuffer += chunk;

        const lines = lineBuffer.split('\n');
        lineBuffer = lines.pop() || "";

        for (const line of lines) {
          const trimmedLine = line.trim();

          if (!trimmedLine.startsWith('data: '))
            continue;

          try {
            const json = JSON.parse(line.substring(6));
            const candidate = json.candidates?.[0];
            if (!candidate) {
              continue;
            }

            const parts = json.candidates[0].content?.parts || [];

            for (const part of parts) {
              if (part.functionCall) {
                functionCallPart = part;
                fullModelContent = candidate.content;
              } else if (part.text) {
                accumulatedText += part.text;
                if (onChunk) onChunk(part.text);
              }
            }
          } catch (e) {
            console.error("Failed to parse JSON chunk: ", trimmedLine, e);
          }
        }
      }
    } catch (err) {
      if (err.name === 'AbortError') {
        console.log(`[STREAM] Gemini generation aborted by user`);
        throw new Error('GENERATION_ABORTED');
      }
      throw err;
    }

    if (signal.aborted) {
      console.log(`[STREAM] Stream aborted, not processing function calls`);
      return accumulatedText || `[Generation stopped by user]`;
    }

    if (functionCallPart) {
      const functionName = functionCallPart.functionCall.name;
      const args = functionCallPart.functionCall.args || {};

      let toolResult;

      if (functionName === 'apply_code_edits') {
        const { reason, newText, explanation } = args;
        const editor = vscode.window.activeTextEditor;

        if (!editor || !newText) {
          toolResult = '[NO_ACTIVE_EDITOR_OR_EMPTY_EDIT]';
        } else {
          const userAccepted = await openDiffPreview(
            editor.document,
            newText,
            reason,
            explanation
          );

          if (userAccepted) {
            const currentEditor = vscode.window.activeTextEditor;

            if (!currentEditor || currentEditor.document.uri.toString() !== editor.document.uri.toString()) {
              const doc = await vscode.workspace.openTextDocument(editor.document.uri);
              const reopenedEditor = await vscode.window.showTextDocument(doc);
              await applyChanges(reopenedEditor, newText);
            } else {
              await applyChanges(currentEditor, newText);
            }

            toolResult = `Changes applied successfully.\n\nExplanation:\n${explanation || 'No explanation provided.'}`;
          } else {
            toolResult = 'User rejected the proposed edits.';
          }
        }
      } else {
        try {
          toolResult = await toolHandler.execute(functionName, args, console.log);
        } catch (err) {
          toolResult = err.message || 'Tool execution failed';
        }
      }

      console.log(`[GEMINI_TOOL] Tool ${functionName} completed, continuing conversation...`);

      currentContents = [
        ...currentContents,
        fullModelContent,
        {
          role: 'user',
          parts: [
            {
              functionResponse: {
                name: functionName,
                response: { text: toolResult }
              }
            }
          ]
        }
      ];

      continue;
    }

    break;
  }

  if (accumulatedText.trim()) {
    return accumulatedText;
  }

  throw new Error('Maximum tool iterations reached');
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

        const userAccepted = await openDiffPreview(
          editor.document,
          newText,
          reason,
          explanation
        );

        if (userAccepted) {
          const currentEditor = vscode.window.activeTextEditor;

          if (!currentEditor || currentEditor.document.uri.toString() !== editor.document.uri.toString()) {
            const doc = await vscode.workspace.openTextDocument(editor.document.uri);
            const reopenedEditor = await vscode.window.showTextDocument(doc);
            await applyChanges(reopenedEditor, newText);
          } else {
            await applyChanges(currentEditor, newText);
          }

          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            name: 'apply_code_edits',
            content: `Changes applied successfully.\n\nExplanation:\n${explanation || 'No explanation provided.'}`
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

async function callLLM(contents, apiKey, tools = [], onChunk = null) {
  if (LLM_PROVIDER === 'Gemini') {
    return callGemini(contents, apiKey, tools, onChunk);
  }

  if (LLM_PROVIDER === 'Groq') {
    return callGroq(contents, apiKey, tools);
  }
  throw new Error(`Unsupported LLM provider: ${LLM_PROVIDER}`);
}

async function generateAssistantResponse({
  webview,
  apiKey,
  tools,
  isRegenerate = false,
  existingVersions = null
}) {
  const LLMContents = conversation.map(turn => {
    if (turn.role === 'assistant') {
      const active = turn.versions[turn.activeVersionIndex];
      return {
        role: 'model',
        parts: [{ text: active.content }]
      };
    }

    return {
      role: 'user',
      parts: [{ text: turn.content }]
    };
  });

  const effectiveTools = isRegenerate ? [] : tools;

  generationWasAborted = false;

  const aiResponse = await callLLM(
    LLMContents,
    apiKey,
    effectiveTools,
    chunk => {
      webview.postMessage({
        type: 'assistantChunk',
        text: chunk,
        conversationIndex: conversation.length
      });
    }
  );

  if (!generationWasAborted) {
    const lastTurn = conversation[conversation.length - 1];

    if (lastTurn && lastTurn.role === 'assistant') {
      lastTurn.versions.push({
        id: `v${lastTurn.versions.length + 1}`,
        content: aiResponse,
        createdAt: Date.now(),
        metadata: { regenerated: true }
      });
      lastTurn.activeVersionIndex = lastTurn.versions.length - 1;
    } else {

      const versions = existingVersions ? [
        ...existingVersions,
        {
          id: `v${existingVersions.length + 1}`,
          content: aiResponse,
          createdAt: Date.now(),
          metadata: { regenerated: true }
        }
      ] : [
        {
          id: 'v1',
          content: aiResponse,
          createdAt: Date.now(),
          metadata: { regenerated: false }
        }
      ];

      conversation.push({
        role: 'assistant',
        versions: versions,
        activeVersionIndex: versions.length - 1
      });
    }

    const lastAssistant = conversation[conversation.length - 1];
    const conversationIndex = conversation.length - 1;

    webview.postMessage({
      type: 'streamComplete',
      conversationIndex: conversationIndex,
      versionInfo: {
        current: lastAssistant.activeVersionIndex + 1,
        total: lastAssistant.versions.length
      }
    });
  }
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

            if (!message.provider) {
              throw new Error('NO_PROVIDER_SELECTED');
            }

            LLM_PROVIDER = message.provider;

            if (message.provider === 'Gemini') {
              await validateGeminiApiKey(message.key);
            }
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
            } else if (err.message === 'NO_PROVIDER_SELECTED') {
              webviewView.webview.postMessage({
                type: 'apiKeyInvalid',
                error: 'Please select an LLM provider before saving the key.'
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

        case 'stop-generation':
          if (currentAbortController) {
            console.log('[UI] Stop Requested');
            generationWasAborted = true;
            currentAbortController.abort();
          }
          return;

        case 'clearChat': {
          conversation = [];

          webviewView.webview.postMessage({
            type: 'chatCleared'
          });
          return;
        }

        case 'regenerateLast': {
          if (conversation.length === 0) return;

          const apiKey = await this.context.secrets.get('LLMApiKey');
          if (!apiKey) return;

          try {
            await generateAssistantResponse({
              webview: webviewView.webview,
              apiKey,
              tools,
              isRegenerate: true
            });
          } catch (error) {
            webviewView.webview.postMessage({
              type: 'assistantResponse',
              text: 'Error regenerating response: ' + error.message
            });
          }

          return;
        }

        case 'regenerateAt': {
          const index = message.conversationIndex;

          if (typeof index !== 'number' || index < 0 || index >= conversation.length) {
            console.error('[regenerateAt] Invalid conversation index: ', index);
            return;
          }

          const turn = conversation[index];
          if (!turn || turn.role !== 'assistant') {
            console.error('[regenerateAt] Turn at index is not an assistant: ', turn);
            return;
          }

          const apiKey = await this.context.secrets.get('LLMApiKey');
          if (!apiKey) return;

          const existingVersions = turn.versions;

          conversation = conversation.slice(0, index);

          try {
            await generateAssistantResponse({
              webview: webviewView.webview,
              apiKey,
              tools,
              isRegenerate: true,
              existingVersions: existingVersions
            });
          } catch (error) {
            if (
              error.message === 'GENERATION_ABORTED' ||
              error.name === 'AbortError' ||
              error.message?.includes('aborted')
            ) {
              console.log(`[STREAM] Generation aborted by user`);
              return;
            }

            webviewView.webview.postMessage({
              type: 'assistantResponse',
              text: 'Error regenerating response: ' + error.message
            });
          }

          return;
        }

        case 'switchVersion': {
          const index = message.conversationIndex;
          const versionIndex = message.versionIndex;

          if (typeof index !== 'number' || index < 0 || index >= conversation.length) {
            return;
          }

          const turn = conversation[index];
          if (!turn || turn.role !== 'assistant') {
            return;
          }

          turn.activeVersionIndex = versionIndex;

          const version = turn.versions[versionIndex];
          webviewView.webview.postMessage({
            type: 'versionSwitched',
            conversationIndex: index,
            content: version.content,
            versionInfo: {
              current: versionIndex + 1,
              total: turn.versions.length
            }
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

      if (attachedFile && attachedFile.path) {
        conversation.push({
          role: 'user',
          content: `User has attached a file at path: ${attachedFile.path}`
        });
      }

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
        await generateAssistantResponse({
          webview: webviewView.webview,
          apiKey,
          tools,
          isRegenerate: false
        });

        if (conversation.length > 20) {
          conversation = conversation.slice(-20);
        }
      } catch (error) {
        if (
          error.message === 'GENERATION_ABORTED' ||
          error.name === 'AbortError' ||
          error.message?.includes('aborted')
        ) {
          console.log(`[STREAM] Generation aborted by user`);
          return;
        }

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

function deactivate() {
  activeDiffDisposables.forEach(disposable => {
    try {
      disposable.dispose();
    } catch (err) {
      console.error('Error disposing diff view:', err);
    }
  });
  activeDiffDisposables = [];
}

module.exports = {
  activate,
  deactivate
};