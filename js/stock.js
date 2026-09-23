/* ==========================================================================
   stock.js — Listado de stock con edición inline por lotes (usado por
   stock.html y stock-critico.html mediante el atributo data-critical-only)
   ========================================================================== */

let STOCK_session = null;
let STOCK_criticalOnly = false;
let STOCK_pendingDeltas = {}; // { variantId: delta } — persiste entre renders y filtros
let modalConfirmAdjustInst = null;

let TRANSFER_productId = null;
let TRANSFER_destBranchId = null;
let TRANSFER_qtyMap = {}; // { variantId: qty }
let TRANSFER_confirmEntries = [];
let modalTransferProductInst = null;
let modalConfirmTransferInst = null;

document.addEventListener('DOMContentLoaded', () => {
  STOCK_criticalOnly = document.body.dataset.criticalOnly === 'true';
  STOCK_session = nav_init(STOCK_criticalOnly ? 'critico' : 'stock');
  if (!STOCK_session) return;

  document.getElementById('branchLabel').textContent = DB.getBranchName(STOCK_session.branchId);

  modalConfirmAdjustInst = M.Modal.init(document.getElementById('modalConfirmAdjust'), {});
  modalTransferProductInst = M.Modal.init(document.getElementById('modalTransferProduct'), {
    onCloseStart: () => {
      TRANSFER_productId = null;
      TRANSFER_destBranchId = null;
      TRANSFER_qtyMap = {};
    }
  });
  modalConfirmTransferInst = M.Modal.init(document.getElementById('modalConfirmTransfer'), {});

  fillCategorySelect();

  document.getElementById('searchName').addEventListener('input', renderStockTable);
  document.getElementById('searchCategory').addEventListener('change', renderStockTable);
  document.getElementById('btnClearFilters').addEventListener('click', clearFilters);
  document.getElementById('btnClearEntries').addEventListener('click', clearEntries);
  document.getElementById('btnSaveChanges').addEventListener('click', onSaveChangesClick);
  document.getElementById('btnAcceptAdjust').addEventListener('click', onAcceptAdjustClick);

  document.getElementById('btnTransferBack').addEventListener('click', backToTransferBranchStep);
  document.getElementById('btnSaveTransfer').addEventListener('click', onSaveTransferClick);
  document.getElementById('btnAcceptTransfer').addEventListener('click', applyTransfer);

  renderStockTable();
});

function fillCategorySelect() {
  const select = document.getElementById('searchCategory');
  const categories = DB.getCategories();
  select.innerHTML = '<option value="">Todas las categorías</option>' +
    categories.map(c => `<option value="${c}">${c}</option>`).join('');
}

function clearFilters() {
  document.getElementById('searchName').value = '';
  document.getElementById('searchCategory').value = '';
  renderStockTable();
}

function clearEntries() {
  STOCK_pendingDeltas = {};
  M.toast({ html: 'Se limpiaron todos los ingresos cargados.' });
  renderStockTable();
}

/* ---------------- Construcción de la tabla ---------------- */
function getFilteredProducts() {
  const branchId = STOCK_session.branchId;
  const term = document.getElementById('searchName').value.trim().toLowerCase();
  const category = document.getElementById('searchCategory').value;

  return DB.getProducts().filter(p =>
    p.active &&
    p.branchesSold.includes(branchId) &&
    (term === '' || p.name.toLowerCase().includes(term)) &&
    (category === '' || (p.categories || []).includes(category))
  );
}

function buildVariantLinesHtml(product, branchId, onlyCritical) {
  const variants = DB.getVariantsByProduct(product.id)
    .filter(v => v.active && v.stock[branchId])
    .sort((a, b) => SIZES.indexOf(a.size) - SIZES.indexOf(b.size));

  let anyCritical = false;
  const lines = variants.map(v => {
    const st = v.stock[branchId];
    const isCritical = st.current <= st.critical;
    if (isCritical) anyCritical = true;
    if (onlyCritical && !isCritical) return null;

    const delta = STOCK_pendingDeltas[v.id] || 0;
    const newVal = Math.max(0, st.current + delta);

    return `
      <div class="variant-stock-line">
        <span class="v-size ${isCritical ? 'low-stock-text' : ''}">${v.size}</span>
        <span class="v-info">Actual: <strong>${st.current}</strong> · Mín: ${st.critical}</span>
        <div class="stock-adjust-row">
          <button type="button" class="adj-btn minus" onclick="adjustDelta('${v.id}', -1)">−</button>
          <input type="number" id="delta_${v.id}" value="${delta}" onchange="onDeltaTyped('${v.id}')">
          <button type="button" class="adj-btn plus" onclick="adjustDelta('${v.id}', 1)">+</button>
        </div>
        <span class="v-new" id="newstock_${v.id}">→ ${newVal}</span>
      </div>
    `;
  }).filter(Boolean);

  return { html: lines.join('') || '<span style="color:var(--text-muted);">—</span>', anyCritical, hasLines: lines.length > 0 };
}

function renderStockTable() {
  const branchId = STOCK_session.branchId;
  const products = getFilteredProducts();

  let rows = [];
  products.forEach(p => {
    const variantsInfo = buildVariantLinesHtml(p, branchId, STOCK_criticalOnly);
    if (!variantsInfo.hasLines) return;
    if (STOCK_criticalOnly && !variantsInfo.anyCritical) return;
    rows.push({ product: p, variantsInfo });
  });

  const tbody = document.getElementById('stockTbody');
  const emptyMsg = document.getElementById('noStockMsg');

  if (rows.length === 0) {
    emptyMsg.style.display = 'block';
    tbody.innerHTML = '';
    return;
  }
  emptyMsg.style.display = 'none';

  tbody.innerHTML = rows.map(r => `
    <tr class="${r.variantsInfo.anyCritical ? 'low-stock-row' : ''}">
      <td><img class="thumb" src="${r.product.photo}"></td>
      <td><strong>${r.product.name}</strong></td>
      <td style="max-width:240px;">${r.product.description || ''}</td>
      <td>${(r.product.categories || []).map(c => `<span class="chip chip-cat">${c}</span>`).join('')}</td>
      <td>${r.variantsInfo.html}</td>
      <td>
        <button type="button" class="btn-flat btn-small waves-effect" style="border:1px solid var(--border-soft);white-space:nowrap;" onclick="openTransferModal('${r.product.id}')">
          <i class="material-icons left tiny">swap_horiz</i>Transferir
        </button>
      </td>
    </tr>
  `).join('');
}

/* ---------------- Edición de deltas por variante ---------------- */
function getVariantBaseCurrent(variantId) {
  const v = DB.getVariants().find(v => v.id === variantId);
  return v ? v.stock[STOCK_session.branchId].current : 0;
}

function adjustDelta(variantId, step) {
  const input = document.getElementById('delta_' + variantId);
  input.value = (parseInt(input.value) || 0) + step;
  updateDeltaDisplay(variantId);
}

function onDeltaTyped(variantId) {
  updateDeltaDisplay(variantId);
}

function updateDeltaDisplay(variantId) {
  const input = document.getElementById('delta_' + variantId);
  const delta = parseInt(input.value) || 0;
  if (delta === 0) {
    delete STOCK_pendingDeltas[variantId];
  } else {
    STOCK_pendingDeltas[variantId] = delta;
  }
  const base = getVariantBaseCurrent(variantId);
  const newVal = Math.max(0, base + delta);
  const newEl = document.getElementById('newstock_' + variantId);
  if (newEl) newEl.textContent = '→ ' + newVal;
}

/* ---------------- Guardar cambios (por lotes) ---------------- */
function onSaveChangesClick() {
  const entries = Object.entries(STOCK_pendingDeltas).filter(([, delta]) => delta !== 0);
  if (entries.length === 0) {
    M.toast({ html: 'No cargaste ningún cambio de stock todavía.' });
    return;
  }

  const variants = DB.getVariants();
  const products = DB.getProducts();
  const branchId = STOCK_session.branchId;

  const list = entries.map(([variantId, delta]) => {
    const v = variants.find(v => v.id === variantId);
    if (!v) return '';
    const p = products.find(p => p.id === v.productId);
    const base = v.stock[branchId].current;
    const newVal = Math.max(0, base + delta);
    const sign = delta > 0 ? '+' : '';
    const colorClass = delta > 0 ? 'style="color:var(--success);font-weight:700;"' : 'style="color:var(--danger);font-weight:700;"';
    return `<div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--border-soft);">
              <span><strong>${p ? p.name : ''}</strong> — Talle ${v.size} (${base} → ${newVal})</span>
              <span ${colorClass}>${sign}${delta}</span>
            </div>`;
  }).join('');

  document.getElementById('confirmAdjustList').innerHTML = list;
  modalConfirmAdjustInst.open();
}

function onAcceptAdjustClick() {
  const variants = DB.getVariants();
  const branchId = STOCK_session.branchId;

  Object.entries(STOCK_pendingDeltas).forEach(([variantId, delta]) => {
    if (delta === 0) return;
    const v = variants.find(v => v.id === variantId);
    if (!v || !v.stock[branchId]) return;
    const base = v.stock[branchId].current;
    v.stock[branchId].current = Math.max(0, base + delta);
  });
  DB.setVariants(variants);

  STOCK_pendingDeltas = {};
  modalConfirmAdjustInst.close();
  M.toast({ html: 'Stock actualizado correctamente.' });
  renderStockTable();
  nav_render(STOCK_criticalOnly ? 'critico' : 'stock'); // refresca el badge de stock crítico
}

/* ==========================================================================
   Transferencia de stock entre sucursales
   ========================================================================== */

function openTransferModal(productId) {
  const product = DB.getProducts().find(p => p.id === productId);
  if (!product) return;

  TRANSFER_productId = productId;
  TRANSFER_destBranchId = null;
  TRANSFER_qtyMap = {};

  document.getElementById('transferProductName').textContent = product.name;

  const branches = DB.getBranches().filter(b => b.id !== STOCK_session.branchId);
  document.getElementById('transferBranchList').innerHTML = branches.map(b => `
    <div class="branch-option" onclick="selectTransferBranch('${b.id}')">
      <i class="material-icons">storefront</i>
      <div>
        <div class="b-name">${b.name}</div>
        <div class="b-sub">Transferir stock a esta sucursal</div>
      </div>
    </div>
  `).join('');

  document.getElementById('transferStepBranch').style.display = 'block';
  document.getElementById('transferStepQty').style.display = 'none';
  document.getElementById('btnTransferBack').style.display = 'none';
  document.getElementById('btnSaveTransfer').style.display = 'none';

  modalTransferProductInst.open();
}

function selectTransferBranch(branchId) {
  TRANSFER_destBranchId = branchId;

  document.getElementById('transferFromBranch').textContent = DB.getBranchName(STOCK_session.branchId);
  document.getElementById('transferToBranch').textContent = DB.getBranchName(branchId);

  renderTransferQtyRows();

  document.getElementById('transferStepBranch').style.display = 'none';
  document.getElementById('transferStepQty').style.display = 'block';
  document.getElementById('btnTransferBack').style.display = 'inline-block';
  document.getElementById('btnSaveTransfer').style.display = 'inline-block';
}

function backToTransferBranchStep() {
  document.getElementById('transferStepBranch').style.display = 'block';
  document.getElementById('transferStepQty').style.display = 'none';
  document.getElementById('btnTransferBack').style.display = 'none';
  document.getElementById('btnSaveTransfer').style.display = 'none';
}

function renderTransferQtyRows() {
  const branchId = STOCK_session.branchId;
  const variants = DB.getVariantsByProduct(TRANSFER_productId)
    .filter(v => v.active && v.stock[branchId])
    .sort((a, b) => SIZES.indexOf(a.size) - SIZES.indexOf(b.size));

  document.getElementById('transferQtyTbody').innerHTML = variants.map(v => {
    const sourceStock = v.stock[branchId].current;
    const qty = TRANSFER_qtyMap[v.id] || 0;
    return `
      <tr data-variant-id="${v.id}">
        <td><strong>${v.size}</strong></td>
        <td>${sourceStock}</td>
        <td>
          <div class="stock-adjust-row">
            <button type="button" class="adj-btn minus" onclick="adjustTransferQty('${v.id}', -1)">−</button>
            <input type="number" min="0" max="${sourceStock}" id="transfer_qty_${v.id}" value="${qty}" onchange="onTransferQtyTyped('${v.id}')">
            <button type="button" class="adj-btn plus" onclick="adjustTransferQty('${v.id}', 1)">+</button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

function getTransferSourceStock(variantId) {
  const v = DB.getVariants().find(v => v.id === variantId);
  return v && v.stock[STOCK_session.branchId] ? v.stock[STOCK_session.branchId].current : 0;
}

function setTransferQty(variantId, qty) {
  const max = getTransferSourceStock(variantId);
  let clamped = isNaN(qty) ? 0 : qty;
  if (clamped < 0) clamped = 0;
  if (clamped > max) {
    clamped = max;
    M.toast({ html: `Solo hay ${max} unidades disponibles para transferir en este talle.` });
  }
  if (clamped === 0) {
    delete TRANSFER_qtyMap[variantId];
  } else {
    TRANSFER_qtyMap[variantId] = clamped;
  }
  const input = document.getElementById('transfer_qty_' + variantId);
  if (input) input.value = clamped;
}

function adjustTransferQty(variantId, step) {
  const current = TRANSFER_qtyMap[variantId] || 0;
  setTransferQty(variantId, current + step);
}

function onTransferQtyTyped(variantId) {
  const input = document.getElementById('transfer_qty_' + variantId);
  setTransferQty(variantId, parseInt(input.value));
}

function onSaveTransferClick() {
  const entries = Object.entries(TRANSFER_qtyMap).filter(([, qty]) => qty > 0);
  if (entries.length === 0) {
    M.toast({ html: 'Ingresá una cantidad a transferir para al menos un talle.' });
    return;
  }

  const product = DB.getProducts().find(p => p.id === TRANSFER_productId);
  const variants = DB.getVariants();
  const sourceBranchId = STOCK_session.branchId;
  const destBranchId = TRANSFER_destBranchId;
  const sourceName = DB.getBranchName(sourceBranchId);
  const destName = DB.getBranchName(destBranchId);

  TRANSFER_confirmEntries = entries.map(([variantId, qty]) => ({ variantId, qty }));

  const list = TRANSFER_confirmEntries.map(({ variantId, qty }) => {
    const v = variants.find(v => v.id === variantId);
    const sourceCurrent = v.stock[sourceBranchId].current;
    const destCurrent = v.stock[destBranchId] ? v.stock[destBranchId].current : 0;
    return `
      <div style="padding:10px 0;border-bottom:1px solid var(--border-soft);">
        <div style="font-weight:700;margin-bottom:4px;">${product ? product.name : ''} — Talle ${v.size} · ${qty} unidad(es)</div>
        <div style="display:flex;justify-content:space-between;font-size:0.85rem;">
          <span style="color:var(--danger);">${sourceName}: ${sourceCurrent} → ${sourceCurrent - qty}</span>
          <span style="color:var(--success);">${destName}: ${destCurrent} → ${destCurrent + qty}</span>
        </div>
      </div>
    `;
  }).join('');

  document.getElementById('confirmTransferList').innerHTML = list;
  modalConfirmTransferInst.open();
}

function applyTransfer() {
  const variants = DB.getVariants();
  const products = DB.getProducts();
  const sourceBranchId = STOCK_session.branchId;
  const destBranchId = TRANSFER_destBranchId;

  TRANSFER_confirmEntries.forEach(({ variantId, qty }) => {
    const v = variants.find(v => v.id === variantId);
    if (!v || !v.stock[sourceBranchId]) return;

    v.stock[sourceBranchId].current = Math.max(0, v.stock[sourceBranchId].current - qty);

    if (!v.stock[destBranchId]) {
      v.stock[destBranchId] = { current: 0, critical: v.stock[sourceBranchId].critical || 0 };
    }
    v.stock[destBranchId].current += qty;
  });
  DB.setVariants(variants);

  const product = products.find(p => p.id === TRANSFER_productId);
  if (product && !product.branchesSold.includes(destBranchId)) {
    product.branchesSold.push(destBranchId);
    DB.setProducts(products);
  }

  modalConfirmTransferInst.close();
  modalTransferProductInst.close();

  TRANSFER_productId = null;
  TRANSFER_destBranchId = null;
  TRANSFER_qtyMap = {};
  TRANSFER_confirmEntries = [];

  M.toast({ html: 'Transferencia realizada correctamente.' });
  renderStockTable();
  nav_render(STOCK_criticalOnly ? 'critico' : 'stock');
}
