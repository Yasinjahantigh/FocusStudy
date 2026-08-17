const STRINGS = {
  en: {
    privacy: 'Sends only tab titles & hostnames to FocusStudy. No URLs, content or cookies.',
    copy: 'Copy',
    copied: 'Copied',
    test: 'Test native host connection',
    testing: 'Testing…',
    ok: 'Native host connected ✓',
    fail: 'Native host NOT found.',
    failErr: 'Native host error:',
    fix: 'Install FocusStudy 1.1+, open Settings → Browser Bridge, paste this ID, then restart the browser.',
    step1: 'Open FocusStudy → Settings → Browser Bridge.',
    step2: 'Paste the extension ID above into the app.',
    step3: 'Restart the browser.',
    logHint: 'Diagnostics: %TEMP%\\focusstudy-bridge.log',
  },
  fa: {
    privacy: 'فقط عنوان تب و نام دامنه به FocusStudy فرستاده می‌شود؛ بدون URL، محتوا یا کوکی.',
    copy: 'کپی',
    copied: 'کپی شد',
    test: 'تست اتصال Native Host',
    testing: 'در حال تست…',
    ok: 'اتصال برقرار شد ✓',
    fail: 'Native Host پیدا نشد.',
    failErr: 'خطای Native Host:',
    fix: 'FocusStudy نسخه ۱.۱+ را نصب کنید، در تنظیمات ← Browser Bridge این شناسه را وارد کنید و سپس مرورگر را ری‌استارت کنید.',
    step1: 'در FocusStudy: تنظیمات ← Browser Bridge را باز کنید.',
    step2: 'شناسهٔ افزونهٔ بالا را در برنامه وارد کنید.',
    step3: 'مرورگر را ری‌استارت کنید.',
    logHint: 'برای عیب‌یابی: %TEMP%\\focusstudy-bridge.log',
  },
};

// Persian UI when the browser (or Windows) language is Persian.
const browserLang = (chrome.i18n && chrome.i18n.getUILanguage && chrome.i18n.getUILanguage()) || navigator.language || 'en';
const lang = browserLang.toLowerCase().startsWith('fa') ? 'fa' : 'en';
const L = STRINGS[lang];

document.documentElement.lang = lang;
document.documentElement.dir = lang === 'fa' ? 'rtl' : 'ltr';
document.querySelectorAll('[data-i18n]').forEach((el) => {
  const key = el.getAttribute('data-i18n');
  if (L[key]) el.textContent = L[key];
});

const idInput = document.getElementById('ext-id');
const statusBox = document.getElementById('status');
const testBtn = document.getElementById('test-host');
const copyBtn = document.getElementById('copy-id');

idInput.value = chrome.runtime.id;

copyBtn.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(chrome.runtime.id);
    copyBtn.textContent = L.copied;
  } catch {
    idInput.select();
    document.execCommand('copy');
    copyBtn.textContent = L.copied;
  }
  setTimeout(() => (copyBtn.textContent = L.copy), 1500);
});

function showStatus(className, text) {
  statusBox.style.display = 'block';
  statusBox.className = 'status ' + className;
  statusBox.textContent = text;
}

testBtn.addEventListener('click', async () => {
  showStatus('fail', L.testing);
  const restoreTestBtn = testBtn.textContent;
  testBtn.disabled = true;
  try {
    const res = await chrome.runtime.sendMessage({ type: 'ping' });
    if (res && res.ok) {
      showStatus('ok', L.ok);
    } else {
      const err = res && res.error ? ` ${L.failErr} ${res.error}` : '';
      showStatus('fail', `${L.fail}${err} ${L.fix}`);
    }
  } catch {
    showStatus('fail', `${L.fail} ${L.fix}`);
  } finally {
    testBtn.disabled = false;
    testBtn.textContent = restoreTestBtn;
  }
});
