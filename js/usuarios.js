/* ==========================================================================
   usuarios.js — Alta, listado y edición de usuarios (solo administradores)
   ========================================================================== */

let USR_session = null;
let modalAddUserInst, modalEditUserInst;

document.addEventListener('DOMContentLoaded', () => {
  USR_session = nav_init('usuarios', { requireAdmin: true });
  if (!USR_session) return;

  M.FormSelect.init(document.querySelectorAll('select:not(.browser-default)'));
  modalAddUserInst = M.Modal.init(document.getElementById('modalAddUser'), {});
  modalEditUserInst = M.Modal.init(document.getElementById('modalEditUser'), {});

  document.getElementById('searchName').addEventListener('input', renderUsersTable);
  document.getElementById('searchRole').addEventListener('change', renderUsersTable);
  document.getElementById('searchStatus').addEventListener('change', renderUsersTable);
  document.getElementById('btnClearFilters').addEventListener('click', clearUserFilters);

  document.getElementById('btnOpenAddUser').addEventListener('click', openAddUserModal);
  document.getElementById('btnSaveNewUser').addEventListener('click', saveNewUser);
  document.getElementById('btnSaveEditUser').addEventListener('click', saveEditUser);
  document.getElementById('btnDeactivateUser').addEventListener('click', toggleUserActive);

  renderUsersTable();
});

function clearUserFilters() {
  document.getElementById('searchName').value = '';
  document.getElementById('searchRole').value = '';
  document.getElementById('searchStatus').value = '';
  renderUsersTable();
}

function getFilteredUsers() {
  const term = document.getElementById('searchName').value.trim().toLowerCase();
  const role = document.getElementById('searchRole').value;
  const status = document.getElementById('searchStatus').value;

  return DB.getUsers().filter(u =>
    (term === '' || u.name.toLowerCase().includes(term)) &&
    (role === '' || u.role === role) &&
    (status === '' || (status === 'activo' ? u.active : !u.active))
  );
}

function renderUsersTable() {
  const users = getFilteredUsers();
  const tbody = document.getElementById('usersTbody');
  const emptyMsg = document.getElementById('noUsersMsg');

  if (users.length === 0) {
    emptyMsg.style.display = 'block';
    tbody.innerHTML = '';
    return;
  }
  emptyMsg.style.display = 'none';

  tbody.innerHTML = users.map(u => `
    <tr onclick="openEditUserModal('${u.id}')" class="${!u.active ? 'low-stock-row' : ''}">
      <td><strong>${u.name}</strong></td>
      <td>${u.email}</td>
      <td>${u.role === 'admin' ? 'Administrador' : 'Empleado'}</td>
      <td>${u.active ? '<span style="color:var(--success);font-weight:600;">Activo</span>' : '<span class="inactive-tag">De baja</span>'}</td>
    </tr>
  `).join('');
}

function openAddUserModal() {
  document.getElementById('add_u_name').value = '';
  document.getElementById('add_u_email').value = '';
  document.getElementById('add_u_password').value = '';
  document.getElementById('add_u_role').value = 'empleado';
  M.FormSelect.init(document.querySelectorAll('#modalAddUser select'));
  M.updateTextFields();
  modalAddUserInst.open();
}

function saveNewUser() {
  const name = document.getElementById('add_u_name').value.trim();
  const email = document.getElementById('add_u_email').value.trim();
  const password = document.getElementById('add_u_password').value;
  const role = document.getElementById('add_u_role').value;

  if (!name || !email || !password) {
    M.toast({ html: 'Completá todos los campos obligatorios.' });
    return;
  }

  const users = DB.getUsers();
  if (users.some(u => u.email.toLowerCase() === email.toLowerCase())) {
    M.toast({ html: 'Ya existe un usuario con ese correo electrónico.' });
    return;
  }

  users.push({
    id: uid('user'),
    name, email, password, role,
    active: true
  });
  DB.setUsers(users);

  modalAddUserInst.close();
  M.toast({ html: 'Usuario registrado correctamente.' });
  renderUsersTable();
}

function openEditUserModal(userId) {
  const user = DB.getUsers().find(u => u.id === userId);
  if (!user) return;

  document.getElementById('edit_u_id').value = user.id;
  document.getElementById('edit_u_name').value = user.name;
  document.getElementById('edit_u_email').value = user.email;
  document.getElementById('edit_u_role').value = user.role;
  document.getElementById('edit_u_inactiveTag').style.display = user.active ? 'none' : 'inline-block';
  document.getElementById('btnDeactivateUser').innerHTML = user.active
    ? '<i class="material-icons left">block</i>Dar de baja'
    : '<i class="material-icons left">check_circle</i>Reactivar usuario';

  M.FormSelect.init(document.querySelectorAll('#modalEditUser select'));
  M.updateTextFields();
  modalEditUserInst.open();
}

function saveEditUser() {
  const id = document.getElementById('edit_u_id').value;
  const users = DB.getUsers();
  const user = users.find(u => u.id === id);
  if (!user) return;

  const name = document.getElementById('edit_u_name').value.trim();
  const email = document.getElementById('edit_u_email').value.trim();
  const role = document.getElementById('edit_u_role').value;

  if (!name || !email) {
    M.toast({ html: 'Completá todos los campos obligatorios.' });
    return;
  }
  if (users.some(u => u.id !== id && u.email.toLowerCase() === email.toLowerCase())) {
    M.toast({ html: 'Ya existe otro usuario con ese correo electrónico.' });
    return;
  }

  if (!confirm('¿Confirmás guardar los cambios de este usuario?')) return;

  user.name = name;
  user.email = email;
  user.role = role;
  DB.setUsers(users);

  // Si el usuario editado es el que tiene la sesión actual, actualizar sesión
  if (USR_session.userId === id) {
    const s = DB.getSession();
    s.name = name; s.email = email; s.role = role;
    DB.setSession(s);
  }

  modalEditUserInst.close();
  M.toast({ html: 'Cambios guardados.' });
  renderUsersTable();
}

function toggleUserActive() {
  const id = document.getElementById('edit_u_id').value;
  const users = DB.getUsers();
  const user = users.find(u => u.id === id);
  if (!user) return;

  if (id === USR_session.userId && user.active) {
    M.toast({ html: 'No podés dar de baja tu propio usuario mientras estás conectado.' });
    return;
  }

  const willActivate = !user.active;
  const msg = willActivate ? '¿Reactivar este usuario?' : '¿Dar de baja este usuario?';
  if (!confirm(msg)) return;

  user.active = willActivate;
  DB.setUsers(users);

  modalEditUserInst.close();
  M.toast({ html: willActivate ? 'Usuario reactivado.' : 'Usuario dado de baja.' });
  renderUsersTable();
}
