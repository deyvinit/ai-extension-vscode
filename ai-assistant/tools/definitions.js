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

// Helper function to get tools in the format expected by providers
function getAllTools() {
    return [
        {
            functionDeclarations: [
                getSelectedTextFunction,
                getCurrentFileFunction,
                applyEditorEditsFunction,
                getAttachedFileFunction
            ]
        }
    ];
}

module.exports = {
    getSelectedTextFunction,
    getCurrentFileFunction,
    applyEditorEditsFunction,
    getAttachedFileFunction,
    getAllTools
};