/* ==========================================================================
   nav.js — Sidebar de navegación + menú de perfil, compartido entre páginas
   ========================================================================== */

const NAV_ITEMS = [
  { key: 'home', label: 'Inicio', icon: 'dashboard', href: 'home.html', adminOnly: false },
  { key: 'productos', label: 'Productos', icon: 'checkroom', href: 'productos.html', adminOnly: false },
  { key: 'stock', label: 'Stock', icon: 'inventory_2', href: 'stock.html', adminOnly: false },
  { key: 'critico', label: 'Stock crítico', icon: 'warning_amber', href: 'stock-critico.html', adminOnly: false },
  { key: 'ventas', label: 'Ventas', icon: 'point_of_sale', href: 'ventas.html', adminOnly: false },
  { key: 'usuarios', label: 'Usuarios', icon: 'group', href: 'usuarios.html', adminOnly: true }
];

function nav_countCriticalForBranch(branchId) {
  const variants = DB.getVariants().filter(v => v.active);
  const products = DB.getProducts();
  let count = 0;
  variants.forEach(v => {
    const prod = products.find(p => p.id === v.productId);
    console.log(prod)
    if (!prod || !prod.active || !prod.branchesSold.includes(branchId)) return;
    const st = v.stock[branchId];
    if (st && st.current <= st.critical) count++;
  });
  return count;
}

function nav_render(activeKey) {
  const session = DB.getSession();
  if (!session) return;

  const branchName = session.branchId ? DB.getBranchName(session.branchId) : '';
  const criticalCount = session.branchId ? nav_countCriticalForBranch(session.branchId) : 0;

  const itemsHtml = NAV_ITEMS.filter(it => !it.adminOnly || session.role === 'admin').map(it => {
    const activeClass = it.key === activeKey ? 'active' : '';
    const badge = (it.key === 'critico' && criticalCount > 0)
      ? `<span class="critical-badge">${criticalCount}</span>` : '';
    return `<a href="${it.href}" class="side-link ${activeClass}">
              <i class="material-icons">${it.icon}</i>
              <span>${it.label}</span>
              ${badge}
            </a>`;
  }).join('');

  const sidebarHtml = `
    <div class="sidebar" id="mainSidebar">
      <div class="brand">
        <div class="logo-mark">SICO</div>
        <div>
          <div class="brand-text">SICO</div>
          <div class="brand-sub">Gestión de indumentaria</div>
        </div>
      </div>
      <nav class="sidebar-nav">
        ${itemsHtml}
      </nav>
      <div class="sidebar-profile">
        <div class="profile-popover" id="profilePopover">
          <div class="pop-branch">SUCURSAL ACTUAL</div>
          <div class="pop-item" style="cursor:default;">
            <i class="material-icons">storefront</i>
            <span>${branchName}</span>
          </div>
          <div class="pop-divider"></div>
          <div class="pop-item" id="btnChangeBranch">
            <i class="material-icons">sync_alt</i>
            <span>Cambiar de sucursal</span>
          </div>
          <div class="pop-item" id="btnLogout">
            <i class="material-icons">logout</i>
            <span>Cerrar sesión</span>
          </div>
        </div>
        <div class="profile-trigger" id="profileTrigger">
          <img src="${GENERIC_AVATAR}" alt="Perfil">
          <div class="profile-info">
            <div class="profile-name">${session.name}</div>
            <div class="profile-role">${session.role === 'admin' ? 'Administrador' : 'Empleado'}</div>
          </div>
        </div>
      </div>
    </div>

    <div class="mobile-topbar">
      <i class="material-icons" id="btnOpenSidebar" style="cursor:pointer;">menu</i>
      <span style="font-family:'Poppins',sans-serif;font-weight:600;">SICO</span>
    </div>

    <!-- Modal cambiar sucursal -->
    <div id="modalChangeBranch" class="modal">
      <div class="modal-content">
        <p class="modal-title">Cambiar de sucursal</p>
        <p style="color:var(--text-muted);font-size:0.85rem;">Elegí la sucursal en la que vas a trabajar ahora.</p>
        <div id="branchOptionsList"></div>
      </div>
      <div class="modal-footer">
        <a href="#!" class="modal-close btn btn-flat">Cancelar</a>
      </div>
    </div>
  `;

  const container = document.getElementById('sidebar-container');
  container.innerHTML = sidebarHtml;

  // Popover perfil
  const trigger = document.getElementById('profileTrigger');
  const popover = document.getElementById('profilePopover');
  trigger.addEventListener('click', (e) => {
    e.stopPropagation();
    popover.classList.toggle('open');
  });
  document.addEventListener('click', () => popover.classList.remove('open'));

  document.getElementById('btnLogout').addEventListener('click', () => {
    auth_logout();
  });

  const modalBranchElem = document.getElementById('modalChangeBranch');
  const modalBranchInstance = M.Modal.init(modalBranchElem, {});

  document.getElementById('btnChangeBranch').addEventListener('click', (e) => {
    e.stopPropagation();
    popover.classList.remove('open');
    const branches = DB.getBranches();
    const list = document.getElementById('branchOptionsList');
    list.innerHTML = branches.map(b => `
      <div class="branch-option" data-id="${b.id}">
        <i class="material-icons">storefront</i>
        <div>
          <div class="b-name">${b.name}</div>
          <div class="b-sub">${b.id === session.branchId ? 'Sucursal actual' : 'Cambiar a esta sucursal'}</div>
        </div>
      </div>
    `).join('');
    list.querySelectorAll('.branch-option').forEach(opt => {
      opt.addEventListener('click', () => {
        auth_setBranch(opt.dataset.id);
        modalBranchInstance.close();
        window.location.href = 'home.html';
      });
    });
    modalBranchInstance.open();
  });

  // Mobile sidebar toggle
  const openBtn = document.getElementById('btnOpenSidebar');
  if (openBtn) {
    openBtn.addEventListener('click', () => {
      document.getElementById('mainSidebar').classList.toggle('open');
    });
  }
}

function nav_init(activeKey, opts) {
  const requireAdmin = opts && opts.requireAdmin;
  const session = requireAdmin ? auth_requireAdmin() : auth_requireBranch();
  if (!session) return null;
  nav_render(activeKey);
  return session;
}
