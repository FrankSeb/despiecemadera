const $ = selector => document.querySelector(selector);
let supabase = null;
let session = null;
let mode = 'login';
const authCallback = (() => {
  const query = new URLSearchParams(location.search);
  const fragment = new URLSearchParams(location.hash.slice(1));
  return {
    error: fragment.get('error_description') || query.get('error_description') || fragment.get('error') || query.get('error'),
    errorCode: fragment.get('error_code') || query.get('error_code'),
    returned: query.has('code') || fragment.has('access_token') || fragment.has('error') || query.has('error')
  };
})();

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
      ? await supabase.auth.signUp({ email, password, options: { emailRedirectTo: location.origin + location.pathname } })
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
      redirectTo: location.origin + location.pathname
    });
    if (error) throw error;
    setStatus('Si el correo está registrado, recibirás un enlace para restablecer la contraseña.');
  } catch (error) {
    setStatus(error.message || 'No se pudo enviar el enlace.', true);
  }
});

$('#resend-confirmation').addEventListener('click', async () => {
  if (!supabase) return;
  const email = $('#email').value.trim();
  if (!email) {
    setStatus('Escribe el correo de la cuenta para reenviar la confirmación.', true);
    return;
  }
  const button = $('#resend-confirmation');
  button.disabled = true;
  try {
    const { error } = await supabase.auth.resend({
      type: 'signup',
      email,
      options: { emailRedirectTo: location.origin + location.pathname }
    });
    if (error) throw error;
    setStatus('Si la cuenta necesita confirmación, enviaremos un nuevo enlace. Revisa también la carpeta de spam.');
  } catch (error) {
    setStatus(error.message || 'No se pudo reenviar el enlace de confirmación.', true);
  } finally {
    button.disabled = false;
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
    $('#resend-confirmation').disabled = false;
    const { data, error } = await supabase.auth.getSession();
    if (error) throw error;
    showSession(data.session);
    if (authCallback.error) {
      if (authCallback.errorCode === 'otp_expired') {
        $('#resend-confirmation').hidden = false;
        setStatus('El enlace de confirmación venció o ya fue utilizado. Escribe tu correo y solicita uno nuevo.', true);
      } else {
        setStatus('Supabase no pudo confirmar el enlace: ' + authCallback.error, true);
      }
    } else if (authCallback.returned && !data.session) {
      setStatus('El enlace volvió a la app, pero no abrió una sesión. Intenta iniciar sesión; si no funciona, solicita un enlace nuevo.', true);
    } else if (authCallback.returned && data.session) {
      setStatus('Correo confirmado. Tu cuenta ya está activa.');
    }
    supabase.auth.onAuthStateChange((_event, nextSession) => {
      showSession(nextSession);
      if (!nextSession && !authCallback.returned) setStatus('Conectado a Supabase. Inicia sesión o crea una cuenta.');
    });
    if (!data.session && !authCallback.returned) setStatus('Conectado a Supabase. Inicia sesión o crea una cuenta.');
  } catch (error) {
    setStatus(error.message || 'No se pudo conectar con Supabase.', true);
  }
}

init();