/* ==========================================================================
   devoluciones.js — Registro y listado de devoluciones. Dos tipos:
   - Cambio de producto: el cliente devuelve productos (vuelven al stock) y
     se lleva otros (se descuentan del stock); si lo entregado vale más,
     paga la diferencia; si vale menos, no se reembolsa nada.
   - Devolución por falla: productos fallados que NO vuelven al stock pero
     quedan registrados, con reembolso del importe.
   Las devoluciones son independientes de las ventas.
   ========================================================================== */

let DEV_session = null;

let RETURN_type = null;              // 'exchange' | 'defect'
let RETURN_receivedItems = [];       // productos que devuelve el cliente (exchange y defect)
let RETURN_deliveredItems = [];      // productos entregados al cliente (solo exchange)
let RETURN_pendingConfirm = null;    // datos calculados al abrir el modal de confirmación
let CURRENT_returnDetailId = null;
let FILTER_type = '';

let modalReturnTypeInst, modalExchangeReturnInst, modalDefectReturnInst,
    modalConfirmExchangeInst, modalConfirmDefectInst, modalReturnDetailInst;

document.addEventListener('DOMContentLoaded', () => {
  DEV_session = nav_init('devoluciones');
  if (!DEV_session) return;

  modalReturnTypeInst = M.Modal.init(document.getElementById('modalReturnType'), {});
  modalExchangeReturnInst = M.Modal.init(document.getElementById('modalExchangeReturn'), { onCloseStart: resetReturnState });
  modalDefectReturnInst = M.Modal.init(document.getElementById('modalDefectReturn'), { onCloseStart: resetReturnState });
  modalConfirmExchangeInst = M.Modal.init(document.getElementById('modalConfirmExchange'), {});
  modalConfirmDefectInst = M.Modal.init(document.getElementById('modalConfirmDefect'), {});
  modalReturnDetailInst = M.Modal.init(document.getElementById('modalReturnDetail'), {});

  fillPaymentSelect();

  document.getElementById('btnNewReturn').addEventListener('click', () => {
    resetReturnState();
    modalReturnTypeInst.open();
  });

  // Paso 1 (devueltos) — exchange
  document.getElementById('devReceivedSearchInput').addEventListener('input', renderReceivedSearchResults);
  document.getElementById('btnExchangeContinue').addEventListener('click', goToDeliveredStep);
  document.getElementById('btnExchangeBack').addEventListener('click', goBackToReceivedStep);
  document.getElementById('btnSaveExchange').addEventListener('click', onSaveExchangeClick);
  document.getElementById('btnAcceptExchange').addEventListener('click', applyExchangeReturn);

  // Paso 2 (entregados) — exchange
  document.getElementById('devDeliveredSearchInput').addEventListener('input', renderDeliveredSearchResults);

  // Falla
  document.getElementById('devDefectSearchInput').addEventListener('input', renderDefectSearchResults);
  document.getElementById('btnSaveDefect').addEventListener('click', onSaveDefectClick);
  document.getElementById('btnAcceptDefect').addEventListener('click', applyDefectReturn);

  // Listado y filtros
  document.getElementById('filterDateMin').addEventListener('change', renderReturnsTable);
  document.getElementById('filterDateMax').addEventListener('change', renderReturnsTable);
  document.getElementById('filterType').addEventListener('change', () => {
    FILTER_type = document.getElementById('filterType').value;
    renderReturnsTable();
  });
  document.getElementById('btnClearFilters').addEventListener('click', clearFilters);

  renderReturnsTable();
});

function fillPaymentSelect() {
  const select = document.getElementById('exchangeDiffPaymentMethod');
  select.innerHTML = PAYMENT_METHODS.map(m => `<option value="${m}">${m}</option>`).join('');
}

function resetReturnState() {
  RETURN_type = null;
  RETURN_receivedItems = [];
  RETURN_deliveredItems = [];
  RETURN_pendingConfirm = null;
}

/* ==========================================================================
   Cambio de producto
   ========================================================================== */
function startExchangeReturn() {
  resetReturnState();
  RETURN_type = 'exchange';
  modalReturnTypeInst.close();

  document.getElementById('exchangeBranch').textContent = DB.getBranchName(DEV_session.branchId);
  document.getElementById('devReceivedSearchInput').value = '';
  document.getElementById('devDeliveredSearchInput').value = '';

  showExchangeStepReceived();
  renderReceivedSearchResults();
  renderReceivedSelection();
  modalExchangeReturnInst.open();
}

function showExchangeStepReceived() {
  document.getElementById('exchangeStepReceived').style.display = 'block';
  document.getElementById('exchangeStepDelivered').style.display = 'none';
  document.getElementById('btnExchangeBack').style.display = 'none';
  document.getElementById('btnExchangeContinue').style.display = 'inline-block';
  document.getElementById('btnSaveExchange').style.display = 'none';
}

function showExchangeStepDelivered() {
  document.getElementById('exchangeStepReceived').style.display = 'none';
  document.getElementById('exchangeStepDelivered').style.display = 'block';
  document.getElementById('btnExchangeBack').style.display = 'inline-block';
  document.getElementById('btnExchangeContinue').style.display = 'none';
  document.getElementById('btnSaveExchange').style.display = 'inline-block';
}

function goToDeliveredStep() {
  if (RETURN_receivedItems.length === 0) {
    M.toast({ html: 'Agregá al menos un producto que devuelve el cliente.' });
    return;
  }
  showExchangeStepDelivered();
  renderDeliveredSearchResults();
  renderDeliveredSelection();
  updateExchangeSummary();
}

function goBackToReceivedStep() {
  showExchangeStepReceived();
  renderReceivedSearchResults();
  renderReceivedSelection();
}

/* ---------- Paso 1: productos devueltos por el cliente (vuelven al stock) ---------- */
function getReceivedQty(variantId) {
  const it = RETURN_receivedItems.find(i => i.variantId === variantId);
  return it ? it.quantity : 0;
}

function renderReceivedSearchResults() {
  const term = document.getElementById('devReceivedSearchInput').value.trim().toLowerCase();
  const branchId = DEV_session.branchId;
  const products = DB.getProducts().filter(p =>
    p.active && p.branchesSold.includes(branchId) && (term === '' || p.name.toLowerCase().includes(term))
  );

  const container = document.getElementById('devReceivedSearchResults');
  if (products.length === 0) {
    container.innerHTML = `<p style="color:var(--text-muted);padding:10px 0;">No se encontraron productos.</p>`;
    return;
  }

  container.innerHTML = products.map(p => {
    const variants = DB.getVariantsByProduct(p.id)
      .filter(v => v.active && v.stock[branchId])
      .sort((a, b) => SIZES.indexOf(a.size) - SIZES.indexOf(b.size));

    const sizesHtml = variants.map(v => {
      const inList = getReceivedQty(v.id);
      const price = v.stock[branchId].price;
      return `<span class="size-btn ${inList > 0 ? 'in-cart' : ''}" onclick="addReceivedItem('${p.id}','${v.id}')">
                ${v.size} · ${formatMoney(price)}
                <small style="color:var(--text-muted);">${inList > 0 ? ' · agregado: ' + inList : ''}</small>
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

function addReceivedItem(productId, variantId) {
  const product = DB.getProducts().find(p => p.id === productId);
  const variant = DB.getVariants().find(v => v.id === variantId);
  if (!product || !variant) return;
  const branchId = DEV_session.branchId;
  const price = variant.stock[branchId] ? variant.stock[branchId].price : 0;

  const existing = RETURN_receivedItems.find(i => i.variantId === variantId);
  if (existing) {
    existing.quantity += 1;
  } else {
    RETURN_receivedItems.push({
      variantId, productId,
      name: product.name, description: product.description,
      size: variant.size, color: product.color, photo: product.photo,
      price, quantity: 1
    });
  }
  renderReceivedSearchResults();
  renderReceivedSelection();
}

function renderReceivedSelection() {
  const list = document.getElementById('devReceivedSelection');
  const emptyMsg = document.getElementById('noReceivedMsg');

  if (RETURN_receivedItems.length === 0) {
    emptyMsg.style.display = 'block';
    list.innerHTML = '';
    return;
  }
  emptyMsg.style.display = 'none';

  list.innerHTML = RETURN_receivedItems.map((item, idx) => `
    <div class="selection-row">
      <img class="sale-item-thumb" src="${item.photo}">
      <div style="flex:1;">
        <div style="font-weight:600;">${item.name}</div>
        <div style="font-size:0.76rem;color:var(--text-muted);">Talle ${item.size} · ${item.color}</div>
      </div>
      <input type="number" class="price-input" min="0" step="0.01" value="${item.price}" onchange="updateReceivedField(${idx},'price',this.value)">
      <div class="qty-stepper">
        <button type="button" onclick="changeReceivedQty(${idx},-1)">−</button>
        <input type="number" min="1" value="${item.quantity}" onchange="updateReceivedField(${idx},'quantity',this.value)">
        <button type="button" onclick="changeReceivedQty(${idx},1)">+</button>
      </div>
      <i class="material-icons" style="cursor:pointer;color:var(--danger);" onclick="removeReceivedItem(${idx})">close</i>
    </div>
  `).join('');
}

function updateReceivedField(idx, field, value) {
  const item = RETURN_receivedItems[idx];
  if (!item) return;
  if (field === 'quantity') {
    let q = parseInt(value) || 1;
    if (q < 1) q = 1;
    item.quantity = q;
  } else {
    item[field] = parseFloat(value) || 0;
  }
  renderReceivedSearchResults();
  renderReceivedSelection();
  if (RETURN_type === 'exchange') updateExchangeSummary();
}

function changeReceivedQty(idx, delta) {
  const item = RETURN_receivedItems[idx];
  if (!item) return;
  item.quantity = Math.max(1, item.quantity + delta);
  renderReceivedSearchResults();
  renderReceivedSelection();
  if (RETURN_type === 'exchange') updateExchangeSummary();
}

function removeReceivedItem(idx) {
  RETURN_receivedItems.splice(idx, 1);
  renderReceivedSearchResults();
  renderReceivedSelection();
  if (RETURN_type === 'exchange') updateExchangeSummary();
}

/* ---------- Paso 2: productos a entregar al cliente (salen del stock) ---------- */
function getDeliveredQty(variantId) {
  const it = RETURN_deliveredItems.find(i => i.variantId === variantId);
  return it ? it.quantity : 0;
}

function availableStockForDelivery(variantId) {
  const v = DB.getVariants().find(v => v.id === variantId);
  // Lo reservado por pedidos confirmados no se puede entregar en un cambio
  return v ? availableStock(v.stock[DEV_session.branchId]) : 0;
}

function renderDeliveredSearchResults() {
  const term = document.getElementById('devDeliveredSearchInput').value.trim().toLowerCase();
  const branchId = DEV_session.branchId;
  const products = DB.getProducts().filter(p =>
    p.active && p.branchesSold.includes(branchId) && (term === '' || p.name.toLowerCase().includes(term))
  );

  const container = document.getElementById('devDeliveredSearchResults');
  if (products.length === 0) {
    container.innerHTML = `<p style="color:var(--text-muted);padding:10px 0;">No se encontraron productos.</p>`;
    return;
  }

  container.innerHTML = products.map(p => {
    const variants = DB.getVariantsByProduct(p.id)
      .filter(v => v.active && v.stock[branchId])
      .sort((a, b) => SIZES.indexOf(a.size) - SIZES.indexOf(b.size));

    const sizesHtml = variants.map(v => {
      const inList = getDeliveredQty(v.id);
      const remaining = availableStockForDelivery(v.id) - inList;
      const disabled = remaining <= 0;
      const price = v.stock[branchId].price;
      return `<span class="size-btn ${disabled ? 'disabled' : ''} ${inList > 0 ? 'in-cart' : ''}"
                    ${disabled ? '' : `onclick="addDeliveredItem('${p.id}','${v.id}')"`}>
                ${v.size} · ${formatMoney(price)}
                <small style="color:var(--text-muted);">(${remaining}${inList > 0 ? ' · agregado: ' + inList : ''})</small>
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

function addDeliveredItem(productId, variantId) {
  const product = DB.getProducts().find(p => p.id === productId);
  const variant = DB.getVariants().find(v => v.id === variantId);
  if (!product || !variant) return;
  const branchId = DEV_session.branchId;
  const price = variant.stock[branchId] ? variant.stock[branchId].price : 0;

  const existing = RETURN_deliveredItems.find(i => i.variantId === variantId);
  if (existing) {
    if (availableStockForDelivery(variantId) - existing.quantity < 1) {
      M.toast({ html: 'No hay más stock disponible para entregar.' });
      return;
    }
    existing.quantity += 1;
  } else {
    if (availableStockForDelivery(variantId) < 1) {
      M.toast({ html: 'No hay stock disponible para este talle.' });
      return;
    }
    RETURN_deliveredItems.push({
      variantId, productId,
      name: product.name, description: product.description,
      size: variant.size, color: product.color, photo: product.photo,
      price, quantity: 1
    });
  }
  renderDeliveredSearchResults();
  renderDeliveredSelection();
  updateExchangeSummary();
}

function renderDeliveredSelection() {
  const list = document.getElementById('devDeliveredSelection');
  const emptyMsg = document.getElementById('noDeliveredMsg');

  if (RETURN_deliveredItems.length === 0) {
    emptyMsg.style.display = 'block';
    list.innerHTML = '';
    return;
  }
  emptyMsg.style.display = 'none';

  list.innerHTML = RETURN_deliveredItems.map((item, idx) => `
    <div class="selection-row">
      <img class="sale-item-thumb" src="${item.photo}">
      <div style="flex:1;">
        <div style="font-weight:600;">${item.name}</div>
        <div style="font-size:0.76rem;color:var(--text-muted);">Talle ${item.size} · ${item.color}</div>
      </div>
      <input type="number" class="price-input" min="0" step="0.01" value="${item.price}" onchange="updateDeliveredField(${idx},'price',this.value)">
      <div class="qty-stepper">
        <button type="button" onclick="changeDeliveredQty(${idx},-1)">−</button>
        <input type="number" min="1" value="${item.quantity}" onchange="updateDeliveredField(${idx},'quantity',this.value)">
        <button type="button" onclick="changeDeliveredQty(${idx},1)">+</button>
      </div>
      <i class="material-icons" style="cursor:pointer;color:var(--danger);" onclick="removeDeliveredItem(${idx})">close</i>
    </div>
  `).join('');
}

function updateDeliveredField(idx, field, value) {
  const item = RETURN_deliveredItems[idx];
  if (!item) return;
  if (field === 'quantity') {
    let q = parseInt(value) || 1;
    if (q < 1) q = 1;
    const max = availableStockForDelivery(item.variantId);
    if (q > max) {
      M.toast({ html: `Solo hay ${max} unidades disponibles para este talle.` });
      q = max < 1 ? 1 : max;
    }
    item.quantity = q;
  } else {
    item[field] = parseFloat(value) || 0;
  }
  renderDeliveredSearchResults();
  renderDeliveredSelection();
  updateExchangeSummary();
}

function changeDeliveredQty(idx, delta) {
  const item = RETURN_deliveredItems[idx];
  if (!item) return;
  const newQty = item.quantity + delta;
  if (delta > 0 && newQty > availableStockForDelivery(item.variantId)) {
    M.toast({ html: 'No hay más stock disponible para este talle.' });
    return;
  }
  item.quantity = Math.max(1, newQty);
  renderDeliveredSearchResults();
  renderDeliveredSelection();
  updateExchangeSummary();
}

function removeDeliveredItem(idx) {
  RETURN_deliveredItems.splice(idx, 1);
  renderDeliveredSearchResults();
  renderDeliveredSelection();
  updateExchangeSummary();
}

/* ---------- Resumen de totales y diferencia ---------- */
function computeItemsTotal(items) {
  return items.reduce((sum, it) => sum + (Number(it.price) || 0) * it.quantity, 0);
}

function updateExchangeSummary() {
  const totalReceived = computeItemsTotal(RETURN_receivedItems);
  const totalDelivered = computeItemsTotal(RETURN_deliveredItems);
  document.getElementById('exchangeTotalReceived').textContent = formatMoney(totalReceived);
  document.getElementById('exchangeTotalDelivered').textContent = formatMoney(totalDelivered);

  const diff = totalDelivered - totalReceived;
  const payWrap = document.getElementById('exchangeDiffPayWrap');
  const noteEl = document.getElementById('exchangeNoRefundNote');

  if (diff > 0) {
    payWrap.style.display = 'block';
    noteEl.style.display = 'none';
    document.getElementById('exchangeDiffAmount').textContent = formatMoney(diff);
  } else {
    payWrap.style.display = 'none';
    noteEl.style.display = 'block';
    noteEl.textContent = diff < 0
      ? `El cliente no recibe reembolso por la diferencia a favor (${formatMoney(-diff)}). No se entrega dinero.`
      : 'Cambio sin diferencia a pagar.';
  }
}

/* ---------- Guardar cambio de producto ---------- */
function onSaveExchangeClick() {
  if (RETURN_receivedItems.length === 0) {
    M.toast({ html: 'Agregá al menos un producto que devuelve el cliente.' });
    return;
  }
  if (RETURN_deliveredItems.length === 0) {
    M.toast({ html: 'Agregá al menos un producto para entregar al cliente.' });
    return;
  }

  for (const item of RETURN_deliveredItems) {
    const available = availableStockForDelivery(item.variantId);
    if (item.quantity > available) {
      M.toast({ html: `Stock insuficiente para ${item.name} (talle ${item.size}). Disponible: ${available}.` });
      return;
    }
  }

  const totalReceived = computeItemsTotal(RETURN_receivedItems);
  const totalDelivered = computeItemsTotal(RETURN_deliveredItems);
  const diff = totalDelivered - totalReceived;

  let diffPaymentMethod = null;
  if (diff > 0) {
    diffPaymentMethod = document.getElementById('exchangeDiffPaymentMethod').value;
    if (!diffPaymentMethod) {
      M.toast({ html: 'Elegí el método de pago de la diferencia.' });
      return;
    }
  }

  RETURN_pendingConfirm = { totalReceived, totalDelivered, diff, diffPaymentMethod };

  let html = '<p style="font-weight:600;margin-bottom:6px;">Vuelven al stock</p>';
  html += RETURN_receivedItems.map(it => `
    <div class="diff-row"><span>${it.name} — Talle ${it.size}</span><span style="color:var(--success);font-weight:700;">+${it.quantity}</span></div>
  `).join('');
  html += '<p style="font-weight:600;margin:14px 0 6px;">Se descuentan del stock</p>';
  html += RETURN_deliveredItems.map(it => `
    <div class="diff-row"><span>${it.name} — Talle ${it.size}</span><span style="color:var(--danger);font-weight:700;">-${it.quantity}</span></div>
  `).join('');
  html += `<div class="diff-row" style="margin-top:14px;"><span>Total productos devueltos</span><span>${formatMoney(totalReceived)}</span></div>`;
  html += `<div class="diff-row"><span>Total productos entregados</span><span>${formatMoney(totalDelivered)}</span></div>`;
  if (diff > 0) {
    html += `<div class="diff-row"><span>Diferencia a pagar por el cliente (${diffPaymentMethod})</span><span style="color:var(--danger);font-weight:700;">${formatMoney(diff)}</span></div>`;
  } else if (diff < 0) {
    html += `<div class="diff-row"><span>Diferencia a favor del cliente</span><span>${formatMoney(-diff)} (sin reembolso)</span></div>`;
  } else {
    html += `<div class="diff-row"><span>Diferencia</span><span>Sin diferencia a pagar</span></div>`;
  }

  document.getElementById('confirmExchangeList').innerHTML = html;
  modalConfirmExchangeInst.open();
}

function applyExchangeReturn() {
  if (!RETURN_pendingConfirm) return;
  const { totalReceived, totalDelivered, diff, diffPaymentMethod } = RETURN_pendingConfirm;

  const variants = DB.getVariants();
  const branchId = DEV_session.branchId;

  RETURN_receivedItems.forEach(it => {
    const v = variants.find(v => v.id === it.variantId);
    if (v && v.stock[branchId]) v.stock[branchId].current += it.quantity;
  });
  RETURN_deliveredItems.forEach(it => {
    const v = variants.find(v => v.id === it.variantId);
    if (v && v.stock[branchId]) v.stock[branchId].current = Math.max(0, v.stock[branchId].current - it.quantity);
  });
  DB.setVariants(variants);

  const ret = {
    id: uid('ret'),
    type: 'exchange',
    date: nowISO(),
    branchId,
    userId: DEV_session.userId,
    userName: DEV_session.name,
    receivedItems: RETURN_receivedItems.map(it => ({ ...it })),
    deliveredItems: RETURN_deliveredItems.map(it => ({ ...it })),
    totalReceived,
    totalDelivered,
    diffPaid: diff > 0 ? diff : 0,
    diffPaymentMethod: diff > 0 ? diffPaymentMethod : null,
    refundAmount: 0
  };

  const returns = DB.getReturns();
  returns.push(ret);
  DB.setReturns(returns);

  modalConfirmExchangeInst.close();
  modalExchangeReturnInst.close();
  resetReturnState();
  M.toast({ html: 'Cambio de producto registrado correctamente.' });
  renderReturnsTable();
  nav_render('devoluciones');
}

/* ==========================================================================
   Devolución por falla
   ========================================================================== */
function startDefectReturn() {
  resetReturnState();
  RETURN_type = 'defect';
  modalReturnTypeInst.close();

  document.getElementById('defectBranch').textContent = DB.getBranchName(DEV_session.branchId);
  document.getElementById('devDefectSearchInput').value = '';

  renderDefectSearchResults();
  renderDefectSelection();
  modalDefectReturnInst.open();
}

function renderDefectSearchResults() {
  const term = document.getElementById('devDefectSearchInput').value.trim().toLowerCase();
  const branchId = DEV_session.branchId;
  const products = DB.getProducts().filter(p =>
    p.active && p.branchesSold.includes(branchId) && (term === '' || p.name.toLowerCase().includes(term))
  );

  const container = document.getElementById('devDefectSearchResults');
  if (products.length === 0) {
    container.innerHTML = `<p style="color:var(--text-muted);padding:10px 0;">No se encontraron productos.</p>`;
    return;
  }

  container.innerHTML = products.map(p => {
    const variants = DB.getVariantsByProduct(p.id)
      .filter(v => v.active && v.stock[branchId])
      .sort((a, b) => SIZES.indexOf(a.size) - SIZES.indexOf(b.size));

    const sizesHtml = variants.map(v => {
      const inList = getReceivedQty(v.id);
      const price = v.stock[branchId].price;
      return `<span class="size-btn ${inList > 0 ? 'in-cart' : ''}" onclick="addDefectItem('${p.id}','${v.id}')">
                ${v.size} · ${formatMoney(price)}
                <small style="color:var(--text-muted);">${inList > 0 ? ' · agregado: ' + inList : ''}</small>
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

/* La devolución por falla reutiliza RETURN_receivedItems (son, en ambos
   casos, "productos recibidos del cliente"); lo que cambia es que al
   guardar NO se devuelven al stock. */
function addDefectItem(productId, variantId) {
  addReceivedItem(productId, variantId);
  renderDefectSearchResults();
  renderDefectSelection();
}

function renderDefectSelection() {
  const list = document.getElementById('devDefectSelection');
  const emptyMsg = document.getElementById('noDefectMsg');

  if (RETURN_receivedItems.length === 0) {
    emptyMsg.style.display = 'block';
    list.innerHTML = '';
  } else {
    emptyMsg.style.display = 'none';
    list.innerHTML = RETURN_receivedItems.map((item, idx) => `
      <div class="selection-row">
        <img class="sale-item-thumb" src="${item.photo}">
        <div style="flex:1;">
          <div style="font-weight:600;">${item.name}</div>
          <div style="font-size:0.76rem;color:var(--text-muted);">Talle ${item.size} · ${item.color}</div>
        </div>
        <input type="number" class="price-input" min="0" step="0.01" value="${item.price}" onchange="updateDefectField(${idx},'price',this.value)">
        <div class="qty-stepper">
          <button type="button" onclick="changeDefectQty(${idx},-1)">−</button>
          <input type="number" min="1" value="${item.quantity}" onchange="updateDefectField(${idx},'quantity',this.value)">
          <button type="button" onclick="changeDefectQty(${idx},1)">+</button>
        </div>
        <i class="material-icons" style="cursor:pointer;color:var(--danger);" onclick="removeDefectItem(${idx})">close</i>
      </div>
    `).join('');
  }

  document.getElementById('defectTotalAmount').textContent = formatMoney(computeItemsTotal(RETURN_receivedItems));
}

function updateDefectField(idx, field, value) {
  updateReceivedField(idx, field, value);
  renderDefectSearchResults();
  renderDefectSelection();
}

function changeDefectQty(idx, delta) {
  changeReceivedQty(idx, delta);
  renderDefectSearchResults();
  renderDefectSelection();
}

function removeDefectItem(idx) {
  removeReceivedItem(idx);
  renderDefectSearchResults();
  renderDefectSelection();
}

function onSaveDefectClick() {
  if (RETURN_receivedItems.length === 0) {
    M.toast({ html: 'Agregá al menos un producto fallado.' });
    return;
  }

  const total = computeItemsTotal(RETURN_receivedItems);
  RETURN_pendingConfirm = { total };

  let html = '<p style="font-weight:600;margin-bottom:6px;">Productos fallados (no vuelven al stock)</p>';
  html += RETURN_receivedItems.map(it => `
    <div class="diff-row"><span>${it.name} — Talle ${it.size} × ${it.quantity}</span><span>${formatMoney(it.price * it.quantity)}</span></div>
  `).join('');
  html += `<div class="diff-row" style="margin-top:10px;"><span>Monto total a reembolsar</span><span style="font-weight:700;">${formatMoney(total)}</span></div>`;

  document.getElementById('confirmDefectList').innerHTML = html;
  modalConfirmDefectInst.open();
}

function applyDefectReturn() {
  if (!RETURN_pendingConfirm) return;
  const { total } = RETURN_pendingConfirm;

  const ret = {
    id: uid('ret'),
    type: 'defect',
    date: nowISO(),
    branchId: DEV_session.branchId,
    userId: DEV_session.userId,
    userName: DEV_session.name,
    receivedItems: RETURN_receivedItems.map(it => ({ ...it })),
    deliveredItems: [],
    totalReceived: total,
    totalDelivered: 0,
    diffPaid: 0,
    diffPaymentMethod: null,
    refundAmount: total
  };

  const returns = DB.getReturns();
  returns.push(ret);
  DB.setReturns(returns);

  modalConfirmDefectInst.close();
  modalDefectReturnInst.close();
  resetReturnState();
  M.toast({ html: 'Devolución por falla registrada correctamente.' });
  renderReturnsTable();
}

/* ==========================================================================
   Listado, filtros y detalle
   ========================================================================== */
function clearFilters() {
  document.getElementById('filterDateMin').value = '';
  document.getElementById('filterDateMax').value = '';
  document.getElementById('filterType').value = '';
  FILTER_type = '';
  renderReturnsTable();
}

function summarizeReturnProducts(ret) {
  const names = [...ret.receivedItems, ...ret.deliveredItems].map(it => it.name);
  const unique = [...new Set(names)];
  if (unique.length === 0) return '—';
  if (unique.length <= 2) return unique.join(', ');
  return unique.slice(0, 2).join(', ') + ` +${unique.length - 2}`;
}

function renderReturnsTable() {
  let returns = DB.getReturns().filter(r => r.branchId === DEV_session.branchId);

  const dMin = document.getElementById('filterDateMin').value;
  const dMax = document.getElementById('filterDateMax').value;
  if (dMin) returns = returns.filter(r => new Date(r.date) >= new Date(dMin));
  if (dMax) returns = returns.filter(r => new Date(r.date) <= new Date(dMax));
  if (FILTER_type) returns = returns.filter(r => r.type === FILTER_type);

  returns = returns.sort((a, b) => new Date(b.date) - new Date(a.date));

  const tbody = document.getElementById('returnsTbody');
  const emptyMsg = document.getElementById('noReturnsMsg');

  if (returns.length === 0) {
    emptyMsg.style.display = 'block';
    tbody.innerHTML = '';
    return;
  }
  emptyMsg.style.display = 'none';

  tbody.innerHTML = returns.map(r => `
    <tr>
      <td>${formatDateTime(r.date)}</td>
      <td><span class="type-chip ${r.type === 'exchange' ? 'exchange' : 'defect'}">${r.type === 'exchange' ? 'Cambio de producto' : 'Devolución por falla'}</span></td>
      <td>${r.userName}</td>
      <td>${summarizeReturnProducts(r)}</td>
      <td>${r.diffPaid > 0 ? formatMoney(r.diffPaid) : '—'}</td>
      <td>${r.refundAmount > 0 ? formatMoney(r.refundAmount) : '—'}</td>
      <td><button class="btn-flat btn-small waves-effect" style="border:1px solid var(--border-soft);" onclick="openReturnDetail('${r.id}')">Ver más</button></td>
    </tr>
  `).join('');
}

function buildReturnItemsTableHtml(items, note) {
  if (!items || items.length === 0) return '<p style="color:var(--text-muted);font-size:0.85rem;">Sin productos.</p>';
  return `
    <table class="data-table" style="margin-bottom:10px;">
      <thead><tr><th>Producto</th><th>Talle</th><th>Cant.</th><th>Precio unit.</th><th>Subtotal</th></tr></thead>
      <tbody>
        ${items.map(it => `
          <tr>
            <td><div style="display:flex;align-items:center;gap:8px;"><img class="sale-item-thumb" src="${it.photo}"><span>${it.name}</span></div></td>
            <td>${it.size}</td>
            <td>${it.quantity}</td>
            <td>${formatMoney(it.price)}</td>
            <td>${formatMoney(it.price * it.quantity)}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
    ${note ? `<p style="color:var(--text-muted);font-size:0.78rem;margin-top:-4px;">${note}</p>` : ''}
  `;
}

function openReturnDetail(returnId) {
  const ret = DB.getReturns().find(r => r.id === returnId);
  if (!ret) return;
  CURRENT_returnDetailId = returnId;

  document.getElementById('returnDetailMeta').innerHTML = `
    <strong>Fecha:</strong> ${formatDateTime(ret.date)} &nbsp;·&nbsp;
    <strong>Tipo:</strong> ${ret.type === 'exchange' ? 'Cambio de producto' : 'Devolución por falla'} &nbsp;·&nbsp;
    <strong>Usuario:</strong> ${ret.userName} &nbsp;·&nbsp;
    <strong>Sucursal:</strong> ${DB.getBranchName(ret.branchId)}
  `;

  let bodyHtml = '';
  if (ret.type === 'exchange') {
    bodyHtml += `<p style="font-weight:600;margin-bottom:6px;">Productos devueltos por el cliente (volvieron al stock)</p>`;
    bodyHtml += buildReturnItemsTableHtml(ret.receivedItems);
    bodyHtml += `<p style="font-weight:600;margin:16px 0 6px;">Productos entregados al cliente</p>`;
    bodyHtml += buildReturnItemsTableHtml(ret.deliveredItems);
    bodyHtml += `
      <div class="diff-row"><span>Total productos devueltos</span><span>${formatMoney(ret.totalReceived)}</span></div>
      <div class="diff-row"><span>Total productos entregados</span><span>${formatMoney(ret.totalDelivered)}</span></div>
    `;
    bodyHtml += ret.diffPaid > 0
      ? `<div class="diff-row"><span>Diferencia abonada por el cliente (${ret.diffPaymentMethod})</span><span style="font-weight:700;">${formatMoney(ret.diffPaid)}</span></div>`
      : `<div class="diff-row"><span>Diferencia</span><span>Sin diferencia a pagar / sin reembolso</span></div>`;
  } else {
    bodyHtml += `<p style="font-weight:600;margin-bottom:6px;">Productos fallados recibidos</p>`;
    bodyHtml += buildReturnItemsTableHtml(ret.receivedItems, 'Estos productos no volvieron a ingresar al stock.');
    bodyHtml += `<div class="diff-row"><span>Monto reembolsado</span><span style="font-weight:700;">${formatMoney(ret.refundAmount)}</span></div>`;
  }
  document.getElementById('returnDetailBody').innerHTML = bodyHtml;

  modalReturnDetailInst.open();
}
