/* ==========================================================================
   auth.js — Login, sesión y guardas de navegación
   ========================================================================== */

function auth_login(email, password) {
  const users = DB.getUsers();
  const user = users.find(u => u.email.toLowerCase() === String(email).toLowerCase() && u.active);
  if (!user) return { ok: false, error: 'Usuario no encontrado o dado de baja.' };
  if (user.password !== password) return { ok: false, error: 'Contraseña incorrecta.' };

  DB.setSession({
    userId: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    branchId: null
  });
  return { ok: true };
}

function auth_logout() {
  DB.clearSession();
  window.location.href = 'index.html';
}

function auth_setBranch(branchId) {
  const s = DB.getSession();
  if (!s) return;
  s.branchId = branchId;
  DB.setSession(s);
}

/* Requiere que haya sesión iniciada; si no, redirige a login */
function auth_requireLogin() {
  const s = DB.getSession();
  if (!s) {
    window.location.href = 'index.html';
    return null;
  }
  return s;
}

/* Requiere sesión + sucursal elegida; si no, redirige según corresponda */
function auth_requireBranch() {
  const s = auth_requireLogin();
  if (!s) return null;
  if (!s.branchId) {
    window.location.href = 'sucursal.html';
    return null;
  }
  return s;
}

/* Requiere rol admin */
function auth_requireAdmin() {
  const s = auth_requireBranch();
  if (!s) return null;
  if (s.role !== 'admin') {
    alert('No tenés permisos de administrador para acceder a esta sección.');
    window.location.href = 'home.html';
    return null;
  }
  return s;
}

/* Si ya hay sesión completa, evita volver a login/sucursal */
function auth_redirectIfLoggedIn() {
  const s = DB.getSession();
  if (s && s.branchId) {
    window.location.href = 'home.html';
  } else if (s && !s.branchId) {
    window.location.href = 'sucursal.html';
  }
}
