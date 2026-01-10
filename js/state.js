export const state = {
    tab: 'flash',
    sessionCount: 12,
    translationDir: 'ENZH',
    card: {
        front: 'hanzi',
        word: '欢迎',
        pinyinToned: 'huānyíng',
        pinyinBare: 'huanying',
        tones: '12',
        meaning: 'welcome',
        audioLabel: 'Pronunciation',
    },
    translation: {
        promptEN: 'Welcome home. Do you want bread?',
        promptZH: '欢迎回家。你想要面包吗？',
        feedbackOverview: 'Nice structure. Two word choices are off, and one word is missing.',
        tokens: [
            { text: '欢迎', cls: 'ok', detail: 'Correct.' },
            { text: '回家', cls: 'ok', detail: 'Correct.' },
            { text: '你', cls: 'missing', detail: 'Missing word. Add 你 before 想要.' },
            { text: '想要', cls: 'spelling', detail: 'Form is slightly off. Preferred: 想要.' },
            { text: '面包', cls: 'wrong', detail: 'Wrong word choice. Use 面包 (miànbāo) for bread.' },
            { text: '吗', cls: 'extra', detail: 'Extra word. Your sentence already forms a question.' },
        ],
    },
    imported: { deckName: 'My Wordlist' }
};

export function bumpSession(n) {
    state.sessionCount = Math.max(0, state.sessionCount + n);
}
