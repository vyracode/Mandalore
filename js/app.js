import { state, loadState, saveState } from './state.js';
import { $, on } from './modules/utils.js';
import { renderFront, nextCard, resetAllBack, bindModality, updateDailySupercardCounter } from './modules/flashcards.js';
import { setTranslationDir, checkTranslation, newSentence, showTranslateA, handleFeedbackClick, renderFeedbackTokens, skipSentence, switchTranslationDir } from './modules/translation.js';
import { renderKeyStatus, handleImport, handleForgetList, forgetKey, saveKey, copyPrompt, renderModel, handleModelChange, triggerBrowse, handleFileSelect, clearCacheAndReload, loadVersionInfo, setupTextareaAutoResize, renderSentenceCount, renderWordCount, viewSentences, closeModal, forgetSentences, renderFSRSStats, forgetFSRS } from './modules/settings.js';


function runSmokeTests() {
    // Tests (logged only; never throws)
    const required = [
        '#tabFlash', '#tabTranslate', '#tabSettings',
        '#screen-flash', '#screen-translate', '#screen-settings',
        '#btnFabNext', '#btnNextBottom',
        '#modPron', '#modPinyin', '#modHanzi', '#modMeaning', '#modHanziTyping',
        '#fbSentence', '#btnSubmitTranslation', '#btnSwitchDirection', '#btnSkipSentence', '#btnNextSentence',
        '#btnImport', '#btnForgetKey', '#btnForgetList', '#btnClearCache'
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
    
    // Update FSRS stats when settings tab is shown
    if (tab === 'settings') {
        renderFSRSStats();
    }
}

// Tabs
on('#tabFlash', 'click', () => setTab('flash'));
on('#tabTranslate', 'click', () => setTab('translate'));
on('#tabSettings', 'click', () => setTab('settings'));

// Flash controls (Skip button in header, Next button at bottom when all finished)
on('#btnFabNext', 'click', () => { nextCard(); });
on('#btnNextBottom', 'click', () => { nextCard(); });

// Modality binds
bindModality($('#modPron'));
bindModality($('#modPinyin'));
bindModality($('#modHanzi'));
bindModality($('#modMeaning'));
bindModality($('#modHanziTyping'));

// Translation controls
on('#btnSwitchDirection', 'click', () => switchTranslationDir());
on('#btnSubmitTranslation', 'click', () => checkTranslation());
on('#btnSkipSentence', 'click', () => skipSentence());
on('#btnNextSentence', 'click', () => newSentence());

// Enter key handling for translation input
const userTranslationInput = $('#userTranslation');
if (userTranslationInput) {
    userTranslationInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey && !userTranslationInput.disabled) {
            e.preventDefault();
            checkTranslation();
        }
    });
}

const fb = $('#fbSentence');
if (fb) {
    fb.addEventListener('click', handleFeedbackClick);
}

// Settings controls
on('#apiKey', 'input', renderKeyStatus);
on('#btnSaveKey', 'click', saveKey);
on('#geminiModel', 'change', handleModelChange);
on('#btnForgetKey', 'click', forgetKey);
on('#btnCopyPrompt', 'click', copyPrompt);

on('#btnImport', 'click', handleImport);
on('#btnBrowse', 'click', triggerBrowse);
on('#fileInput', 'change', handleFileSelect);
on('#btnForgetList', 'click', handleForgetList);
on('#btnViewSentences', 'click', viewSentences);
on('#btnForgetSentences', 'click', forgetSentences);
on('#btnForgetFSRS', 'click', forgetFSRS);
on('#btnClearCache', 'click', clearCacheAndReload);

// Modal controls
on('#btnCloseModal', 'click', closeModal);
on('#modalOverlay', 'click', closeModal);

// Reset UI removed as per request. Use individual Forget buttons.

// Init
if (loadState()) {
    console.log('State loaded. Wordlist size:', state.wordlist.length);
} else {
    console.log('No state found, starting fresh.');
}

setTab('flash');
nextCard();
updateDailySupercardCounter(); // Will render empty state if no words
setTranslationDir('ENZH');
renderKeyStatus();
renderModel();
renderSentenceCount();
renderWordCount();
renderFSRSStats();
renderFeedbackTokens();
loadVersionInfo();
setupTextareaAutoResize();
runSmokeTests();
