/* ==========================================================================
   db.js — Capa de datos sobre localStorage (sin backend)
   ========================================================================== */

const DB_KEYS = {
  users: 'sa_users',
  branches: 'sa_branches',
  categories: 'sa_categories',
  products: 'sa_products',
  variants: 'sa_variants',
  sales: 'sa_sales',
  session: 'sa_session',
  seeded: 'sa_seeded_v1'
};

const SIZES = ['XS', 'S', 'M', 'L', 'XL', 'XXL'];

const PAYMENT_METHODS = ['Débito', 'Crédito', 'Transferencia', 'Efectivo'];

/* ---------- Helpers genéricos ---------- */
function dbGet(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (e) {
    console.error('Error leyendo', key, e);
    return fallback;
  }
}

function dbSet(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function uid(prefix) {
  return (prefix ? prefix + '_' : '') + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
}

function nowISO() {
  return new Date().toISOString();
}

function formatMoney(n) {
  const v = Number(n) || 0;
  return '$' + v.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatDateTime(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString('es-AR') + ' ' + d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
}

/* Avatar genérico en SVG (data URI) para fotos de perfil */
const GENERIC_AVATAR = 'data:image/svg+xml;utf8,' + encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
     <rect width="100" height="100" fill="#1B2430"/>
     <circle cx="50" cy="38" r="18" fill="#C79A3D"/>
     <path d="M50 62 C25 62 15 80 15 100 L85 100 C85 80 75 62 50 62 Z" fill="#C79A3D"/>
   </svg>`
);

/* Imagen genérica de producto (placeholder) en SVG */
function genericProductImage(seedColor) {
  const c = seedColor || '#C79A3D';
  return 'data:image/svg+xml;utf8,' + encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200">
       <rect width="200" height="200" fill="#EFEAE0"/>
       <path d="M70 40 L100 20 L130 40 L150 55 L135 75 L120 65 L120 180 L80 180 L80 65 L65 75 L50 55 Z" fill="${c}" opacity="0.85"/>
     </svg>`
  );
}

/* ---------- Inicialización / semillas ---------- */
function seedDatabaseIfNeeded() {
  if (dbGet(DB_KEYS.seeded, false)) return;

  // Sucursales fijas
  const branches = [
    { id: 'suc_centro', name: 'Sucursal Centro' },
    { id: 'suc_feria', name: 'Sucursal Feria' }
  ];
  dbSet(DB_KEYS.branches, branches);

  // Categorías iniciales
  dbSet(DB_KEYS.categories, ['Remeras', 'Pantalones', 'Camperas', 'Vestidos', 'Accesorios', 'Calzado']);

  // Usuario administrador genérico
  const users = [
    {
      id: uid('user'),
      name: 'Administrador General',
      email: 'admin@tienda.com',
      password: 'admin123',
      role: 'admin',
      active: true
    }
  ];
  dbSet(DB_KEYS.users, users);

  // Productos genéricos de ejemplo
  const products = [];
  const variants = [];

  function addProduct(def) {
    const p = {
      id: uid('prod'),
      name: def.name,
      description: def.description,
      basePrice: {},
      color: def.color,
      categories: def.categories,
      photo: genericProductImage(def.imgColor),
      sizeMin: def.sizeMin,
      sizeMax: def.sizeMax,
      branchesSold: def.branchesSold,
      active: true,
      createdAt: nowISO()
    };
    def.branchesSold.forEach(bId => { p.basePrice[bId] = def.price; });
    products.push(p);

    const minIdx = SIZES.indexOf(def.sizeMin);
    const maxIdx = SIZES.indexOf(def.sizeMax);
    for (let i = minIdx; i <= maxIdx; i++) {
      const stock = {};
      def.branchesSold.forEach(bId => {
        stock[bId] = {
          current: def.initialStock !== undefined ? def.initialStock : Math.floor(Math.random() * 15) + 5,
          critical: def.criticalStock !== undefined ? def.criticalStock : 5,
          price: def.price
        };
      });
      variants.push({
        id: uid('var'),
        productId: p.id,
        size: SIZES[i],
        active: true,
        stock
      });
    }
  }

  addProduct({
    name: 'Remera Básica Algodón',
    description: 'Remera de algodón peinado, corte clásico, ideal para uso diario.',
    price: 8500,
    color: 'Blanco',
    categories: ['Remeras'],
    imgColor: '#C79A3D',
    sizeMin: 'S', sizeMax: 'XL',
    branchesSold: ['suc_centro', 'suc_norte'],
    initialStock: 12, criticalStock: 5
  });

  addProduct({
    name: 'Jean Recto Azul',
    description: 'Pantalón de jean recto, tiro medio, tela con elastano.',
    price: 21000,
    color: 'Azul',
    categories: ['Pantalones'],
    imgColor: '#3B5B84',
    sizeMin: 'S', sizeMax: 'XXL',
    branchesSold: ['suc_centro', 'suc_norte'],
    initialStock: 8, criticalStock: 4
  });

  addProduct({
    name: 'Campera Rompeviento',
    description: 'Campera liviana impermeable con capucha desmontable.',
    price: 34500,
    color: 'Negro',
    categories: ['Camperas'],
    imgColor: '#222222',
    sizeMin: 'M', sizeMax: 'XL',
    branchesSold: ['suc_centro'],
    initialStock: 3, criticalStock: 5
  });

  addProduct({
    name: 'Vestido Verano Floreado',
    description: 'Vestido liviano de tela fresca, estampa floral, ideal para verano.',
    price: 19800,
    color: 'Multicolor',
    categories: ['Vestidos', 'Accesorios'],
    imgColor: '#B85C8A',
    sizeMin: 'XS', sizeMax: 'L',
    branchesSold: ['suc_norte'],
    initialStock: 6, criticalStock: 3
  });

  addProduct({
    name: 'Zapatillas Urbanas',
    description: 'Zapatillas de lona con suela de goma, estilo urbano.',
    price: 27500,
    color: 'Gris',
    categories: ['Calzado'],
    imgColor: '#7A7A7A',
    sizeMin: 'S', sizeMax: 'M',
    branchesSold: ['suc_centro', 'suc_norte'],
    initialStock: 2, criticalStock: 4
  });

  dbSet(DB_KEYS.products, products);
  dbSet(DB_KEYS.variants, variants);
  dbSet(DB_KEYS.sales, []);

  dbSet(DB_KEYS.seeded, true);
}

/* ---------- Accesores de dominio ---------- */
const DB = {
  getUsers: () => dbGet(DB_KEYS.users, []),
  setUsers: (v) => dbSet(DB_KEYS.users, v),

  getBranches: () => dbGet(DB_KEYS.branches, []),
  getBranchName: (id) => {
    const b = DB.getBranches().find(b => b.id === id);
    return b ? b.name : '—';
  },

  getCategories: () => dbGet(DB_KEYS.categories, []),
  setCategories: (v) => dbSet(DB_KEYS.categories, v),
  addCategoryIfNew: (cat) => {
    const cats = DB.getCategories();
    if (cat && !cats.includes(cat)) {
      cats.push(cat);
      DB.setCategories(cats);
    }
  },

  getProducts: () => dbGet(DB_KEYS.products, []),
  setProducts: (v) => dbSet(DB_KEYS.products, v),

  getVariants: () => dbGet(DB_KEYS.variants, []),
  setVariants: (v) => dbSet(DB_KEYS.variants, v),

  getVariantsByProduct: (productId) => DB.getVariants().filter(v => v.productId === productId),

  getSales: () => dbGet(DB_KEYS.sales, []),
  setSales: (v) => dbSet(DB_KEYS.sales, v),

  getSession: () => dbGet(DB_KEYS.session, null),
  setSession: (v) => dbSet(DB_KEYS.session, v),
  clearSession: () => localStorage.removeItem(DB_KEYS.session)
};

seedDatabaseIfNeeded();

/* ---------- Migración: precio por sucursal y por talle ----------
   Adapta datos guardados por versiones anteriores (precio único por
   producto) al nuevo esquema: precio base por sucursal en el producto,
   y precio propio por talle+sucursal en cada variante. No se ejecuta
   si los datos ya están en el formato nuevo. */
function migrateProductPricingSchema() {
  const products = dbGet(DB_KEYS.products, []);
  const variants = dbGet(DB_KEYS.variants, []);
  let changed = false;

  products.forEach(p => {
    if (!p.basePrice) {
      const legacyPrice = typeof p.price === 'number' ? p.price : 0;
      p.basePrice = {};
      (p.branchesSold || []).forEach(bId => { p.basePrice[bId] = legacyPrice; });
      delete p.price;
      changed = true;
    }
  });

  variants.forEach(v => {
    Object.keys(v.stock || {}).forEach(bId => {
      if (v.stock[bId].price === undefined) {
        const product = products.find(p => p.id === v.productId);
        const fallback = (product && product.basePrice && product.basePrice[bId] !== undefined) ? product.basePrice[bId] : 0;
        v.stock[bId].price = fallback;
        changed = true;
      }
    });
  });

  if (changed) {
    dbSet(DB_KEYS.products, products);
    dbSet(DB_KEYS.variants, variants);
  }
}

migrateProductPricingSchema();
