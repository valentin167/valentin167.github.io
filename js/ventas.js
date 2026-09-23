/* ==========================================================================
   ventas.js — Registro de ventas (con descuento automático de stock),
   listado/filtrado/detalle, y modificación / anulación (devolución) de
   ventas ya registradas.
   ========================================================================== */

let VENTAS_session = null;
let SALE_cart = [];
let SALE_editMode = null;            // null = venta nueva, string = id de venta que se está modificando
let SALE_editOriginalItems = [];     // snapshot de los items originales de la venta en edición
let CURRENT_saleDetailId = null;     // venta actualmente abierta en el modal de detalle
let FILTER_productId = null;

let modalNewSaleInst, modalPickProductInst, modalFilterProductInst,
    modalSaleDetailInst, modalConfirmEditSaleInst, modalConfirmVoidSaleInst;

document.addEventListener('DOMContentLoaded', () => {
  VENTAS_session = nav_init('ventas');
  if (!VENTAS_session) return;

  modalNewSaleInst = M.Modal.init(document.getElementById('modalNewSale'), {
    onCloseStart: resetSaleCart
  });
  modalPickProductInst = M.Modal.init(document.getElementById('modalPickProduct'), {});
  modalFilterProductInst = M.Modal.init(document.getElementById('modalFilterProduct'), {});
  modalSaleDetailInst = M.Modal.init(document.getElementById('modalSaleDetail'), {});
  modalConfirmEditSaleInst = M.Modal.init(document.getElementById('modalConfirmEditSale'), {});
  modalConfirmVoidSaleInst = M.Modal.init(document.getElementById('modalConfirmVoidSale'), {});

  document.getElementById('btnNewSale').addEventListener('click', openNewSaleModal);
  document.getElementById('btnAddSaleItem').addEventListener('click', openPickProductModal);
  document.getElementById('btnSaveSale').addEventListener('click', onSaveSaleClick);
  document.getElementById('pickSearchInput').addEventListener('input', renderPickResults);
  document.getElementById('btnFilterProduct').addEventListener('click', openFilterProductModal);
  document.getElementById('filterSearchInput').addEventListener('input', renderFilterResults);
  document.getElementById('btnClearFilters').addEventListener('click', clearFilters);
  document.getElementById('filterDateMin').addEventListener('change', renderSalesTable);
  document.getElementById('filterDateMax').addEventListener('change', renderSalesTable);

  document.getElementById('btnOpenEditSale').addEventListener('click', () => openEditSaleModal(CURRENT_saleDetailId));
  document.getElementById('btnOpenVoidSale').addEventListener('click', () => openVoidSaleModal(CURRENT_saleDetailId));
  document.getElementById('btnAcceptEditSale').addEventListener('click', applyEditSale);
  document.getElementById('btnAcceptVoidSale').addEventListener('click', applyVoidSale);

  renderSalesTable();
});

/* ---------------------- Disponibilidad de stock ---------------------- */
/* Al modificar una venta, la cantidad ya cargada originalmente en esa venta
   se considera "disponible" para volver a asignarse (porque ya está
   reservada/descontada del stock real). */
function getOriginalQty(variantId) {
  if (!SALE_editMode) return 0;
  const o = SALE_editOriginalItems.find(it => it.variantId === variantId);
  return o ? o.quantity : 0;
}

function getCartQty(variantId) {
  const item = SALE_cart.find(i => i.variantId === variantId);
  return item ? item.quantity : 0;
}

function availableStockForVariant(variantId) {
  const v = DB.getVariants().find(v => v.id === variantId);
  const current = v && v.stock[VENTAS_session.branchId] ? v.stock[VENTAS_session.branchId].current : 0;
  return current + getOriginalQty(variantId);
}

/* ---------------------- Registrar / modificar venta ---------------------- */
function resetSaleCart() {
  SALE_cart = [];
  SALE_editMode = null;
  SALE_editOriginalItems = [];
}

function openNewSaleModal() {
  SALE_editMode = null;
  SALE_editOriginalItems = [];
  SALE_cart = [];
  document.getElementById('saleModalTitle').textContent = 'Registrar venta';
  document.getElementById('btnSaveSale').textContent = 'Guardar venta';
  document.getElementById('newSaleBranch').textContent = DB.getBranchName(VENTAS_session.branchId);
  renderSaleItemsTable();
  modalNewSaleInst.open();
}

function openEditSaleModal(saleId) {
  const sale = DB.getSales().find(s => s.id === saleId);
  if (!sale) return;
  if (sale.voided) {
    M.toast({ html: 'No se puede modificar una venta anulada.' });
    return;
  }

  SALE_editMode = sale.id;
  SALE_editOriginalItems = JSON.parse(JSON.stringify(sale.items));
  SALE_cart = sale.items.map(it => ({
    variantId: it.variantId,
    productId: it.productId,
    name: it.name,
    description: it.description,
    size: it.size,
    color: it.color,
    photo: it.photo,
    priceList: it.priceList,
    increasePct: it.increasePct || 0,
    discountPct: it.discountPct || 0,
    quantity: it.quantity,
    paymentMethod: it.paymentMethod
  }));

  document.getElementById('saleModalTitle').textContent = 'Modificar venta';
  document.getElementById('btnSaveSale').textContent = 'Guardar cambios';
  document.getElementById('newSaleBranch').textContent = DB.getBranchName(sale.branchId);

  modalSaleDetailInst.close();
  renderSaleItemsTable();
  modalNewSaleInst.open();
}

function openPickProductModal() {
  document.getElementById('pickSearchInput').value = '';
  document.getElementById('pickSizesWrap').style.display = 'none';
  renderPickResults();
  modalPickProductInst.open();
}

function renderPickResults() {
  const term = document.getElementById('pickSearchInput').value.trim().toLowerCase();
  const branchId = VENTAS_session.branchId;
  const products = DB.getProducts().filter(p =>
    p.active &&
    p.branchesSold.includes(branchId) &&
    (term === '' || p.name.toLowerCase().includes(term))
  );

  const list = document.getElementById('pickResultsList');
  if (products.length === 0) {
    list.innerHTML = `<p style="color:var(--text-muted);padding:10px;">No se encontraron productos.</p>`;
    return;
  }

  list.innerHTML = products.map(p => `
    <div class="pick-result-item" onclick="selectPickProduct('${p.id}')">
      <img src="${p.photo}">
      <div>
        <div style="font-weight:600;">${p.name}</div>
        <div style="font-size:0.78rem;color:var(--text-muted);">${p.color} · desde ${formatMoney(p.basePrice ? (p.basePrice[branchId] || 0) : 0)}</div>
      </div>
    </div>
  `).join('');
}

function selectPickProduct(productId) {
  const branchId = VENTAS_session.branchId;
  const variants = DB.getVariantsByProduct(productId)
    .filter(v => v.active && v.stock[branchId])
    .sort((a, b) => SIZES.indexOf(a.size) - SIZES.indexOf(b.size));

  const wrap = document.getElementById('pickSizesWrap');
  const sizesList = document.getElementById('pickSizesList');
  wrap.style.display = 'block';

  sizesList.innerHTML = variants.map(v => {
    const remaining = availableStockForVariant(v.id) - getCartQty(v.id);
    const disabled = remaining <= 0;
    const price = v.stock[branchId].price;
    return `<span class="size-btn ${disabled ? 'disabled' : ''}" ${disabled ? '' : `onclick="addToCart('${productId}','${v.id}')"`}>
              ${v.size} · ${formatMoney(price)} <small style="color:var(--text-muted);">(${remaining})</small>
            </span>`;
  }).join('');

  if (variants.length === 0) {
    sizesList.innerHTML = '<p style="color:var(--text-muted);">Este producto no tiene talles disponibles.</p>';
  }
}

function addToCart(productId, variantId) {
  const product = DB.getProducts().find(p => p.id === productId);
  const variant = DB.getVariants().find(v => v.id === variantId);
  if (!product || !variant) return;
  const branchId = VENTAS_session.branchId;
  const variantPrice = variant.stock[branchId] ? variant.stock[branchId].price : 0;

  const existing = SALE_cart.find(i => i.variantId === variantId);
  if (existing) {
    if (availableStockForVariant(variantId) - existing.quantity < 1) {
      M.toast({ html: 'No hay más stock disponible para agregar.' });
      return;
    }
    existing.quantity += 1;
  } else {
    if (availableStockForVariant(variantId) < 1) {
      M.toast({ html: 'No hay stock disponible para este talle.' });
      return;
    }
    SALE_cart.push({
      variantId,
      productId,
      name: product.name,
      description: product.description,
      size: variant.size,
      color: product.color,
      photo: product.photo,
      priceList: variantPrice,
      increasePct: 0,
      discountPct: 0,
      quantity: 1,
      paymentMethod: PAYMENT_METHODS[0]
    });
  }
  modalPickProductInst.close();
  renderSaleItemsTable();
}

function computeItemUnit(item) {
  const base = Number(item.priceList) || 0;
  const inc = Number(item.increasePct) || 0;
  const disc = Number(item.discountPct) || 0;
  return base * (1 + inc / 100 - disc / 100);
}

function computeItemSubtotal(item) {
  return computeItemUnit(item) * item.quantity;
}

function renderSaleItemsTable() {
  const tbody = document.getElementById('saleItemsTbody');
  const emptyMsg = document.getElementById('noItemsMsg');

  if (SALE_cart.length === 0) {
    emptyMsg.style.display = 'block';
    tbody.innerHTML = '';
  } else {
    emptyMsg.style.display = 'none';
    tbody.innerHTML = SALE_cart.map((item, idx) => `
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
        <td><input type="number" class="price-input" min="0" step="1" value="${item.priceList}" onchange="updateCartField(${idx},'priceList',this.value)"></td>
        <td><input type="number" class="pct-input" min="0" value="${item.increasePct}" onchange="updateCartField(${idx},'increasePct',this.value)"></td>
        <td><input type="number" class="pct-input" min="0" value="${item.discountPct}" onchange="updateCartField(${idx},'discountPct',this.value)"></td>
        <td>
          <div class="qty-stepper">
            <button type="button" onclick="changeQty(${idx},-1)">−</button>
            <input type="number" min="1" value="${item.quantity}" onchange="updateCartField(${idx},'quantity',this.value)">
            <button type="button" onclick="changeQty(${idx},1)">+</button>
          </div>
        </td>
        <td>
          <select class="pay-select browser-default" onchange="updateCartField(${idx},'paymentMethod',this.value)">
            ${PAYMENT_METHODS.map(m => `<option value="${m}" ${m === item.paymentMethod ? 'selected' : ''}>${m}</option>`).join('')}
          </select>
        </td>
        <td><strong>${formatMoney(computeItemSubtotal(item))}</strong></td>
        <td><i class="material-icons" style="cursor:pointer;color:var(--danger);" onclick="removeCartItem(${idx})">close</i></td>
      </tr>
    `).join('');
  }

  const total = SALE_cart.reduce((sum, item) => sum + computeItemSubtotal(item), 0);
  document.getElementById('saleTotalAmount').textContent = formatMoney(total);
}

function updateCartField(idx, field, value) {
  const item = SALE_cart[idx];
  if (!item) return;
  if (field === 'quantity') {
    let q = parseInt(value) || 1;
    if (q < 1) q = 1;
    const max = availableStockForVariant(item.variantId);
    if (q > max) {
      M.toast({ html: `Solo hay ${max} unidades disponibles para este talle.` });
      q = max < 1 ? 1 : max;
    }
    item.quantity = q;
  } else if (field === 'paymentMethod') {
    item.paymentMethod = value;
  } else {
    item[field] = parseFloat(value) || 0;
  }
  renderSaleItemsTable();
}

function changeQty(idx, delta) {
  const item = SALE_cart[idx];
  if (!item) return;
  const newQty = item.quantity + delta;
  if (delta > 0 && newQty > availableStockForVariant(item.variantId)) {
    M.toast({ html: 'No hay más stock disponible para este talle.' });
    return;
  }
  item.quantity = Math.max(1, newQty);
  renderSaleItemsTable();
}

function removeCartItem(idx) {
  SALE_cart.splice(idx, 1);
  renderSaleItemsTable();
}

function onSaveSaleClick() {
  if (SALE_editMode) {
    handleSaveEditedSale();
  } else {
    saveNewSale();
  }
}

function saveNewSale() {
  if (SALE_cart.length === 0) {
    M.toast({ html: 'Agregá al menos un producto a la venta.' });
    return;
  }

  for (const item of SALE_cart) {
    const available = availableStockForVariant(item.variantId);
    if (item.quantity > available) {
      M.toast({ html: `Stock insuficiente para ${item.name} (talle ${item.size}). Disponible: ${available}.` });
      return;
    }
  }

  if (!confirm('¿Confirmás registrar esta venta? Se descontará el stock automáticamente.')) return;

  const variants = DB.getVariants();
  SALE_cart.forEach(item => {
    const v = variants.find(v => v.id === item.variantId);
    v.stock[VENTAS_session.branchId].current -= item.quantity;
  });
  DB.setVariants(variants);

  const total = SALE_cart.reduce((sum, item) => sum + computeItemSubtotal(item), 0);
  const sale = {
    id: uid('sale'),
    date: nowISO(),
    branchId: VENTAS_session.branchId,
    userId: VENTAS_session.userId,
    userName: VENTAS_session.name,
    items: SALE_cart.map(item => ({
      variantId: item.variantId,
      productId: item.productId,
      name: item.name,
      description: item.description,
      size: item.size,
      color: item.color,
      photo: item.photo,
      priceList: item.priceList,
      increasePct: item.increasePct,
      discountPct: item.discountPct,
      unitPrice: computeItemUnit(item),
      quantity: item.quantity,
      paymentMethod: item.paymentMethod,
      subtotal: computeItemSubtotal(item)
    })),
    total,
    voided: false
  };

  const sales = DB.getSales();
  sales.push(sale);
  DB.setSales(sales);

  SALE_cart = [];
  modalNewSaleInst.close();
  M.toast({ html: 'Venta registrada correctamente.' });
  renderSalesTable();
  nav_render('ventas');
}

/* ---------------------- Modificación de una venta existente ---------------------- */
function buildEditDiff() {
  const origMap = {};
  SALE_editOriginalItems.forEach(it => { origMap[it.variantId] = it; });
  const newMap = {};
  SALE_cart.forEach(it => { newMap[it.variantId] = it; });

  const stockMoves = [];  // { variantId, name, size, delta } delta>0 => descontar, delta<0 => devolver
  const saleChanges = [];

  Object.keys(origMap).forEach(vid => {
    if (!newMap[vid]) {
      const o = origMap[vid];
      stockMoves.push({ variantId: vid, name: o.name, size: o.size, delta: -o.quantity });
      saleChanges.push(`Se elimina <strong>${o.name}</strong> (talle ${o.size}) de la venta.`);
    }
  });

  Object.keys(newMap).forEach(vid => {
    if (!origMap[vid]) {
      const n = newMap[vid];
      stockMoves.push({ variantId: vid, name: n.name, size: n.size, delta: n.quantity });
      saleChanges.push(`Se agrega <strong>${n.name}</strong> (talle ${n.size}) × ${n.quantity}.`);
    }
  });

  Object.keys(newMap).forEach(vid => {
    const o = origMap[vid];
    if (!o) return;
    const n = newMap[vid];

    if (n.quantity !== o.quantity) {
      stockMoves.push({ variantId: vid, name: n.name, size: n.size, delta: n.quantity - o.quantity });
      saleChanges.push(`Cantidad de <strong>${n.name}</strong> (talle ${n.size}): ${o.quantity} → ${n.quantity}.`);
    }

    const oldUnit = computeItemUnit(o);
    const newUnit = computeItemUnit(n);
    if (Math.abs(oldUnit - newUnit) > 0.001) {
      saleChanges.push(`Precio unitario de <strong>${n.name}</strong> (talle ${n.size}): ${formatMoney(oldUnit)} → ${formatMoney(newUnit)}.`);
    }

    if (o.paymentMethod !== n.paymentMethod) {
      saleChanges.push(`Método de pago de <strong>${n.name}</strong> (talle ${n.size}): ${o.paymentMethod} → ${n.paymentMethod}.`);
    }
  });

  return { stockMoves, saleChanges };
}

function handleSaveEditedSale() {
  if (SALE_cart.length === 0) {
    M.toast({ html: 'Una venta no puede quedar sin productos. Para eliminarla por completo usá "Anular (devolución)".' });
    return;
  }

  const { stockMoves, saleChanges } = buildEditDiff();
  if (stockMoves.length === 0 && saleChanges.length === 0) {
    M.toast({ html: 'No se detectaron cambios en la venta.' });
    return;
  }

  // Validar stock disponible antes de mostrar la confirmación
  const variants = DB.getVariants();
  const branchId = VENTAS_session.branchId;
  for (const move of stockMoves) {
    if (move.delta > 0) {
      const v = variants.find(v => v.id === move.variantId);
      const current = v && v.stock[branchId] ? v.stock[branchId].current : 0;
      if (move.delta > current) {
        M.toast({ html: `Stock insuficiente para ${move.name} (talle ${move.size}). Disponible: ${current}.` });
        return;
      }
    }
  }

  document.getElementById('editStockMovesList').innerHTML = stockMoves.length
    ? stockMoves.map(m => {
        const isDeduct = m.delta > 0;
        const label = isDeduct ? 'Se descuentan del stock' : 'Se devuelven al stock';
        const colorClass = isDeduct ? 'style="color:var(--danger);font-weight:700;"' : 'style="color:var(--success);font-weight:700;"';
        return `<div class="diff-row"><span><strong>${m.name}</strong> — Talle ${m.size}</span><span ${colorClass}>${label}: ${Math.abs(m.delta)}</span></div>`;
      }).join('')
    : '<p style="color:var(--text-muted);font-size:0.85rem;">No hay movimientos de stock.</p>';

  document.getElementById('editSaleChangesList').innerHTML = saleChanges.length
    ? saleChanges.map(c => `<div class="diff-row"><span>${c}</span></div>`).join('')
    : '<p style="color:var(--text-muted);font-size:0.85rem;">No hay cambios adicionales sobre la venta.</p>';

  modalConfirmEditSaleInst.open();
}

function applyEditSale() {
  const { stockMoves } = buildEditDiff();
  const variants = DB.getVariants();
  const branchId = VENTAS_session.branchId;

  stockMoves.forEach(move => {
    const v = variants.find(v => v.id === move.variantId);
    if (!v || !v.stock[branchId]) return;
    v.stock[branchId].current = Math.max(0, v.stock[branchId].current - move.delta);
  });
  DB.setVariants(variants);

  const sales = DB.getSales();
  const sale = sales.find(s => s.id === SALE_editMode);
  if (sale) {
    sale.items = SALE_cart.map(item => ({
      variantId: item.variantId,
      productId: item.productId,
      name: item.name,
      description: item.description,
      size: item.size,
      color: item.color,
      photo: item.photo,
      priceList: item.priceList,
      increasePct: item.increasePct,
      discountPct: item.discountPct,
      unitPrice: computeItemUnit(item),
      quantity: item.quantity,
      paymentMethod: item.paymentMethod,
      subtotal: computeItemSubtotal(item)
    }));
    sale.total = sale.items.reduce((sum, it) => sum + it.subtotal, 0);
    sale.editedAt = nowISO();
    sale.editedBy = VENTAS_session.name;
    DB.setSales(sales);
  }

  modalConfirmEditSaleInst.close();
  modalNewSaleInst.close();
  SALE_editMode = null;
  SALE_cart = [];
  M.toast({ html: 'Venta modificada correctamente.' });
  renderSalesTable();
  nav_render('ventas');
}

/* ---------------------- Anulación (devolución) de una venta ---------------------- */
function openVoidSaleModal(saleId) {
  const sale = DB.getSales().find(s => s.id === saleId);
  if (!sale) return;
  if (sale.voided) {
    M.toast({ html: 'Esta venta ya fue anulada.' });
    return;
  }

  document.getElementById('voidStockList').innerHTML = sale.items.map(it => `
    <div class="void-item-row">
      <img class="sale-item-thumb" src="${it.photo}">
      <div><strong>${it.name}</strong> — Talle ${it.size} × ${it.quantity} <span style="color:var(--text-muted);">(vuelve al stock)</span></div>
    </div>
  `).join('');

  modalSaleDetailInst.close();
  modalConfirmVoidSaleInst.open();
}

function applyVoidSale() {
  const sales = DB.getSales();
  const sale = sales.find(s => s.id === CURRENT_saleDetailId);
  if (!sale) return;

  const variants = DB.getVariants();
  sale.items.forEach(it => {
    const v = variants.find(v => v.id === it.variantId);
    if (v && v.stock[sale.branchId]) {
      v.stock[sale.branchId].current += it.quantity;
    }
  });
  DB.setVariants(variants);

  sale.voided = true;
  sale.voidedAt = nowISO();
  sale.voidedBy = VENTAS_session.name;
  DB.setSales(sales);

  modalConfirmVoidSaleInst.close();
  M.toast({ html: 'Venta anulada. El stock fue devuelto correctamente.' });
  renderSalesTable();
  nav_render('ventas');
}

/* ---------------------- Listado y filtros ---------------------- */
function openFilterProductModal() {
  document.getElementById('filterSearchInput').value = '';
  renderFilterResults();
  modalFilterProductInst.open();
}

function renderFilterResults() {
  const term = document.getElementById('filterSearchInput').value.trim().toLowerCase();
  const products = DB.getProducts().filter(p => term === '' || p.name.toLowerCase().includes(term));
  const list = document.getElementById('filterResultsList');

  let html = `<div class="pick-result-item" onclick="setProductFilter(null,'Todos')">
                <div style="width:44px;height:44px;border-radius:6px;background:var(--navy-800);display:flex;align-items:center;justify-content:center;">
                  <i class="material-icons" style="color:var(--gold-400);">apps</i>
                </div>
                <div style="font-weight:600;">Todos los productos</div>
              </div>`;

  html += products.map(p => `
    <div class="pick-result-item" onclick="setProductFilter('${p.id}', '${p.name.replace(/'/g, "\\'")}')">
      <img src="${p.photo}">
      <div style="font-weight:600;">${p.name}</div>
    </div>
  `).join('');

  list.innerHTML = html;
}

function setProductFilter(productId, label) {
  FILTER_productId = productId;
  document.getElementById('filterProductLabel').textContent = label;
  modalFilterProductInst.close();
  renderSalesTable();
}

function clearFilters() {
  FILTER_productId = null;
  document.getElementById('filterProductLabel').textContent = 'Todos';
  document.getElementById('filterDateMin').value = '';
  document.getElementById('filterDateMax').value = '';
  renderSalesTable();
}

function renderSalesTable() {
  let sales = DB.getSales().filter(s => s.branchId === VENTAS_session.branchId);

  const dMin = document.getElementById('filterDateMin').value;
  const dMax = document.getElementById('filterDateMax').value;
  if (dMin) sales = sales.filter(s => new Date(s.date) >= new Date(dMin));
  if (dMax) sales = sales.filter(s => new Date(s.date) <= new Date(dMax));
  if (FILTER_productId) sales = sales.filter(s => s.items.some(it => it.productId === FILTER_productId));

  sales = sales.sort((a, b) => new Date(b.date) - new Date(a.date));

  const tbody = document.getElementById('salesTbody');
  const emptyMsg = document.getElementById('noSalesMsg');

  if (sales.length === 0) {
    emptyMsg.style.display = 'block';
    tbody.innerHTML = '';
    return;
  }
  emptyMsg.style.display = 'none';

  tbody.innerHTML = sales.map(s => `
    <tr class="${s.voided ? 'voided-row' : ''}">
      <td>${formatDateTime(s.date)}</td>
      <td>${s.userName}</td>
      <td>${DB.getBranchName(s.branchId)}</td>
      <td><strong>${formatMoney(s.total)}</strong></td>
      <td>${s.voided ? '<span class="inactive-tag">Anulada</span>' : '<span style="color:var(--success);font-weight:600;">Registrada</span>'}</td>
      <td><button class="btn-flat btn-small waves-effect" style="border:1px solid var(--border-soft);" onclick="openSaleDetail('${s.id}')">Ver más</button></td>
    </tr>
  `).join('');
}

function openSaleDetail(saleId) {
  const sale = DB.getSales().find(s => s.id === saleId);
  if (!sale) return;
  CURRENT_saleDetailId = saleId;

  document.getElementById('saleDetailId').value = saleId;
  document.getElementById('saleDetailVoidedTag').style.display = sale.voided ? 'inline-block' : 'none';
  document.getElementById('saleDetailActions').style.display = sale.voided ? 'none' : 'block';

  let metaHtml = `
    <strong>Fecha:</strong> ${formatDateTime(sale.date)} &nbsp;·&nbsp;
    <strong>Usuario:</strong> ${sale.userName} &nbsp;·&nbsp;
    <strong>Sucursal:</strong> ${DB.getBranchName(sale.branchId)}
  `;
  if (sale.editedAt) {
    metaHtml += `<br><strong>Última modificación:</strong> ${formatDateTime(sale.editedAt)} por ${sale.editedBy}`;
  }
  if (sale.voided) {
    metaHtml += `<br><strong>Anulada:</strong> ${formatDateTime(sale.voidedAt)} por ${sale.voidedBy}`;
  }
  document.getElementById('saleDetailMeta').innerHTML = metaHtml;

  document.getElementById('saleDetailItems').innerHTML = sale.items.map(it => `
    <tr>
      <td>
        <div style="display:flex;align-items:center;gap:8px;">
          <img class="sale-item-thumb" src="${it.photo}">
          <span>${it.name}</span>
        </div>
      </td>
      <td>${it.size}</td>
      <td>${it.quantity}</td>
      <td>${formatMoney(it.unitPrice)}</td>
      <td>${formatMoney(it.subtotal)}</td>
    </tr>
  `).join('');

  document.getElementById('saleDetailTotal').textContent = formatMoney(sale.total);
  modalSaleDetailInst.open();
}
