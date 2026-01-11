/**
 * ShopKeeper - Main Application Logic (Firebase Edition)
 */

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { 
    getAuth, 
    createUserWithEmailAndPassword, 
    signInWithEmailAndPassword, 
    onAuthStateChanged,
    signOut 
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { 
    getFirestore, 
    collection, 
    addDoc, 
    getDocs, 
    updateDoc, 
    deleteDoc,
    doc, 
    query, 
    where,
    Timestamp 
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// --- Configuration ---
const firebaseConfig = {
    apiKey: "AIzaSyBgzOLnA52tN25-IXYJVgZgbZ1nrkKIm6w",
    authDomain: "sellapp-41e05.firebaseapp.com",
    projectId: "sellapp-41e05",
    storageBucket: "sellapp-41e05.firebasestorage.app",
    messagingSenderId: "881156283722",
    appId: "1:881156283722:web:403722b7ebac9874c8f5b3"
};

// Initialize
let app, auth, db;
try {
    app = initializeApp(firebaseConfig);
    auth = getAuth(app);
    db = getFirestore(app);
} catch (error) {
    console.error("Firebase init failed:", error);
}

// Global State (Cache)
let currentUser = null;
let productsCache = [];
let transactionsCache = [];

// --- Global Exports for HTML Access ---
window.handleLogin = handleLogin;
window.handleRegister = handleRegister;
window.handleAddProduct = handleAddProduct;
window.showScreen = showScreen;
window.openSellModal = openSellModal;
window.closeSellModal = closeSellModal;
window.confirmSell = confirmSell;
window.confirmSell = confirmSell;
window.handleLogout = handleLogout;
window.showToast = showToast;
window.deleteProduct = deleteProduct;
window.openEditModal = openEditModal;
window.closeEditModal = closeEditModal;
window.handleUpdateProduct = handleUpdateProduct;

// Initialize Listeners
document.addEventListener('DOMContentLoaded', () => {
    // Auth Listener
    if(auth) {
        onAuthStateChanged(auth, (user) => {
            if (user) {
                currentUser = user;
                console.log("Logged in:", user.email);
                loadData(); 
                showScreen('dashboard-screen');
            } else {
                currentUser = null;
                showScreen('welcome-screen');
            }
        });
    }

    // Search Listener
    document.addEventListener('input', (e) => {
        if(e.target.matches('.search-input input')) {
            renderProductList(e.target.value);
        }
    });

    // Close modal on outside click
    window.onclick = function(event) {
        const modal = document.getElementById('sell-modal');
        if (event.target == modal) {
            closeSellModal();
        }
    }
});

// --- Auth Functions ---
async function handleLogin(e) {
    e.preventDefault();
    const email = e.target.querySelector('input[type="email"]').value;
    const password = e.target.querySelector('input[type="password"]').value;
    
    showLoading();
    try {
        await signInWithEmailAndPassword(auth, email, password);
        showToast("Login Successful!", "success");
    } catch (error) {
        console.error("Login Error Code:", error.code);
        if (error.code === 'auth/invalid-credential' || error.code === 'auth/user-not-found' || error.code === 'auth/wrong-password') {
             showToast("Invalid Email or Password.", 'error');
        } else if (error.code === 'auth/too-many-requests') {
             showToast("Too many failed attempts. Please try again later.", 'error');
        } else {
             showToast("Login Failed: " + error.message, 'error');
        }
    } finally {
        hideLoading();
    }
}

async function handleRegister(e) {
    e.preventDefault();
    const email = e.target.querySelector('input[type="email"]').value;
    const password = e.target.querySelector('input[type="password"]').value;
    
    showLoading();
    try {
        await createUserWithEmailAndPassword(auth, email, password);
        showToast("Account Created! You are being logged in.", 'success');
    } catch (error) {
        console.error("Registration Error Code:", error.code);
        if (error.code === 'auth/email-already-in-use') {
            showToast("This email is already registered. Please Login instead.", 'warning');
            showScreen('login-screen'); 
        } else if (error.code === 'auth/weak-password') {
            showToast("Password is too weak. Please use at least 6 characters.", 'error');
        } else if (error.code === 'auth/operation-not-allowed') {
            showToast("Email/Password login is not enabled in Firebase Console.", 'error');
        } else {
            showToast("Registration Failed: " + error.message, 'error');
        }
    } finally {
        hideLoading();
    }
}

// --- Data Loading ---
async function loadData() {
    if(!currentUser || !db) return;

    try {
        // Load Products (Only mine)
        const qProd = query(
            collection(db, "products"), 
            where("ownerId", "==", currentUser.uid)
        );
        const prodSnap = await getDocs(qProd);
        
        productsCache = prodSnap.docs
            .map(d => ({id: d.id, ...d.data()}))
            .sort((a,b) => a.name.localeCompare(b.name));

        // Load Transactions (Only mine)
        const qTrans = query(
            collection(db, "transactions"),
            where("ownerId", "==", currentUser.uid)
        );
        const transSnap = await getDocs(qTrans);
        
        transactionsCache = transSnap.docs
            .map(d => ({id: d.id, ...d.data()}))
            .sort((a, b) => {
                // Client side sort descending
                const dateA = a.date && a.date.toDate ? a.date.toDate() : new Date(a.date || 0);
                const dateB = b.date && b.date.toDate ? b.date.toDate() : new Date(b.date || 0);
                return dateB - dateA;
            });

        updateDashboard();
        renderProductList();
        renderInventoryList();
        renderHistory();
    } catch (e) {
        console.error("Error loading data:", e);
    }
}

// --- Dashboard Logic ---
function updateDashboard() {
    const products = productsCache;
    const transactions = transactionsCache;

    const totalProducts = products.length;
    // Calculate stock value (Sell Price * Qty)
    const totalValue = products.reduce((sum, p) => sum + (p.price * p.qty), 0);
    
    // Sales This Week
    const now = new Date();
    const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    
    const relevantSales = transactions.filter(t => {
        const d = t.date && t.date.toDate ? t.date.toDate() : new Date(t.date);
        return d >= oneWeekAgo;
    });
    const salesWeek = relevantSales.reduce((sum, t) => sum + (t.price * t.qty), 0);
    
    // Profit
    const totalProfit = transactions.reduce((sum, t) => {
        const cost = t.cost || 0; 
        return sum + ((t.price - cost) * t.qty);
    }, 0);

    // Remaining Stock
    const totalStock = products.reduce((sum, p) => sum + p.qty, 0);
    
    // Remaining Value (Cost Value of Asset)
    const stockValueCost = products.reduce((sum, p) => sum + ((p.cost || 0) * p.qty), 0);

    safeSetText('dash-total-products', formatNumber(totalProducts));
    safeSetText('dash-total-value', formatMoney(totalValue)); 
    safeSetText('dash-sales-week', formatMoney(salesWeek));
    safeSetText('dash-profit', formatMoney(totalProfit)); 
    safeSetText('dash-stock-count', formatNumber(totalStock));
    safeSetText('dash-stock-value', formatMoney(stockValueCost));
}

function safeSetText(id, val) {
    const el = document.getElementById(id);
    if(el) el.innerText = val;
}

function formatMoney(num) {
    return '₦' + Number(num).toLocaleString('en-NG', { 
        minimumFractionDigits: 2, 
        maximumFractionDigits: 2 
    });
}

function formatNumber(num) {
    return Number(num || 0).toLocaleString('en-NG');
}

// --- Add Product ---
async function handleAddProduct(e) {
    e.preventDefault();
    if(!currentUser) return;

    const form = e.target;
    // Use querySelector because name attribute is reliable
    const name = form.querySelector('[name="name"]').value;
    const cost = parseFloat(form.querySelector('[name="costPrice"]').value) || 0;
    const price = 0; // Price not collected in Add Form
    const qty = parseInt(form.querySelector('[name="quantity"]').value) || 0;

    const newProduct = {
        name,
        cost,
        price,
        qty,
        ownerId: currentUser.uid,
        createdAt: Timestamp.now()
    };

    showLoading();
    try {
        const docRef = await addDoc(collection(db, "products"), newProduct);
        productsCache.push({id: docRef.id, ...newProduct});
        productsCache.sort((a,b) => a.name.localeCompare(b.name));
        
        showToast('Product Added!', 'success');
        form.reset();
        updateDashboard();
        renderInventoryList();
        showScreen('dashboard-screen');
    } catch (e) {
        showToast("Error saving: " + e.message, 'error');
    } finally {
        hideLoading();
    }
}

// --- Sell Logic ---
let currentSellProduct = null;

function renderProductList(filterText = '') {
    const container = document.getElementById('sell-product-list');
    if(!container) return;
    container.innerHTML = '';
    
    const filtered = productsCache.filter(p => 
        p.name.toLowerCase().includes(filterText.toLowerCase())
    );

    if(filtered.length === 0) {
        container.innerHTML = '<p style="text-align:center; padding:20px; color:#999;">No products found.</p>';
        return;
    }

    filtered.forEach(p => {
        const item = document.createElement('div');
        item.className = 'product-item';
        // Only show Cost or just Stock? User didn't ask to show Cost.
        // Let's just show Stock.
        item.innerHTML = `
            <div class="prod-info">
                <h4>${p.name}</h4>
                <p>Stock: ${formatNumber(p.qty)}</p>
            </div>
            <button class="btn-sm btn-accent" onclick="openSellModal('${p.id}')">
                Sell
            </button>
        `;
        container.appendChild(item);
    });
}

function openSellModal(productId) {
    const product = productsCache.find(p => p.id === productId);
    if(!product) return;

    if(product.qty < 1) {
        showToast("Out of stock!", 'warning');
        return;
    }

    currentSellProduct = product;
    
    document.getElementById('modal-product-name').innerText = `Sell ${product.name}`;
    document.getElementById('modal-stock-qty').innerText = formatNumber(product.qty);
    // If price is 0 (not set), leave empty for user to type
    document.getElementById('modal-sell-price').value = product.price > 0 ? product.price : '';
    document.getElementById('modal-sell-qty').value = 1;

    document.getElementById('sell-modal').classList.remove('hidden');
}

function renderInventoryList() {
    const container = document.getElementById('inventory-list');
    if(!container) return;
    container.innerHTML = '';
    
    if(productsCache.length === 0) {
        container.innerHTML = '<p style="text-align:center; padding:20px; color:#999;">No products yet.</p>';
        return;
    }

    productsCache.forEach(p => {
        const item = document.createElement('div');
        item.className = 'product-item';
        item.innerHTML = `
            <div class="prod-info">
                <h4>${p.name}</h4>
                <p>Stock: ${formatNumber(p.qty)} • Cost: ${formatMoney(p.cost || 0)}</p>
            </div>
            <div class="prod-actions">
                <button class="icon-btn-sm" onclick="openEditModal('${p.id}')" title="Edit">
                    <i class="fa-solid fa-pen-to-square" style="color: var(--primary-color);"></i>
                </button>
                <button class="icon-btn-sm" onclick="deleteProduct('${p.id}')" title="Delete">
                    <i class="fa-solid fa-trash" style="color: #EF4444;"></i>
                </button>
            </div>
        `;
        container.appendChild(item);
    });
}

function openEditModal(productId) {
    const product = productsCache.find(p => p.id === productId);
    if(!product) return;

    document.getElementById('edit-product-id').value = product.id;
    document.getElementById('edit-product-name').value = product.name;
    document.getElementById('edit-product-cost').value = product.cost || 0;
    document.getElementById('edit-product-qty').value = product.qty;

    document.getElementById('edit-modal').classList.remove('hidden');
}

function closeEditModal() {
    document.getElementById('edit-modal').classList.add('hidden');
}

async function handleUpdateProduct(e) {
    e.preventDefault();
    const id = document.getElementById('edit-product-id').value;
    const name = document.getElementById('edit-product-name').value;
    const cost = parseFloat(document.getElementById('edit-product-cost').value) || 0;
    const qty = parseInt(document.getElementById('edit-product-qty').value) || 0;

    showLoading();
    try {
        await updateDoc(doc(db, "products", id), {
            name, cost, qty
        });

        const idx = productsCache.findIndex(p => p.id === id);
        if(idx !== -1) {
            productsCache[idx] = { ...productsCache[idx], name, cost, qty };
        }
        
        showToast("Product updated!", "success");
        closeEditModal();
        updateDashboard();
        renderInventoryList();
        renderProductList();
    } catch (e) {
        showToast("Update failed: " + e.message, "error");
    } finally {
        hideLoading();
    }
}

async function deleteProduct(productId) {
    if(!confirm("Are you sure you want to delete this product?")) return;

    showLoading();
    try {
        await deleteDoc(doc(db, "products", productId));
        productsCache = productsCache.filter(p => p.id !== productId);
        
        showToast("Product deleted!", "success");
        updateDashboard();
        renderInventoryList();
        renderProductList();
    } catch (e) {
        showToast("Delete failed: " + e.message, "error");
    } finally {
        hideLoading();
    }
}

function closeSellModal() {
    document.getElementById('sell-modal').classList.add('hidden');
    currentSellProduct = null;
}

async function confirmSell() {
    if(!currentSellProduct || !currentUser) return;

    const qty = parseInt(document.getElementById('modal-sell-qty').value);
    const price = parseFloat(document.getElementById('modal-sell-price').value);

    if(qty > currentSellProduct.qty) {
        showToast("Not enough stock!", 'warning');
        return;
    }

    const transaction = {
        productId: currentSellProduct.id,
        productName: currentSellProduct.name,
        price: price,
        cost: currentSellProduct.cost,
        qty: qty,
        date: Timestamp.now(),
        ownerId: currentUser.uid
    };

    showLoading();
    try {
        const transRef = await addDoc(collection(db, "transactions"), transaction);
        
        const newQty = currentSellProduct.qty - qty;
        await updateDoc(doc(db, "products", currentSellProduct.id), {
            qty: newQty
        });

        transaction.id = transRef.id;
        transactionsCache.unshift(transaction);
        transactionsCache.sort((a,b) => {
             const dA = a.date && a.date.toDate ? a.date.toDate() : new Date(a.date);
             const dB = b.date && b.date.toDate ? b.date.toDate() : new Date(b.date);
             return dB - dA;
        });

        currentSellProduct.qty = newQty;
        
        updateDashboard();
        const searchVal = document.querySelector('#sell-screen .search-input input')?.value || '';
        renderProductList(searchVal);
        closeSellModal();
        showToast("Sold successfully!", 'success');
    } catch (e) {
        showToast("Transaction failed: " + e.message, 'error');
    } finally {
        hideLoading();
    }
}

// --- History Logic ---
function renderHistory() {
    const container = document.querySelector('.history-list');
    if(!container) return;
    container.innerHTML = '';

    if(transactionsCache.length === 0) {
        container.innerHTML = '<p style="text-align:center; padding:20px; color:#999;">No sales history yet.</p>';
        return;
    }

    transactionsCache.forEach(t => {
        let dateObj;
        if(t.date && t.date.toDate) {
            dateObj = t.date.toDate();
        } else {
            dateObj = new Date(t.date);
        }
        const dateStr = dateObj.toLocaleDateString() + ' ' + dateObj.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});

        const el = document.createElement('div');
        el.className = 'history-item';
        el.innerHTML = `
            <div class="hist-main">
                <h4>${t.productName}</h4>
                <span class="hist-date">${dateStr}</span>
            </div>
            <div class="hist-meta">
                 <span class="qty">x${formatNumber(t.qty)}</span>
                 <span class="price">${formatMoney(t.price * t.qty)}</span>
            </div>
        `;
        container.appendChild(el);
    });
}

// --- Navigation ---
function showScreen(screenId) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    const target = document.getElementById(screenId);
    if(target) target.classList.add('active');
    
    if (screenId === 'dashboard-screen') updateDashboard();
    if (screenId === 'add-product-screen') renderInventoryList();
    if (screenId === 'sell-screen') renderProductList();
    if (screenId === 'history-screen') renderHistory();
}

// --- Toast Notification ---
function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    if(!container) return;

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    
    let icon = 'fa-info-circle';
    if(type === 'success') icon = 'fa-check-circle';
    if(type === 'error') icon = 'fa-exclamation-circle';
    if(type === 'warning') icon = 'fa-exclamation-triangle';

    toast.innerHTML = `
        <i class="fas ${icon}"></i>
        <span>${message}</span>
    `;

    container.appendChild(toast);

    // Trigger animation
    requestAnimationFrame(() => {
        toast.classList.add('visible');
    });

    // Remove after 3 seconds
    setTimeout(() => {
        toast.style.animation = 'fadeOut 0.3s ease-out forwards';
        toast.addEventListener('animationend', () => {
            if(toast.parentElement) toast.remove();
        });
    }, 3000);
}

// --- Loader Logic ---
function showLoading() {
    const loader = document.getElementById('loader-overlay');
    if(loader) loader.style.display = 'flex';
}

function hideLoading() {
    const loader = document.getElementById('loader-overlay');
    if(loader) loader.style.display = 'none';
}

async function handleLogout() {
    showLoading();
    try {
        await signOut(auth);
    } catch (error) {
        console.error("Logout Error:", error);
    } finally {
        hideLoading();
    }
}
