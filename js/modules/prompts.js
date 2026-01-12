export const prompts = {
    generateSentence: (words) => {
        return `Generate a simple practice sentence using ONLY the following Mandarin words: [${words}]. 
Return a JSON object with: { "mandarin": "The sentence in Hanzi", "english": "The English translation" }.`;
    },

    // ///////////////////////////////////////////////////////////////////////////
    // English → Chinese grading (word-by-word comparison with correct answer)
    // ///////////////////////////////////////////////////////////////////////////
    evaluateEnglishToChinese: (srcText, correctText, userText) => {
        return `Grade a translation by comparing the user's attempt to the correct answer WORD-BY-WORD.

SOURCE: "${srcText}"
CORRECT TRANSLATION: "${correctText}"
USER'S TRANSLATION: "${userText}"

CHINESE RULES:
- Tokenize by WORDS, not individual characters (e.g. "我是美国人" → [我, 是, 美国人])
- Accept Hanzi OR Pinyin (wo=我, xihuan=喜欢, meiguoren=美国人)
- If user got a word partially right (some chars correct, some wrong), use "spelling" and explain in detail
- IMPORTANT: When referencing Chinese words in feedback (overview and detail fields), always format as: Hanzi (pinyin with tone marks). Example: "我 (wǒ)", "喜欢 (xǐhuān)", "美国人 (měiguórén)"

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

{"words":[{"text":"他","cls":"ok","detail":"Correct! 他 (tā) = he"},{"text":"是","cls":"ok","detail":"Correct! 是 (shì) = is"},{"text":"美高","cls":"spelling","detail":"Close! You got 美 (měi) right, but 高 (gāo) should be 国 (guó), and you're missing 人 (rén). The word is 美国人 (měiguórén)."}],"overview":"Good attempt! 👍 2 out of 3 words correct - 他 (tā) and 是 (shì) are perfect!"}

EXAMPLE 2 (Perfect - Pinyin accepted):
Source: "I like cats"
Correct: "我喜欢猫" → Words: [我, 喜欢, 猫]
User: "wo xihuan mao"

{"words":[{"text":"wo","cls":"ok","detail":"Correct! wo = 我 (wǒ)"},{"text":"xihuan","cls":"ok","detail":"Correct! xihuan = 喜欢 (xǐhuān)"},{"text":"mao","cls":"ok","detail":"Correct! mao = 猫 (māo)"}],"overview":"Perfect! 🎉 All 3 words correct - 我 (wǒ), 喜欢 (xǐhuān), and 猫 (māo)."}

EXAMPLE 3 (Missing word + extra word):
Source: "I eat apples"
Correct: "我吃苹果" → Words: [我, 吃, 苹果]
User: "wo 苹果 hello"

{"words":[{"text":"wo","cls":"ok","detail":"Correct! wo = 我 (wǒ)"},{"text":"吃","cls":"missing","detail":"Missing 吃 (chī) - don't skip verbs!"},{"text":"苹果","cls":"ok","detail":"Correct! 苹果 (píngguǒ) = apple"},{"text":"hello","cls":"extra","detail":"Extra word - not needed"}],"overview":"2 out of 3 words correct - got 我 (wǒ) and 苹果 (píngguǒ), but missed 吃 (chī). 😊"}

EXAMPLE 4 (Wrong word choice vs spelling):
Source: "I like dogs"
Correct: "我喜欢狗" → Words: [我, 喜欢, 狗]
User: "wo xihun 猫"

{"words":[{"text":"wo","cls":"ok","detail":"Correct! wo = 我 (wǒ)"},{"text":"xihun","cls":"spelling","detail":"Typo! Should be 'xihuan' (喜欢 xǐhuān), not 'xihun'"},{"text":"猫","cls":"wrong","detail":"Wrong word! 猫 (māo) means 'cat', but sentence says 'dogs' - should be 狗 (gǒu)"}],"overview":"Good structure! 🐕 Got 我 (wǒ) right, but typo in 喜欢 (xǐhuān) and used 猫 (māo) instead of 狗 (gǒu)."}`;
    },

    // ///////////////////////////////////////////////////////////////////////////
    // Chinese → English grading (meaning-based, no fixed correct answer)
    // ///////////////////////////////////////////////////////////////////////////
    evaluateChineseToEnglish: (srcText, userText) => {
        return `Grade an English translation of a Chinese sentence. The user is a NATIVE ENGLISH SPEAKER learning Mandarin - we are testing their CHINESE COMPREHENSION, not their English skills.

CHINESE SOURCE: "${srcText}"
USER'S ENGLISH: "${userText}"

GRADING APPROACH:
- Break down the Chinese source into semantic units (subject, verb, object, modifiers, etc.)
- Check if each meaning is conveyed in the user's English, regardless of exact phrasing
- Accept natural English variations ("I want" = "I would like" = "I'd like")
- Focus on: Did they understand the Chinese? Did they convey the full meaning?
- IMPORTANT: English typos/grammar mistakes are fine if the meaning is clear. Mark as "ok" but mention the typo in detail.

GRADING SYSTEM:
- "ok" = Meaning correctly conveyed (even with English typos - just note them in detail)
- "wrong" = Misunderstood the Chinese word/phrase
- "missing" = User missed this part of the meaning
- "extra" = User added meaning not in the original

OUTPUT: Return ONLY valid JSON. NO explanations, NO thinking process.

{
    "words": [
        {
            "text": "the English word/phrase user wrote (or Chinese word if missing)",
            "cls": "ok|wrong|missing|extra",
            "detail": "Brief explanation with the Chinese word (mention English typos here if any)"
        }
    ],
    "overview": "Encouraging 1-2 sentence summary with emoji"
}

EXAMPLE 1 (Perfect - natural variation):
Source: "我想喝茶"
User: "I would like to drink tea"

{"words":[{"text":"I","cls":"ok","detail":"Correct! 我 = I"},{"text":"would like to","cls":"ok","detail":"Correct! 想 can be 'want to' or 'would like to'"},{"text":"drink","cls":"ok","detail":"Correct! 喝 = drink"},{"text":"tea","cls":"ok","detail":"Correct! 茶 = tea"}],"overview":"Perfect! 🎉 Natural translation that captures the full meaning."}

EXAMPLE 2 (Missing meaning):
Source: "我很喜欢吃苹果"
User: "I like apples"

{"words":[{"text":"I","cls":"ok","detail":"Correct! 我 = I"},{"text":"很","cls":"missing","detail":"Missing 很 (very/really) - 'I really like' or 'I like...a lot'"},{"text":"like","cls":"ok","detail":"Correct! 喜欢 = like"},{"text":"吃","cls":"missing","detail":"Missing 吃 (eat) - Chinese says 'like eating' not just 'like'"},{"text":"apples","cls":"ok","detail":"Correct! 苹果 = apple(s)"}],"overview":"Good start! 👍 But missed some nuance - try 'I really like eating apples'."}

EXAMPLE 3 (Wrong meaning):
Source: "他是我的朋友"
User: "He is my brother"

{"words":[{"text":"He is","cls":"ok","detail":"Correct! 他是 = He is"},{"text":"my","cls":"ok","detail":"Correct! 我的 = my"},{"text":"brother","cls":"wrong","detail":"Wrong! 朋友 means 'friend', not 'brother' (兄弟)"}],"overview":"Almost! 😊 Just mixed up 朋友 (friend) with 兄弟 (brother)."}

EXAMPLE 4 (English typo - still ok):
Source: "她每天学习中文"
User: "She studys Chineese every day"

{"words":[{"text":"She","cls":"ok","detail":"Correct! 她 = she"},{"text":"studys","cls":"ok","detail":"Correct! 学习 = study (btw: 'studies' in English)"},{"text":"Chineese","cls":"ok","detail":"Correct! 中文 = Chinese (btw: spelled 'Chinese')"},{"text":"every day","cls":"ok","detail":"Correct! 每天 = every day"}],"overview":"Perfect comprehension! 🎉 You understood everything."}`;
    },

    // ///////////////////////////////////////////////////////////////////////////
    // Wordlist extraction and verification
    // ///////////////////////////////////////////////////////////////////////////

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
