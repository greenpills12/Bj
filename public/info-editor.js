'use strict';

const infoForm = document.getElementById('info-form');
const infoFields = document.getElementById('info-fields');
const infoStatus = document.getElementById('info-save-status');
const infoPreview = document.getElementById('info-preview');
const imageInput = document.getElementById('edit-info-image');
const fields = {
  title:document.getElementById('edit-info-title'),
  rules:document.getElementById('edit-info-rules'),
  simulationTitle:document.getElementById('edit-simulation-title'),
  simulationText:document.getElementById('edit-simulation-text'),
  alt:document.getElementById('edit-info-alt')
};
let image = '';

function showGraphic(value) {
  image = value;
  if (value) infoPreview.src = value;
  else infoPreview.removeAttribute('src');
  infoPreview.hidden = !value;
}
function fillInfo(info) {
  for (const [key, field] of Object.entries(fields)) field.value = info[key];
  showGraphic(info.image);
  imageInput.value = '';
}

bankRequest('info').then(info => {
  fillInfo(info);
  infoFields.disabled = false;
}).catch(() => { infoStatus.textContent = 'Could not load the panel. Reload to try again.'; });

imageInput.addEventListener('change', async () => {
  const file = imageInput.files[0];
  if (!file) return;
  if (file.size > 81920 || !['image/png','image/jpeg','image/webp'].includes(file.type)) {
    imageInput.value = '';
    infoStatus.textContent = 'Choose a PNG, JPEG or WebP image up to 80 KB.';
    return;
  }
  infoFields.disabled = true;
  try {
    const reader = new FileReader();
    const data = await new Promise((resolve, reject) => {
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
    showGraphic(data);
    infoStatus.textContent = 'Graphic ready. Save to publish it.';
  } catch {
    infoStatus.textContent = 'Could not read that graphic.';
  } finally {
    infoFields.disabled = false;
  }
});
document.getElementById('remove-info-image').addEventListener('click', () => {
  showGraphic('');
  imageInput.value = '';
  fields.alt.value = '';
  infoStatus.textContent = 'Save to remove the graphic from the player’s panel.';
});
infoForm.addEventListener('submit', async event => {
  event.preventDefault();
  infoFields.disabled = true;
  const copy = Object.fromEntries(Object.entries(fields).map(([key, field]) => [key, field.value]));
  try {
    fillInfo(await bankRequest('info', {...copy, image}));
    infoStatus.textContent = 'Info panel saved.';
  } catch (error) {
    if (error.status === 401) location.replace('/bank/');
    else infoStatus.textContent = error.message || 'Could not save the panel.';
  } finally {
    infoFields.disabled = false;
  }
});
