export const prompts = {
    generateSentence: (words) => {
        return `Generate a simple practice sentence using ONLY the following Mandarin words: [${words}]. 
Return a JSON object with: { "mandarin": "The sentence in Hanzi", "english": "The English translation" }.`;
    },

    evaluateTranslation: (srcText, targetLang, userText) => {
        return `
I am translating the sentence "${srcText}" into ${targetLang}.
My attempt: "${userText}".

Evaluate my translation. If I used Pinyin, ignore tones.
Return a JSON object with:
{
    "overview": "Brief summary of quality (1–2 sentences), perhaps include emoji.",
    "words": [
        {
            "text": "The word from my attempt",
            "cls": "ok" | "wrong" | "spelling" | "missing" | "extra",
            "detail": "Explanation"
        }
    ]
}
For "words", include all words in the *correct* translation, and any *extra* words from my attempt (They will display as crossed-out when tagged as "extra").
Do not just include the problematic words. The word array you provide will be rendered as a sentence, presented as the correct translation.
`;
    },

    copyChatGPT: () => {
        return `Please output the wordlist as a JSON array of objects with keys: "word" (Hanzi), "pinyin" (with tone marks), and "definition" (English). 
Example format:
[
  {"word": "欢迎", "pinyin": "huānyíng", "definition": "welcome"},
  {"word": "面包", "pinyin": "miànbāo", "definition": "bread"}
]
Output the JSON array in a codeblock.`;
    }
};
