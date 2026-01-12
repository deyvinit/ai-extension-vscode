const vscode = require('vscode');
const ToolHandler = require('./tools/handlers');
const { validateGeminiApiKey } = require('./tools/validators');
const { getAllTools } = require('./tools/definitions');

let LLM_PROVIDER = null;
let generationWasAborted = false;
let currentAbortController = null;

let chats = [];
let currentChatId = null;

const SYSTEM_PROMPT = `
You are an expert IDE code assistant operating inside a code editor.

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

Violation of these rules is considered an error.
`.trim();

function generateChatId() {
  return `chat_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

function getCurrentChat() {
  return chats.find(c => c.id === currentChatId);
}

function createNewChat() {
  const chat = {
    id: generateChatId(),
    title: 'New Chat',
    conversation: [],
    createdAt: Date.now(),
    lastModified: Date.now(),
    isPinned: false,
    isArchived: false,
    attachedFiles: []
  };

  chats.unshift(chat);
  currentChatId = chat.id;
  return chat;
}

function getChatPreview(conversation) {
  if (conversation.length === 0) return '';
  const firstUserMsg = conversation.find(msg => msg.role === 'user');
  if (!firstUserMsg) return '';
  return firstUserMsg.content.substring(0, 60);
}

function getChatList() {
  return chats.map(chat => ({
    id: chat.id,
    title: chat.title,
    preview: getChatPreview(chat.conversation),
    createdAt: chat.createdAt,
    lastModified: chat.lastModified,
    isPinned: chat.isPinned,
    messageCount: chat.conversation.length
  }));
}

async function saveChats(context) {
  try {
    await context.globalState.update('chatHistory', chats);
    await context.globalState.update('currentChatId', currentChatId);
    console.log('[STORAGE] Chats saved successfully');
  } catch (error) {
    console.error('[STORAGE] Failed to save chats:', error);
  }
}

async function loadChats(context) {
  try {
    const savedChats = await context.globalState.get('chatHistory', []);
    const savedCurrentChatId = await context.globalState.get('currentChatId', null);

    if (savedChats && savedChats.length > 0) {
      chats = savedChats;
      currentChatId = savedCurrentChatId;
      console.log(`[STORAGE] Loaded ${chats.length} chats from storage`);
    } else {
      console.log('[STORAGE] No saved chats found');
    }
  } catch (error) {
    console.error('[STORAGE] Failed to load chats:', error);
  }
}

function buildRequestContents(conversation) {
  return [
    {
      role: 'user',
      parts: [{ text: SYSTEM_PROMPT }]
    },
    ...conversation
  ];
}

function estimateTokens(text) {
  return Math.ceil(text.length / 4);
}

function trimConversationToTokenLimit(conversation, maxTokens) {
  let totalTokens = 0;
  const trimmed = [];

  for (let i = conversation.length - 1; i >= 0; i--) {
    const msg = conversation[i];
    const text = msg.parts?.[0]?.text || '';
    const tokens = estimateTokens(text);

    if (totalTokens + tokens > maxTokens) {
      break;
    }

    totalTokens += tokens;
    trimmed.unshift(msg);
  }

  return trimmed;
}

const tools = getAllTools();

async function callGemini(contents, apiKey, tools = [], onChunk = null) {
  const toolHandler = new ToolHandler();
  toolHandler.reset();

  let toolIterations = 0;
  const MAX_TOOL_ITERATIONS = 5;

  const MAX_CONTEXT_TOKENS = 12_000;
  const trimmedConversation = trimConversationToTokenLimit(contents, MAX_CONTEXT_TOKENS);
  let currentContents = buildRequestContents(trimmedConversation);
  let accumulatedText = "";

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

      const nextConversation = [
        ...currentContents.slice(1),
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

      const trimmedNextConversation = trimConversationToTokenLimit(nextConversation, MAX_CONTEXT_TOKENS);

      currentContents = buildRequestContents(trimmedNextConversation);

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
  chatId,
  isRegenerate = false,
  existingVersions = null,
  context = null
}) {
  const chat = chats.find(c => c.id === chatId);
  if (!chat) {
    throw new Error('Chat not found');
  }

  const conversation = chat.conversation;

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

    chat.lastModified = Date.now();

    if (conversation.length === 2 && chat.title === 'New Chat') {
      const firstUserMsg = conversation[0].content;
      chat.title = firstUserMsg.substring(0, 40) + (firstUserMsg.length > 40 ? '...' : '');
    }

    if (context) {
      await saveChats(context);
    }

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

  async resolveWebviewView(webviewView) {
    webviewView.webview.options = {
      enableScripts: true
    };

    webviewView.webview.html = getHtml(webviewView.webview, this.context);

    await loadChats(this.context);

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

        case 'loadChats': {
          webviewView.webview.postMessage({
            type: 'chatsLoaded',
            chats: getChatList()
          });
          return;
        }

        case 'createNewChat': {
          const newChat = createNewChat();
          await saveChats(this.context);
          webviewView.webview.postMessage({
            type: 'chatCreated',
            chat: {
              id: newChat.id,
              title: newChat.title,
              preview: '',
              createdAt: newChat.createdAt,
              lastModified: newChat.lastModified,
              isPinned: false,
              messageCount: 0
            },
            conversation: newChat.conversation
          });
          return;
        }

        case 'switchChat': {
          const chat = chats.find(c => c.id === message.chatId);
          if (chat) {
            currentChatId = message.chatId;
            await saveChats(this.context);
            webviewView.webview.postMessage({
              type: 'chatSwitched',
              chatId: chat.id,
              title: chat.title,
              conversation: chat.conversation
            });
          }
          return;
        }

        case 'deleteChat': {
          chats = chats.filter(c => c.id !== message.chatId);
          webviewView.webview.postMessage({
            type: 'chatDeleted',
            chatId: message.chatId
          });

          if (currentChatId === message.chatId) {
            if (chats.length > 0) {
              const nextChat = chats[0];
              currentChatId = nextChat.id;
              webviewView.webview.postMessage({
                type: 'chatSwitched',
                chatId: nextChat.id,
                title: nextChat.title,
                conversation: nextChat.conversation
              });
            } else {
              currentChatId = null;
            }
          }
          return;
        }

        case 'requestDeleteConfirmation': {
          const answer = await vscode.window.showWarningMessage(
            'Are you sure you want to delete this chat?',
            { modal: true },
            { title: 'Delete', isCloseAffordance: false },
            { title: 'Cancel', isCloseAffordance: true }
          );

          if (answer && answer.title === 'Delete') {
            chats = chats.filter(c => c.id !== message.chatId);
            await saveChats(this.context);
            webviewView.webview.postMessage({
              type: 'chatDeleted',
              chatId: message.chatId
            });

            if (currentChatId === message.chatId) {
              currentChatId = null;
              await saveChats(this.context);
            }
          }
          return;
        }

        case 'renameChat': {
          const chat = chats.find(c => c.id === message.chatId);
          if (chat) {
            chat.title = message.title;
            chat.lastModified = Date.now();
            await saveChats(this.context);
            webviewView.webview.postMessage({
              type: 'chatRenamed',
              chatId: message.chatId,
              title: message.title
            });
          }
          return;
        }

        // case 'requestRename': {
        //   const result = await vscode.window.showInputBox({
        //     prompt: 'Enter new chat title',
        //     value: message.currentTitle,
        //     placeHolder: 'Chat title'
        //   });

        //   if (result && result.trim()) {
        //     const chat = chats.find(c => c.id === message.chatId);
        //     if (chat) {
        //       chat.title = result.trim();
        //       chat.lastModified = Date.now();
        //       webviewView.webview.postMessage({
        //         type: 'chatRenamed',
        //         chatId: message.chatId,
        //         title: result.trim()
        //       });
        //     }
        //   }
        //   return;
        // }

        case 'pinChat': {
          const chat = chats.find(c => c.id === message.chatId);
          if (chat) {
            chat.isPinned = !chat.isPinned;

            chats.sort((a, b) => {
              if (a.isPinned && !b.isPinned) return -1;
              if (!a.isPinned && b.isPinned) return 1;
              return b.lastModified - a.lastModified;
            });

            await saveChats(this.context);

            webviewView.webview.postMessage({
              type: 'chatPinned',
              chatId: message.chatId,
              isPinned: chat.isPinned
            });
          }
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
          chats = [];
          currentChatId = null;
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

        case 'requestClearConfirmation': {
          const answer = await vscode.window.showWarningMessage(
            'Clear all messages in this chat?',
            { modal: true },
            { title: 'Clear', isCloseAffordance: false },
            { title: 'Cancel', isCloseAffordance: true }
          );

          if (answer && answer.title === 'Clear') {
            const chat = chats.find(c => c.id === message.chatId);
            if (chat) {
              chat.conversation = [];
              chat.lastModified = Date.now();
            }

            await saveChats(this.context);

            webviewView.webview.postMessage({
              type: 'chatCleared'
            });
          }
          return;
        }

        case 'clearChat': {
          const chat = chats.find(c => c.id === message.chatId);
          if (chat) {
            chat.conversation = [];
            chat.lastModified = Date.now();
          }

          webviewView.webview.postMessage({
            type: 'chatCleared'
          });
          return;
        }

        case 'regenerateLast': {
          const chat = getCurrentChat();
          if (!chat || chat.conversation.length === 0) return;

          const apiKey = await this.context.secrets.get('LLMApiKey');
          if (!apiKey) return;

          try {
            await generateAssistantResponse({
              webview: webviewView.webview,
              apiKey,
              tools,
              chatId: currentChatId,
              isRegenerate: true,
              context: this.context
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
          const chat = chats.find(c => c.id === message.chatId);

          if (!chat) return;

          if (typeof index !== 'number' || index < 0 || index >= chat.conversation.length) {
            console.error('[regenerateAt] Invalid conversation index: ', index);
            return;
          }

          const turn = chat.conversation[index];
          if (!turn || turn.role !== 'assistant') {
            console.error('[regenerateAt] Turn at index is not an assistant: ', turn);
            return;
          }

          const apiKey = await this.context.secrets.get('LLMApiKey');
          if (!apiKey) return;

          const existingVersions = turn.versions;
          chat.conversation = chat.conversation.slice(0, index);

          try {
            await generateAssistantResponse({
              webview: webviewView.webview,
              apiKey,
              tools,
              chatId: message.chatId,
              isRegenerate: true,
              existingVersions: existingVersions,
              context: this.context
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
          const chat = chats.find(c => c.id === message.chatId);

          if (!chat) return;

          if (typeof index !== 'number' || index < 0 || index >= chat.conversation.length) {
            return;
          }

          const turn = chat.conversation[index];
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

      if (!currentChatId) {
        const newChat = createNewChat();
        webviewView.webview.postMessage({
          type: 'chatCreated',
          chat: {
            id: newChat.id,
            title: newChat.title,
            preview: '',
            createdAt: newChat.createdAt,
            lastModified: newChat.lastModified,
            isPinned: false,
            messageCount: 0
          },
          conversation: newChat.conversation
        });
      }

      const chat = getCurrentChat();
      if (!chat) return;

      const finalPrompt = message.text;
      const attachedFile = message.attachedFile || null;

      if (attachedFile && attachedFile.path) {
        chat.conversation.push({
          role: 'user',
          content: `User has attached a file at path: ${attachedFile.path}`
        });
      }

      chat.conversation.push({
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
          chatId: currentChatId,
          isRegenerate: false,
          context: this.context
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