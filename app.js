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
    getDoc,
    setDoc,
    query, 
    where,
    Timestamp,
    enableIndexedDbPersistence 
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
    
    // Enable Offline Persistence
    enableIndexedDbPersistence(db).catch((err) => {
        if (err.code == 'failed-precondition') {
            console.warn("Persistence failed: Multiple tabs open");
        } else if (err.code == 'unimplemented') {
            console.warn("Persistence failed: Browser not supported");
        }
    });
} catch (error) {
    console.error("Firebase init failed:", error);
}

// Global State (Cache)
let currentUser = null;
let currentUserProfile = null;
let productsCache = [];
let transactionsCache = [];
let creditsCache = []; // Customer credit records
let currentCreditCustomer = null; // For detail view

// --- Utilities ---
function sanitizeInput(str) {
    if (typeof str !== 'string') return str;
    // Remove HTML tags completely to prevent any tag injection
    return str.replace(/<[^>]*>?/gm, '').trim();
}

function isInputSafe(str) {
    if (typeof str !== 'string') return true;
    // Check for common malicious patterns: <script>, javascript:, onmouseover, etc.
    const dangerousPatterns = [/<script/i, /javascript:/i, /on\w+=/i, /<iframe/i];
    return !dangerousPatterns.some(pattern => pattern.test(str));
}

function escapeHTML(str) {
    if (typeof str !== 'string') return str;
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

function formatWithCommas(value) {
    if (!value && value !== 0) return '';
    const parts = value.toString().split('.');
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return parts.join('.');
}

function parseFromCommas(value) {
    if (typeof value !== 'string') return value;
    return value.replace(/,/g, '');
}

// --- Global Exports for HTML Access ---
window.handleLogin = handleLogin;
window.handleRegister = handleRegister;
window.handleAddProduct = handleAddProduct;
window.showScreen = showScreen;
window.openSellModal = openSellModal;
window.closeSellModal = closeSellModal;
window.confirmSell = confirmSell;
window.handleLogout = handleLogout;
window.showToast = showToast;
window.deleteProduct = deleteProduct;
window.openEditModal = openEditModal;
window.closeEditModal = closeEditModal;
window.handleUpdateProduct = handleUpdateProduct;
window.openEditSaleModal = openEditSaleModal;
window.closeEditSaleModal = closeEditSaleModal;
window.handleUpdateSale = handleUpdateSale;
// Credit Book exports
window.openAddCreditModal = openAddCreditModal;
window.closeAddCreditModal = closeAddCreditModal;
window.handleAddCustomer = handleAddCustomer;
window.viewCreditDetail = viewCreditDetail;
window.openAddTransactionModal = openAddTransactionModal;
window.closeAddTransactionModal = closeAddTransactionModal;
window.handleAddCreditTransaction = handleAddCreditTransaction;
window.openPaymentModal = openPaymentModal;
window.closePaymentModal = closePaymentModal;
window.handleRecordPayment = handleRecordPayment;
window.openFilterModal = openFilterModal;
window.closeFilterModal = closeFilterModal;
window.setFilterRange = setFilterRange;
window.calculateFilterStats = calculateFilterStats;
window.deleteCustomer = deleteCustomer;

// Initialize Listeners
document.addEventListener('DOMContentLoaded', () => {
    // Auth Listener
    let loadTimeout = setTimeout(() => {
        showRetry("Loading is taking longer than usual. Please check your connection.");
    }, 15000); // 15 seconds timeout

    if(auth) {
        onAuthStateChanged(auth, async (user) => {
            try {
                if (user) {
                    currentUser = user;
                    console.log("Logged in:", user.email);
                    const success = await loadData(); 
                    if(success) {
                        clearTimeout(loadTimeout);
                        showScreen('dashboard-screen');
                        hideLoading();
                    } else {
                        showRetry("Failed to sync data. Check your network.");
                    }
                } else {
                    currentUser = null;
                    clearTimeout(loadTimeout);
                    showScreen('welcome-screen');
                    hideLoading();
                }
            } catch (error) {
                console.error("Auth listener error:", error);
                showRetry("Authentication failed. Please retry.");
            }
        });
    } else {
        showRetry("Firebase initialization failed.");
    }

    // Search Listener
    document.addEventListener('input', (e) => {
        if(e.target.matches('#sell-screen .search-input input')) {
            renderProductList(e.target.value);
        }
        if(e.target.matches('#credit-search')) {
            renderCreditList(e.target.value);
        }
    });

    // Close modal on outside click
    window.onclick = function(event) {
        const modal = document.getElementById('sell-modal');
        if (event.target == modal) {
            closeSellModal();
        }
    }

    // Money Input Formatter
    document.addEventListener('input', (e) => {
        if (e.target.classList.contains('money-input')) {
            const cursorPosition = e.target.selectionStart;
            const originalLength = e.target.value.length;
            
            // Allow only digits, one decimal point, and commas
            let value = e.target.value.replace(/[^0-9.]/g, '');
            
            // Ensure only one dot
            const parts = value.split('.');
            if (parts.length > 2) value = parts[0] + '.' + parts.slice(1).join('');
            
            const formatted = formatWithCommas(value);
            e.target.value = formatted;
            
            // Restore cursor position
            const newLength = formatted.length;
            const diff = newLength - originalLength;
            e.target.setSelectionRange(cursorPosition + diff, cursorPosition + diff);
        }
    });

    // Network Status Listeners
    window.addEventListener('offline', () => {
        const loader = document.getElementById('loader-overlay');
        if(loader && loader.style.display === 'flex') {
            showRetry("You are offline. Please check your internet.");
        }
    });

    window.addEventListener('online', () => {
        const loader = document.getElementById('loader-overlay');
        const retry = document.getElementById('retry-container');
        // If we were showing a retry error but are now back online, maybe just tip them to try again
        if(loader && loader.style.display === 'flex' && retry && !retry.classList.contains('hidden')) {
             showToast("Connection restored. Retrying...", "info");
             window.location.reload();
        }
    });
});

// --- Auth Functions ---
async function handleLogin(e) {
    e.preventDefault();
    const emailRaw = e.target.querySelector('input[type="email"]').value;
    const password = e.target.querySelector('input[type="password"]').value;

    if (!isInputSafe(emailRaw)) {
        showToast("Invalid characters in email.", "warning");
        return;
    }

    const email = sanitizeInput(emailRaw);
    if (!email) {
        showToast("Please enter a valid email.", "warning");
        return;
    }
    
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
    const form = e.target;
    const fullNameRaw = form.querySelector('input[placeholder="Full Name"]').value;
    const shopNameRaw = form.querySelector('input[placeholder="Shop Name"]').value;
    const phoneRaw = form.querySelector('input[placeholder="Phone Number"]').value;
    const emailRaw = form.querySelector('input[type="email"]').value;
    const password = form.querySelector('input[type="password"]').value;

    // Security Check
    if (!isInputSafe(fullNameRaw) || !isInputSafe(shopNameRaw) || 
        !isInputSafe(phoneRaw) || !isInputSafe(emailRaw)) {
        showToast("Security Alert: Malicious characters detected!", "error");
        return;
    }

    const fullName = sanitizeInput(fullNameRaw);
    const shopName = sanitizeInput(shopNameRaw);
    const phone = sanitizeInput(phoneRaw);
    const email = sanitizeInput(emailRaw);

    if (!fullName || !shopName || !email) {
        showToast("Please fill in all fields correctly.", "warning");
        return;
    }
    
    showLoading();
    try {
        const userCredential = await createUserWithEmailAndPassword(auth, email, password);
        const user = userCredential.user;
        
        // Save profile to Firestore
        await setDoc(doc(db, "users", user.uid), {
            fullName,
            shopName,
            phone,
            email,
            createdAt: Timestamp.now()
        });

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
    if(!currentUser || !db) return false;

    try {
        // Load User Profile
        const userDoc = await getDoc(doc(db, "users", currentUser.uid));
        if (userDoc.exists()) {
            currentUserProfile = userDoc.data();
            safeSetText('display-shop-name', currentUserProfile.shopName || "My Shop");
        } else {
            safeSetText('display-shop-name', "My Shop");
        }

        // Load Products
        const qProd = query(
            collection(db, "products"), 
            where("ownerId", "==", currentUser.uid)
        );
        
        // Use getDocs which will now hit the local cache first if persistence is enabled
        const prodSnap = await getDocs(qProd);
        
        productsCache = prodSnap.docs
            .map(d => ({id: d.id, ...d.data()}))
            .sort((a,b) => a.name.localeCompare(b.name));

        // Load Transactions
        const qTrans = query(
            collection(db, "transactions"),
            where("ownerId", "==", currentUser.uid)
        );
        const transSnap = await getDocs(qTrans);
        
        transactionsCache = transSnap.docs
            .map(d => ({id: d.id, ...d.data()}))
            .sort((a, b) => {
                const dateA = a.date && a.date.toDate ? a.date.toDate() : new Date(a.date || 0);
                const dateB = b.date && b.date.toDate ? b.date.toDate() : new Date(b.date || 0);
                return dateB - dateA;
            });

        // Load Credits
        const qCredits = query(
            collection(db, "credits"),
            where("ownerId", "==", currentUser.uid)
        );
        const creditsSnap = await getDocs(qCredits);
        
        creditsCache = creditsSnap.docs
            .map(d => ({id: d.id, ...d.data()}))
            .sort((a, b) => a.customerName.localeCompare(b.customerName));

        updateDashboard();
        renderProductList();
        renderInventoryList();
        renderHistory();
        renderCreditList();
        updateCreditSummary();
        return true;
    } catch (e) {
        console.error("Error loading data:", e);
        // If we have cached data, we still return true to let the user in
        if (productsCache.length > 0) return true;
        return false;
    }
}

// --- Dashboard Logic ---
function updateDashboard() {
    const products = productsCache;
    const transactions = transactionsCache;

    const totalProducts = products.length;
    // Calculate stock value (Sell Price * Qty)
    const totalValue = Math.round(products.reduce((sum, p) => sum + (p.price * p.qty), 0) * 100) / 100;
    
    // Sales This Week
    const now = new Date();
    const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    
    const relevantSales = transactions.filter(t => {
        const d = t.date && t.date.toDate ? t.date.toDate() : new Date(t.date);
        return d >= oneWeekAgo;
    });
    const salesWeek = Math.round(relevantSales.reduce((sum, t) => sum + (t.price * t.qty), 0) * 100) / 100;
    
    // Profit
    const totalProfit = Math.round(transactions.reduce((sum, t) => {
        const cost = t.cost || 0; 
        return sum + ((t.price - cost) * t.qty);
    }, 0) * 100) / 100;

    // Remaining Stock
    const totalStock = products.reduce((sum, p) => sum + p.qty, 0);
    
    // Remaining Value (Cost Value of Asset)
    const stockValueCost = Math.round(products.reduce((sum, p) => sum + ((p.cost || 0) * p.qty), 0) * 100) / 100;

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
    const nameRaw = form.querySelector('[name="name"]').value;
    
    if (!isInputSafe(nameRaw)) {
        showToast("Invalid product name.", "warning");
        return;
    }

    const name = sanitizeInput(nameRaw);
    const cost = parseFloat(parseFromCommas(form.querySelector('[name="costPrice"]').value)) || 0;
    const price = 0; // Price not collected in Add Form
    const qty = parseInt(form.querySelector('[name="quantity"]').value) || 0;

    if (!name) {
        showToast("Product name cannot be empty.", "warning");
        return;
    }

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
                <h4>${escapeHTML(p.name)}</h4>
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
    document.getElementById('modal-sell-price').value = product.price > 0 ? formatWithCommas(product.price) : '';
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
                <h4>${escapeHTML(p.name)}</h4>
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
    document.getElementById('edit-product-cost').value = formatWithCommas(product.cost || 0);
    document.getElementById('edit-product-qty').value = product.qty;

    document.getElementById('edit-modal').classList.remove('hidden');
}

function closeEditModal() {
    document.getElementById('edit-modal').classList.add('hidden');
}

async function handleUpdateProduct(e) {
    e.preventDefault();
    const id = document.getElementById('edit-product-id').value;
    const name = sanitizeInput(document.getElementById('edit-product-name').value);
    const cost = parseFloat(parseFromCommas(document.getElementById('edit-product-cost').value)) || 0;
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
    const price = parseFloat(parseFromCommas(document.getElementById('modal-sell-price').value));

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
                <h4>${escapeHTML(t.productName)}</h4>
                <span class="hist-date">${dateStr}</span>
            </div>
            <div class="hist-meta" style="display: flex; align-items: center; gap: 15px;">
                 <div style="text-align: right;">
                    <span class="qty">x${formatNumber(t.qty)}</span>
                    <span class="price">${formatMoney(t.price * t.qty)}</span>
                 </div>
                 <button class="icon-btn-sm" onclick="openEditSaleModal('${t.id}')" title="Edit Sale">
                    <i class="fa-solid fa-pen-to-square" style="color: var(--primary);"></i>
                 </button>
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
    if (screenId === 'credit-screen') {
        renderCreditList();
        updateCreditSummary();
    }
    if (screenId === 'credit-detail-screen') renderCreditTransactions();
}

// --- Filter Logic ---
function openFilterModal() {
    const modal = document.getElementById('filter-modal');
    if(modal) {
        modal.classList.remove('hidden');
        // Set default to this week if inputs empty
        if(!document.getElementById('filter-start-date').value) {
            setFilterRange('week');
        }
    }
}

function closeFilterModal() {
    const modal = document.getElementById('filter-modal');
    if(modal) modal.classList.add('hidden');
}

function setFilterRange(type) {
    const now = new Date();
    const startInput = document.getElementById('filter-start-date');
    const endInput = document.getElementById('filter-end-date');
    
    // Format YYYY-MM-DD
    const formatDate = (date) => date.toISOString().split('T')[0];
    
    if(type === 'week') {
        const lastWeek = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        startInput.value = formatDate(lastWeek);
        endInput.value = formatDate(now);
    } else if (type === 'month') {
        const lastMonth = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        startInput.value = formatDate(lastMonth);
        endInput.value = formatDate(now);
    }
    
    // Auto calculate on quick select
    calculateFilterStats();
}

function calculateFilterStats() {
    const startVal = document.getElementById('filter-start-date').value;
    const endVal = document.getElementById('filter-end-date').value;
    
    if(!startVal || !endVal) {
        // If user manually cleared one, do nothing or show 0
        safeSetText('filter-result-sales', '₦0.00');
        safeSetText('filter-result-profit', '₦0.00');
        return;
    }

    const startDate = new Date(startVal);
    startDate.setHours(0,0,0,0);
    
    const endDate = new Date(endVal);
    endDate.setHours(23,59,59,999);

    let totalSales = 0;
    let totalProfit = 0;

    transactionsCache.forEach(t => {
        const tDate = t.date && t.date.toDate ? t.date.toDate() : new Date(t.date);
        
        if(tDate >= startDate && tDate <= endDate) {
            const saleAmount = t.price * t.qty;
            const costAmount = (t.cost || 0) * t.qty;
            const profit = saleAmount - costAmount;
            
            totalSales += saleAmount;
            totalProfit += profit;
        }
    });

    safeSetText('filter-result-sales', formatMoney(totalSales));
    safeSetText('filter-result-profit', formatMoney(totalProfit));
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
    const status = document.getElementById('loader-status');
    const retry = document.getElementById('retry-container');
    const spinner = loader?.querySelector('.spinner');

    if(status) status.innerText = 'Loading AnemaSales...';
    if(retry) retry.classList.add('hidden');
    if(spinner) spinner.style.display = 'block';
    if(loader) loader.style.display = 'flex';
}

function hideLoading() {
    const loader = document.getElementById('loader-overlay');
    if(loader) loader.style.display = 'none';
}

function showRetry(message) {
    const status = document.getElementById('loader-status');
    const retry = document.getElementById('retry-container');
    const loader = document.getElementById('loader-overlay');
    
    if(status) status.innerText = message;
    if(retry) retry.classList.remove('hidden');
    if(loader) loader.style.display = 'flex';
    
    // Hide spinner on error
    const spinner = loader?.querySelector('.spinner');
    if(spinner) spinner.style.display = 'none';
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

// --- Edit Sale Logic ---
function openEditSaleModal(transactionId) {
    const transaction = transactionsCache.find(t => t.id === transactionId);
    if (!transaction) return;

    document.getElementById('edit-sale-id').value = transaction.id;
    document.getElementById('edit-sale-product-name').innerText = transaction.productName;
    document.getElementById('edit-sale-price').value = formatWithCommas(transaction.price);
    document.getElementById('edit-sale-qty').value = transaction.qty;

    document.getElementById('edit-sale-modal').classList.remove('hidden');
}

function closeEditSaleModal() {
    document.getElementById('edit-sale-modal').classList.add('hidden');
}

async function handleUpdateSale(e) {
    e.preventDefault();
    const id = document.getElementById('edit-sale-id').value;
    const newPrice = parseFloat(parseFromCommas(document.getElementById('edit-sale-price').value));
    const newQty = parseInt(document.getElementById('edit-sale-qty').value);

    if (isNaN(newPrice) || isNaN(newQty) || newQty < 1) {
        showToast("Please enter valid price and quantity.", "warning");
        return;
    }

    const transaction = transactionsCache.find(t => t.id === id);
    if (!transaction) return;

    const qtyDiff = newQty - transaction.qty;
    const product = productsCache.find(p => p.id === transaction.productId);

    // Stock check for updates
    if (product && qtyDiff > product.qty) {
        showToast(`Not enough stock! available: ${formatNumber(product.qty + transaction.qty)}`, "warning");
        return;
    }

    showLoading();
    try {
        // 1. Update Transaction
        await updateDoc(doc(db, "transactions", id), {
            price: newPrice,
            qty: newQty
        });

        // 2. Adjust Product Stock
        if (product) {
            const updatedStock = product.qty - qtyDiff;
            await updateDoc(doc(db, "products", product.id), {
                qty: updatedStock
            });
            // Update local product cache
            product.qty = updatedStock;
        }

        // 3. Update local transaction cache
        transaction.price = newPrice;
        transaction.qty = newQty;

        showToast("Sale updated & stock adjusted!", "success");
        closeEditSaleModal();
        updateDashboard();
        renderHistory();
        renderProductList();
        renderInventoryList();
    } catch (e) {
        console.error("Update sale error:", e);
        showToast("Update failed: " + e.message, "error");
    } finally {
        hideLoading();
    }
}
// This file contains all credit book functions
// To be appended to app.js

// ========== CREDIT BOOK FUNCTIONS ==========

// --- Render Credit List ---
function renderCreditList(filterText = '') {
    const container = document.getElementById('credit-list');
    if(!container) return;
    container.innerHTML = '';
    
    const filtered = creditsCache.filter(c => 
        c.customerName.toLowerCase().includes(filterText.toLowerCase()) ||
        c.phone.toLowerCase().includes(filterText.toLowerCase())
    );

    if(filtered.length === 0) {
        container.innerHTML = '<p style="text-align:center; padding:20px; color:#999;">No customers yet.</p>';
        return;
    }

    filtered.forEach(c => {
        const item = document.createElement('div');
        item.className = 'credit-item';
        item.onclick = () => viewCreditDetail(c.id);
        
        item.innerHTML = `
            <div class="credit-item-info">
                <h4>${escapeHTML(c.customerName)}</h4>
                <p class="phone">${escapeHTML(c.phone)}</p>
            </div>
            <div class="credit-item-balance">
                <span class="amount">${formatMoney(c.balance || 0)}</span>
                <span class="label">Outstanding</span>
            </div>
        `;
        container.appendChild(item);
    });
}

// --- Update Credit Summary ---
function updateCreditSummary() {
    const totalCredit = creditsCache.reduce((sum, c) => sum + (c.balance || 0), 0);
    const totalCustomers = creditsCache.length;
    
    safeSetText('total-credit-amount', formatMoney(totalCredit));
    safeSetText('total-credit-customers', totalCustomers);
}

// --- Add Customer Modal ---
function openAddCreditModal() {
    document.getElementById('add-credit-modal').classList.remove('hidden');
    document.getElementById('add-credit-form').reset();
}

function closeAddCreditModal() {
    document.getElementById('add-credit-modal').classList.add('hidden');
}

async function handleAddCustomer(e) {
    e.preventDefault();
    if(!currentUser) return;

    const nameRaw = document.getElementById('new-customer-name').value;
    const phoneRaw = document.getElementById('new-customer-phone').value;
    const amountRaw = document.getElementById('new-customer-amount').value;
    const descriptionRaw = document.getElementById('new-customer-description').value;

    if (!isInputSafe(nameRaw) || !isInputSafe(phoneRaw) || !isInputSafe(descriptionRaw)) {
        showToast("Invalid input detected.", "warning");
        return;
    }

    const customerName = sanitizeInput(nameRaw);
    const phone = sanitizeInput(phoneRaw);
    const amount = parseFloat(parseFromCommas(amountRaw)) || 0;
    const description = sanitizeInput(descriptionRaw);

    if (!customerName || !phone) {
        showToast("Please fill in customer name and phone.", "warning");
        return;
    }

    const newCredit = {
        customerName,
        phone,
        balance: amount,
        ownerId: currentUser.uid,
        createdAt: Timestamp.now()
    };

    showLoading();
    try {
        const docRef = await addDoc(collection(db, "credits"), newCredit);
        newCredit.id = docRef.id;
        creditsCache.push(newCredit);
        creditsCache.sort((a, b) => a.customerName.localeCompare(b.customerName));

        // If there's an initial amount, create a transaction
        if (amount > 0) {
            const transaction = {
                creditId: docRef.id,
                type: 'credit', // credit or payment
                amount: amount,
                description: description || 'Initial credit',
                date: Timestamp.now(),
                ownerId: currentUser.uid
            };
            await addDoc(collection(db, "creditTransactions"), transaction);
        }

        showToast('Customer added!', 'success');
        closeAddCreditModal();
        renderCreditList();
        updateCreditSummary();
    } catch (e) {
        showToast("Error adding customer: " + e.message, 'error');
    } finally {
        hideLoading();
    }
}

// --- View Credit Detail ---
function viewCreditDetail(creditId) {
    const credit = creditsCache.find(c => c.id === creditId);
    if (!credit) return;

    currentCreditCustomer = credit;
    
    document.getElementById('credit-detail-customer-name').innerText = credit.customerName;
    document.getElementById('credit-detail-phone').innerText = credit.phone;
    document.getElementById('credit-detail-balance').innerText = formatMoney(credit.balance || 0);
    
    showScreen('credit-detail-screen');
}

// --- Render Credit Transactions ---
async function renderCreditTransactions() {
    if (!currentCreditCustomer) return;

    const container = document.getElementById('credit-transactions-list');
    if (!container) return;
    container.innerHTML = '<p style="text-align:center; padding:20px; color:#999;">Loading...</p>';

    try {
        const q = query(
            collection(db, "creditTransactions"),
            where("creditId", "==", currentCreditCustomer.id),
            where("ownerId", "==", currentUser.uid)
        );
        const snapshot = await getDocs(q);
        
        const transactions = snapshot.docs
            .map(d => ({id: d.id, ...d.data()}))
            .sort((a, b) => {
                const dateA = a.date && a.date.toDate ? a.date.toDate() : new Date(a.date || 0);
                const dateB = b.date && b.date.toDate ? b.date.toDate() : new Date(b.date || 0);
                return dateB - dateA;
            });

        container.innerHTML = '';

        if (transactions.length === 0) {
            container.innerHTML = '<p style="text-align:center; padding:20px; color:#999;">No transactions yet.</p>';
            return;
        }

        transactions.forEach(t => {
            let dateObj;
            if(t.date && t.date.toDate) {
                dateObj = t.date.toDate();
            } else {
                dateObj = new Date(t.date);
            }
            const dateStr = dateObj.toLocaleDateString() + ' ' + dateObj.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});

            const el = document.createElement('div');
            el.className = 'credit-transaction-item';
            
            const typeClass = t.type === 'payment' ? 'payment' : 'credit';
            const sign = t.type === 'payment' ? '-' : '+';
            
            el.innerHTML = `
                <div class="transaction-header">
                    <span class="transaction-type ${typeClass}">${t.type}</span>
                    <span class="transaction-amount ${typeClass}">${sign}${formatMoney(t.amount)}</span>
                </div>
                <p class="transaction-description">${escapeHTML(t.description || 'No description')}</p>
                <p class="transaction-date">${dateStr}</p>
            `;
            container.appendChild(el);
        });
    } catch (e) {
        console.error("Error loading transactions:", e);
        container.innerHTML = '<p style="text-align:center; padding:20px; color:#999;">Error loading transactions.</p>';
    }
}

// --- Add Credit Transaction Modal ---
function openAddTransactionModal() {
    if (!currentCreditCustomer) return;
    document.getElementById('add-transaction-modal').classList.remove('hidden');
    document.getElementById('add-transaction-form').reset();
}

function closeAddTransactionModal() {
    document.getElementById('add-transaction-modal').classList.add('hidden');
}

async function handleAddCreditTransaction(e) {
    e.preventDefault();
    if (!currentCreditCustomer || !currentUser) return;

    const amountRaw = document.getElementById('transaction-amount').value;
    const descriptionRaw = document.getElementById('transaction-description').value;

    if (!isInputSafe(descriptionRaw)) {
        showToast("Invalid description.", "warning");
        return;
    }

    const amount = parseFloat(parseFromCommas(amountRaw));
    const description = sanitizeInput(descriptionRaw);

    if (isNaN(amount) || amount <= 0) {
        showToast("Please enter a valid amount.", "warning");
        return;
    }

    const transaction = {
        creditId: currentCreditCustomer.id,
        type: 'credit',
        amount: amount,
        description: description,
        date: Timestamp.now(),
        ownerId: currentUser.uid
    };

    showLoading();
    try {
        await addDoc(collection(db, "creditTransactions"), transaction);
        
        // Update balance
        const newBalance = (currentCreditCustomer.balance || 0) + amount;
        await updateDoc(doc(db, "credits", currentCreditCustomer.id), {
            balance: newBalance
        });

        currentCreditCustomer.balance = newBalance;
        const idx = creditsCache.findIndex(c => c.id === currentCreditCustomer.id);
        if (idx !== -1) {
            creditsCache[idx].balance = newBalance;
        }

        document.getElementById('credit-detail-balance').innerText = formatMoney(newBalance);
        
        showToast('Credit added!', 'success');
        closeAddTransactionModal();
        renderCreditTransactions();
        updateCreditSummary();
    } catch (e) {
        showToast("Error adding credit: " + e.message, 'error');
    } finally {
        hideLoading();
    }
}

// --- Payment Modal ---
function openPaymentModal() {
    if (!currentCreditCustomer) return;
    document.getElementById('payment-modal').classList.remove('hidden');
    document.getElementById('payment-form').reset();
    document.getElementById('payment-modal-balance').innerText = formatMoney(currentCreditCustomer.balance || 0);
}

function closePaymentModal() {
    document.getElementById('payment-modal').classList.add('hidden');
}

async function handleRecordPayment(e) {
    e.preventDefault();
    if (!currentCreditCustomer || !currentUser) return;

    const amountRaw = document.getElementById('payment-amount').value;
    const noteRaw = document.getElementById('payment-note').value;

    if (!isInputSafe(noteRaw)) {
        showToast("Invalid note.", "warning");
        return;
    }

    const amount = parseFloat(parseFromCommas(amountRaw));
    const note = sanitizeInput(noteRaw);

    if (isNaN(amount) || amount <= 0) {
        showToast("Please enter a valid amount.", "warning");
        return;
    }

    if (amount > currentCreditCustomer.balance) {
        showToast("Payment exceeds outstanding balance!", "warning");
        return;
    }

    const transaction = {
        creditId: currentCreditCustomer.id,
        type: 'payment',
        amount: amount,
        description: note || 'Payment received',
        date: Timestamp.now(),
        ownerId: currentUser.uid
    };

    showLoading();
    try {
        await addDoc(collection(db, "creditTransactions"), transaction);
        
        // Update balance
        const newBalance = (currentCreditCustomer.balance || 0) - amount;
        await updateDoc(doc(db, "credits", currentCreditCustomer.id), {
            balance: newBalance
        });

        currentCreditCustomer.balance = newBalance;
        const idx = creditsCache.findIndex(c => c.id === currentCreditCustomer.id);
        if (idx !== -1) {
            creditsCache[idx].balance = newBalance;
        }

        document.getElementById('credit-detail-balance').innerText = formatMoney(newBalance);
        
        showToast('Payment recorded!', 'success');
        closePaymentModal();
        renderCreditTransactions();
        updateCreditSummary();
    } catch (e) {
        showToast("Error recording payment: " + e.message, 'error');
    } finally {
        hideLoading();
    }
}

// --- Delete Customer ---
async function deleteCustomer() {
    if (!currentCreditCustomer) return;

    const customerName = currentCreditCustomer.customerName;
    const balance = currentCreditCustomer.balance || 0;

    // Warn if customer still has outstanding balance
    let confirmMessage = `Are you sure you want to delete "${customerName}"?`;
    if (balance > 0) {
        confirmMessage = `"${customerName}" still has an outstanding balance of ${formatMoney(balance)}.\n\nAre you sure you want to delete this customer? This will also delete all transaction history.`;
    } else {
        confirmMessage += '\n\nThis will also delete all transaction history.';
    }

    if (!confirm(confirmMessage)) return;

    showLoading();
    try {
        // Delete all credit transactions for this customer
        const qTrans = query(
            collection(db, "creditTransactions"),
            where("creditId", "==", currentCreditCustomer.id),
            where("ownerId", "==", currentUser.uid)
        );
        const transSnap = await getDocs(qTrans);
        
        // Delete all transactions
        const deletePromises = transSnap.docs.map(doc => 
            deleteDoc(doc.ref)
        );
        await Promise.all(deletePromises);

        // Delete the customer record
        await deleteDoc(doc(db, "credits", currentCreditCustomer.id));

        // Remove from cache
        creditsCache = creditsCache.filter(c => c.id !== currentCreditCustomer.id);
        currentCreditCustomer = null;

        showToast('Customer deleted successfully!', 'success');
        showScreen('credit-screen');
        renderCreditList();
        updateCreditSummary();
    } catch (e) {
        console.error("Delete customer error:", e);
        showToast("Error deleting customer: " + e.message, 'error');
    } finally {
        hideLoading();
    }
}
