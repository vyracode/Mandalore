import { state } from './state.js';
import { $, on } from './modules/utils.js';
import { renderFront, cycleFront, resetAllBack, bindModality } from './modules/flashcards.js';
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
on('#btnFabNext', 'click', () => { cycleFront(); resetAllBack(); });

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
// FIX: Moving listener attempt to below, I need to patch translation.js first? 
// Actually, I can just attach the listener in app.js if I export setDetail? 
// Better: add an initTranslation() in translation.js. 
// For now, I will assume I can edit translation.js or I will fix it in next step.

// Settings controls
on('#apiKey', 'input', renderKeyStatus);
on('#btnSaveKey', 'click', renderKeyStatus);
on('#btnClearKey', 'click', () => { const k = $('#apiKey'); if (k) k.value = ''; renderKeyStatus(); });

on('#btnImport', 'click', handleImport);
on('#btnClearList', 'click', handleClear);

on('#btnReset', 'click', () => {
    setTab('flash');
    state.sessionCount = 12;
    state.card.front = 'hanzi';
    state.card.word = '欢迎';
    state.card.pinyinToned = 'huānyíng';
    state.card.pinyinBare = 'huanying';
    state.card.tones = '12';
    state.card.meaning = 'welcome';
    const dn = $('#deckName');
    if (dn) dn.textContent = 'My Wordlist';
    resetAllBack();
    renderFront();
    setTranslationDir('ENZH');
    const ut = $('#userTranslation');
    if (ut) ut.value = '';
    const err = $('#importError');
    const ok = $('#importOk');
    if (err) err.style.display = 'none';
    if (ok) ok.style.display = 'none';
    const k = $('#apiKey');
    if (k) k.value = '';
    renderKeyStatus();
});

// Init
setTab('flash');
resetAllBack();
renderFront();
setTranslationDir('ENZH');
renderKeyStatus();
renderFeedbackTokens();
runSmokeTests();
