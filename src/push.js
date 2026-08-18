// FIX: llave pública VAPID — no es secreta, es la que usa el navegador
// para verificar que las notificaciones vengan realmente de nuestro
// servidor. La llave privada correspondiente vive SOLO en el Edge
// Function de Supabase (nunca en el frontend).
const VAPID_PUBLIC_KEY = 'BIW4G3lPysE96Qv2fEZYYCJMmfJeGi8yU6HIwMoeE7l10VD8LreIxAGBxpBSU7nvTh8ICOiDfNm8K2mTTGNb5x8';

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) outputArray[i] = rawData.charCodeAt(i);
  return outputArray;
}

// FIX: true si el navegador/dispositivo soporta push (en iOS solo
// funciona si el CRM ya está agregado a la pantalla de inicio).
export function pushEsCompatible() {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

export async function estaSuscrito() {
  if (!pushEsCompatible()) return false;
  const reg = await navigator.serviceWorker.getRegistration();
  if (!reg) return false;
  const sub = await reg.pushManager.getSubscription();
  return !!sub;
}

// FIX: pide permiso, se suscribe, y guarda la suscripción ligada al
// correo del agente en `push_subscriptions` — de ahí es de donde el
// servidor saca a quién avisarle.
export async function activarNotificaciones(supabase, correo) {
  if (!pushEsCompatible()) return { ok: false, error: 'Este navegador o dispositivo no soporta notificaciones push.' };

  // FIX: respaldo — si no llega el correo por parámetro (por ejemplo, un
  // problema de props/timing), se busca directo de la sesión activa.
  let correoFinal = correo;
  if (!correoFinal) {
    const { data: { user } } = await supabase.auth.getUser();
    correoFinal = user?.email;
  }
  if (!correoFinal) return { ok: false, error: 'No se pudo identificar tu correo — intenta cerrar sesión y volver a entrar.' };

  const reg = await navigator.serviceWorker.register('/service-worker.js');
  await navigator.serviceWorker.ready;

  const permiso = await Notification.requestPermission();
  if (permiso !== 'granted') return { ok: false, error: 'No se concedió el permiso de notificaciones.' };

  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
    });
  }
  const subJson = sub.toJSON();

  const { error } = await supabase.from('push_subscriptions').upsert({
    agente_correo: correoFinal,
    endpoint: subJson.endpoint,
    p256dh: subJson.keys.p256dh,
    auth: subJson.keys.auth,
  }, { onConflict: 'endpoint' });

  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function desactivarNotificaciones(supabase) {
  const reg = await navigator.serviceWorker.getRegistration();
  if (!reg) return { ok: true };
  const sub = await reg.pushManager.getSubscription();
  if (sub) {
    await supabase.from('push_subscriptions').delete().eq('endpoint', sub.endpoint);
    await sub.unsubscribe();
  }
  return { ok: true };
}