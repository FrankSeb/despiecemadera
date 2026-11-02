const $ = selector => document.querySelector(selector);
let supabase = null;
let session = null;
let mode = 'login';

function setStatus(message, isError = false) {
  const status = $('#auth-status');
  status.textContent = message;
  status.dataset.error = isError ? 'true' : 'false';
}

function showSession(nextSession) {
  session = nextSession;
  $('#auth-view').hidden = Boolean(session);
  $('#account-view').hidden = !session;
  if (session) {
    $('#account-email').textContent = session.user.email || 'Cuenta activa';
    $('#account-status').textContent = 'Este taller guarda tus cálculos asociados a esta cuenta.';
  }
}

function setMode(nextMode) {
  mode = nextMode;
  const signingUp = mode === 'signup';
  $('#tab-login').setAttribute('aria-selected', String(!signingUp));
  $('#tab-signup').setAttribute('aria-selected', String(signingUp));
  $('#confirm-wrap').hidden = !signingUp;
  $('#password-confirm').required = signingUp;
  $('#password').autocomplete = signingUp ? 'new-password' : 'current-password';
  $('#auth-submit').textContent = signingUp ? 'Crear cuenta' : 'Iniciar sesión';
  $('#reset-password').hidden = signingUp;
  setStatus('');
}

$('#tab-login').addEventListener('click', () => setMode('login'));
$('#tab-signup').addEventListener('click', () => setMode('signup'));

$('#auth-form').addEventListener('submit', async event => {
  event.preventDefault();
  if (!supabase) return;
  const email = $('#email').value.trim();
  const password = $('#password').value;
  if (mode === 'signup' && password !== $('#password-confirm').value) {
    setStatus('Las contraseñas no coinciden.', true);
    return;
  }
  const button = $('#auth-submit');
  button.disabled = true;
  try {
    const result = mode === 'signup'
      ? await supabase.auth.signUp({ email, password, options: { emailRedirectTo: new URL('./index.html', location.href).href } })
      : await supabase.auth.signInWithPassword({ email, password });
    if (result.error) throw result.error;
    if (mode === 'signup' && !result.data.session) {
      setStatus('Cuenta creada. Confirma el correo para activar el acceso.');
    } else {
      showSession(result.data.session);
    }
  } catch (error) {
    setStatus(error.message || 'No se pudo completar el acceso.', true);
  } finally {
    button.disabled = false;
  }
});

$('#reset-password').addEventListener('click', async () => {
  if (!supabase) return;
  const email = $('#email').value.trim();
  if (!email) {
    setStatus('Introduce tu correo para enviarte el enlace.', true);
    return;
  }
  try {
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: new URL('./index.html', location.href).href
    });
    if (error) throw error;
    setStatus('Si el correo está registrado, recibirás un enlace para restablecer la contraseña.');
  } catch (error) {
    setStatus(error.message || 'No se pudo enviar el enlace.', true);
  }
});

$('#password-form').addEventListener('submit', async event => {
  event.preventDefault();
  if (!supabase || !session) return;
  const password = $('#new-password').value;
  try {
    const { error } = await supabase.auth.updateUser({ password });
    if (error) throw error;
    $('#new-password').value = '';
    $('#account-status').textContent = 'Contraseña actualizada.';
  } catch (error) {
    $('#account-status').textContent = error.message || 'No se pudo actualizar la contraseña.';
  }
});

$('#signout').addEventListener('click', async () => {
  if (!supabase) return;
  try {
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
    showSession(null);
  } catch (error) {
    $('#account-status').textContent = error.message || 'No se pudo cerrar sesión.';
  }
});

async function init() {
  const config = window.SUPABASE_CONFIG;
  if (!config || !config.url || !config.anonKey) {
    $('#setup-status').hidden = false;
    $('#setup-status').textContent = 'El acceso con cuenta se habilitará al configurar el proyecto Supabase.';
    setStatus('Supabase todavía no está conectado. Puedes abrir la demostración local.', true);
    return;
  }
  try {
    const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2');
    supabase = createClient(config.url, config.anonKey);
    $('#auth-submit').disabled = false;
    $('#reset-password').disabled = false;
    const { data, error } = await supabase.auth.getSession();
    if (error) throw error;
    showSession(data.session);
    supabase.auth.onAuthStateChange((_event, nextSession) => showSession(nextSession));
  } catch (error) {
    setStatus(error.message || 'No se pudo conectar con Supabase.', true);
  }
}

init();