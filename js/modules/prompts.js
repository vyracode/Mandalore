export const prompts = {
    generateSentence: (words) => {
        return `Generate a simple practice sentence using ONLY the following Mandarin words: [${words}]. 
Return a JSON object with: { "mandarin": "The sentence in Hanzi", "english": "The English translation" }.`;
    },

    evaluateTranslation: (srcText, correctText, userText, targetLang) => {
        const isMandarin = targetLang === 'Mandarin';
        return `Grade a translation by comparing the user's attempt to the correct answer WORD-BY-WORD.

SOURCE: "${srcText}"
CORRECT TRANSLATION: "${correctText}"
USER'S TRANSLATION: "${userText}"

${isMandarin ? `CHINESE RULES:
- Tokenize by WORDS, not individual characters (e.g. "我是美国人" → [我, 是, 美国人])
- Accept Hanzi OR Pinyin (wo=我, xihuan=喜欢, meiguoren=美国人)
- If user got a word partially right (some chars correct, some wrong), use "spelling" and explain in detail
` : ''}
GRADING SYSTEM:
- "ok" = Word matches correct (or acceptable Pinyin equivalent)
- "spelling" = Attempted the right word but has typos or wrong characters (explain what's wrong in detail)
- "wrong" = Completely different word/meaning
- "missing" = User didn't include this word
- "extra" = User added unnecessary words (list at end)

OUTPUT: Return ONLY valid JSON. NO explanations, NO thinking process.

{
    "words": [
        {
            "text": "what user wrote (or correct word if missing)",
            "cls": "ok|spelling|wrong|missing|extra",
            "detail": "Brief explanation"
        }
    ],
    "overview": "Encouraging 1-2 sentence summary with emoji"
}

EXAMPLE 1 (Partial word - spelling error):
Source: "He is American"
Correct: "他是美国人" → Words: [他, 是, 美国人]
User: "他是美高"

{"words":[{"text":"他","cls":"ok","detail":"Correct! 他 = he"},{"text":"是","cls":"ok","detail":"Correct! 是 = is"},{"text":"美高","cls":"spelling","detail":"Close! You got 美 right, but 高 should be 国, and you're missing 人. The word is 美国人 (American)."}],"overview":"Good attempt! 👍 2 out of 3 words correct."}

EXAMPLE 2 (Perfect - Pinyin accepted):
Source: "I like cats"
Correct: "我喜欢猫" → Words: [我, 喜欢, 猫]
User: "wo xihuan mao"

{"words":[{"text":"wo","cls":"ok","detail":"Correct! wo = 我 (I)"},{"text":"xihuan","cls":"ok","detail":"Correct! xihuan = 喜欢 (like)"},{"text":"mao","cls":"ok","detail":"Correct! mao = 猫 (cat)"}],"overview":"Perfect! 🎉 All 3 words correct."}

EXAMPLE 3 (Missing word + extra word):
Source: "I eat apples"
Correct: "我吃苹果" → Words: [我, 吃, 苹果]
User: "wo 苹果 hello"

{"words":[{"text":"wo","cls":"ok","detail":"Correct! wo = 我 (I)"},{"text":"吃","cls":"missing","detail":"Missing 吃 (eat). Don't skip verbs!"},{"text":"苹果","cls":"ok","detail":"Correct! 苹果 = apple"},{"text":"hello","cls":"extra","detail":"Extra word - not needed"}],"overview":"2 out of 3 words, but missed the verb. 😊"}

EXAMPLE 4 (Wrong word choice vs spelling):
Source: "I like dogs"
Correct: "我喜欢狗" → Words: [我, 喜欢, 狗]
User: "wo xihun 猫"

{"words":[{"text":"wo","cls":"ok","detail":"Correct! wo = 我 (I)"},{"text":"xihun","cls":"spelling","detail":"Typo! Should be 'xihuan' not 'xihun'"},{"text":"猫","cls":"wrong","detail":"Wrong word! 猫 means 'cat', but sentence says 'dogs' (狗)"}],"overview":"Good structure! 🐕 One typo and one wrong word."}`;
    },

    wordlistExtraction: () => {
        return `Extract the wordlist and output it as a JSON array of objects with keys: "word" (Hanzi), "pinyin" (with tone marks), and "definition" (English). 
Example format:
[
  {"word": "欢迎", "pinyin": "huānyíng", "definition": "welcome"},
  {"word": "面包", "pinyin": "miànbāo", "definition": "bread"}
]
Output ONLY the JSON array in a codeblock.`;
    },

    wordlistVerification: (extractedJson) => {
        return `Review the following wordlist extraction for errors. Check against the image(s) to verify:
- All words were captured (nothing missed)
- Pinyin has correct tone marks
- Definitions are accurate
- Correct letter casing
- No duplicates or typos

Extracted data:
${extractedJson}

If corrections are needed, output the corrected JSON array in a codeblock.
If it looks correct, output the same JSON array in a codeblock.
Output ONLY the JSON array.`;
    }
};
