const vscode = require('vscode');
const fs = require('fs');

class ToolHandler {
    constructor() {
        this.hasAppliedEdits = false;
    }

    async execute(functionName, args, log = console.log) {
        log(`[TOOL] Executing: ${functionName}`);

        switch (functionName) {
            case 'get_selected_text':
                return this.getSelectedText(log);
            case 'get_current_file':
                return this.getCurrentFile(log);
            case 'get_attached_file':
                return this.getAttachedFile(args, log);
            case 'apply_code_edits':
                return this.applyCodeEdits(args, log);
            default:
                throw new Error(`Unknown tool: ${functionName}`);
        }
    }

    getSelectedText(log) {
        const editor = vscode.window.activeTextEditor;
        const result = editor && !editor.selection.isEmpty
            ? editor.document.getText(editor.selection)
            : '[NO_SELECTION]';

        log(`[TOOL] get_selected_text result: ${result.length} characters`);
        return result;
    }

    getCurrentFile(log) {
        const editor = vscode.window.activeTextEditor;
        const result = editor ? editor.document.getText() : '[NO_ACTIVE_FILE]';
        const fileName = editor ? editor.document.fileName : 'none';

        log(`[TOOL] get_current_file: ${fileName}, ${result.length} characters`);
        return result;
    }

    async getAttachedFile(args, log) {
        const { path } = args;
        log(`[TOOL] Reading file: ${path}`);

        try {
            const result = fs.readFileSync(path, 'utf8');
            log(`[TOOL] File read successfully: ${result.length} characters`);
            return result;
        } catch (error) {
            log(`[TOOL] File read FAILED: ${error.message}`);
            return `Failed to read file at path: ${path}`;
        }
    }

    async applyCodeEdits(args, log) {
        if (this.hasAppliedEdits) {
            log('[TOOL] apply_code_edits SKIPPED - already applied');
            throw new Error('EDITS_ALREADY_APPLIED');
        }

        this.hasAppliedEdits = true;
        const { reason, newText, explanation } = args;

        log(`[TOOL] apply_code_edits requested: ${reason}`);

        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            log('[TOOL] FAILED - no active editor');
            throw new Error('NO_ACTIVE_EDITOR');
        }

        const confirmation = await vscode.window.showInformationMessage(
            `AI wants to apply changes:\n\n${reason}`,
            { modal: true },
            'Apply',
            'Cancel'
        );

        if (confirmation !== 'Apply') {
            log('[TOOL] CANCELLED by user');
            throw new Error('USER_CANCELLED');
        }

        await editor.edit(editBuilder => {
            const fullRange = new vscode.Range(
                editor.document.positionAt(0),
                editor.document.positionAt(editor.document.getText().length)
            );
            editBuilder.replace(fullRange, newText);
        });

        log('[TOOL] SUCCESS - changes applied');
        return `Changes applied successfully.\n\nExplanation:\n${explanation}`;
    }

    reset() {
        this.hasAppliedEdits = false;
    }
}

module.exports = ToolHandler;