const vscode = require('vscode');
const fs = require('fs');
const path = require('path');

const activeDiffDisposables = [];

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
            case 'get_current_file_info':
                return this.getCurrentFileInfo(log);
            case 'list_open_files':
                return this.listOpenFiles(log);
            case 'list_workspace_files':
                return this.listWorkspaceFiles(args, log);
            case 'list_workspace_folders':
                return this.listWorkspaceFolders(log);
            case 'search_workspace':
                return this.searchWorkspace(args, log);
            case 'read_file':
                return this.readFile(args, log);
            case 'open_file':
                return this.openFile(args, log);
            case 'open_folder':
                return this.openFolder(args, log);
            case 'close_file':
                return this.closeFile(args, log);
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

    getCurrentFileInfo(log) {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            log('[TOOL] get_current_file_info: NO_ACTIVE_FILE');
            return '[NO_ACTIVE_FILE]';
        }

        const doc = editor.document;
        const workspaceFolder = vscode.workspace.getWorkspaceFolder(doc.uri);

        log(`[TOOL] get_current_file_info: ${doc.fileName}`);

        return {
            name: path.basename(doc.fileName),
            path: doc.uri.fsPath,
            language: doc.languageId,
            directory: path.dirname(doc.uri.fsPath),
            workspaceRoot: workspaceFolder ? workspaceFolder.uri.fsPath : null
        };
    }

    listOpenFiles(log) {
        const openTabs = vscode.window.tabGroups.all
            .flatMap(group => group.tabs)
            .filter(tab => tab.input && tab.input.uri);

        const files = openTabs.map(tab => tab.input.uri.fsPath);

        log(`[TOOL] list_open_files: ${files.length} files`);

        return files.length ? files : '[NO_OPEN_FILES]';
    }

    async listWorkspaceFiles(args, log) {
        const recursive = args?.recursive !== false;

        log(`[TOOL] list_workspace_files: recursive=${recursive}`);

        const includePattern = recursive ? '**/*' : '*';
        const excludePattern = '**/{node_modules,.git,dist,build,out}/**';

        const files = await vscode.workspace.findFiles(
            includePattern,
            excludePattern
        );

        log(`[TOOL] list_workspace_files: ${files.length} files found`);

        return files.map(uri => uri.fsPath);
    }

    async listWorkspaceFolders(log) {
        const folders = vscode.workspace.workspaceFolders || [];
        log(`[TOOL] list_workspace_folders: ${folders.length} folders`);
        return folders.map(f => f.uri.fsPath);
    }

    async searchWorkspace(args, log) {
        const { query } = args || {};
        if (!query || typeof query !== 'string') {
            throw new Error('NO_SEARCH_QUERY_PROVIDED');
        }

        log(`[TOOL] search_workspace: query="${query}"`);

        const results = [];
        const excludePattern = '**/{node_modules,.git,dist,build,out}/**';

        await vscode.workspace.findTextInFiles(
            { pattern: query },
            { exclude: excludePattern },
            result => {
                results.push({
                    path: result.uri.fsPath,
                    line: result.ranges[0].start.line + 1,
                    preview: result.preview.text.trim()
                });
            }
        );

        log(`[TOOL] search_workspace: ${results.length} matches`);

        const MAX_RESULTS = 50;
        return results.slice(0, MAX_RESULTS);
    }

    async readFile(args, log) {
        const { path: filePath } = args;
        if (!filePath) {
            throw new Error('NO_FILE_PATH_PROVIDED');
        }

        log(`[TOOL] read_file: ${filePath}`);

        const uri = vscode.Uri.file(filePath);
        const workspaceFolder = vscode.workspace.getWorkspaceFolder(uri);

        if (!workspaceFolder) {
            throw new Error('FILE_NOT_IN_WORKSPACE');
        }

        const content = await vscode.workspace.fs.readFile(uri);

        log(`[TOOL] read_file: ${content.length} characters`);

        return content.toString();
    }

    async openFile(args, log) {
        const paths = args?.paths || [];
        if (!Array.isArray(paths) || paths.length === 0) {
            throw new Error('NO_FILE_PATHS_PROVIDED');
        }

        log(`[TOOL] open_file: requested="${paths.join(', ')}"`);

        const opened = [];

        for (const inputPath of paths) {
            let uri;

            if (path.isAbsolute(inputPath)) {
                uri = vscode.Uri.file(inputPath);
            } else {
                const folders = vscode.workspace.workspaceFolders || [];
                for (const folder of folders) {
                    const candidate = vscode.Uri.joinPath(folder.uri, inputPath);
                    try {
                        await vscode.workspace.fs.stat(candidate);
                        uri = candidate;
                        break;
                    } catch { }
                }
            }

            if (!uri) {
                log(`[TOOL] open_file: NOT_FOUND ${inputPath}`);
                continue;
            }

            const doc = await vscode.workspace.openTextDocument(uri);
            await vscode.window.showTextDocument(doc, {
                preview: false,
                preserveFocus: true
            });

            opened.push(inputPath);
        }

        return opened.length
            ? `Opened Files: ${opened.join(', ')}`
            : 'No files were opened';
    }

    async openFolder(args, log) {
        const { path: folderPath } = args;
        if (!folderPath) {
            throw new Error('NO_FOLDER_PATH_PROVIDED');
        }

        log(`[TOOL] open_folder: ${folderPath}`);

        const uri = vscode.Uri.file(folderPath);
        const workspaceFolder = vscode.workspace.getWorkspaceFolder(uri);

        if (!workspaceFolder) {
            throw new Error('FOLDER_NOT_IN_WORKSPACE');
        }

        await vscode.commands.executeCommand('revealInExplorer', uri);

        log(`[TOOL] open_folder: SUCCESS`);

        return 'FOLDER_REVEALED';
    }

    async closeFile(args, log) {
        const paths = args?.paths;
        log(`[TOOL] close_file: requested=${paths && paths.length ? paths.join(', ') : 'CURRENT_FILE'}`);

        if (!paths || paths.length === 0) {
            const editor = vscode.window.activeTextEditor;
            if (!editor) return 'NO_ACTIVE_FILE';
            log(`[TOOL] close_file: closing active file ${editor.document.fileName}`);

            await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
            return 'FILE_CLOSED';
        }

        const openTabs = vscode.window.tabGroups.all
            .flatMap(group => group.tabs)
            .filter(tab => tab.input && tab.input.uri);

        const openUris = openTabs.map(tab => tab.input.uri.fsPath);
        const closed = [];
        const notOpen = [];

        for (const target of paths) {
            const matchingUri = openUris.find(uri =>
                uri === target || path.basename(uri) === target
            );

            if (!matchingUri) {
                notOpen.push(target);
                continue;
            }

            const tab = openTabs.find(
                t => t.input?.uri?.fsPath === matchingUri
            );

            if (!tab) {
                notOpen.push(target);
                continue;
            }

            await vscode.commands.executeCommand(
                'vscode.open',
                vscode.Uri.file(matchingUri),
                { preview: false, preserveFocus: false }
            );

            log(`[TOOL] close_file: closing ${path.basename(matchingUri)}`);
            await vscode.commands.executeCommand('workbench.action.closeActiveEditor');

            closed.push(target);
        }

        let result = '';
        if (closed.length) result += `Closed: ${closed.join(', ')}. `;
        if (notOpen.length) result += `Not open: ${notOpen.join(', ')}.`;

        log(`[TOOL] close_file result: ${result.trim()}`);
        return result.trim();
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
        if (!editor || !newText) {
            throw new Error('NO_ACTIVE_EDITOR_OR_EMPTY_EDIT');
        }

        const userAccepted = await openDiffPreview(
            editor.document,
            newText
        );

        if (!userAccepted) {
            throw new Error('USER_REJECTED_EDITS');
        }

        const currentEditor = vscode.window.activeTextEditor;

        if (!currentEditor || currentEditor.document.uri.toString() !== editor.document.uri.toString()) {
            const doc = await vscode.workspace.openTextDocument(editor.document.uri);
            const reopenedEditor = await vscode.window.showTextDocument(doc);
            await applyChanges(reopenedEditor, newText);
        } else {
            await applyChanges(currentEditor, newText);
        }

        log('[TOOL] SUCCESS - changes applied via diff preview');
        return `Changes applied successfully.\n\nExplanation:\n${explanation || 'No explanation provided.'}`;
    }

    reset() {
        this.hasAppliedEdits = false;
    }
}

module.exports = ToolHandler;