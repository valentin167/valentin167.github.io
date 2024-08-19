// Guardar datos en localStorage
const saveData = (key, data) => {
    localStorage.setItem(key, JSON.stringify(data));
};

// Obtener datos de localStorage
const getData = (key) => {
    return JSON.parse(localStorage.getItem(key)) || [];
};

// Productos preestablecidos
const predefinedProducts = [
    { code: 'PROD001', description: 'Mancuernas', price: 29.99 },
    { code: 'PROD002', description: 'Barra', price: 39.99 },
    { code: 'PROD003', description: 'Discos', price: 39.99 },
    { code: 'PROD004', description: 'Soga', price: 4.99 },
    { code: 'PROD005', description: 'Colchoneta', price: 4.99 },
    { code: 'PROD006', description: 'Cama elastica', price: 59.99 },
    { code: 'PROD007', description: 'Banda elastica', price: 2.99 },
    { code: 'PROD008', description: 'Rodilleras', price: 3.99 },
    { code: 'PROD009', description: 'Straps', price: 3.99 },
    { code: 'PROD010', description: 'Musculosas', price: 9.99 }
];

// Inicialización de productos y usuarios
const initializeData = () => {
    if (!localStorage.getItem('products')) {
        saveData('products', predefinedProducts);
    }
    if (!localStorage.getItem('users')) {
        const users = [
            { username: 'admin', password: 'admin123', isAdmin: true }
        ];
        saveData('users', users);
    }
    if (!localStorage.getItem('orders')) {
        saveData('orders', []);
    }
    if (!localStorage.getItem('cart')) {
        saveData('cart', []);
    }
};

// Mostrar/ocultar los enlaces de iniciar sesión y registro según el estado de sesión
const updateNav = () => {
    const loginLink = document.getElementById('login-link');
    const signupLink = document.getElementById('signup-link');
    const logoutButton = document.getElementById('logout');
    const currentUser = JSON.parse(localStorage.getItem('currentUser'));
    
    if (loginLink && signupLink) {
        if (currentUser) {
            loginLink.style.display = 'none';
            signupLink.style.display = 'none';
        } else {
            loginLink.style.display = 'inline';
            signupLink.style.display = 'inline';
        }
    }
    
    if (logoutButton) {
        logoutButton.style.display = currentUser ? 'block' : 'none';
    }
};


// Cerrar sesión
const handleLogout = () => {
    localStorage.removeItem('currentUser');
    alert('Has cerrado sesión exitosamente.');
    window.location.href = 'index.html';
};
// Actualizar el estado del botón de agregar al carrito
const updateAddToCartButtons = () => {
    const buttons = document.querySelectorAll('button[data-action="add-to-cart"]');
    const currentUser = JSON.parse(localStorage.getItem('currentUser'));
    
    buttons.forEach(button => {
        button.disabled = !currentUser; // Deshabilitar si no hay usuario actual
    });
};

// Cargar productos en la pantalla principal (index.html)
const loadProductsForUser = () => {
    const products = getData('products');
    const productList = document.getElementById('product-list');

    if (productList) {
        productList.innerHTML = products.map(product => `
	   <div class="product">
                <div class="product-content">
                    <div class="product-txt">
                        <h2 class="card-title">${product.description}</h2>
                        <p class="card-text">$${product.price}</p>
                        <input type="number" id="quantity-${product.code}" min="1" value="1" class="form-control mb-2">
                    </div>
                    <div class="btn-1"> 
                    <a data-action="add-to-cart" class="btn-1" onclick="addToCart('${product.code}')">Agregar al Carrito</a>
                    </div>
                </div>
            </div>
        `).join('');
        updateAddToCartButtons(); // Actualizar el estado de los botones
    }
};

// Cargar productos en la pantalla de administración (admin.html)
const loadProductsForAdmin = () => {
    const products = getData('products');
    const productList = document.getElementById('product-list');

    if (productList) {
        productList.innerHTML = products.map(product => `
                    <tr>
                        <td>${product.code}</td>
                        <td>${product.description}</td>
                        <td>$${product.price}</td>
                        <td><button class="btn btn-danger" onclick="removeProduct('${product.code}')">Eliminar</button></td>
                    </tr>
        `).join('');
    }
};

// Manejo de agregar productos al carrito
const addToCart = (code) => {
    const quantityInput = document.getElementById(`quantity-${code}`);
    const quantity = parseInt(quantityInput.value);
    const products = getData('products');
    const cart = getData('cart');
    const product = products.find(p => p.code === code);
    
    if (product) {
        const existingItemIndex = cart.findIndex(item => item.code === code);
        
        if (existingItemIndex > -1) {
            // Actualizar la cantidad si el producto ya está en el carrito
            cart[existingItemIndex].quantity += quantity;
        } else {
            // Agregar un nuevo producto al carrito
            cart.push({ ...product, quantity });
        }

        saveData('cart', cart);
        alert('Producto agregado al carrito.');
    } else {
        alert('Producto no encontrado.');
    }
};

// Manejo de formulario de registro
const handleSignup = (event) => {
    event.preventDefault();
    const username = document.getElementById('new-username').value;
    const password = document.getElementById('new-password').value;
    const users = getData('users');
    
    if (users.find(user => user.username === username)) {
        alert('Usuario ya registrado.');
        return;
    }
    
    users.push({ username, password, isAdmin: false });
    saveData('users', users);
    alert('Registro exitoso.');
    window.location.href = 'login.html';
};

// Manejo de formulario de inicio de sesión
const handleLogin = (event) => {
    event.preventDefault();
    const username = document.getElementById('username').value;
    const password = document.getElementById('password').value;
    const users = getData('users');
    
    const user = users.find(user => user.username === username && user.password === password);
    if (user) {
        localStorage.setItem('currentUser', JSON.stringify(user));
        alert('Inicio de sesión exitoso.');
        window.location.href = 'index.html';
    } else {
        alert('Credenciales incorrectas.');
    }
};

// Manejo de formulario de carga de productos
const handleProductForm = (event) => {
    event.preventDefault();
    const code = document.getElementById('product-code').value;
    const description = document.getElementById('product-description').value;
    const price = parseFloat(document.getElementById('product-price').value);
    const products = getData('products');

    const codeExists = products.some(product => product.code === code);
    if (codeExists) {
        // Muestra un mensaje de error si el código ya existe
        alert('El código del producto ya existe. Por favor, utiliza un código diferente.');
    } else{
        products.push({ code, description, price });
        saveData('products', products);
        loadProductsForAdmin();
    }


};

// Eliminar un producto
const removeProduct = (code) => {
    const products = getData('products');
    const updatedProducts = products.filter(product => product.code !== code);
    saveData('products', updatedProducts);
    loadProductsForAdmin();
};

// Manejo de carrito de compras
const handleCart = () => {
    const cart = getData('cart');
    const cartItems = document.getElementById('cart-items');
    const totalPriceElem = document.getElementById('total-price');

    if (cartItems) {
        cartItems.innerHTML = cart.map(item => `
            <li>
                ${item.description} - $${item.price}
                <input type="number" id="quantity-${item.code}" value="${item.quantity}" min="1" style="width: 60px;" onchange="updateQuantity('${item.code}')">
                <button class="btn btn-danger" onclick="removeFromCart('${item.code}')">Eliminar</button>
            </li>
        `).join('');

        // Calcular el total de precio
        const totalPrice = cart.reduce((total, item) => total + (item.price * item.quantity), 0);
        totalPriceElem.textContent = totalPrice.toFixed(2);
    }
};

// Actualizar la cantidad de un producto en el carrito
const updateQuantity = (code) => {
    const quantityInput = document.getElementById(`quantity-${code}`);
    const newQuantity = parseInt(quantityInput.value);
    const cart = getData('cart');
    const itemIndex = cart.findIndex(item => item.code === code);
    
    if (itemIndex > -1) {
        if (newQuantity <= 0) {
            cart.splice(itemIndex, 1); // Eliminar el producto si la cantidad es 0 o menor
        } else {
            cart[itemIndex].quantity = newQuantity;
        }
        saveData('cart', cart);
        handleCart(); // Actualizar la vista del carrito
    }
};

// Eliminar un producto del carrito
const removeFromCart = (code) => {
    const cart = getData('cart');
    const updatedCart = cart.filter(item => item.code !== code);
    saveData('cart', updatedCart);
    handleCart(); // Actualizar la vista del carrito
};

// Manejo de compra
const handleCheckout = () => {
    const cart = getData('cart');
    const orders = getData('orders');
    const currentUser = JSON.parse(localStorage.getItem('currentUser'));
    const address = document.getElementById('address').value.trim();
    if (!address) {
        alert('Por favor, ingresa una dirección para finalizar la compra.');
        return;
    }
    if (!currentUser) {
        alert('Debe iniciar sesión para realizar una compra.');
        return;
    }

    if (cart.length === 0) {
        alert('El carrito está vacío.');
        return;
    }
    
    const totalPrice = document.getElementById('total-price').textContent;
    orders.push({
        user: currentUser.username,
        items: cart,
        totalPrice: totalPrice,
        status: 'Pendiente',
        address: address,
        date: new Date().toLocaleDateString(),
        id: new Date().toISOString()
    }); 
    
    saveData('orders', orders);
    localStorage.removeItem('cart');
    alert('Compra registrada como pendiente.');
    window.location.href = 'cart.html';
};
// Cargar pedidos pendientes en la pantalla de administración (admin.html)
const loadPendingOrders = () => {
    const orders = getData('orders');
    const pendingOrdersList = document.getElementById('pending-orders-list');

    if (pendingOrdersList) {
        pendingOrdersList.innerHTML = orders
            .filter(order => order.status === 'Pendiente')
            .map(order => `
                <tr>
                    <td>${order.user} </td>
                    <td>${order.items.map(item => `${item.description} (x${item.quantity})`).join(', ')}</td>
                    <td>$${order.totalPrice}</td>
                    <td>${order.address}</td>
                    <td>${order.date}</td>
                    <td>
                    <button class="btn btn-success" onclick="deliverOrder('${order.id}')">Realizar entrega</button>
                    <button class="btn btn-danger" onclick="cancelOrder('${order.id}')">Anular</button>
                    </td>
                </tr>
            `).join('');
    }
    const sentOrdersList = document.getElementById('sent-orders-list');
    const invoices = getData('invoices');
    if (sentOrdersList) {
        sentOrdersList.innerHTML = invoices
            .map(order => `
                <tr>
                    <td>${order.user} </td>
                    <td>$${order.amount}</td>
                    <td>${order.date}</td>
                </tr>
            `).join('');
    }
};

// Realizar entrega de un pedido
const deliverOrder = (id) => {
    const orders = getData('orders');
    const updatedOrders = orders.map(order => {
        if (order.id === id) {
            order.status = 'Entregado';
            // Agregar el precio del pedido a la factura
            const totalAmount = order.items.reduce((total, item) => total + (item.price * item.quantity), 0);
            const invoices = getData('invoices');
            invoices.push({ user: order.user, amount: totalAmount, date: new Date().toLocaleDateString(), id: new Date().toISOString() });
            saveData('invoices', invoices);
        }
        return order;
    });
    saveData('orders', updatedOrders);
    loadPendingOrders(); // Actualizar la lista de pedidos pendientes
};

// Anular un pedido
const cancelOrder = (id) => {
    const orders = getData('orders');
    const updatedOrders = orders.filter(order => order.id !== id);
    saveData('orders', updatedOrders);
    loadPendingOrders(); // Actualizar la lista de pedidos pendientes
};

const checkAdminAccess = () => {
    const currentUser = JSON.parse(localStorage.getItem('currentUser'));
    if (!currentUser || !currentUser.isAdmin) {
        alert("Acceso denegado");
        window.location.href = 'index.html'; // Redirige a la página principal si no es admin
    }
};

// Inicialización
document.addEventListener('DOMContentLoaded', () => {
    initializeData();
    updateNav();
    const currentPage = window.location.pathname.split('/').pop();
    
    if (currentPage === 'index.html') {
        loadProductsForUser();
    } else if (currentPage === 'admin.html') {
        checkAdminAccess(); 
        loadProductsForAdmin();
        loadPendingOrders();
    } else if (currentPage === 'login.html') {
        const passwordInput = document.getElementById('password');
        const togglePassword = document.getElementById('toggle-password');

        togglePassword.addEventListener('click', () => {
            // Toggle the type attribute using getAttribute and setAttribute methods
            const type = passwordInput.getAttribute('type') === 'password' ? 'text' : 'password';
            passwordInput.setAttribute('type', type);
    });
    } else if (document.getElementById('cart-items')) {
        handleCart();
    }
    
    if (document.getElementById('signup-form')) {
        document.getElementById('signup-form').addEventListener('submit', handleSignup);
        
        // Manejo de mostrar contraseña en el formulario de registro
        const signupPasswordInput = document.getElementById('new-password');
        const toggleSignupPassword = document.getElementById('toggle-signup-password');

        toggleSignupPassword.addEventListener('click', () => {
            const type = signupPasswordInput.getAttribute('type') === 'password' ? 'text' : 'password';
            signupPasswordInput.setAttribute('type', type);
        });
    }
    if (document.getElementById('login-form')) {
        document.getElementById('login-form').addEventListener('submit', handleLogin);
    }

    if (document.getElementById('product-form')) {
        document.getElementById('product-form').addEventListener('submit', handleProductForm);
    }

    if (document.getElementById('checkout')) {
        document.getElementById('checkout').addEventListener('click', handleCheckout);
    }

    const logoutButton = document.getElementById('logout');
    if (logoutButton) {
        logoutButton.addEventListener('click', handleLogout);
    }
});