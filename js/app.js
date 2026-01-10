import { state, loadState, saveState } from './state.js';
import { $, on } from './modules/utils.js';
import { renderFront, nextCard, resetAllBack, bindModality } from './modules/flashcards.js';
import { setTranslationDir, showTranslateB, newSentence, showTranslateA, handleFeedbackClick, renderFeedbackTokens } from './modules/translation.js';
import { renderKeyStatus, handleImport, handleClear } from './modules/settings.js';

function runSmokeTests() {
    // Tests (logged only; never throws)
    const required = [
        '#tabFlash', '#tabTranslate', '#tabSettings',
        '#screen-flash', '#screen-translate', '#screen-settings',
        '#btnFabNext',
        '#modPron', '#modPinyin', '#modHanzi', '#modMeaning',
        '#fbSentence', '#btnSubmitTranslation', '#btnNewSentence', '#btnBackToInput',
        '#btnImport', '#btnReset'
    ];
    const missing = required.filter(s => !$(s));
    if (missing.length) {
        console.warn('[Mandalore UI] Missing required elements:', missing);
    } else {
        console.log('[Mandalore UI] Smoke tests passed');
    }
}

function setTab(tab) {
    state.tab = tab;
    const map = {
        flash: { tab: $('#tabFlash'), screen: $('#screen-flash') },
        translate: { tab: $('#tabTranslate'), screen: $('#screen-translate') },
        settings: { tab: $('#tabSettings'), screen: $('#screen-settings') },
    };
    Object.entries(map).forEach(([k, v]) => {
        if (!v.tab || !v.screen) return;
        const on = (k === tab);
        v.tab.dataset.active = String(on);
        v.tab.setAttribute('aria-selected', on ? 'true' : 'false');
        v.screen.classList.toggle('hide', !on);
    });

    const fab = $('#btnFabNext');
    if (fab) fab.classList.toggle('hide', tab !== 'flash');
}

// Tabs
on('#tabFlash', 'click', () => setTab('flash'));
on('#tabTranslate', 'click', () => setTab('translate'));
on('#tabSettings', 'click', () => setTab('settings'));

// Flash controls (Next doubles as Skip)
on('#btnFabNext', 'click', () => { nextCard(); });

// Modality binds
bindModality($('#modPron'));
bindModality($('#modPinyin'));
bindModality($('#modHanzi'));
bindModality($('#modMeaning'));

// Translation controls
on('#dirENZH', 'click', () => setTranslationDir('ENZH'));
on('#dirZHEN', 'click', () => setTranslationDir('ZHEN'));
on('#btnSubmitTranslation', 'click', () => showTranslateB());
on('#btnNewSentence', 'click', () => newSentence());
on('#btnBackToInput', 'click', () => showTranslateA());

const fb = $('#fbSentence');
if (fb) {
    fb.addEventListener('click', handleFeedbackClick);
}

// Settings controls
on('#apiKey', 'input', renderKeyStatus);
on('#btnSaveKey', 'click', renderKeyStatus);
on('#btnClearKey', 'click', () => { const k = $('#apiKey'); if (k) k.value = ''; renderKeyStatus(); });

on('#btnImport', 'click', handleImport);
on('#btnClearList', 'click', handleClear);

on('#btnReset', 'click', () => {
    // Reset basically helps debugging by clearing everything
    localStorage.clear();
    location.reload();
});

// Init
if (loadState()) {
    console.log('State loaded. Wordlist size:', state.wordlist.length);
} else {
    console.log('No state found, starting fresh.');
}

setTab('flash');
nextCard(); // Will render empty state if no words
setTranslationDir('ENZH');
renderKeyStatus();
renderFeedbackTokens();
runSmokeTests();
