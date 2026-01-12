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
                description: 'Explain why the user request requires modifying code (quote or reference the user request).'
            },
            newText: {
                type: 'string',
                description: 'The full updated content to replace the current editor content.'
            },
            explanation: {
                type: 'string',
                description: 'Explain what was changed and why, to be shown to the user after edits are applied.'
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

const getCurrentFileInfoFunction = {
    name: 'get_current_file_info',
    description: 'Returns metadata about the currently active file, including name, path, language, and containing folder.',
    parameters: {
        type: 'object',
        properties: {},
        required: []
    }
};

const listWorkspaceFilesFunction = {
    name: 'list_workspace_files',
    description: 'Lists all files in the current workspace. Can be recursive or top-level only.',
    parameters: {
        type: 'object',
        properties: {
            recursive: {
                type: 'boolean',
                description: 'Whether to list files recursively. Defaults to true.'
            }
        },
        required: []
    }
};

const listWorkspaceFoldersFunction = {
    name: 'list_workspace_folders',
    description: 'Lists top-level folders in the current workspace.',
    parameters: {
        type: 'object',
        properties: {},
        required: []
    }
};

const searchWorkspaceFunction = {
    name: 'search_workspace',
    description: 'Searches for a text pattern across files in the current workspace.',
    parameters: {
        type: 'object',
        properties: {
            query: {
                type: 'string',
                description: 'Text pattern to search for in the workspace.'
            }
        },
        required: ['query']
    }
};

const readFileFunction = {
    name: 'read_file',
    description: 'Reads the full text content of a file within the workspace.',
    parameters: {
        type: 'object',
        properties: {
            path: {
                type: 'string',
                description: 'Workspace-relative or absolute path of the file to read.'
            }
        },
        required: ['path']
    }
};

const openFileFunction = {
    name: 'open_file',
    description: 'Opens a file in the VS Code editor.',
    parameters: {
        type: 'object',
        properties: {
            path: {
                type: 'string',
                description: 'Workspace-relative or absolute path of the file to open.'
            }
        },
        required: ['path']
    }
};

const openFolderFunction = {
    name: 'open_folder',
    description: 'Reveals a folder in the VS Code Explorer.',
    parameters: {
        type: 'object',
        properties: {
            path: {
                type: 'string',
                description: 'Workspace-relative or absolute path of the folder to reveal.'
            }
        },
        required: ['path']
    }
};

function getAllTools() {
    return [
        {
            functionDeclarations: [
                getSelectedTextFunction,
                getCurrentFileFunction,
                applyEditorEditsFunction,
                getAttachedFileFunction,
                getCurrentFileInfoFunction,
                listWorkspaceFilesFunction,
                listWorkspaceFoldersFunction,
                searchWorkspaceFunction,
                readFileFunction,
                openFileFunction,
                openFolderFunction
            ]
        }
    ];
}

module.exports = {
    getSelectedTextFunction,
    getCurrentFileFunction,
    applyEditorEditsFunction,
    getAttachedFileFunction,
    getCurrentFileInfoFunction,
    listWorkspaceFilesFunction,
    listWorkspaceFoldersFunction,
    searchWorkspaceFunction,
    readFileFunction,
    openFileFunction,
    openFolderFunction,
    getAllTools
};