/* ==========================================================================
   productos.js — Alta, listado y edición de productos
   ========================================================================== */

let PROD_session = null;
let addChipsInstance = null;
let editChipsInstance = null;

document.addEventListener('DOMContentLoaded', () => {
  PROD_session = nav_init('productos');
  document.getElementById('branchLabel').textContent = DB.getBranchName(PROD_session.branchId);
  if (!PROD_session) return;

  fillSizeSelects('add_sizeMin', 'add_sizeMax');
  fillSizeSelects('edit_sizeMin', 'edit_sizeMax');
  renderBranchChecks('add_branchChecks', []);
  renderBranchChecks('edit_branchChecks', []);

  M.FormSelect.init(document.querySelectorAll('select:not(.browser-default)'));

  fillCategoryFilterSelect();
  document.getElementById('searchName').addEventListener('input', renderProductsTable);
  document.getElementById('searchCategory').addEventListener('change', renderProductsTable);
  document.getElementById('btnClearFilters').addEventListener('click', clearProductFilters);

  document.getElementById('btnOpenAdd').addEventListener('click', openAddModal);
  document.getElementById('btnSaveNewProduct').addEventListener('click', saveNewProduct);
  document.getElementById('btnSaveEditProduct').addEventListener('click', saveEditProduct);
  document.getElementById('btnDeactivateProduct').addEventListener('click', deactivateProduct);

  document.getElementById('add_photoInput').addEventListener('change', (e) => handlePhotoInput(e, 'add_photoPreview'));
  document.getElementById('edit_photoInput').addEventListener('change', (e) => handlePhotoInput(e, 'edit_photoPreview'));

  ['add_sizeMin', 'add_sizeMax'].forEach(id => document.getElementById(id).addEventListener('change', () => renderAddStockFields()));
  ['edit_sizeMin', 'edit_sizeMax'].forEach(id => document.getElementById(id).addEventListener('change', () => renderEditStockFields()));

  M.Modal.init(document.getElementById('modalAddProduct'), {});
  M.Modal.init(document.getElementById('modalEditProduct'), {});

  renderProductsTable();
});

function fillSizeSelects(minId, maxId) {
  const opts = SIZES.map(s => `<option value="${s}">${s}</option>`).join('');
  document.getElementById(minId).innerHTML = opts;
  document.getElementById(maxId).innerHTML = opts;
  document.getElementById(maxId).value = SIZES[SIZES.length - 1];
}

function renderBranchChecks(containerId, checkedIds) {
  const branches = DB.getBranches();
  const container = document.getElementById(containerId);
  container.innerHTML = branches.map(b => `
    <label>
      <input type="checkbox" class="branch-check-input" value="${b.id}" ${checkedIds.includes(b.id) ? 'checked' : ''}/>
      <span>${b.name}</span>
    </label>
  `).join('');
  container.querySelectorAll('.branch-check-input').forEach(chk => {
    chk.addEventListener('change', () => {
      const prefix = containerId === 'add_branchChecks' ? 'add' : 'edit';
      renderBasePriceInputs(prefix);
      if (prefix === 'add') renderAddStockFields();
      else renderEditStockFields();
    });
  });
}

function getCheckedBranches(containerId) {
  return Array.from(document.querySelectorAll('#' + containerId + ' .branch-check-input:checked')).map(c => c.value);
}

/* ---------- Precio base por sucursal ---------- */
function renderBasePriceInputs(prefix, existingBasePrice) {
  const containerId = prefix + '_branchChecks';
  const wrapId = prefix + '_basePriceWrap';
  const branches = getCheckedBranches(containerId);
  const wrap = document.getElementById(wrapId);
  const basePrice = existingBasePrice || {};

  if (branches.length === 0) {
    wrap.innerHTML = `<p style="color:var(--text-muted);font-size:0.85rem;">Seleccioná al menos una sucursal para definir el precio base.</p>`;
    return;
  }

  wrap.innerHTML = branches.map(bId => `
    <div class="input-field col s6 m4">
      <input type="number" min="0" step="1" id="${prefix}_baseprice_${bId}"
             value="${basePrice[bId] !== undefined ? basePrice[bId] : ''}"
             oninput="applyBasePriceToColumn('${prefix}', '${bId}')">
      <label class="active" for="${prefix}_baseprice_${bId}">Precio base — ${DB.getBranchName(bId)}</label>
    </div>
  `).join('');
}

function applyBasePriceToColumn(prefix, branchId) {
  const baseInput = document.getElementById(`${prefix}_baseprice_${branchId}`);
  const baseVal = baseInput ? baseInput.value : '';
  const min = document.getElementById(prefix + '_sizeMin').value;
  const max = document.getElementById(prefix + '_sizeMax').value;
  sizesInRange(min, max).forEach(size => {
    const priceInput = document.getElementById(`${prefix}_price_${size}_${branchId}`);
    if (priceInput) priceInput.value = baseVal;
  });
}

function sizesInRange(minSize, maxSize) {
  const minIdx = SIZES.indexOf(minSize);
  const maxIdx = SIZES.indexOf(maxSize);
  if (minIdx === -1 || maxIdx === -1 || minIdx > maxIdx) return [];
  return SIZES.slice(minIdx, maxIdx + 1);
}

function handlePhotoInput(e, previewId) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (ev) => {
    document.getElementById(previewId).src = ev.target.result;
    document.getElementById(previewId).dataset.base64 = ev.target.result;
  };
  reader.readAsDataURL(file);
}

/* ---------- Campos dinámicos de stock y precio por talle / sucursal ---------- */
function buildStockFieldsHtml(sizes, branches, existingVariants, prefix) {
  if (sizes.length === 0 || branches.length === 0) {
    return `<p style="color:var(--text-muted);font-size:0.85rem;">Seleccioná un rango de talles y al menos una sucursal para definir el stock y el precio.</p>`;
  }
  let head = '<th>Talle</th>';
  branches.forEach(bId => {
    head += `<th colspan="3">${DB.getBranchName(bId)}</th>`;
  });
  let subhead = '<th></th>';
  branches.forEach(() => { subhead += '<th>Stock actual</th><th>Stock mínimo</th><th>Precio</th>'; });

  let rows = '';
  sizes.forEach(size => {
    rows += `<tr><td><strong>${size}</strong></td>`;
    branches.forEach(bId => {
      let currentVal = 0, criticalVal = 5, priceVal = '';
      const baseInput = document.getElementById(`${prefix}_baseprice_${bId}`);
      if (baseInput && baseInput.value !== '') priceVal = baseInput.value;
      if (existingVariants) {
        const v = existingVariants.find(v => v.size === size);
        if (v && v.stock[bId]) {
          currentVal = v.stock[bId].current;
          criticalVal = v.stock[bId].critical;
          if (v.stock[bId].price !== undefined) priceVal = v.stock[bId].price;
        }
      }
      rows += `
        <td><input type="number" min="0" style="margin:0;" id="${prefix}_cur_${size}_${bId}" value="${currentVal}"></td>
        <td><input type="number" min="0" style="margin:0;" id="${prefix}_crit_${size}_${bId}" value="${criticalVal}"></td>
        <td><input type="number" min="0" step="1" style="margin:0;" id="${prefix}_price_${size}_${bId}" value="${priceVal}"></td>
      `;
    });
    rows += '</tr>';
  });

  return `
    <table class="stock-fields-table" style="margin-top:8px;">
      <thead><tr>${head}</tr><tr>${subhead}</tr></thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

function renderAddStockFields() {
  const min = document.getElementById('add_sizeMin').value;
  const max = document.getElementById('add_sizeMax').value;
  const sizes = sizesInRange(min, max);
  const branches = getCheckedBranches('add_branchChecks');
  document.getElementById('add_stockFieldsWrap').innerHTML = buildStockFieldsHtml(sizes, branches, null, 'add');
}

function renderEditStockFields(existingVariants) {
  const min = document.getElementById('edit_sizeMin').value;
  const max = document.getElementById('edit_sizeMax').value;
  const sizes = sizesInRange(min, max);
  const branches = getCheckedBranches('edit_branchChecks');
  document.getElementById('edit_stockFieldsWrap').innerHTML = buildStockFieldsHtml(sizes, branches, existingVariants || EDIT_currentVariants, 'edit');
}

/* ---------- Modal Agregar ---------- */
function openAddModal() {
  document.getElementById('add_name').value = '';
  document.getElementById('add_description').value = '';
  document.getElementById('add_color').value = '';
  document.getElementById('add_photoPreview').src = genericProductImage();
  document.getElementById('add_photoPreview').dataset.base64 = '';
  document.getElementById('add_sizeMin').value = 'S';
  document.getElementById('add_sizeMax').value = 'XL';
  M.FormSelect.init(document.querySelectorAll('#modalAddProduct select'));
  renderBranchChecks('add_branchChecks', []);
  renderBasePriceInputs('add');
  renderAddStockFields();

  const chipsEl = document.getElementById('add_categoryChips');
  const existingAdd = M.Chips.getInstance(chipsEl);
  if (existingAdd) existingAdd.destroy();
  addChipsInstance = M.Chips.init(chipsEl, {
    data: [],
    placeholder: 'Agregar categoría',
    secondaryPlaceholder: '+ categoría',
    autocompleteOptions: { data: buildCategoryAutocomplete(), limit: 8, minLength: 1 }
  });

  M.updateTextFields();
  M.Modal.getInstance(document.getElementById('modalAddProduct')).open();
}

function buildCategoryAutocomplete() {
  const obj = {};
  DB.getCategories().forEach(c => obj[c] = null);
  return obj;
}

function saveNewProduct() {
  const name = document.getElementById('add_name').value.trim();
  const description = document.getElementById('add_description').value.trim();
  const color = document.getElementById('add_color').value.trim();
  const sizeMin = document.getElementById('add_sizeMin').value;
  const sizeMax = document.getElementById('add_sizeMax').value;
  const branches = getCheckedBranches('add_branchChecks');
  const categories = (addChipsInstance ? addChipsInstance.chipsData.map(c => c.tag) : []);
  const photo = document.getElementById('add_photoPreview').dataset.base64 || genericProductImage();

  if (!name) { M.toast({ html: 'Ingresá un nombre de producto.' }); return; }
  if (SIZES.indexOf(sizeMin) > SIZES.indexOf(sizeMax)) { M.toast({ html: 'El talle mínimo no puede ser mayor al máximo.' }); return; }
  if (branches.length === 0) { M.toast({ html: 'Seleccioná al menos una sucursal.' }); return; }
  if (categories.length === 0) { M.toast({ html: 'Agregá al menos una categoría.' }); return; }

  categories.forEach(c => DB.addCategoryIfNew(c));

  const basePrice = {};
  branches.forEach(bId => {
    const el = document.getElementById(`add_baseprice_${bId}`);
    basePrice[bId] = el ? (parseFloat(el.value) || 0) : 0;
  });

  const product = {
    id: uid('prod'),
    name, description, color, categories,
    basePrice,
    photo,
    sizeMin, sizeMax,
    branchesSold: branches,
    active: true,
    createdAt: nowISO()
  };

  const sizes = sizesInRange(sizeMin, sizeMax);
  const variants = [];
  sizes.forEach(size => {
    const stock = {};
    branches.forEach(bId => {
      const cur = parseInt(document.getElementById(`add_cur_${size}_${bId}`).value) || 0;
      const crit = parseInt(document.getElementById(`add_crit_${size}_${bId}`).value) || 0;
      const priceEl = document.getElementById(`add_price_${size}_${bId}`);
      const price = priceEl && priceEl.value !== '' ? (parseFloat(priceEl.value) || 0) : basePrice[bId];
      stock[bId] = { current: cur, critical: crit, price };
    });
    variants.push({ id: uid('var'), productId: product.id, size, active: true, stock });
  });

  const allProducts = DB.getProducts();
  allProducts.push(product);
  DB.setProducts(allProducts);

  const allVariants = DB.getVariants();
  DB.setVariants([...allVariants, ...variants]);

  M.Modal.getInstance(document.getElementById('modalAddProduct')).close();
  M.toast({ html: 'Producto creado correctamente.' });
  fillCategoryFilterSelect();
  renderProductsTable();
}

function fillCategoryFilterSelect() {
  const select = document.getElementById('searchCategory');
  const categories = DB.getCategories();
  select.innerHTML = '<option value="">Todas las categorías</option>' +
    categories.map(c => `<option value="${c}">${c}</option>`).join('');
}

function clearProductFilters() {
  document.getElementById('searchName').value = '';
  document.getElementById('searchCategory').value = '';
  renderProductsTable();
}

function formatPriceRange(product) {
  const values = Object.values(product.basePrice || {}).filter(v => typeof v === 'number');
  if (values.length === 0) return '—';
  const min = Math.min(...values);
  const max = Math.max(...values);
  return min === max ? formatMoney(min) : `${formatMoney(min)} – ${formatMoney(max)}`;
}

/* ---------- Tabla principal ---------- */
function getFilteredProducts() {
  const term = document.getElementById('searchName').value.trim().toLowerCase();
  const category = document.getElementById('searchCategory').value;
  return DB.getProducts().filter(p =>
    (term === '' || p.name.toLowerCase().includes(term)) &&
    (category === '' || (p.categories || []).includes(category))
  );
}

function renderProductsTable() {
  const products = getFilteredProducts();
  const tbody = document.getElementById('productsTbody');
  if (products.length === 0) {
    document.getElementById('noProductsMsg').style.display = 'block';
    tbody.innerHTML = '';
    return;
  }
  document.getElementById('noProductsMsg').style.display = 'none';

  tbody.innerHTML = products.map(p => `
    <tr onclick="openEditModal('${p.id}')" class="${!p.active ? 'low-stock-row' : ''}">
      <td><img class="thumb" src="${p.photo}"></td>
      <td><strong>${p.name}</strong></td>
      <td style="max-width:260px;">${p.description || ''}</td>
      <td>${(p.categories || []).map(c => `<span class="chip chip-cat">${c}</span>`).join('')}</td>
      <td>${p.sizeMin} – ${p.sizeMax}</td>
      <td>${formatPriceRange(p)}</td>
      <td>${p.active ? '<span style="color:var(--success);font-weight:600;">Activo</span>' : '<span class="inactive-tag">De baja</span>'}</td>
    </tr>
  `).join('');
}

/* ---------- Modal Editar ---------- */
let EDIT_currentVariants = [];

function openEditModal(productId) {
  const product = DB.getProducts().find(p => p.id === productId);
  if (!product) return;
  EDIT_currentVariants = DB.getVariantsByProduct(productId);

  document.getElementById('edit_productId').value = product.id;
  document.getElementById('edit_name').value = product.name;
  document.getElementById('edit_description').value = product.description;
  document.getElementById('edit_color').value = product.color;
  document.getElementById('edit_photoPreview').src = product.photo;
  document.getElementById('edit_photoPreview').dataset.base64 = product.photo;
  document.getElementById('edit_sizeMin').value = product.sizeMin;
  document.getElementById('edit_sizeMax').value = product.sizeMax;
  document.getElementById('edit_inactiveTag').style.display = product.active ? 'none' : 'inline-block';
  document.getElementById('btnDeactivateProduct').innerHTML = product.active
    ? '<i class="material-icons left">block</i>Dar de baja'
    : '<i class="material-icons left">check_circle</i>Reactivar producto';

  M.FormSelect.init(document.querySelectorAll('#modalEditProduct select'));
  renderBranchChecks('edit_branchChecks', product.branchesSold);
  renderBasePriceInputs('edit', product.basePrice);

  const chipsEl = document.getElementById('edit_categoryChips');
  const existingEdit = M.Chips.getInstance(chipsEl);
  if (existingEdit) existingEdit.destroy();
  chipsEl.innerHTML = '';
  editChipsInstance = M.Chips.init(chipsEl, {
    data: (product.categories || []).map(c => ({ tag: c })),
    placeholder: 'Agregar categoría',
    secondaryPlaceholder: '+ categoría',
    autocompleteOptions: { data: buildCategoryAutocomplete(), limit: 8, minLength: 1 }
  });

  renderEditStockFields(EDIT_currentVariants);
  M.updateTextFields();
  M.Modal.getInstance(document.getElementById('modalEditProduct')).open();
}

function saveEditProduct() {
  const id = document.getElementById('edit_productId').value;
  const products = DB.getProducts();
  const product = products.find(p => p.id === id);
  if (!product) return;

  if (!confirm('¿Confirmás guardar los cambios de este producto?')) return;

  const name = document.getElementById('edit_name').value.trim();
  if (!name) { M.toast({ html: 'Ingresá un nombre de producto.' }); return; }

  const sizeMin = document.getElementById('edit_sizeMin').value;
  const sizeMax = document.getElementById('edit_sizeMax').value;
  if (SIZES.indexOf(sizeMin) > SIZES.indexOf(sizeMax)) { M.toast({ html: 'El talle mínimo no puede ser mayor al máximo.' }); return; }

  const branches = getCheckedBranches('edit_branchChecks');
  if (branches.length === 0) { M.toast({ html: 'Seleccioná al menos una sucursal.' }); return; }

  const categories = (editChipsInstance ? editChipsInstance.chipsData.map(c => c.tag) : []);
  if (categories.length === 0) { M.toast({ html: 'Agregá al menos una categoría.' }); return; }
  categories.forEach(c => DB.addCategoryIfNew(c));

  const newBasePrice = {};
  branches.forEach(bId => {
    const el = document.getElementById(`edit_baseprice_${bId}`);
    newBasePrice[bId] = el ? (parseFloat(el.value) || 0) : 0;
  });

  product.name = name;
  product.description = document.getElementById('edit_description').value.trim();
  product.color = document.getElementById('edit_color').value.trim();
  product.photo = document.getElementById('edit_photoPreview').dataset.base64 || product.photo;
  product.categories = categories;
  product.sizeMin = sizeMin;
  product.sizeMax = sizeMax;
  product.branchesSold = branches;
  product.basePrice = Object.assign({}, product.basePrice, newBasePrice);

  DB.setProducts(products);

  // Reconciliar variantes según nuevo rango de talles
  const sizes = sizesInRange(sizeMin, sizeMax);
  const allVariants = DB.getVariants();

  sizes.forEach(size => {
    let variant = allVariants.find(v => v.productId === id && v.size === size);
    const stockData = {};
    branches.forEach(bId => {
      const curEl = document.getElementById(`edit_cur_${size}_${bId}`);
      const critEl = document.getElementById(`edit_crit_${size}_${bId}`);
      const priceEl = document.getElementById(`edit_price_${size}_${bId}`);
      stockData[bId] = {
        current: curEl ? (parseInt(curEl.value) || 0) : 0,
        critical: critEl ? (parseInt(critEl.value) || 0) : 0,
        price: priceEl && priceEl.value !== '' ? (parseFloat(priceEl.value) || 0) : newBasePrice[bId]
      };
    });
    if (variant) {
      variant.active = true;
      variant.stock = Object.assign({}, variant.stock, stockData);
    } else {
      allVariants.push({ id: uid('var'), productId: id, size, active: true, stock: stockData });
    }
  });

  // Talles que quedaron fuera del nuevo rango -> baja lógica de esas variantes
  allVariants.filter(v => v.productId === id && !sizes.includes(v.size)).forEach(v => { v.active = false; });

  DB.setVariants(allVariants);

  M.Modal.getInstance(document.getElementById('modalEditProduct')).close();
  M.toast({ html: 'Cambios guardados.' });
  fillCategoryFilterSelect();
  renderProductsTable();
}

function deactivateProduct() {
  const id = document.getElementById('edit_productId').value;
  const products = DB.getProducts();
  const product = products.find(p => p.id === id);
  if (!product) return;

  const willActivate = !product.active;
  const msg = willActivate ? '¿Reactivar este producto?' : '¿Dar de baja este producto? No se mostrará en el catálogo activo.';
  if (!confirm(msg)) return;

  product.active = willActivate;
  DB.setProducts(products);

  M.Modal.getInstance(document.getElementById('modalEditProduct')).close();
  M.toast({ html: willActivate ? 'Producto reactivado.' : 'Producto dado de baja.' });
  renderProductsTable();
}
