const vscode = require('vscode');
const ToolHandler = require('./tools/handlers');
const { validateGeminiApiKey } = require('./tools/validators');
const { getAllTools } = require('./tools/definitions');

let LLM_PROVIDER = null;
let generationWasAborted = false;
let currentAbortController = null;
let conversation = [];

const tools = getAllTools();

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

      try {
        toolResult = await toolHandler.execute(functionName, args, console.log);
      } catch (err) {
        toolResult = err.message || 'Tool execution failed';
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

async function callGroq() {
  // Placeholder for future implementation
  return 'Support for Groq is not enabled yet.';
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

function deactivate() { };

module.exports = {
  activate,
  deactivate
};