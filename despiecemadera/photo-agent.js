const $ = selector => document.querySelector(selector);
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
let supabase = null;
let session = null;
let selectedFile = null;
let previewUrl = null;
let currentProposal = null;
let requestedDimensions = null;

function setStatus(id, message, isError) {
  const status = document.getElementById(id);
  status.textContent = message;
  status.dataset.error = isError ? 'true' : 'false';
}

function updateControls() {
  const signedIn = Boolean(session);
  $('#photo-file').disabled = !signedIn;
  $('#photo-consent').disabled = !signedIn;
  $('#photo-paste').disabled = !signedIn;
  $('#analyze-photo').disabled = !(supabase && signedIn && selectedFile && $('#photo-consent').checked);
}

function setPreview(file) {
  const preview = $('#photo-preview');
  if (previewUrl) URL.revokeObjectURL(previewUrl);
  previewUrl = file ? URL.createObjectURL(file) : null;
  preview.hidden = !previewUrl;
  if (previewUrl) preview.src = previewUrl;
}

function setPhoto(file, source) {
  selectedFile = null;
  setPreview(null);
  if (!file) {
    setStatus('photo-status', '', false);
    updateControls();
    return;
  }
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
    setStatus('photo-status', 'Usa una imagen JPG, PNG o WebP.', true);
  } else if (file.size > MAX_IMAGE_BYTES) {
    setStatus('photo-status', 'La imagen debe pesar 4 MB o menos.', true);
  } else {
    selectedFile = file;
    setPreview(file);
    setStatus('photo-status', source === 'clipboard' ? 'Imagen pegada y lista para analizar.' : 'Foto lista para analizar.', false);
  }
  updateControls();
}

$('#photo-file').addEventListener('change', event => {
  setPhoto(event.target.files[0] || null, 'file');
});

$('#photo-paste').addEventListener('click', async () => {
  if (!navigator.clipboard || typeof navigator.clipboard.read !== 'function') {
    setStatus('photo-status', 'Este navegador no permite leer imágenes del portapapeles. Usa Ctrl+V o selecciona un archivo.', true);
    return;
  }
  try {
    const items = await navigator.clipboard.read();
    for (const item of items) {
      const mimeType = item.types.find(type => ['image/png', 'image/jpeg', 'image/webp'].includes(type));
      if (!mimeType) continue;
      const blob = await item.getType(mimeType);
      const extension = mimeType.split('/')[1].replace('jpeg', 'jpg');
      setPhoto(new File([blob], 'imagen-portapapeles.' + extension, { type: mimeType }), 'clipboard');
      return;
    }
    setStatus('El portapapeles no contiene una imagen compatible.', true);
  } catch (error) {
    setStatus(error.message || 'No se pudo leer el portapapeles. Revisa el permiso del navegador.', true);
  }
});

document.addEventListener('paste', event => {
  if ($('#p-foto').hidden || !session) return;
  const items = Array.from(event.clipboardData?.items || []);
  const image = items.find(item => item.type.startsWith('image/'));
  const file = image && image.getAsFile();
  if (!file) return;
  event.preventDefault();
  setPhoto(file, 'clipboard');
});

$('#photo-consent').addEventListener('change', updateControls);

function readAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1]);
    reader.onerror = () => reject(new Error('No se pudo leer la imagen.'));
    reader.readAsDataURL(file);
  });
}

function makeInput(value, type, field, label) {
  const input = document.createElement('input');
  input.type = type;
  input.value = value;
  input.dataset.field = field;
  input.setAttribute('aria-label', label);
  if (type === 'number') {
    input.min = field === 'q' ? '1' : '0';
    input.step = 'any';
  }
  return input;
}

function makeMaterialSelect(family, selected) {
  const select = document.createElement('select');
  select.dataset.field = 'mat';
  select.setAttribute('aria-label', 'Material');
  Object.entries(window.MATERIAL_CATALOG || {}).forEach(([id, material]) => {
    if (material.family !== family) return;
    const option = document.createElement('option');
    option.value = id;
    option.textContent = material.name;
    option.selected = id === selected;
    select.append(option);
  });
  return select;
}

function renderProposal(data) {
  if (!Array.isArray(data.parts) || !data.parts.length) throw new Error('El análisis no devolvió piezas. Prueba con otra foto.');
  currentProposal = data;
  const furnitureNames = {
    desk: 'Escritorio',
    'kitchen-module': 'Módulo de cocina',
    closet: 'Armario',
    shelf: 'Estantería',
    table: 'Mesa',
    other: 'Otro mueble'
  };
  const detectedType = data.furnitureType in furnitureNames ? data.furnitureType : 'other';
  $('#furniture-type').value = detectedType;
  $('#photo-identity').textContent = 'Mueble identificado: ' + furnitureNames[detectedType] + '.';
  const suggested = data.suggestedDimensions || {};
  const keys = [
    ['width', 'widthMm', 'dim-width'],
    ['height', 'heightMm', 'dim-height'],
    ['depth', 'depthMm', 'dim-depth']
  ];
  keys.forEach(([, responseKey, inputId]) => {
    const input = document.getElementById(inputId);
    if (!input.value && Number.isFinite(Number(suggested[responseKey]))) input.value = suggested[responseKey];
  });
  const confidence = Math.round(Math.max(0, Math.min(1, Number(data.dimensionConfidence) || 0)) * 100);
  const allDimensionsProvided = requestedDimensions && Object.values(requestedDimensions).every(value => value !== null);
  $('#photo-dimensions').textContent = 'Dimensiones exteriores: ' +
    ['widthMm', 'heightMm', 'depthMm'].map(key => suggested[key]).join(' × ') + ' mm. ' +
    (allDimensionsProvided ? 'Tomadas de tus medidas.' : 'Estimación aproximada de la IA (' + confidence + '% de confianza); revisa y corrige antes de continuar.');
  $('#photo-summary').textContent = data.summary || 'Revisa la propuesta antes de calcular los cortes.';
  const assumptions = $('#photo-assumptions');
  assumptions.replaceChildren();
  (data.assumptions || []).forEach(text => {
    const item = document.createElement('li');
    item.textContent = text;
    assumptions.append(item);
  });

  const table = document.createElement('table');
  table.className = 'pieces';
  const headers = ['Pieza', 'Material', 'Largo (mm)', 'Ancho (mm)', 'Espesor (mm)', 'Cantidad', 'Tipo'];
  const head = document.createElement('thead');
  const headRow = document.createElement('tr');
  headers.forEach(text => {
    const cell = document.createElement('th');
    cell.textContent = text;
    headRow.append(cell);
  });
  head.append(headRow);
  table.append(head);

  const body = document.createElement('tbody');
  data.parts.forEach(part => {
    const row = document.createElement('tr');
    const kind = part.type === 'L' ? 'L' : 'T';
    const values = [
      makeInput(part.name || 'Pieza', 'text', 'n', 'Pieza'),
      makeMaterialSelect(kind === 'L' ? 'wood' : 'panel', kind === 'L' ? 'wood' : 'melamine'),
      makeInput(part.lengthMm, 'number', 'l', 'Largo'),
      makeInput(part.widthMm || 0, 'number', 'w', 'Ancho'),
      makeInput(part.thicknessMm, 'number', 't', 'Espesor'),
      makeInput(part.quantity || 1, 'number', 'q', 'Cantidad'),
      null
    ];
    const type = document.createElement('select');
    type.dataset.field = 'k';
    type.setAttribute('aria-label', 'Tipo');
    [['T', 'Tablero'], ['L', 'Listón']].forEach(([value, label]) => {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = label;
      option.selected = value === kind;
      type.append(option);
    });
    type.addEventListener('change', () => {
      const family = type.value === 'L' ? 'wood' : 'panel';
      const defaultId = type.value === 'L' ? 'wood' : 'melamine';
      const replacement = makeMaterialSelect(family, defaultId);
      values[1].replaceWith(replacement);
      values[1] = replacement;
    });
    values[6] = type;
    values.forEach(control => {
      const cell = document.createElement('td');
      cell.append(control);
      row.append(cell);
    });
    body.append(row);
  });
  table.append(body);
  $('#photo-parts').replaceChildren(table);
  $('#photo-result').hidden = false;
  $('#apply-photo-parts').disabled = false;
}

$('#apply-photo-parts').addEventListener('click', () => {
  const parts = Array.from($('#photo-parts tbody').rows).map(row => {
    const value = field => row.querySelector('[data-field="' + field + '"]').value;
    return { n: value('n'), mat: value('mat'), l: value('l'), w: value('w'), t: value('t'), q: value('q'), k: value('k') };
  });
  if (typeof window.applyPhotoParts === 'function') window.applyPhotoParts(parts);
});

window.addEventListener('despiece:photo-applied', async event => {
  if (!supabase || !session) return;
  try {
    const { error } = await supabase.from('designs').insert({
      user_id: session.id,
      name: event.detail.name,
      furniture_type: event.detail.furnitureType,
      dimensions: event.detail.dimensions,
      structure: currentProposal || {},
      parts: event.detail.parts
    });
    if (error) throw error;
    setStatus('photo-status', 'Despiece aplicado y guardado en tu cuenta.', false);
  } catch (error) {
    setStatus('photo-status', 'El despiece se aplicó, pero no se pudo guardar en la cuenta: ' + (error.message || 'error de conexión'), true);
  }
});

$('#analyze-photo').addEventListener('click', async () => {
  const dimensions = {
    width: $('#dim-width').value.trim() ? Number($('#dim-width').value) : null,
    height: $('#dim-height').value.trim() ? Number($('#dim-height').value) : null,
    depth: $('#dim-depth').value.trim() ? Number($('#dim-depth').value) : null
  };
  if (!Object.values(dimensions).every(value => value === null || (Number.isFinite(value) && value > 0 && value <= 10000))) {
    setStatus('photo-status', 'Las medidas deben estar en milímetros y ser mayores que cero.', true);
    return;
  }
  requestedDimensions = dimensions;
  const button = $('#analyze-photo');
  button.disabled = true;
  setStatus('photo-status', 'Identificando el mueble y proponiendo su estructura…', false);
  $('#photo-result').hidden = true;
  try {
    if (!selectedFile) throw new Error('Selecciona una foto para analizar.');
    const base64 = await readAsBase64(selectedFile);
    const { data, error } = await supabase.functions.invoke('analyze-furniture', {
      body: {
        image: { mimeType: selectedFile.type, base64 },
        dimensions,
        furnitureType: $('#furniture-type').value
      }
    });
    if (error) {
      let detail = error.message || 'No se pudo analizar la foto.';
      if (error.context && typeof error.context.clone === 'function') {
        try {
          const responseBody = await error.context.clone().json();
          if (responseBody.error) detail = responseBody.error;
        } catch {}
      }
      if (/failed to send a request|networkerror|load failed/i.test(detail)) {
        detail = 'No se pudo contactar con la función. Comprueba que analyze-furniture esté desplegada en Supabase.';
      }
      throw new Error(detail);
    }
    renderProposal(data);
    setStatus('photo-status', 'Propuesta generada. Revisa y corrige las piezas antes de aplicarla.', false);
  } catch (error) {
    setStatus('photo-status', error.message || 'No se pudo analizar la foto.', true);
  } finally {
    updateControls();
  }
});

async function init() {
  const appSession = await window.APP_SESSION_READY;
  if (!appSession) return;
  supabase = appSession.supabase;
  session = appSession.mode === 'user' ? appSession.user : null;
  setStatus('photo-status', session
    ? 'La foto solo se envía al aceptar la casilla de consentimiento.'
    : 'Inicia sesión desde Inicio de cuenta para usar el análisis fotográfico.', false);
  updateControls();
}

init();