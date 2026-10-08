/* ==========================================================================
   pedidos.js — Módulo de pedidos.

   Estados y transiciones permitidas:
     pendiente  → confirmado | rechazado
     confirmado → entregado  | rechazado
     entregado  y rechazado son finales.

   Stock:
     - pendiente:  no toca el stock (los datos del pedido se pueden modificar).
     - confirmado: el pedido está pago y RESERVA los productos (reserved += cant);
                   lo reservado no está disponible para ventas ni otros pedidos.
     - entregado:  los productos se descuentan definitivamente (current -= cant,
                   reserved -= cant).
     - rechazado:  si estaba confirmado, se liberan las reservas y se devuelve el
                   monto pagado (paidAmount pasa a 0 y queda en refundedAmount).
   ========================================================================== */

const ORDER_STATUS_LABEL = {
  pendiente: 'Pendiente',
  confirmado: 'Confirmado',
  entregado: 'Entregado',
  rechazado: 'Rechazado'
};

const ORDER_ALLOWED_TRANSITIONS = {
  pendiente: ['confirmado', 'rechazado'],
  confirmado: ['entregado', 'rechazado'],
  entregado: [],
  rechazado: []
};

let PED_session = null;
let ORDER_cart = [];
let ORDER_increasePct = 0;
let ORDER_discountPct = 0;
let ORDER_paymentMethod = null;
let ORDER_editMode = null;        // null = pedido nuevo, string = id del pedido (pendiente) que se modifica
let ORDER_editOriginal = null;    // snapshot del pedido al abrir la modificación
let CURRENT_orderId = null;       // pedido abierto en el modal de detalle
let ORDER_pendingAction = null;   // { type: 'confirm'|'deliver'|'reject', orderId }

let modalOrderInst, modalOrderDetailInst, modalConfirmOrderActionInst;

document.addEventListener('DOMContentLoaded', () => {
  PED_session = nav_init('pedidos');
  if (!PED_session) return;

  modalOrderInst = M.Modal.init(document.getElementById('modalOrder'), { onCloseStart: resetOrderForm });
  modalOrderDetailInst = M.Modal.init(document.getElementById('modalOrderDetail'), {});
  modalConfirmOrderActionInst = M.Modal.init(document.getElementById('modalConfirmOrderAction'), {});

  fillOrderPaymentSelect();

  document.getElementById('btnNewOrder').addEventListener('click', openNewOrderModal);
  document.getElementById('orderCustomerPhone').addEventListener('input', updateOrderCustomerStatus);
  document.getElementById('orderSearchInput').addEventListener('input', renderOrderSearchResults);
  document.getElementById('btnOrderContinue').addEventListener('click', goToOrderPricingStep);
  document.getElementById('btnOrderBack').addEventListener('click', goToOrderSelectStep);
  document.getElementById('btnSaveOrder').addEventListener('click', onSaveOrderClick);
  document.getElementById('orderIncreasePct').addEventListener('input', onOrderGlobalChange);
  document.getElementById('orderDiscountPct').addEventListener('input', onOrderGlobalChange);
  document.getElementById('orderPaymentMethod').addEventListener('change', onOrderGlobalChange);
  document.getElementById('orderDeliveryType').addEventListener('change', updateAddressVisibility);

  document.getElementById('filterOrderId').addEventListener('input', renderOrdersTable);
  document.getElementById('filterCustomerName').addEventListener('input', renderOrdersTable);
  document.getElementById('filterStatus').addEventListener('change', renderOrdersTable);
  document.getElementById('btnClearFilters').addEventListener('click', clearOrderFilters);

  document.getElementById('btnOrderEdit').addEventListener('click', () => openEditOrderModal(CURRENT_orderId));
  document.getElementById('btnOrderConfirm').addEventListener('click', () => openOrderAction('confirm', CURRENT_orderId));
  document.getElementById('btnOrderDeliver').addEventListener('click', () => openOrderAction('deliver', CURRENT_orderId));
  document.getElementById('btnOrderReject').addEventListener('click', () => openOrderAction('reject', CURRENT_orderId));
  document.getElementById('btnAcceptOrderAction').addEventListener('click', applyOrderAction);

  renderOrdersTable();
});

/* ---------------------- Utilidades ---------------------- */
function escapeHtml(str) {
  return String(str === null || str === undefined ? '' : str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/* Identificador único aleatorio, legible (sin caracteres ambiguos como 0/O, 1/I). */
function generateOrderId() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const existing = new Set(DB.getOrders().map(o => o.id));
  let id;
  do {
    let code = '';
    const bytes = new Uint8Array(6);
    if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
      crypto.getRandomValues(bytes);
    } else {
      for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
    }
    bytes.forEach(b => { code += chars[b % chars.length]; });
    id = 'PED-' + code;
  } while (existing.has(id));
  return id;
}

function statusChipHtml(status) {
  return `<span class="status-chip ${status}">${ORDER_STATUS_LABEL[status] || status}</span>`;
}

function fillOrderPaymentSelect() {
  document.getElementById('orderPaymentMethod').innerHTML =
    PAYMENT_METHODS.map(m => `<option value="${m}">${m}</option>`).join('');
}

/* ---------------------- Disponibilidad de stock ----------------------
   Un pedido pendiente no reserva nada; lo disponible es lo físico menos lo
   reservado por pedidos confirmados. */
function availableForOrder(variantId) {
  const v = DB.getVariants().find(v => v.id === variantId);
  return v ? availableStock(v.stock[PED_session.branchId]) : 0;
}

function getOrderCartQty(variantId) {
  const it = ORDER_cart.find(i => i.variantId === variantId);
  return it ? it.quantity : 0;
}

/* ---------------------- Cliente del pedido ----------------------
   Nombre y teléfono son obligatorios. El nombre NO se autocompleta: solo se
   indica si el teléfono ya está registrado. Un teléfono nuevo registra al
   cliente con el nombre ingresado. */
function updateOrderCustomerStatus() {
  const phone = document.getElementById('orderCustomerPhone').value.trim();
  const el = document.getElementById('orderCustomerStatus');
  if (phone === '') { el.innerHTML = ''; return; }
  el.innerHTML = DB.findCustomerByPhone(phone)
    ? '<span style="color:var(--success);font-weight:600;">✓ Cliente registrado</span>'
    : '<span style="color:var(--gold-500);font-weight:600;">Cliente nuevo</span>';
}

function resolveOrderCustomer() {
  const phone = document.getElementById('orderCustomerPhone').value.trim();
  const name = document.getElementById('orderCustomerName').value.trim();
  if (!phone || !name) {
    return { error: 'Ingresá el nombre y el teléfono del cliente.' };
  }
  return { phone, name, isNewCustomer: !DB.findCustomerByPhone(phone) };
}

function registerCustomerIfNew(customerResult) {
  if (!customerResult.isNewCustomer) return;
  const customers = DB.getCustomers();
  customers.push({
    id: uid('cust'),
    phone: customerResult.phone,
    name: customerResult.name,
    active: true,
    createdAt: nowISO()
  });
  DB.setCustomers(customers);
}

/* ---------------------- Pasos del modal ---------------------- */
function showOrderSelectStepUI() {
  document.getElementById('orderStepSelect').style.display = 'block';
  document.getElementById('orderStepPricing').style.display = 'none';
  document.getElementById('btnOrderBack').style.display = 'none';
  document.getElementById('btnOrderContinue').style.display = 'inline-block';
  document.getElementById('btnSaveOrder').style.display = 'none';
}

function showOrderPricingStepUI() {
  document.getElementById('orderStepSelect').style.display = 'none';
  document.getElementById('orderStepPricing').style.display = 'block';
  document.getElementById('btnOrderBack').style.display = 'inline-block';
  document.getElementById('btnOrderContinue').style.display = 'none';
  document.getElementById('btnSaveOrder').style.display = 'inline-block';
}

function goToOrderPricingStep() {
  const customerResult = resolveOrderCustomer();
  if (customerResult.error) {
    M.toast({ html: customerResult.error });
    return;
  }
  if (ORDER_cart.length === 0) {
    M.toast({ html: 'Seleccioná al menos un producto antes de continuar.' });
    return;
  }
  showOrderPricingStepUI();
  renderOrderItemsTable();
}

function goToOrderSelectStep() {
  showOrderSelectStepUI();
  renderOrderSearchResults();
  renderOrderSelectionSummary();
}

function updateAddressVisibility() {
  const isShipping = document.getElementById('orderDeliveryType').value === 'envio';
  document.getElementById('orderAddressWrap').style.display = isShipping ? 'block' : 'none';
}

function resetOrderForm() {
  ORDER_cart = [];
  ORDER_increasePct = 0;
  ORDER_discountPct = 0;
  ORDER_paymentMethod = PAYMENT_METHODS[0];
  ORDER_editMode = null;
  ORDER_editOriginal = null;
}

function fillOrderFormFields(data) {
  document.getElementById('orderCustomerPhone').value = data.phone || '';
  document.getElementById('orderCustomerName').value = data.name || '';
  updateOrderCustomerStatus();
  document.getElementById('orderSearchInput').value = '';
  document.getElementById('orderIncreasePct').value = data.increasePct || 0;
  document.getElementById('orderDiscountPct').value = data.discountPct || 0;
  document.getElementById('orderPaymentMethod').value = data.paymentMethod || PAYMENT_METHODS[0];
  document.getElementById('orderDeliveryType').value = data.deliveryType || 'retiro';
  document.getElementById('orderAddress').value = data.address || '';
  document.getElementById('orderNotes').value = data.notes || '';
  updateAddressVisibility();
}

function openNewOrderModal() {
  resetOrderForm();
  document.getElementById('orderModalTitle').textContent = 'Registrar pedido';
  document.getElementById('orderModalIdLabel').textContent = '';
  document.getElementById('orderBranch').textContent = DB.getBranchName(PED_session.branchId);
  fillOrderFormFields({});

  showOrderSelectStepUI();
  renderOrderSearchResults();
  renderOrderSelectionSummary();
  modalOrderInst.open();
  M.updateTextFields();
}

function openEditOrderModal(orderId) {
  const order = DB.getOrders().find(o => o.id === orderId);
  if (!order) return;
  if (order.status !== 'pendiente') {
    M.toast({ html: 'Solo se pueden modificar los pedidos pendientes.' });
    return;
  }

  resetOrderForm();
  ORDER_editMode = order.id;
  ORDER_editOriginal = JSON.parse(JSON.stringify(order));
  ORDER_cart = order.items.map(it => ({
    variantId: it.variantId, productId: it.productId,
    name: it.name, description: it.description,
    size: it.size, color: it.color, photo: it.photo,
    priceList: it.priceList, quantity: it.quantity
  }));
  ORDER_increasePct = order.increasePct || 0;
  ORDER_discountPct = order.discountPct || 0;
  ORDER_paymentMethod = order.paymentMethod;

  document.getElementById('orderModalTitle').textContent = 'Modificar pedido';
  document.getElementById('orderModalIdLabel').textContent = ' · ' + order.id;
  document.getElementById('orderBranch').textContent = DB.getBranchName(order.branchId);
  fillOrderFormFields({
    phone: order.customerPhone, name: order.customerName,
    increasePct: order.increasePct, discountPct: order.discountPct,
    paymentMethod: order.paymentMethod, deliveryType: order.deliveryType,
    address: order.address, notes: order.notes
  });

  modalOrderDetailInst.close();
  showOrderSelectStepUI();
  renderOrderSearchResults();
  renderOrderSelectionSummary();
  modalOrderInst.open();
  M.updateTextFields();
}

/* ---------------------- Paso 1: búsqueda y selección por lotes ---------------------- */
function renderOrderSearchResults() {
  const term = document.getElementById('orderSearchInput').value.trim().toLowerCase();
  const branchId = PED_session.branchId;
  const products = DB.getProducts().filter(p =>
    p.active && p.branchesSold.includes(branchId) && (term === '' || p.name.toLowerCase().includes(term))
  );

  const container = document.getElementById('orderSearchResults');
  if (products.length === 0) {
    container.innerHTML = `<p style="color:var(--text-muted);padding:10px 0;">No se encontraron productos.</p>`;
    return;
  }

  container.innerHTML = products.map(p => {
    const variants = DB.getVariantsByProduct(p.id)
      .filter(v => v.active && v.stock[branchId])
      .sort((a, b) => SIZES.indexOf(a.size) - SIZES.indexOf(b.size));

    const sizesHtml = variants.map(v => {
      const inCart = getOrderCartQty(v.id);
      const remaining = availableForOrder(v.id) - inCart;
      const disabled = remaining <= 0;
      const price = v.stock[branchId].price;
      return `<span class="size-btn ${disabled ? 'disabled' : ''} ${inCart > 0 ? 'in-cart' : ''}"
                    ${disabled ? '' : `onclick="addToOrderCart('${p.id}','${v.id}')"`}>
                ${v.size} · ${formatMoney(price)}
                <small style="color:var(--text-muted);">(${remaining}${inCart > 0 ? ' · en pedido: ' + inCart : ''})</small>
              </span>`;
    }).join('') || '<span style="color:var(--text-muted);font-size:0.8rem;">Sin talles disponibles</span>';

    return `
      <div class="search-product-row">
        <img src="${p.photo}">
        <div style="flex:1;">
          <div style="font-weight:600;">${p.name}</div>
          <div style="font-size:0.76rem;color:var(--text-muted);margin-bottom:4px;">${p.color}</div>
          <div>${sizesHtml}</div>
        </div>
      </div>
    `;
  }).join('');
}

function renderOrderSelectionSummary() {
  const list = document.getElementById('orderSelectionSummary');
  const emptyMsg = document.getElementById('noOrderSelectionMsg');

  if (ORDER_cart.length === 0) {
    emptyMsg.style.display = 'block';
    list.innerHTML = '';
    return;
  }
  emptyMsg.style.display = 'none';

  list.innerHTML = ORDER_cart.map((item, idx) => `
    <div class="selection-row">
      <img class="sale-item-thumb" src="${item.photo}">
      <div style="flex:1;">
        <div style="font-weight:600;">${item.name}</div>
        <div style="font-size:0.76rem;color:var(--text-muted);">Talle ${item.size} · ${item.color}</div>
      </div>
      <div class="qty-stepper">
        <button type="button" onclick="changeOrderQty(${idx},-1)">−</button>
        <input type="number" min="1" value="${item.quantity}" onchange="updateOrderCartField(${idx},'quantity',this.value)">
        <button type="button" onclick="changeOrderQty(${idx},1)">+</button>
      </div>
      <i class="material-icons" style="cursor:pointer;color:var(--danger);" onclick="removeOrderCartItem(${idx})">close</i>
    </div>
  `).join('');
}

function addToOrderCart(productId, variantId) {
  const product = DB.getProducts().find(p => p.id === productId);
  const variant = DB.getVariants().find(v => v.id === variantId);
  if (!product || !variant) return;
  const branchId = PED_session.branchId;
  const variantPrice = variant.stock[branchId] ? variant.stock[branchId].price : 0;

  const existing = ORDER_cart.find(i => i.variantId === variantId);
  if (existing) {
    if (availableForOrder(variantId) - existing.quantity < 1) {
      M.toast({ html: 'No hay más stock disponible para agregar.' });
      return;
    }
    existing.quantity += 1;
  } else {
    if (availableForOrder(variantId) < 1) {
      M.toast({ html: 'No hay stock disponible para este talle.' });
      return;
    }
    ORDER_cart.push({
      variantId, productId,
      name: product.name, description: product.description,
      size: variant.size, color: product.color, photo: product.photo,
      priceList: variantPrice, quantity: 1
    });
  }
  refreshOrderCartViews();
}

function refreshOrderCartViews() {
  renderOrderSearchResults();
  renderOrderSelectionSummary();
  renderOrderItemsTable();
}

function updateOrderCartField(idx, field, value) {
  const item = ORDER_cart[idx];
  if (!item) return;
  if (field === 'quantity') {
    let q = parseInt(value) || 1;
    if (q < 1) q = 1;
    const max = availableForOrder(item.variantId);
    if (q > max) {
      M.toast({ html: `Solo hay ${max} unidades disponibles para este talle.` });
      q = max < 1 ? 1 : max;
    }
    item.quantity = q;
  } else {
    item[field] = parseFloat(value) || 0;
  }
  refreshOrderCartViews();
}

function changeOrderQty(idx, delta) {
  const item = ORDER_cart[idx];
  if (!item) return;
  const newQty = item.quantity + delta;
  if (delta > 0 && newQty > availableForOrder(item.variantId)) {
    M.toast({ html: 'No hay más stock disponible para este talle.' });
    return;
  }
  item.quantity = Math.max(1, newQty);
  refreshOrderCartViews();
}

function removeOrderCartItem(idx) {
  ORDER_cart.splice(idx, 1);
  refreshOrderCartViews();
}

/* ---------------------- Paso 2: precio unitario, % global, pago y entrega ---------------------- */
function onOrderGlobalChange() {
  ORDER_increasePct = parseFloat(document.getElementById('orderIncreasePct').value) || 0;
  ORDER_discountPct = parseFloat(document.getElementById('orderDiscountPct').value) || 0;
  ORDER_paymentMethod = document.getElementById('orderPaymentMethod').value;
  renderOrderItemsTable();
}

function computeOrderItemUnit(item) {
  const base = Number(item.priceList) || 0;
  return base * (1 + ORDER_increasePct / 100 - ORDER_discountPct / 100);
}

function computeOrderItemSubtotal(item) {
  return computeOrderItemUnit(item) * item.quantity;
}

function computeOrderTotal() {
  return ORDER_cart.reduce((sum, it) => sum + computeOrderItemSubtotal(it), 0);
}

function renderOrderItemsTable() {
  const tbody = document.getElementById('orderItemsTbody');
  const emptyMsg = document.getElementById('noOrderItemsMsg');

  if (ORDER_cart.length === 0) {
    emptyMsg.style.display = 'block';
    tbody.innerHTML = '';
  } else {
    emptyMsg.style.display = 'none';
    tbody.innerHTML = ORDER_cart.map((item, idx) => `
      <tr class="sale-item-row">
        <td>
          <div style="display:flex;align-items:center;gap:8px;">
            <img class="sale-item-thumb" src="${item.photo}">
            <div>
              <div style="font-weight:600;">${item.name}</div>
              <div style="font-size:0.74rem;color:var(--text-muted);max-width:160px;">${item.description || ''}</div>
            </div>
          </div>
        </td>
        <td>${item.size}</td>
        <td>${item.color}</td>
        <td><input type="number" class="price-input" min="0" step="0.01" value="${item.priceList}" onchange="updateOrderCartField(${idx},'priceList',this.value)"></td>
        <td>
          <div class="qty-stepper">
            <button type="button" onclick="changeOrderQty(${idx},-1)">−</button>
            <input type="number" min="1" value="${item.quantity}" onchange="updateOrderCartField(${idx},'quantity',this.value)">
            <button type="button" onclick="changeOrderQty(${idx},1)">+</button>
          </div>
        </td>
        <td><strong>${formatMoney(computeOrderItemSubtotal(item))}</strong></td>
        <td><i class="material-icons" style="cursor:pointer;color:var(--danger);" onclick="removeOrderCartItem(${idx})">close</i></td>
      </tr>
    `).join('');
  }
  document.getElementById('orderTotalAmount').textContent = formatMoney(computeOrderTotal());
}

/* ---------------------- Guardar (alta / modificación) ---------------------- */
function buildOrderItemsSnapshot() {
  return ORDER_cart.map(item => ({
    variantId: item.variantId,
    productId: item.productId,
    name: item.name,
    description: item.description,
    size: item.size,
    color: item.color,
    photo: item.photo,
    priceList: item.priceList,
    unitPrice: computeOrderItemUnit(item),
    quantity: item.quantity,
    subtotal: computeOrderItemSubtotal(item)
  }));
}

/* Valida el formulario completo y devuelve los datos listos para guardar,
   o { error }. */
function collectOrderFormData() {
  if (ORDER_cart.length === 0) return { error: 'Agregá al menos un producto al pedido.' };

  const customerResult = resolveOrderCustomer();
  if (customerResult.error) return { error: customerResult.error };

  for (const item of ORDER_cart) {
    const available = availableForOrder(item.variantId);
    if (item.quantity > available) {
      return { error: `Stock insuficiente para ${item.name} (talle ${item.size}). Disponible: ${available}.` };
    }
  }

  const deliveryType = document.getElementById('orderDeliveryType').value;
  const address = document.getElementById('orderAddress').value.trim();
  if (deliveryType === 'envio' && !address) {
    return { error: 'Ingresá la dirección para el envío a domicilio.' };
  }

  return {
    customerResult,
    deliveryType,
    address: deliveryType === 'envio' ? address : null,
    notes: document.getElementById('orderNotes').value.trim()
  };
}

function onSaveOrderClick() {
  const data = collectOrderFormData();
  if (data.error) {
    M.toast({ html: data.error });
    return;
  }

  if (ORDER_editMode) {
    saveEditedOrder(data);
  } else {
    saveNewOrder(data);
  }
}

function saveNewOrder(data) {
  if (!confirm('¿Confirmás registrar este pedido? Quedará en estado Pendiente y todavía no reserva stock.')) return;

  registerCustomerIfNew(data.customerResult);

  const items = buildOrderItemsSnapshot();
  const order = {
    id: generateOrderId(),
    createdAt: nowISO(),
    branchId: PED_session.branchId,
    userId: PED_session.userId,
    userName: PED_session.name,
    customerName: data.customerResult.name,
    customerPhone: data.customerResult.phone,
    items,
    increasePct: ORDER_increasePct,
    discountPct: ORDER_discountPct,
    paymentMethod: ORDER_paymentMethod || PAYMENT_METHODS[0],
    deliveryType: data.deliveryType,
    address: data.address,
    notes: data.notes,
    total: items.reduce((s, it) => s + it.subtotal, 0),
    status: 'pendiente',
    paidAmount: 0,
    refundedAmount: 0
  };

  const orders = DB.getOrders();
  orders.push(order);
  DB.setOrders(orders);

  modalOrderInst.close();
  M.toast({ html: `Pedido ${order.id} registrado como pendiente.` });
  renderOrdersTable();
}

function saveEditedOrder(data) {
  const orders = DB.getOrders();
  const order = orders.find(o => o.id === ORDER_editMode);
  if (!order) return;
  if (order.status !== 'pendiente') {
    M.toast({ html: 'Solo se pueden modificar los pedidos pendientes.' });
    return;
  }

  if (!confirm('¿Confirmás guardar los cambios de este pedido?')) return;

  registerCustomerIfNew(data.customerResult);

  order.customerName = data.customerResult.name;
  order.customerPhone = data.customerResult.phone;
  order.items = buildOrderItemsSnapshot();
  order.increasePct = ORDER_increasePct;
  order.discountPct = ORDER_discountPct;
  order.paymentMethod = ORDER_paymentMethod || order.paymentMethod;
  order.deliveryType = data.deliveryType;
  order.address = data.address;
  order.notes = data.notes;
  order.total = order.items.reduce((s, it) => s + it.subtotal, 0);
  order.editedAt = nowISO();
  order.editedBy = PED_session.name;
  DB.setOrders(orders);

  const id = order.id;
  modalOrderInst.close();
  M.toast({ html: `Pedido ${id} modificado correctamente.` });
  renderOrdersTable();
}

/* ---------------------- Cambios de estado ---------------------- */
function itemsListHtml(items, sign, color) {
  return items.map(it => `
    <div class="diff-row">
      <span><strong>${it.name}</strong> — Talle ${it.size}</span>
      <span style="color:${color};font-weight:700;">${sign}${it.quantity}</span>
    </div>`).join('');
}

/* Devuelve las faltantes de stock (disponible < cantidad) para confirmar un pedido. */
function findOrderShortages(order) {
  const variants = DB.getVariants();
  const shortages = [];
  order.items.forEach(it => {
    const v = variants.find(v => v.id === it.variantId);
    const available = v ? availableStock(v.stock[order.branchId]) : 0;
    if (it.quantity > available) shortages.push({ item: it, available });
  });
  return shortages;
}

function openOrderAction(type, orderId) {
  const order = DB.getOrders().find(o => o.id === orderId);
  if (!order) return;

  const target = { confirm: 'confirmado', deliver: 'entregado', reject: 'rechazado' }[type];
  if (!ORDER_ALLOWED_TRANSITIONS[order.status].includes(target)) {
    M.toast({ html: `Un pedido ${ORDER_STATUS_LABEL[order.status].toLowerCase()} no puede pasar a ${ORDER_STATUS_LABEL[target].toLowerCase()}.` });
    return;
  }

  let title, body;

  if (type === 'confirm') {
    const shortages = findOrderShortages(order);
    if (shortages.length > 0) {
      const s = shortages[0];
      M.toast({ html: `No se puede confirmar: stock insuficiente de ${s.item.name} (talle ${s.item.size}). Disponible: ${s.available}.` });
      return;
    }
    title = 'Confirmar pedido (pago recibido)';
    body = `
      <p style="font-weight:600;margin-bottom:6px;">Se reservan estos productos</p>
      ${itemsListHtml(order.items, '+', 'var(--gold-500)')}
      <div class="diff-row" style="margin-top:12px;"><span>Monto cobrado (${order.paymentMethod})</span><strong>${formatMoney(order.total)}</strong></div>
      <p style="color:var(--text-muted);font-size:0.8rem;margin-top:10px;">Una vez confirmado, el pedido ya no podrá modificarse ni volver a pendiente, y los productos reservados no estarán disponibles para otras ventas o pedidos.</p>`;
  } else if (type === 'deliver') {
    title = 'Marcar pedido como entregado';
    body = `
      <p style="font-weight:600;margin-bottom:6px;">Se descuentan definitivamente del stock</p>
      ${itemsListHtml(order.items, '-', 'var(--danger)')}
      <p style="color:var(--text-muted);font-size:0.8rem;margin-top:10px;">Se liberan las reservas y el stock físico baja. Un pedido entregado no puede rechazarse.</p>`;
  } else {
    title = 'Rechazar pedido';
    if (order.status === 'confirmado') {
      body = `
        <p style="font-weight:600;margin-bottom:6px;">Vuelven a estar disponibles (se liberan las reservas)</p>
        ${itemsListHtml(order.items, '+', 'var(--success)')}
        <div class="diff-row" style="margin-top:12px;"><span>Monto pagado que se descuenta</span><strong style="color:var(--danger);">${formatMoney(order.paidAmount)}</strong></div>`;
    } else {
      body = `<p>El pedido todavía no reservó stock ni fue pagado, así que no hay movimientos de stock ni de dinero que revertir.</p>`;
    }
    body += `<p style="color:var(--text-muted);font-size:0.8rem;margin-top:10px;">Un pedido rechazado no puede volver a abrirse.</p>`;
  }

  ORDER_pendingAction = { type, orderId };
  document.getElementById('orderActionTitle').textContent = title;
  document.getElementById('orderActionBody').innerHTML = body;
  modalConfirmOrderActionInst.open();
}

function applyOrderAction() {
  if (!ORDER_pendingAction) return;
  const { type, orderId } = ORDER_pendingAction;

  const orders = DB.getOrders();
  const order = orders.find(o => o.id === orderId);
  if (!order) return;

  const target = { confirm: 'confirmado', deliver: 'entregado', reject: 'rechazado' }[type];
  if (!ORDER_ALLOWED_TRANSITIONS[order.status].includes(target)) {
    M.toast({ html: 'Esa transición de estado no está permitida.' });
    return;
  }

  const variants = DB.getVariants();
  const branchId = order.branchId;
  const stockEntry = (item) => {
    const v = variants.find(v => v.id === item.variantId);
    return v ? v.stock[branchId] : null;
  };

  if (type === 'confirm') {
    const shortages = findOrderShortages(order);
    if (shortages.length > 0) {
      M.toast({ html: 'El stock cambió y ya no alcanza para confirmar este pedido.' });
      return;
    }
    order.items.forEach(it => {
      const st = stockEntry(it);
      if (st) st.reserved = (st.reserved || 0) + it.quantity;
    });
    order.status = 'confirmado';
    order.paidAmount = order.total;
    order.confirmedAt = nowISO();
    order.confirmedBy = PED_session.name;
  } else if (type === 'deliver') {
    order.items.forEach(it => {
      const st = stockEntry(it);
      if (!st) return;
      st.reserved = Math.max(0, (st.reserved || 0) - it.quantity);
      st.current = Math.max(0, st.current - it.quantity);
    });
    order.status = 'entregado';
    order.deliveredAt = nowISO();
    order.deliveredBy = PED_session.name;
  } else {
    if (order.status === 'confirmado') {
      order.items.forEach(it => {
        const st = stockEntry(it);
        if (st) st.reserved = Math.max(0, (st.reserved || 0) - it.quantity);
      });
      order.refundedAmount = order.paidAmount;
      order.paidAmount = 0;
    }
    order.rejectedFrom = order.status;
    order.status = 'rechazado';
    order.rejectedAt = nowISO();
    order.rejectedBy = PED_session.name;
  }

  DB.setVariants(variants);
  DB.setOrders(orders);

  ORDER_pendingAction = null;
  modalConfirmOrderActionInst.close();
  modalOrderDetailInst.close();
  M.toast({ html: `Pedido ${order.id}: ${ORDER_STATUS_LABEL[order.status].toLowerCase()}.` });
  renderOrdersTable();
  nav_render('pedidos');
}

/* ---------------------- Listado, filtros y detalle ---------------------- */
function clearOrderFilters() {
  document.getElementById('filterOrderId').value = '';
  document.getElementById('filterCustomerName').value = '';
  document.getElementById('filterStatus').value = 'activos';
  renderOrdersTable();
}

/* Por defecto se ocultan los pedidos entregados y rechazados; solo se muestran
   si el filtro de estado lo pide. */
function getFilteredOrders() {
  const idTerm = document.getElementById('filterOrderId').value.trim().toLowerCase();
  const nameTerm = document.getElementById('filterCustomerName').value.trim().toLowerCase();
  const status = document.getElementById('filterStatus').value;

  return DB.getOrders().filter(o => {
    if (o.branchId !== PED_session.branchId) return false;
    if (idTerm && !o.id.toLowerCase().includes(idTerm)) return false;
    if (nameTerm && !o.customerName.toLowerCase().includes(nameTerm)) return false;
    if (status === 'activos') return o.status === 'pendiente' || o.status === 'confirmado';
    if (status === 'todos') return true;
    return o.status === status;
  }).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

function renderOrdersTable() {
  const orders = getFilteredOrders();
  const tbody = document.getElementById('ordersTbody');
  const emptyMsg = document.getElementById('noOrdersMsg');

  if (orders.length === 0) {
    emptyMsg.style.display = 'block';
    tbody.innerHTML = '';
    return;
  }
  emptyMsg.style.display = 'none';

  tbody.innerHTML = orders.map(o => `
    <tr>
      <td><span class="order-id">${o.id}</span></td>
      <td>${formatDateTime(o.createdAt)}</td>
      <td>${escapeHtml(o.customerName)}</td>
      <td>${escapeHtml(o.customerPhone)}</td>
      <td>${o.deliveryType === 'envio' ? 'Envío a domicilio' : 'Retiro'}</td>
      <td><strong>${formatMoney(o.total)}</strong></td>
      <td>${statusChipHtml(o.status)}</td>
      <td><button class="btn-flat btn-small waves-effect" style="border:1px solid var(--border-soft);" onclick="openOrderDetail('${o.id}')">Ver más</button></td>
    </tr>
  `).join('');
}

function openOrderDetail(orderId) {
  const order = DB.getOrders().find(o => o.id === orderId);
  if (!order) return;
  CURRENT_orderId = orderId;

  document.getElementById('orderDetailIdLabel').textContent = order.id;
  document.getElementById('orderDetailStatus').innerHTML = statusChipHtml(order.status);

  let meta = `
    <strong>Fecha:</strong> ${formatDateTime(order.createdAt)} &nbsp;·&nbsp;
    <strong>Registrado por:</strong> ${escapeHtml(order.userName)} &nbsp;·&nbsp;
    <strong>Sucursal:</strong> ${DB.getBranchName(order.branchId)}
    <br><strong>Cliente:</strong> ${escapeHtml(order.customerName)} · ${escapeHtml(order.customerPhone)}
    <br><strong>Entrega:</strong> ${order.deliveryType === 'envio' ? 'Envío a domicilio — ' + escapeHtml(order.address) : 'Retiro en sucursal'}
    <br><strong>Método de pago:</strong> ${order.paymentMethod}`;
  if (order.increasePct || order.discountPct) {
    meta += `<br><strong>% aplicado al pedido:</strong> aumento ${order.increasePct || 0}% · descuento ${order.discountPct || 0}%`;
  }
  if (order.notes) meta += `<br><strong>Aclaraciones:</strong> ${escapeHtml(order.notes)}`;
  if (order.editedAt) meta += `<br><strong>Última modificación:</strong> ${formatDateTime(order.editedAt)} por ${escapeHtml(order.editedBy)}`;
  if (order.confirmedAt) meta += `<br><strong>Confirmado (pagado):</strong> ${formatDateTime(order.confirmedAt)} por ${escapeHtml(order.confirmedBy)} — ${formatMoney(order.total)}`;
  if (order.deliveredAt) meta += `<br><strong>Entregado:</strong> ${formatDateTime(order.deliveredAt)} por ${escapeHtml(order.deliveredBy)}`;
  if (order.rejectedAt) {
    meta += `<br><strong>Rechazado:</strong> ${formatDateTime(order.rejectedAt)} por ${escapeHtml(order.rejectedBy)}`;
    if (order.refundedAmount > 0) meta += ` — monto pagado descontado: ${formatMoney(order.refundedAmount)}`;
  }
  document.getElementById('orderDetailMeta').innerHTML = meta;

  document.getElementById('orderDetailItems').innerHTML = order.items.map(it => `
    <tr>
      <td><div style="display:flex;align-items:center;gap:8px;"><img class="sale-item-thumb" src="${it.photo}"><span>${it.name}</span></div></td>
      <td>${it.size}</td>
      <td>${it.quantity}</td>
      <td>${formatMoney(it.unitPrice)}</td>
      <td>${formatMoney(it.subtotal)}</td>
    </tr>
  `).join('');
  document.getElementById('orderDetailTotal').textContent = formatMoney(order.total);

  // Acciones disponibles según el estado actual
  const allowed = ORDER_ALLOWED_TRANSITIONS[order.status];
  const show = (id, visible) => { document.getElementById(id).style.display = visible ? 'inline-block' : 'none'; };
  show('btnOrderEdit', order.status === 'pendiente');
  show('btnOrderConfirm', allowed.includes('confirmado'));
  show('btnOrderDeliver', allowed.includes('entregado'));
  show('btnOrderReject', allowed.includes('rechazado'));

  modalOrderDetailInst.open();
}
