/* ==========================================================================
   clientes.js — Alta, listado, edición y baja/alta lógica de clientes.
   El teléfono es el dato único de cada cliente. Las ventas ya registradas
   guardan su propia copia del nombre/teléfono del cliente, así que editar
   o dar de baja un cliente nunca modifica ventas pasadas.
   ========================================================================== */

let CUST_session = null;
let modalAddCustomerInst, modalEditCustomerInst;

document.addEventListener('DOMContentLoaded', () => {
  CUST_session = nav_init('clientes');
  if (!CUST_session) return;

  modalAddCustomerInst = M.Modal.init(document.getElementById('modalAddCustomer'), {});
  modalEditCustomerInst = M.Modal.init(document.getElementById('modalEditCustomer'), {});

  document.getElementById('searchName').addEventListener('input', renderCustomersTable);
  document.getElementById('searchPhone').addEventListener('input', renderCustomersTable);
  document.getElementById('searchStatus').addEventListener('change', renderCustomersTable);
  document.getElementById('btnClearFilters').addEventListener('click', clearCustomerFilters);

  document.getElementById('btnOpenAddCustomer').addEventListener('click', openAddCustomerModal);
  document.getElementById('btnSaveNewCustomer').addEventListener('click', saveNewCustomer);
  document.getElementById('btnSaveEditCustomer').addEventListener('click', saveEditCustomer);
  document.getElementById('btnDeactivateCustomer').addEventListener('click', toggleCustomerActive);

  renderCustomersTable();
});

function clearCustomerFilters() {
  document.getElementById('searchName').value = '';
  document.getElementById('searchPhone').value = '';
  document.getElementById('searchStatus').value = '';
  renderCustomersTable();
}

function getFilteredCustomers() {
  const term = document.getElementById('searchName').value.trim().toLowerCase();
  const phoneTerm = document.getElementById('searchPhone').value.trim().toLowerCase();
  const status = document.getElementById('searchStatus').value;

  return DB.getCustomers().filter(c =>
    (term === '' || c.name.toLowerCase().includes(term)) &&
    (phoneTerm === '' || c.phone.toLowerCase().includes(phoneTerm)) &&
    (status === '' || (status === 'activo' ? c.active : !c.active))
  );
}

function renderCustomersTable() {
  const customers = getFilteredCustomers()
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  const tbody = document.getElementById('customersTbody');
  const emptyMsg = document.getElementById('noCustomersMsg');

  if (customers.length === 0) {
    emptyMsg.style.display = 'block';
    tbody.innerHTML = '';
    return;
  }
  emptyMsg.style.display = 'none';

  tbody.innerHTML = customers.map(c => `
    <tr onclick="openEditCustomerModal('${c.id}')" class="${!c.active ? 'low-stock-row' : ''}">
      <td><strong>${c.name}</strong></td>
      <td>${c.phone}</td>
      <td>${c.createdAt ? formatDateTime(c.createdAt) : '—'}</td>
      <td>${c.active ? '<span style="color:var(--success);font-weight:600;">Activo</span>' : '<span class="inactive-tag">De baja</span>'}</td>
    </tr>
  `).join('');
}

function openAddCustomerModal() {
  document.getElementById('add_c_name').value = '';
  document.getElementById('add_c_phone').value = '';
  M.updateTextFields();
  modalAddCustomerInst.open();
}

function saveNewCustomer() {
  const name = document.getElementById('add_c_name').value.trim();
  const phone = document.getElementById('add_c_phone').value.trim();

  if (!name || !phone) {
    M.toast({ html: 'Completá nombre y teléfono.' });
    return;
  }

  const customers = DB.getCustomers();
  if (customers.some(c => c.phone === phone)) {
    M.toast({ html: 'Ya existe un cliente registrado con ese teléfono.' });
    return;
  }

  customers.push({
    id: uid('cust'),
    name, phone,
    active: true,
    createdAt: nowISO()
  });
  DB.setCustomers(customers);

  modalAddCustomerInst.close();
  M.toast({ html: 'Cliente registrado correctamente.' });
  renderCustomersTable();
}

function openEditCustomerModal(customerId) {
  const customer = DB.getCustomers().find(c => c.id === customerId);
  if (!customer) return;

  document.getElementById('edit_c_id').value = customer.id;
  document.getElementById('edit_c_name').value = customer.name;
  document.getElementById('edit_c_phone').value = customer.phone;
  document.getElementById('edit_c_inactiveTag').style.display = customer.active ? 'none' : 'inline-block';
  document.getElementById('btnDeactivateCustomer').innerHTML = customer.active
    ? '<i class="material-icons left">block</i>Dar de baja'
    : '<i class="material-icons left">check_circle</i>Reactivar cliente';

  M.updateTextFields();
  modalEditCustomerInst.open();
}

function saveEditCustomer() {
  const id = document.getElementById('edit_c_id').value;
  const customers = DB.getCustomers();
  const customer = customers.find(c => c.id === id);
  if (!customer) return;

  const name = document.getElementById('edit_c_name').value.trim();
  const phone = document.getElementById('edit_c_phone').value.trim();

  if (!name || !phone) {
    M.toast({ html: 'Completá nombre y teléfono.' });
    return;
  }
  if (customers.some(c => c.id !== id && c.phone === phone)) {
    M.toast({ html: 'Ya existe otro cliente registrado con ese teléfono.' });
    return;
  }

  if (!confirm('¿Confirmás guardar los cambios de este cliente? Las ventas ya registradas no se modifican.')) return;

  customer.name = name;
  customer.phone = phone;
  DB.setCustomers(customers);

  modalEditCustomerInst.close();
  M.toast({ html: 'Cambios guardados.' });
  renderCustomersTable();
}

function toggleCustomerActive() {
  const id = document.getElementById('edit_c_id').value;
  const customers = DB.getCustomers();
  const customer = customers.find(c => c.id === id);
  if (!customer) return;

  const willActivate = !customer.active;
  const msg = willActivate
    ? '¿Reactivar este cliente?'
    : '¿Dar de baja este cliente? Las ventas ya registradas no se ven afectadas.';
  if (!confirm(msg)) return;

  customer.active = willActivate;
  DB.setCustomers(customers);

  modalEditCustomerInst.close();
  M.toast({ html: willActivate ? 'Cliente reactivado.' : 'Cliente dado de baja.' });
  renderCustomersTable();
}
