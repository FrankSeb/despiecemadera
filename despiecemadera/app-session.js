window.APP_SESSION_READY = (async () => {
  const config = window.SUPABASE_CONFIG;
  const demo = new URLSearchParams(location.search).get('demo') === '1';

  if (demo) {
    let id = sessionStorage.getItem('despiece.demo-session');
    if (!id) {
      id = crypto.randomUUID();
      sessionStorage.setItem('despiece.demo-session', id);
    }
    return { mode: 'demo', user: { id }, supabase: null, storage: sessionStorage };
  }

  if (!config || !config.url || !config.anonKey) {
    location.replace('./index.html');
    return null;
  }

  try {
    const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2');
    const supabase = createClient(config.url, config.anonKey);
    const { data, error } = await supabase.auth.getSession();
    if (error || !data.session) {
      location.replace('./index.html');
      return null;
    }
    supabase.auth.onAuthStateChange((_event, session) => {
      if (!session) location.replace('./index.html');
    });
    return { mode: 'user', user: data.session.user, supabase, storage: localStorage };
  } catch {
    location.replace('./index.html');
    return null;
  }
})();