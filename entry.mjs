import {parseStudentId} from './engine.mjs';
import {$, loadProfile, saveProfile} from './common.mjs';

const idInput = $('#student-id'), nameInput = $('#student-name'), preview = $('#id-preview'), error = $('#entry-error');
const existing = loadProfile();
if (existing) {
  idInput.value = existing.studentId;
  nameInput.value = existing.name;
}

function updatePreview() {
  idInput.value = idInput.value.replace(/[^0-9]/g, '').slice(0, 5);
  const parsed = parseStudentId(idInput.value);
  preview.classList.toggle('ok', !!parsed);
  if (parsed) preview.textContent = parsed.grade + '학년 ' + parsed.classNo + '반 ' + parsed.number + '번';
  else if (idInput.value.length === 5) preview.textContent = '학번을 다시 확인해 주세요. 예: 10203 = 1학년 2반 3번';
  else preview.textContent = '학번 5자리 = 학년 1자리 + 반 2자리 + 번호 2자리';
  error.textContent = '';
}
idInput.addEventListener('input', updatePreview);
nameInput.addEventListener('input', () => { error.textContent = ''; });
updatePreview();

$('#entry-form').addEventListener('submit', event => {
  event.preventDefault();
  const parsed = parseStudentId(idInput.value);
  const name = nameInput.value.trim().normalize('NFC');
  if (!parsed) {
    error.textContent = '학번 5자리를 정확히 입력해 주세요. 예: 10203';
    idInput.focus();
    return;
  }
  if (!name || name.length > 20 || /[<>=]/.test(name)) {
    error.textContent = '이름을 정확히 입력해 주세요.';
    nameInput.focus();
    return;
  }
  saveProfile({studentId: parsed.studentId, name});
  location.href = 'play.html';
});
(existing ? nameInput : idInput).focus();
