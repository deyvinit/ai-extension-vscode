async function validateGeminiApiKey(apiKey) {
    const response = await fetch(
        'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent',
        {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-goog-api-key': apiKey
            },
            body: JSON.stringify({
                contents: [{ parts: [{ text: 'OK' }] }]
            })
        }
    );

    if (!response.ok) {
        if (response.status === 429) throw new Error('QUOTA_EXCEEDED');
        if (response.status === 429) throw new Error('SERVICE_OVERLOADED');
        throw new Error('API_KEY_INVALID');
    }

    return true;
}

module.exports = { validateGeminiApiKey };