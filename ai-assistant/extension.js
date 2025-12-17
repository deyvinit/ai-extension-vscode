const vscode = require('vscode');

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
        </style>
      </head>
      <body>
        <h2>AI Assistant</h2>
        <textarea placeholder="Ask something..."></textarea>
        <button>Send</button>
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

function deactivate() {}

module.exports = {
	activate,
	deactivate
};