const STORAGE_KEY = 'lc-bank-data-v1';

const defaultState = {
  theme: 'dark',
  banks: [{ id: crypto.randomUUID(), name: 'Banco Principal', balance: 4500 }],
  cards: [],
  invoices: [],
  categories: [
    { id: crypto.randomUUID(), name: 'Moradia', type: 'expense' },
    { id: crypto.randomUUID(), name: 'Alimentação', type: 'expense' },
    { id: crypto.randomUUID(), name: 'Salário', type: 'income' }
  ],
  transactions: []
};

let state = loadState();

function loadState() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return structuredClone(defaultState);
  try {
    return { ...structuredClone(defaultState), ...JSON.parse(raw) };
  } catch {
    return structuredClone(defaultState);
  }
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

function fmtMoney(v) {
  return BRL.format(Number(v) || 0);
}

function totals() {
  const paidIncome = state.transactions
    .filter((t) => t.type === 'income' && t.status === 'paid')
    .reduce((sum, t) => sum + t.amount, 0);

  const paidExpense = state.transactions
    .filter((t) => t.type === 'expense' && t.status === 'paid')
    .reduce((sum, t) => sum + t.amount, 0);

  const pendingIncome = state.transactions
    .filter((t) => t.type === 'income' && t.status === 'pending')
    .reduce((sum, t) => sum + t.amount, 0);

  const pendingExpense = state.transactions
    .filter((t) => t.type === 'expense' && t.status === 'pending')
    .reduce((sum, t) => sum + t.amount, 0);

  const bankBalance = state.banks.reduce((sum, b) => sum + b.balance, 0);
  const unpaidInvoices = state.invoices.filter((inv) => !inv.paid).reduce((sum, inv) => sum + inv.amount, 0);

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
  const t = totals();
  document.getElementById('dashboard').innerHTML = `
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
        <h3>Destaques</h3>
        <p>${state.transactions.length} movimentações cadastradas</p>
        <p>${state.banks.length} bancos e ${state.cards.length} cartões vinculados</p>
        <p>${state.categories.length} categorias disponíveis</p>
      </section>
    </div>
  `;
}

function renderSelects() {
  document.getElementById('transaction-category').innerHTML = optionHTML(
    state.categories,
    (c) => `<option value="${c.id}">${c.name} (${c.type === 'expense' ? 'Despesa' : 'Receita'})</option>`
  );

  const bankOptions = optionHTML(state.banks, (b) => `<option value="${b.id}">${b.name}</option>`);
  document.getElementById('transaction-bank').innerHTML = bankOptions;
  document.getElementById('card-bank').innerHTML = bankOptions;

  document.getElementById('invoice-card').innerHTML = optionHTML(
    state.cards,
    (c) => `<option value="${c.id}">${c.name}</option>`
  );
}

function getCategoryName(id) {
  return state.categories.find((c) => c.id === id)?.name ?? 'Sem categoria';
}

function getBankName(id) {
  return state.banks.find((b) => b.id === id)?.name ?? 'Sem banco';
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
          <div class="meta">${t.type === 'expense' ? 'Despesa' : 'Receita'} • ${t.status === 'paid' ? 'Pago/Recebido' : 'Pendente'}</div>
        </div>
        <div class="list-actions">
          <strong>${fmtMoney(t.amount)}</strong>
          <button class="danger small" data-action="remove-transaction" data-id="${t.id}">Remover</button>
        </div>
      </article>`
    )
    .join('');
}

function renderStatement() {
  const list = document.getElementById('statement-list');
  const entries = [
    ...state.transactions.map((t) => ({
      id: `t-${t.id}`,
      date: t.date,
      text: `${t.type === 'expense' ? 'Despesa' : 'Receita'}: ${t.description}`,
      value: t.type === 'expense' ? -t.amount : t.amount,
      status: t.status === 'paid' ? 'Compensado' : 'Previsto'
    })),
    ...state.invoices.map((i) => ({
      id: `i-${i.id}`,
      date: i.dueDate,
      text: `Fatura ${getCardName(i.cardId)}`,
      value: -i.amount,
      status: i.paid ? 'Paga' : 'Em aberto'
    }))
  ].sort((a, b) => b.date.localeCompare(a.date));

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
        <strong style="color:${e.value < 0 ? 'var(--danger)' : 'var(--success)'}">${fmtMoney(e.value)}</strong>
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
        <button class="danger small" data-action="remove-bank" data-id="${b.id}">Remover</button>
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
            <div class="meta">${getBankName(c.bankId)} • Limite ${fmtMoney(c.limit)}</div>
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
}

function removeBank(id) {
  state.transactions = state.transactions.filter((t) => t.bankId !== id);
  const cardsToRemove = state.cards.filter((c) => c.bankId === id).map((c) => c.id);
  state.cards = state.cards.filter((c) => c.bankId !== id);
  state.invoices = state.invoices.filter((inv) => !cardsToRemove.includes(inv.cardId));
  state.banks = state.banks.filter((b) => b.id !== id);
}

function removeCard(id) {
  state.cards = state.cards.filter((c) => c.id !== id);
  state.invoices = state.invoices.filter((i) => i.cardId !== id);
}

function removeCategory(id) {
  state.categories = state.categories.filter((c) => c.id !== id);
  state.transactions = state.transactions.map((t) => (t.categoryId === id ? { ...t, categoryId: '' } : t));
}

function markInvoicePaid(id) {
  const invoice = state.invoices.find((x) => x.id === id);
  if (!invoice || invoice.paid) return;
  const card = state.cards.find((c) => c.id === invoice.cardId);
  if (!card) return;
  const bank = state.banks.find((b) => b.id === card.bankId);
  if (!bank) return;

  bank.balance -= invoice.amount;
  invoice.paid = true;
}

document.body.addEventListener('click', (event) => {
  const btn = event.target.closest('button[data-action]');
  if (!btn) return;
  const { action, id } = btn.dataset;

  if (action === 'remove-transaction') removeTransaction(id);
  if (action === 'remove-bank') removeBank(id);
  if (action === 'remove-card') removeCard(id);
  if (action === 'remove-invoice') state.invoices = state.invoices.filter((i) => i.id !== id);
  if (action === 'remove-category') removeCategory(id);
  if (action === 'pay-invoice') markInvoicePaid(id);

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
    const status = data.get('status');

    state.transactions.push({
      id: crypto.randomUUID(),
      description: data.get('description').trim(),
      amount,
      type,
      categoryId: data.get('category'),
      bankId,
      date: data.get('date'),
      status
    });

    if (status === 'paid') {
      const bank = state.banks.find((b) => b.id === bankId);
      if (bank) {
        bank.balance += type === 'income' ? amount : -amount;
      }
    }

    e.target.reset();
    saveState();
    render();
  });

  document.getElementById('bank-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const data = new FormData(e.target);
    state.banks.push({ id: crypto.randomUUID(), name: data.get('name').trim(), balance: Number(data.get('balance')) });
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
      limit: Number(data.get('limit'))
    });
    e.target.reset();
    saveState();
    render();
  });

  document.getElementById('invoice-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const data = new FormData(e.target);
    state.invoices.push({
      id: crypto.randomUUID(),
      cardId: data.get('card'),
      amount: Number(data.get('amount')),
      dueDate: data.get('dueDate'),
      paid: false
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
}

function render() {
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
render();
