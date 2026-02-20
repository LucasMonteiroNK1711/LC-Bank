const STORAGE_KEY = 'lc-bank-data-v1';
const CLOUD_CONFIG_KEY = 'lc-bank-cloud-config-v1';

const cloud = {
  app: null,
  auth: null,
  db: null,
  user: null,
  initialized: false,
  saveTimer: null,
  status: 'Local apenas'
};

const FIREBASE_SDK_URLS = [
  'https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js',
  'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth-compat.js',
  'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore-compat.js'
];

const defaultState = {
  theme: 'dark',
  banks: [{ id: crypto.randomUUID(), name: 'Banco Principal', openingBalance: 4500, balance: 4500 }],
  cards: [],
  invoices: [],
  categories: [
    { id: crypto.randomUUID(), name: 'Moradia', type: 'expense' },
    { id: crypto.randomUUID(), name: 'Alimentação', type: 'expense' },
    { id: crypto.randomUUID(), name: 'Salário', type: 'income' }
  ],
  transactions: [],
  balanceAdjustments: [],
  filters: {
    dashboardMonth: 'all',
    statementMonth: 'all',
    statementType: 'all',
    statementCategory: 'all'
  }
};

let state = loadState();
let editingTransactionId = null;

function normalizeState(inputState = {}) {
  const parsed = { ...structuredClone(defaultState), ...(inputState || {}) };
  parsed.banks = (parsed.banks || []).map((bank) => ({
    ...bank,
    openingBalance: typeof bank.openingBalance === 'number' ? bank.openingBalance : (Number(bank.balance) || 0),
    balance: Number(bank.balance) || 0
  }));
  parsed.cards = (parsed.cards || []).map((card) => ({ ...card, dueDay: card.dueDay || 10 }));
  parsed.balanceAdjustments = (parsed.balanceAdjustments || []).map((a) => ({
    id: a.id || crypto.randomUUID(),
    bankId: a.bankId || '',
    amount: Number(a.amount) || 0,
    date: a.date || new Date().toISOString().slice(0, 10),
    description: a.description || 'Ajuste manual de saldo'
  }));
  parsed.transactions = (parsed.transactions || []).map((t) => ({
    paymentMethod: 'bank',
    installments: 1,
    cardId: '',
    ...t
  }));
  parsed.filters = {
    dashboardMonth: 'all',
    statementMonth: 'all',
    statementType: 'all',
    statementCategory: 'all',
    ...(parsed.filters || {})
  };
  return parsed;
}

function loadState() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return structuredClone(defaultState);
  try {
    return normalizeState(JSON.parse(raw));
  } catch {
    return structuredClone(defaultState);
  }
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  queueCloudSave();
}

function queueCloudSave() {
  if (!cloud.db || !cloud.user) return;
  if (cloud.saveTimer) clearTimeout(cloud.saveTimer);
  cloud.saveTimer = setTimeout(async () => {
    try {
      await cloud.db.collection('users').doc(cloud.user.uid).set({
        state,
        updatedAt: new Date().toISOString(),
        email: cloud.user.email || ''
      });
      cloud.status = `Sincronizado (${new Date().toLocaleTimeString('pt-BR')})`;
    } catch (error) {
      cloud.status = `Erro ao sincronizar: ${error.message}`;
    }
    renderCloudStatus();
  }, 600);
}

async function loadCloudState() {
  if (!cloud.db || !cloud.user) return;
  try {
    const doc = await cloud.db.collection('users').doc(cloud.user.uid).get();
    if (doc.exists && doc.data().state) {
      state = normalizeState(doc.data().state);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      cloud.status = 'Dados carregados da nuvem';
      render();
      return;
    }
    cloud.status = 'Conta conectada (sem dados remotos ainda)';
    queueCloudSave();
  } catch (error) {
    cloud.status = `Erro ao carregar nuvem: ${error.message}`;
  }
  renderCloudStatus();
}

function renderCloudStatus() {
  const statusEl = document.getElementById('cloud-status-text');
  const userEl = document.getElementById('cloud-user-text');
  const connectBtn = document.getElementById('cloud-connect-btn');
  const disconnectBtn = document.getElementById('cloud-disconnect-btn');
  const syncBtn = document.getElementById('cloud-sync-btn');
  if (!statusEl || !userEl || !connectBtn || !disconnectBtn || !syncBtn) return;

  userEl.textContent = cloud.user ? `Conectado: ${cloud.user.email || cloud.user.displayName || 'usuário'}` : 'Não conectado';
  statusEl.textContent = cloud.status;
  connectBtn.classList.toggle('hidden', Boolean(cloud.user));
  disconnectBtn.classList.toggle('hidden', !cloud.user);
  syncBtn.disabled = !cloud.user;
}

function loadExternalScript(src) {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[data-src="${src}"]`);
    if (existing) {
      if (existing.dataset.loaded === 'true') {
        resolve();
      } else {
        existing.addEventListener('load', () => resolve(), { once: true });
        existing.addEventListener('error', () => reject(new Error(`Falha ao carregar ${src}`)), { once: true });
      }
      return;
    }

    const script = document.createElement('script');
    script.src = src;
    script.defer = true;
    script.dataset.src = src;
    script.onload = () => {
      script.dataset.loaded = 'true';
      resolve();
    };
    script.onerror = () => reject(new Error(`Falha ao carregar ${src}`));
    document.head.appendChild(script);
  });
}

async function ensureFirebaseSDK() {
  if (window.firebase) return true;

  try {
    for (const src of FIREBASE_SDK_URLS) {
      await loadExternalScript(src);
    }
    return Boolean(window.firebase);
  } catch {
    return false;
  }
}

async function initCloud() {
  if (cloud.initialized) return;

  const raw = localStorage.getItem(CLOUD_CONFIG_KEY);
  if (!raw) {
    cloud.status = 'Nuvem não configurada';
    return;
  }

  const sdkReady = await ensureFirebaseSDK();
  if (!sdkReady) {
    cloud.status = 'SDK de nuvem indisponível';
    return;
  }

  try {
    const config = JSON.parse(raw);
    cloud.app = firebase.apps.length ? firebase.app() : firebase.initializeApp(config);
    cloud.auth = firebase.auth();
    cloud.db = firebase.firestore();
    cloud.initialized = true;

    cloud.auth.onAuthStateChanged(async (user) => {
      cloud.user = user;
      if (user) {
        cloud.status = 'Conectado. Carregando dados...';
        renderCloudStatus();
        await loadCloudState();
      } else {
        cloud.status = 'Nuvem configurada. Faça login para sincronizar';
        renderCloudStatus();
      }
    });
  } catch (error) {
    cloud.status = `Configuração inválida: ${error.message}`;
  }
}

async function connectCloud() {
  if (!localStorage.getItem(CLOUD_CONFIG_KEY)) {
    const configInput = window.prompt(
      'Cole o JSON da configuração Web do Firebase (Project settings > Your apps > SDK setup and configuration):'
    );
    if (!configInput) return;
    try {
      JSON.parse(configInput);
    } catch {
      window.alert('JSON inválido.');
      return;
    }
    localStorage.setItem(CLOUD_CONFIG_KEY, configInput);
  }

  await initCloud();
  if (!cloud.auth) return;

  try {
    const provider = new firebase.auth.GoogleAuthProvider();
    await cloud.auth.signInWithPopup(provider);
  } catch (error) {
    cloud.status = `Falha no login: ${error.message}`;
    renderCloudStatus();
  }
}

async function disconnectCloud() {
  if (!cloud.auth) return;
  await cloud.auth.signOut();
  cloud.status = 'Desconectado da nuvem';
  renderCloudStatus();
}

function forceCloudSync() {
  if (!cloud.user) return;
  cloud.status = 'Sincronizando...';
  renderCloudStatus();
  queueCloudSave();
}

const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

function fmtMoney(v) {
  return BRL.format(Number(v) || 0);
}

function recalculateBankBalances() {
  state.banks = state.banks.map((bank) => ({
    ...bank,
    openingBalance: typeof bank.openingBalance === 'number' ? bank.openingBalance : (Number(bank.balance) || 0)
  }));

  const cardBankMap = Object.fromEntries(state.cards.map((card) => [card.id, card.bankId]));

  for (const bank of state.banks) {
    let nextBalance = Number(bank.openingBalance) || 0;

    for (const t of state.transactions) {
      if (t.bankId !== bank.id) continue;
      if (t.status !== 'paid') continue;
      if (t.paymentMethod === 'credit_card') continue;
      nextBalance += t.type === 'income' ? t.amount : -t.amount;
    }

    for (const inv of state.invoices) {
      if (!inv.paid) continue;
      if (cardBankMap[inv.cardId] !== bank.id) continue;
      nextBalance -= inv.amount;
    }

    for (const adj of state.balanceAdjustments) {
      if (adj.bankId !== bank.id) continue;
      nextBalance += adj.amount;
    }

    bank.balance = Number(nextBalance.toFixed(2));
  }
}

function matchesMonth(dateValue, monthFilter) {
  return monthFilter === 'all' || (dateValue || '').startsWith(monthFilter);
}

function getAvailableMonths() {
  const months = new Set();
  state.transactions.forEach((t) => months.add((t.date || '').slice(0, 7)));
  state.invoices.forEach((i) => months.add((i.dueDate || '').slice(0, 7)));
  state.balanceAdjustments.forEach((a) => months.add((a.date || '').slice(0, 7)));
  return [...months].filter(Boolean).sort().reverse();
}

function monthLabel(month) {
  if (month === 'all') return 'Todos os meses';
  const [y, m] = month.split('-');
  return new Date(Number(y), Number(m) - 1, 1).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
}

function totals(monthFilter = 'all') {
  const paidIncome = state.transactions
    .filter((t) => t.type === 'income' && t.status === 'paid' && matchesMonth(t.date, monthFilter))
    .reduce((sum, t) => sum + t.amount, 0);

  const paidExpense = state.transactions
    .filter((t) => t.type === 'expense' && t.status === 'paid' && t.paymentMethod !== 'credit_card' && matchesMonth(t.date, monthFilter))
    .reduce((sum, t) => sum + t.amount, 0);

  const pendingIncome = state.transactions
    .filter((t) => t.type === 'income' && t.status === 'pending' && matchesMonth(t.date, monthFilter))
    .reduce((sum, t) => sum + t.amount, 0);

  const pendingExpense = state.transactions
    .filter((t) => t.type === 'expense' && t.status === 'pending' && t.paymentMethod !== 'credit_card' && matchesMonth(t.date, monthFilter))
    .reduce((sum, t) => sum + t.amount, 0);

  const bankBalance = state.banks.reduce((sum, b) => sum + b.balance, 0);
  const unpaidInvoices = state.invoices
    .filter((inv) => !inv.paid && matchesMonth(inv.dueDate, monthFilter))
    .reduce((sum, inv) => sum + inv.amount, 0);

  return {
    paidIncome,
    paidExpense,
    pendingIncome,
    pendingExpense,
    bankBalance,
    unpaidInvoices,
    forecast: bankBalance + pendingIncome - pendingExpense - unpaidInvoices
  };
}

function updateTheme() {
  document.documentElement.dataset.theme = state.theme;
}

function bindNav() {
  const buttons = [...document.querySelectorAll('#main-nav button')];
  const views = [...document.querySelectorAll('.view')];
  buttons.forEach((btn) => {
    btn.addEventListener('click', () => {
      buttons.forEach((x) => x.classList.remove('active'));
      btn.classList.add('active');
      views.forEach((v) => v.classList.remove('active'));
      const target = document.getElementById(btn.dataset.view);
      target.classList.add('active');
      document.getElementById('view-title').textContent = btn.textContent;
      render();
    });
  });
}

function optionHTML(items, mapFn) {
  return items.map(mapFn).join('');
}

function renderDashboard() {
  const monthFilter = state.filters.dashboardMonth;
  const t = totals(monthFilter);
  const monthOptions = ['all', ...getAvailableMonths()]
    .map((month) => `<option value="${month}">${monthLabel(month)}</option>`)
    .join('');

  document.getElementById('dashboard').innerHTML = `
    <div class="card" style="margin-bottom:1rem;">
      <label>Mês do dashboard
        <select id="dashboard-month-filter">${monthOptions}</select>
      </label>
    </div>
    <div class="card" style="margin-bottom:1rem;">
      <h3>Sincronização entre dispositivos</h3>
      <p id="cloud-user-text" class="muted">Não conectado</p>
      <p id="cloud-status-text" class="muted">Local apenas</p>
      <div class="row-actions">
        <button id="cloud-connect-btn" class="secondary small">Conectar nuvem</button>
        <button id="cloud-sync-btn" class="secondary small">Sincronizar agora</button>
        <button id="cloud-disconnect-btn" class="danger small hidden">Desconectar</button>
      </div>
    </div>
    <div class="metric-grid">
      <article class="metric"><span>Saldo atual</span><strong>${fmtMoney(t.bankBalance)}</strong></article>
      <article class="metric"><span>Receitas pagas</span><strong>${fmtMoney(t.paidIncome)}</strong></article>
      <article class="metric"><span>Despesas pagas</span><strong>${fmtMoney(t.paidExpense)}</strong></article>
      <article class="metric"><span>Saldo previsto do mês</span><strong>${fmtMoney(t.forecast)}</strong></article>
    </div>
    <div class="grid-2">
      <section class="card">
        <h3>Pendências</h3>
        <p>Receitas a receber: <strong>${fmtMoney(t.pendingIncome)}</strong></p>
        <p>Despesas a pagar: <strong>${fmtMoney(t.pendingExpense)}</strong></p>
        <p>Faturas em aberto: <strong>${fmtMoney(t.unpaidInvoices)}</strong></p>
      </section>
      <section class="card">
        <h3>Saldo por banco</h3>
        <div class="list">
          ${state.banks.length
            ? state.banks
              .map((bank) => `<div class="list-item"><strong>${bank.name}</strong><strong>${fmtMoney(bank.balance)}</strong></div>`)
              .join('')
            : '<p class="muted">Nenhum banco cadastrado.</p>'}
        </div>
      </section>
    </div>
    <div class="grid-2 mt">
      <section class="card">
        <h3>Fluxo financeiro mensal</h3>
        <canvas id="flow-chart" class="chart-canvas" width="600" height="260" aria-label="Gráfico de fluxo mensal"></canvas>
      </section>
      <section class="card">
        <h3>Despesas por categoria</h3>
        <canvas id="expense-chart" class="chart-canvas" width="600" height="260" aria-label="Gráfico de despesas por categoria"></canvas>
      </section>
    </div>
    <div class="card mt">
      <h3>Evolução mensal: sobrou ou faltou no fechamento</h3>
      <canvas id="monthly-result-chart" class="chart-canvas" width="1200" height="280" aria-label="Gráfico de evolução mensal de sobra ou falta"></canvas>
    </div>
  `;

  const dashboardMonthFilter = document.getElementById('dashboard-month-filter');
  dashboardMonthFilter.value = monthFilter;
  dashboardMonthFilter.onchange = (event) => {
    state.filters.dashboardMonth = event.target.value;
    saveState();
    render();
  };

  document.getElementById('cloud-connect-btn').onclick = () => connectCloud();
  document.getElementById('cloud-disconnect-btn').onclick = () => disconnectCloud();
  document.getElementById('cloud-sync-btn').onclick = () => forceCloudSync();
  renderCloudStatus();

  renderFlowChart(monthFilter);
  renderExpenseChart(monthFilter);
  renderMonthlyResultChart();
}

function renderSelects() {
  const categoryOptions = optionHTML(
    state.categories,
    (c) => `<option value="${c.id}">${c.name} (${c.type === 'expense' ? 'Despesa' : 'Receita'})</option>`
  );
  document.getElementById('transaction-category').innerHTML = categoryOptions;
  document.getElementById('edit-transaction-category').innerHTML = categoryOptions;

  const bankOptions = optionHTML(state.banks, (b) => `<option value="${b.id}">${b.name}</option>`);
  document.getElementById('transaction-bank').innerHTML = bankOptions;
  document.getElementById('edit-transaction-bank').innerHTML = bankOptions;
  document.getElementById('card-bank').innerHTML = bankOptions;

  const cardOptions = optionHTML(state.cards, (c) => `<option value="${c.id}">${c.name}</option>`);
  document.getElementById('transaction-card').innerHTML = cardOptions;
  document.getElementById('edit-transaction-card').innerHTML = cardOptions;
}

function getCategoryName(id) {
  return state.categories.find((c) => c.id === id)?.name ?? 'Sem categoria';
}

function getBankName(id) {
  return state.banks.find((b) => b.id === id)?.name ?? 'Sem banco';
}

function getStatementStatus(transaction) {
  if (transaction.paymentMethod === 'credit_card') {
    return 'Lançado no cartão';
  }

  return transaction.status === 'paid' ? 'Compensado' : 'Previsto';
}

function getPaymentLabel(transaction) {
  if (transaction.paymentMethod === 'credit_card') {
    const card = state.cards.find((c) => c.id === transaction.cardId);
    const cardName = card?.name ?? 'Cartão removido';
    const installments = transaction.installments && transaction.installments > 1 ? ` • ${transaction.installments}x` : '';
    return `Cartão: ${cardName}${installments}`;
  }

  return 'Débito/PIX/Transferência';
}

function splitAmountInInstallments(amount, count) {
  const totalCents = Math.round(amount * 100);
  const base = Math.floor(totalCents / count);
  const remainder = totalCents % count;

  return Array.from({ length: count }, (_, index) => (base + (index < remainder ? 1 : 0)) / 100);
}

function daysInMonth(year, monthIndex) {
  return new Date(year, monthIndex + 1, 0).getDate();
}

function buildDate(year, monthIndex, day) {
  const safeDay = Math.min(day, daysInMonth(year, monthIndex));
  return new Date(year, monthIndex, safeDay);
}

function formatDate(dateObj) {
  const yyyy = dateObj.getFullYear();
  const mm = String(dateObj.getMonth() + 1).padStart(2, '0');
  const dd = String(dateObj.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function getNextInvoiceDueDate(card, purchaseDateStr, installmentOffset = 0) {
  const [year, month, day] = purchaseDateStr.split('-').map(Number);
  const purchaseDate = new Date(year, month - 1, day);
  const dueDay = Math.max(1, Math.min(28, Number(card.dueDay) || 10));

  const dueThisMonth = buildDate(purchaseDate.getFullYear(), purchaseDate.getMonth(), dueDay);
  const cutoffThisMonth = new Date(dueThisMonth);
  cutoffThisMonth.setDate(cutoffThisMonth.getDate() - 5);

  const baseDue = purchaseDate <= cutoffThisMonth ? dueThisMonth : buildDate(purchaseDate.getFullYear(), purchaseDate.getMonth() + 1, dueDay);
  const dueDate = buildDate(baseDue.getFullYear(), baseDue.getMonth() + installmentOffset, dueDay);

  return formatDate(dueDate);
}

function upsertInvoice(cardId, dueDate, amount, metadata) {
  const existing = state.invoices.find((inv) => inv.cardId === cardId && inv.dueDate === dueDate && !inv.paid);

  if (existing) {
    existing.amount += amount;
    existing.items = existing.items || [];
    existing.items.push(metadata);
    return;
  }

  state.invoices.push({
    id: crypto.randomUUID(),
    cardId,
    amount,
    dueDate,
    paid: false,
    items: [metadata]
  });
}

function createInvoicesForCardPurchase(transaction) {
  const card = state.cards.find((c) => c.id === transaction.cardId);
  if (!card) return;

  const installments = transaction.installments || 1;
  const amounts = splitAmountInInstallments(transaction.amount, installments);

  amounts.forEach((partAmount, index) => {
    const dueDate = getNextInvoiceDueDate(card, transaction.date, index);
    upsertInvoice(transaction.cardId, dueDate, partAmount, {
      sourceTransactionId: transaction.id,
      description: transaction.description,
      installment: index + 1,
      installmentCount: installments,
      amount: partAmount
    });
  });
}

function syncTransactionFormControls() {
  const form = document.getElementById('transaction-form');
  const type = form.querySelector('select[name="type"]').value;
  const paymentMethodSelect = form.querySelector('select[name="paymentMethod"]');
  if (type !== 'expense') {
    paymentMethodSelect.value = 'bank';
  }

  const paymentMethod = paymentMethodSelect.value;
  const cardWrapper = document.getElementById('transaction-card-wrapper');
  const installmentsWrapper = document.getElementById('transaction-installments-wrapper');
  const cardSelect = document.getElementById('transaction-card');
  const installmentsInput = document.getElementById('transaction-installments');
  const statusSelect = form.querySelector('select[name="status"]');

  const enableCreditCard = type === 'expense' && paymentMethod === 'credit_card';
  cardWrapper.classList.toggle('hidden', !enableCreditCard);
  installmentsWrapper.classList.toggle('hidden', !enableCreditCard);
  cardSelect.required = enableCreditCard;
  statusSelect.disabled = enableCreditCard;

  if (enableCreditCard) {
    statusSelect.value = 'pending';
  } else {
    statusSelect.disabled = false;
  }

  if (!enableCreditCard) {
    installmentsInput.value = '1';
  }
}

function syncEditTransactionFormControls() {
  const form = document.getElementById('edit-transaction-form');
  const type = form.querySelector('select[name="type"]').value;
  const paymentMethodSelect = form.querySelector('select[name="paymentMethod"]');
  if (type !== 'expense') {
    paymentMethodSelect.value = 'bank';
  }

  const paymentMethod = paymentMethodSelect.value;
  const cardWrapper = document.getElementById('edit-transaction-card-wrapper');
  const installmentsWrapper = document.getElementById('edit-transaction-installments-wrapper');
  const cardSelect = document.getElementById('edit-transaction-card');
  const installmentsInput = document.getElementById('edit-transaction-installments');
  const statusSelect = form.querySelector('select[name="status"]');

  const enableCreditCard = type === 'expense' && paymentMethod === 'credit_card';
  cardWrapper.classList.toggle('hidden', !enableCreditCard);
  installmentsWrapper.classList.toggle('hidden', !enableCreditCard);
  cardSelect.required = enableCreditCard;
  statusSelect.disabled = enableCreditCard;

  if (enableCreditCard) {
    statusSelect.value = 'pending';
  } else {
    statusSelect.disabled = false;
  }

  if (!enableCreditCard) {
    installmentsInput.value = '1';
  }
}

function closeEditTransactionModal() {
  editingTransactionId = null;
  document.getElementById('edit-transaction-modal').classList.add('hidden');
}

function removeInvoiceItemsBySourceTransaction(transactionId) {
  state.invoices = state.invoices
    .map((inv) => {
      if (!inv.items?.length) return inv;
      const filteredItems = inv.items.filter((item) => item.sourceTransactionId !== transactionId);
      const newAmount = filteredItems.reduce((sum, item) => sum + (item.amount || 0), 0);
      return { ...inv, items: filteredItems, amount: Number(newAmount.toFixed(2)) };
    })
    .filter((inv) => !inv.items || inv.items.length || inv.amount > 0);
}

function openEditTransactionModal(id) {
  const t = state.transactions.find((x) => x.id === id);
  if (!t) return;

  editingTransactionId = id;
  renderSelects();

  const form = document.getElementById('edit-transaction-form');
  form.querySelector('input[name="description"]').value = t.description;
  form.querySelector('input[name="amount"]').value = t.amount;
  form.querySelector('select[name="type"]').value = t.type;
  form.querySelector('select[name="category"]').value = t.categoryId || '';
  form.querySelector('select[name="bank"]').value = t.bankId;
  form.querySelector('select[name="paymentMethod"]').value = t.paymentMethod || 'bank';
  form.querySelector('select[name="cardId"]').value = t.cardId || '';
  form.querySelector('input[name="installments"]').value = t.installments || 1;
  form.querySelector('input[name="date"]').value = t.date;
  form.querySelector('select[name="status"]').value = t.status;

  syncEditTransactionFormControls();
  document.getElementById('edit-transaction-modal').classList.remove('hidden');
}

function getMonthlyResultEvolution() {
  const availableMonths = getAvailableMonths().slice().sort();
  const months = availableMonths.length
    ? availableMonths
    : [new Date().toISOString().slice(0, 7)];

  return months.map((monthKey) => {
    const income = state.transactions
      .filter((t) => t.type === 'income' && matchesMonth(t.date, monthKey))
      .reduce((sum, t) => sum + t.amount, 0);

    const expense = state.transactions
      .filter((t) => t.type === 'expense' && t.paymentMethod !== 'credit_card' && matchesMonth(t.date, monthKey))
      .reduce((sum, t) => sum + t.amount, 0);

    const invoicesDue = state.invoices
      .filter((inv) => matchesMonth(inv.dueDate, monthKey))
      .reduce((sum, inv) => sum + inv.amount, 0);

    return {
      key: monthKey,
      label: monthLabel(monthKey),
      result: income - expense - invoicesDue
    };
  });
}

function renderMonthlyResultChart() {
  const canvas = document.getElementById('monthly-result-chart');
  if (!canvas) return;

  const ctx = canvas.getContext('2d');
  const w = canvas.width;
  const h = canvas.height;
  const padX = 50;
  const padY = 35;
  ctx.clearRect(0, 0, w, h);

  const data = getMonthlyResultEvolution();
  if (!data.length) return;

  const maxAbs = Math.max(1, ...data.map((d) => Math.abs(d.result)));
  const chartWidth = w - padX * 2;
  const chartHeight = h - padY * 2;
  const zeroY = padY + chartHeight / 2;
  const stepX = data.length > 1 ? chartWidth / (data.length - 1) : 0;

  ctx.strokeStyle = 'rgba(140,160,210,0.35)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(padX, zeroY);
  ctx.lineTo(w - padX, zeroY);
  ctx.stroke();

  const points = data.map((d, index) => {
    const x = padX + index * stepX;
    const y = zeroY - (d.result / maxAbs) * (chartHeight / 2);
    return { ...d, x, y };
  });

  ctx.beginPath();
  points.forEach((point, index) => {
    if (index === 0) ctx.moveTo(point.x, point.y);
    else ctx.lineTo(point.x, point.y);
  });
  ctx.strokeStyle = '#4f7cff';
  ctx.lineWidth = 2.5;
  ctx.stroke();

  points.forEach((point, index) => {
    ctx.beginPath();
    ctx.arc(point.x, point.y, 4, 0, Math.PI * 2);
    ctx.fillStyle = point.result >= 0 ? '#26c281' : '#ef5b67';
    ctx.fill();

    const label = point.label.split(' de ')[0];
    ctx.fillStyle = 'rgba(160,178,230,0.9)';
    ctx.font = '11px Inter';
    const labelX = point.x - 24;
    ctx.fillText(label, Math.max(8, Math.min(w - 60, labelX)), h - 10);

    if (index === points.length - 1) {
      ctx.fillStyle = point.result >= 0 ? '#26c281' : '#ef5b67';
      ctx.font = '12px Inter';
      ctx.fillText(fmtMoney(point.result), Math.max(8, point.x - 40), Math.max(14, point.y - 8));
    }
  });
}

function getMonthlyFlow(monthFilter = 'all') {
  const months = [];

  if (monthFilter === 'all') {
    const current = new Date();
    for (let i = 5; i >= 0; i -= 1) {
      const d = new Date(current.getFullYear(), current.getMonth() - i, 1);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      months.push({ key, label: d.toLocaleDateString('pt-BR', { month: 'short' }) });
    }
  } else {
    months.push({ key: monthFilter, label: monthLabel(monthFilter) });
  }

  return months.map((month) => {
    const monthItems = state.transactions.filter((t) => t.date.startsWith(month.key));
    const income = monthItems.filter((t) => t.type === 'income').reduce((sum, t) => sum + t.amount, 0);
    const expense = monthItems.filter((t) => t.type === 'expense').reduce((sum, t) => sum + t.amount, 0);
    return { ...month, income, expense };
  });
}

function renderFlowChart(monthFilter = 'all') {
  const canvas = document.getElementById('flow-chart');
  if (!canvas) return;

  const ctx = canvas.getContext('2d');
  const w = canvas.width;
  const h = canvas.height;
  const pad = 35;
  ctx.clearRect(0, 0, w, h);

  const data = getMonthlyFlow(monthFilter);
  const maxValue = Math.max(1, ...data.flatMap((m) => [m.income, m.expense]));
  const slotWidth = (w - pad * 2) / data.length;
  const barWidth = slotWidth * 0.32;

  ctx.strokeStyle = 'rgba(140,160,210,0.4)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(pad, h - pad);
  ctx.lineTo(w - pad, h - pad);
  ctx.stroke();

  data.forEach((d, idx) => {
    const xBase = pad + idx * slotWidth + slotWidth * 0.18;
    const incomeHeight = ((h - pad * 2) * d.income) / maxValue;
    const expenseHeight = ((h - pad * 2) * d.expense) / maxValue;

    ctx.fillStyle = '#10b981';
    ctx.fillRect(xBase, h - pad - incomeHeight, barWidth, incomeHeight);

    ctx.fillStyle = '#ef4444';
    ctx.fillRect(xBase + barWidth + 6, h - pad - expenseHeight, barWidth, expenseHeight);

    ctx.fillStyle = 'rgba(160,178,230,0.9)';
    ctx.font = '12px Inter';
    ctx.fillText(d.label, xBase - 4, h - 12);
  });

  ctx.fillStyle = 'rgba(160,178,230,0.9)';
  ctx.fillText('Receitas', pad, 16);
  ctx.fillStyle = '#10b981';
  ctx.fillRect(pad + 55, 8, 10, 10);
  ctx.fillStyle = 'rgba(160,178,230,0.9)';
  ctx.fillText('Despesas', pad + 80, 16);
  ctx.fillStyle = '#ef4444';
  ctx.fillRect(pad + 138, 8, 10, 10);
}

function renderExpenseChart(monthFilter = 'all') {
  const canvas = document.getElementById('expense-chart');
  if (!canvas) return;

  const ctx = canvas.getContext('2d');
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);

  const expenses = state.transactions.filter((t) => t.type === 'expense' && matchesMonth(t.date, monthFilter));
  const grouped = expenses.reduce((acc, t) => {
    const name = getCategoryName(t.categoryId);
    acc[name] = (acc[name] || 0) + t.amount;
    return acc;
  }, {});

  const entries = Object.entries(grouped)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  if (!entries.length) {
    ctx.fillStyle = 'rgba(160,178,230,0.9)';
    ctx.font = '14px Inter';
    ctx.fillText('Adicione despesas para visualizar o gráfico.', 22, h / 2);
    return;
  }

  const colors = ['#3b82f6', '#8b5cf6', '#06b6d4', '#f59e0b', '#ef4444'];
  const total = entries.reduce((sum, [, value]) => sum + value, 0);
  const cx = 130;
  const cy = h / 2;
  const radius = 80;

  let start = -Math.PI / 2;
  entries.forEach(([name, value], idx) => {
    const slice = (value / total) * Math.PI * 2;
    const color = colors[idx % colors.length];

    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, radius, start, start + slice);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
    start += slice;

    const legendY = 35 + idx * 34;
    ctx.fillStyle = color;
    ctx.fillRect(270, legendY - 10, 14, 14);
    ctx.fillStyle = 'rgba(160,178,230,0.95)';
    ctx.font = '13px Inter';
    const pct = ((value / total) * 100).toFixed(1);
    ctx.fillText(`${name}: ${pct}%`, 292, legendY + 1);
    ctx.fillText(fmtMoney(value), 292, legendY + 16);
  });
}

function renderTransactions() {
  const list = document.getElementById('transactions-list');
  if (!state.transactions.length) {
    list.innerHTML = '<p class="muted">Nenhuma movimentação cadastrada.</p>';
    return;
  }

  list.innerHTML = state.transactions
    .slice()
    .sort((a, b) => b.date.localeCompare(a.date))
    .map(
      (t) => `
      <article class="list-item">
        <div>
          <strong>${t.description}</strong>
          <div class="meta">${getCategoryName(t.categoryId)} • ${getBankName(t.bankId)} • ${new Date(`${t.date}T12:00:00`).toLocaleDateString('pt-BR')}</div>
          <div class="meta">${t.type === 'expense' ? 'Despesa' : 'Receita'} • ${t.status === 'paid' ? 'Pago/Recebido' : 'Pendente'} • ${getPaymentLabel(t)}</div>
        </div>
        <div class="list-actions">
          <strong>${fmtMoney(t.amount)}</strong>
          <button class="secondary small" data-action="edit-transaction" data-id="${t.id}">Editar</button>
          <button class="danger small" data-action="remove-transaction" data-id="${t.id}">Remover</button>
        </div>
      </article>`
    )
    .join('');
}

function renderStatement() {
  const list = document.getElementById('statement-list');
  const monthSelect = document.getElementById('statement-filter-month');
  const typeSelect = document.getElementById('statement-filter-type');
  const categorySelect = document.getElementById('statement-filter-category');

  const monthOptions = ['all', ...getAvailableMonths()]
    .map((month) => `<option value="${month}">${monthLabel(month)}</option>`)
    .join('');
  monthSelect.innerHTML = monthOptions;
  categorySelect.innerHTML = `<option value="all">Todas as categorias</option>${state.categories
    .map((c) => `<option value="${c.id}">${c.name}</option>`)
    .join('')}`;

  monthSelect.value = state.filters.statementMonth;
  typeSelect.value = state.filters.statementType;
  categorySelect.value = state.filters.statementCategory;

  monthSelect.onchange = (event) => {
    state.filters.statementMonth = event.target.value;
    saveState();
    renderStatement();
  };
  typeSelect.onchange = (event) => {
    state.filters.statementType = event.target.value;
    saveState();
    renderStatement();
  };
  categorySelect.onchange = (event) => {
    state.filters.statementCategory = event.target.value;
    saveState();
    renderStatement();
  };

  const entries = [
    ...state.transactions.map((t) => ({
      id: `t-${t.id}`,
      transactionId: t.id,
      entryType: 'transaction',
      date: t.date,
      text: `${t.type === 'expense' ? 'Despesa' : 'Receita'}: ${t.description} (${getPaymentLabel(t)})`,
      value: t.type === 'expense' ? -t.amount : t.amount,
      status: getStatementStatus(t),
      canToggleStatus: t.paymentMethod !== 'credit_card',
      toggleLabel: t.status === 'paid' ? 'Marcar como pendente' : 'Marcar como pago/recebido',
      type: t.type,
      categoryId: t.categoryId
    })),
    ...state.invoices.map((i) => ({
      id: `i-${i.id}`,
      entryType: 'invoice',
      date: i.dueDate,
      text: `Fatura ${getCardName(i.cardId)}${i.items?.length ? ` • ${i.items.length} compra(s)` : ''}`,
      value: -i.amount,
      status: i.paid ? 'Paga' : 'Em aberto',
      canToggleStatus: false,
      type: 'expense',
      categoryId: 'all'
    })),
    ...state.balanceAdjustments.map((a) => ({
      id: `a-${a.id}`,
      entryType: 'adjustment',
      date: a.date,
      text: `${a.description} • ${getBankName(a.bankId)}`,
      value: a.amount,
      status: 'Ajuste de saldo',
      canToggleStatus: false,
      type: a.amount >= 0 ? 'income' : 'expense',
      categoryId: 'all'
    }))
  ]
    .sort((a, b) => b.date.localeCompare(a.date))
    .filter((e) => matchesMonth(e.date, state.filters.statementMonth))
    .filter((e) => state.filters.statementType === 'all' || e.type === state.filters.statementType)
    .filter((e) => state.filters.statementCategory === 'all' || e.categoryId === state.filters.statementCategory);

  if (!entries.length) {
    list.innerHTML = '<p class="muted">Extrato vazio.</p>';
    return;
  }

  list.innerHTML = entries
    .map(
      (e) => `
      <article class="list-item">
        <div>
          <strong>${e.text}</strong>
          <div class="meta">${new Date(`${e.date}T12:00:00`).toLocaleDateString('pt-BR')} • ${e.status}</div>
        </div>
        <div class="list-actions">
          <strong style="color:${e.value < 0 ? 'var(--danger)' : 'var(--success)'}">${fmtMoney(e.value)}</strong>
          ${
            e.canToggleStatus
              ? `<button class="secondary small" data-action="toggle-transaction-status" data-id="${e.transactionId}">${e.toggleLabel}</button>`
              : ''
          }
        </div>
      </article>`
    )
    .join('');
}

function getCardName(id) {
  return state.cards.find((c) => c.id === id)?.name ?? 'Cartão';
}

function renderBanksAndCards() {
  const banksList = document.getElementById('banks-list');
  banksList.innerHTML = state.banks
    .map(
      (b) => `
      <article class="list-item">
        <div>
          <strong>${b.name}</strong>
          <div class="meta">Saldo: ${fmtMoney(b.balance)}</div>
        </div>
        <div class="list-actions">
          <button class="secondary small" data-action="adjust-bank-balance" data-id="${b.id}">Ajustar saldo</button>
          <button class="danger small" data-action="remove-bank" data-id="${b.id}">Remover</button>
        </div>
      </article>`
    )
    .join('');

  const cardsList = document.getElementById('cards-list');
  cardsList.innerHTML = state.cards
    .map((c) => {
      const invoices = state.invoices.filter((i) => i.cardId === c.id);
      const invoiceHTML = invoices.length
        ? invoices
            .map(
              (inv) => `
              <div class="list-item" style="margin-top:.45rem;">
                <div>
                  <strong>Fatura: ${fmtMoney(inv.amount)}</strong>
                  <div class="meta">Vencimento: ${new Date(`${inv.dueDate}T12:00:00`).toLocaleDateString('pt-BR')} • ${inv.paid ? 'Paga' : 'Em aberto'}</div>
                  ${
                    inv.items?.length
                      ? `<div class="meta">${inv.items
                          .map((item) => `${item.description}${item.installmentCount > 1 ? ` (${item.installment}/${item.installmentCount})` : ''}`)
                          .join(' • ')}</div>`
                      : ''
                  }
                </div>
                <div class="list-actions">
                  ${
                    inv.paid
                      ? ''
                      : `<button class="success small" data-action="pay-invoice" data-id="${inv.id}">Marcar paga</button>`
                  }
                  <button class="danger small" data-action="remove-invoice" data-id="${inv.id}">Remover</button>
                </div>
              </div>`
            )
            .join('')
        : '<p class="meta">Sem faturas.</p>';

      return `
      <article class="list-item" style="flex-direction:column;align-items:stretch;">
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <div>
            <strong>${c.name}</strong>
            <div class="meta">${getBankName(c.bankId)} • Limite ${fmtMoney(c.limit)} • Vencimento dia ${c.dueDay || 10}</div>
          </div>
          <button class="danger small" data-action="remove-card" data-id="${c.id}">Remover cartão</button>
        </div>
        ${invoiceHTML}
      </article>`;
    })
    .join('');

  if (!state.cards.length) cardsList.innerHTML = '<p class="muted">Nenhum cartão cadastrado.</p>';
}

function renderCategories() {
  const list = document.getElementById('categories-list');
  list.innerHTML = state.categories
    .map(
      (c) => `
      <article class="list-item">
        <div>
          <strong>${c.name}</strong>
          <div class="meta">${c.type === 'expense' ? 'Despesa' : 'Receita'}</div>
        </div>
        <button class="danger small" data-action="remove-category" data-id="${c.id}">Remover</button>
      </article>`
    )
    .join('');
}

function removeTransaction(id) {
  state.transactions = state.transactions.filter((t) => t.id !== id);

  state.invoices = state.invoices
    .map((inv) => {
      if (!inv.items?.length) return inv;
      const filteredItems = inv.items.filter((item) => item.sourceTransactionId !== id);
      const newAmount = filteredItems.reduce((sum, item) => sum + (item.amount || 0), 0);
      return { ...inv, items: filteredItems, amount: Number(newAmount.toFixed(2)) };
    })
    .filter((inv) => !inv.items || inv.items.length || inv.amount > 0);
}

function addBankBalanceAdjustment(bankId) {
  recalculateBankBalances();
  const bank = state.banks.find((b) => b.id === bankId);
  if (!bank) return;

  const currentBalance = Number(bank.balance) || 0;
  const targetBalanceRaw = prompt(
    `Novo saldo para ${bank.name}.
Saldo atual: ${fmtMoney(currentBalance)}`,
    String(currentBalance.toFixed(2)).replace('.', ',')
  );
  if (targetBalanceRaw === null) return;

  const targetBalance = Number(String(targetBalanceRaw).replace(',', '.'));
  if (!Number.isFinite(targetBalance)) return;

  const amount = Number((targetBalance - currentBalance).toFixed(2));
  if (amount === 0) return;

  const description =
    prompt('Descrição do ajuste (opcional):', `Ajuste de saldo para ${fmtMoney(targetBalance)}`) ||
    `Ajuste de saldo para ${fmtMoney(targetBalance)}`;

  state.balanceAdjustments.push({
    id: crypto.randomUUID(),
    bankId,
    amount,
    date: new Date().toISOString().slice(0, 10),
    description: description.trim() || `Ajuste de saldo para ${fmtMoney(targetBalance)}`
  });
}

function removeBank(id) {
  state.transactions = state.transactions.filter((t) => t.bankId !== id);
  const cardsToRemove = state.cards.filter((c) => c.bankId === id).map((c) => c.id);
  state.cards = state.cards.filter((c) => c.bankId !== id);
  state.invoices = state.invoices.filter((inv) => !cardsToRemove.includes(inv.cardId));
  state.banks = state.banks.filter((b) => b.id !== id);
  state.balanceAdjustments = state.balanceAdjustments.filter((a) => a.bankId !== id);
}

function removeCard(id) {
  state.cards = state.cards.filter((c) => c.id !== id);
  state.invoices = state.invoices.filter((i) => i.cardId !== id);
  state.transactions = state.transactions.map((t) => (t.cardId === id ? { ...t, cardId: '' } : t));
}

function removeCategory(id) {
  state.categories = state.categories.filter((c) => c.id !== id);
  state.transactions = state.transactions.map((t) => (t.categoryId === id ? { ...t, categoryId: '' } : t));
}

function markInvoicePaid(id) {
  const invoice = state.invoices.find((x) => x.id === id);
  if (!invoice || invoice.paid) return;
  invoice.paid = true;
}

function applyTransactionOnBank() {
  // saldo é recalculado no render com base no histórico
}

function toggleTransactionStatus(id) {
  const transaction = state.transactions.find((t) => t.id === id);
  if (!transaction) return;

  if (transaction.status === 'paid') {
    applyTransactionOnBank(transaction, 'remove');
    transaction.status = 'pending';
    return;
  }

  applyTransactionOnBank(transaction, 'add');
  transaction.status = 'paid';
}

document.body.addEventListener('click', (event) => {
  const btn = event.target.closest('button[data-action]');
  if (!btn) return;
  const { action, id } = btn.dataset;

  if (action === 'remove-transaction') removeTransaction(id);
  if (action === 'edit-transaction') openEditTransactionModal(id);
  if (action === 'remove-bank') removeBank(id);
  if (action === 'adjust-bank-balance') addBankBalanceAdjustment(id);
  if (action === 'remove-card') removeCard(id);
  if (action === 'remove-invoice') state.invoices = state.invoices.filter((i) => i.id !== id);
  if (action === 'remove-category') removeCategory(id);
  if (action === 'pay-invoice') markInvoicePaid(id);
  if (action === 'toggle-transaction-status') toggleTransactionStatus(id);

  if (action === 'edit-transaction') return;

  saveState();
  render();
});

function bindForms() {
  document.getElementById('transaction-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const data = new FormData(e.target);
    const amount = Number(data.get('amount'));
    const type = data.get('type');
    const bankId = data.get('bank');
    const rawStatus = data.get('status');
    const paymentMethod = data.get('paymentMethod');
    const isCreditCardPurchase = type === 'expense' && paymentMethod === 'credit_card';
    const installments = isCreditCardPurchase ? Math.max(1, Number(data.get('installments')) || 1) : 1;
    const status = isCreditCardPurchase ? 'pending' : rawStatus;

    const transaction = {
      id: crypto.randomUUID(),
      description: data.get('description').trim(),
      amount,
      type,
      categoryId: data.get('category'),
      bankId,
      date: data.get('date'),
      status,
      paymentMethod,
      cardId: isCreditCardPurchase ? data.get('cardId') : '',
      installments
    };

    state.transactions.push(transaction);

    if (isCreditCardPurchase) {
      createInvoicesForCardPurchase(transaction);
    }

    e.target.reset();
    syncTransactionFormControls();
    saveState();
    render();
  });

  document.getElementById('transaction-form').querySelector('select[name="type"]').addEventListener('change', () => {
    syncTransactionFormControls();
  });

  document.getElementById('transaction-payment-method').addEventListener('change', () => {
    syncTransactionFormControls();
  });

  document.getElementById('bank-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const data = new FormData(e.target);
    const initialBalance = Number(data.get('balance'));
    state.banks.push({ id: crypto.randomUUID(), name: data.get('name').trim(), openingBalance: initialBalance, balance: initialBalance });
    e.target.reset();
    saveState();
    render();
  });

  document.getElementById('card-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const data = new FormData(e.target);
    state.cards.push({
      id: crypto.randomUUID(),
      name: data.get('name').trim(),
      bankId: data.get('bank'),
      limit: Number(data.get('limit')),
      dueDay: Math.max(1, Math.min(28, Number(data.get('dueDay')) || 10))
    });
    e.target.reset();
    saveState();
    render();
  });

  document.getElementById('category-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const data = new FormData(e.target);
    state.categories.push({ id: crypto.randomUUID(), name: data.get('name').trim(), type: data.get('type') });
    e.target.reset();
    saveState();
    render();
  });

  const editForm = document.getElementById('edit-transaction-form');
  document.getElementById('edit-transaction-close').addEventListener('click', closeEditTransactionModal);
  document.getElementById('edit-transaction-cancel').addEventListener('click', closeEditTransactionModal);
  document.getElementById('edit-transaction-modal').addEventListener('click', (event) => {
    if (event.target.id === 'edit-transaction-modal') closeEditTransactionModal();
  });

  editForm.querySelector('select[name="type"]').addEventListener('change', () => {
    syncEditTransactionFormControls();
  });

  document.getElementById('edit-transaction-payment-method').addEventListener('change', () => {
    syncEditTransactionFormControls();
  });

  editForm.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!editingTransactionId) return;

    const current = state.transactions.find((t) => t.id === editingTransactionId);
    if (!current) return;

    const data = new FormData(editForm);
    const amount = Number(data.get('amount'));
    const type = data.get('type');
    const paymentMethod = data.get('paymentMethod');
    const isCreditCardPurchase = type === 'expense' && paymentMethod === 'credit_card';
    const installments = isCreditCardPurchase ? Math.max(1, Number(data.get('installments')) || 1) : 1;

    if (current.paymentMethod === 'credit_card') {
      removeInvoiceItemsBySourceTransaction(current.id);
    }

    current.description = data.get('description').trim();
    current.amount = amount;
    current.type = type;
    current.categoryId = data.get('category');
    current.bankId = data.get('bank');
    current.date = data.get('date');
    current.paymentMethod = paymentMethod;
    current.cardId = isCreditCardPurchase ? data.get('cardId') : '';
    current.installments = installments;
    current.status = isCreditCardPurchase ? 'pending' : data.get('status');

    if (isCreditCardPurchase) {
      createInvoicesForCardPurchase(current);
    }

    saveState();
    render();
    closeEditTransactionModal();
  });

}

function render() {
  recalculateBankBalances();
  updateTheme();
  renderDashboard();
  renderSelects();
  renderTransactions();
  renderStatement();
  renderBanksAndCards();
  renderCategories();
}

function initThemeToggle() {
  document.getElementById('theme-toggle').addEventListener('click', () => {
    state.theme = state.theme === 'dark' ? 'light' : 'dark';
    saveState();
    updateTheme();
  });
}

bindNav();
bindForms();
initThemeToggle();
syncTransactionFormControls();
render();

if (localStorage.getItem(CLOUD_CONFIG_KEY)) {
  initCloud().then(() => renderCloudStatus());
}
