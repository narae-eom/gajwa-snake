// Two-set Korean fallback for an English keyboard. Native IME composition is never intercepted.
const INITIAL = [...'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ'];
const MEDIAL = [...'ㅏㅐㅑㅒㅓㅔㅕㅖㅗㅘㅙㅚㅛㅜㅝㅞㅟㅠㅡㅢㅣ'];
const FINAL = ['', ...'ㄱㄲㄳㄴㄵㄶㄷㄹㄺㄻㄼㄽㄾㄿㅀㅁㅂㅄㅅㅆㅇㅈㅊㅋㅌㅍㅎ'];
const KEYS = Object.fromEntries([...'rsefaqtdwczxvgkoiOjpuPhynbml'].map((key, i) => [key, [...'ㄱㄴㄷㄹㅁㅂㅅㅇㅈㅊㅋㅌㅍㅎㅏㅐㅑㅒㅓㅔㅕㅖㅗㅛㅜㅠㅡㅣ'][i]]));
Object.assign(KEYS, {R:'ㄲ', E:'ㄸ', Q:'ㅃ', T:'ㅆ', W:'ㅉ'});
const VOWEL_PAIRS = {'ㅗㅏ':'ㅘ','ㅗㅐ':'ㅙ','ㅗㅣ':'ㅚ','ㅜㅓ':'ㅝ','ㅜㅔ':'ㅞ','ㅜㅣ':'ㅟ','ㅡㅣ':'ㅢ','ㅘㅣ':'ㅙ','ㅝㅣ':'ㅞ'};
const FINAL_PAIRS = {'ㄱㅅ':'ㄳ','ㄴㅈ':'ㄵ','ㄴㅎ':'ㄶ','ㄹㄱ':'ㄺ','ㄹㅁ':'ㄻ','ㄹㅂ':'ㄼ','ㄹㅅ':'ㄽ','ㄹㅌ':'ㄾ','ㄹㅍ':'ㄿ','ㄹㅎ':'ㅀ','ㅂㅅ':'ㅄ'};
const SPLIT_FINAL = Object.fromEntries(Object.entries(FINAL_PAIRS).map(([pair, combined]) => [combined, [...pair]]));

export function romanToHangul(raw) {
  let output = '', lead = '', vowel = '', tail = '';
  const syllable = () => lead && vowel
    ? String.fromCharCode(0xac00 + INITIAL.indexOf(lead) * 588 + MEDIAL.indexOf(vowel) * 28 + FINAL.indexOf(tail))
    : lead + vowel + tail;
  const flush = () => { output += syllable(); lead = vowel = tail = ''; };
  for (const key of raw) {
    const jamo = KEYS[key] || KEYS[key.toLowerCase()];
    if (!jamo) { flush(); output += key; continue; }
    if (MEDIAL.includes(jamo)) {
      if (tail) {
        const split = SPLIT_FINAL[tail];
        const nextLead = split ? split[1] : tail;
        tail = split ? split[0] : '';
        flush(); lead = nextLead; vowel = jamo;
      } else if (vowel) {
        const combined = VOWEL_PAIRS[vowel + jamo];
        if (combined) vowel = combined;
        else { flush(); vowel = jamo; }
      } else vowel = jamo;
    } else if (lead && vowel) {
      const combined = tail && FINAL_PAIRS[tail + jamo];
      if (combined) tail = combined;
      else if (!tail && FINAL.includes(jamo)) tail = jamo;
      else { flush(); lead = jamo; }
    } else {
      flush(); lead = jamo;
    }
  }
  return output + syllable();
}

export function installKoreanNameInput(input, toggle, hint) {
  let korean = true, composing = false, editing = false, segment = null;
  const clearSegment = () => { segment = null; };
  const matchesSegment = () => segment && input.selectionStart === segment.end && input.selectionEnd === segment.end
    && input.value.slice(segment.start, segment.end) === segment.text;
  const replaceSegment = raw => {
    const text = romanToHangul(raw);
    const limit = input.maxLength > 0 ? input.maxLength : 20;
    if (input.value.length - (segment.end - segment.start) + text.length > limit) return;
    editing = true;
    input.setRangeText(text, segment.start, segment.end, 'end');
    segment = {...segment, raw, text, end: segment.start + text.length};
    input.dispatchEvent(new Event('input', {bubbles:true}));
    editing = false;
  };
  const updateMode = () => {
    input.lang = korean ? 'ko' : 'en';
    input.inputMode = 'text';
    input.placeholder = korean ? '이름을 한글로 입력하세요' : '이름을 입력하세요';
    toggle.textContent = korean ? '한글 입력' : '영문 입력';
    toggle.dataset.mode = korean ? 'ko' : 'en';
    toggle.setAttribute('aria-pressed', String(korean));
    toggle.setAttribute('aria-label', korean ? '영문 입력으로 전환' : '한글 입력으로 전환');
    hint.textContent = korean ? '기본 한글 입력 · 영문 자판으로 쳐도 한글로 조합돼요.' : '영문 입력 · 필요하면 PC의 한/영 키도 전환해 주세요.';
  };
  input.addEventListener('compositionstart', () => { composing = true; clearSegment(); });
  input.addEventListener('compositionend', () => { composing = false; clearSegment(); });
  input.addEventListener('beforeinput', event => {
    if (!korean || composing || event.isComposing || !event.cancelable) { clearSegment(); return; }
    if (event.inputType === 'insertText' && /^[a-zA-Z]$/.test(event.data || '')) {
      event.preventDefault();
      if (!matchesSegment()) segment = {raw:'', text:input.value.slice(input.selectionStart, input.selectionEnd), start:input.selectionStart, end:input.selectionEnd};
      replaceSegment(segment.raw + event.data);
    } else if (event.inputType === 'deleteContentBackward' && matchesSegment() && segment.raw) {
      event.preventDefault(); replaceSegment(segment.raw.slice(0, -1));
    } else clearSegment(); // Paste, native Korean, spaces, undo and other edits remain the browser's job.
  });
  input.addEventListener('input', () => { if (!editing) clearSegment(); });
  input.addEventListener('keydown', event => {
    if (event.ctrlKey || event.metaKey || event.altKey || ['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End','Delete','Tab','Enter'].includes(event.key)) clearSegment();
  });
  input.addEventListener('pointerdown', clearSegment);
  input.addEventListener('blur', clearSegment);
  toggle.addEventListener('click', () => {
    korean = !korean; clearSegment(); updateMode(); input.focus({preventScroll:true});
  });
  updateMode();
}
