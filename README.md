# LC Bank - Gerenciador Financeiro

Aplicação web responsiva para controle de finanças pessoais com foco em UX de banco digital.

## Funcionalidades

- Dashboard inicial com métricas de saldo atual, receitas/despesas pagas e saldo previsto do mês.
- Cadastro de despesas e receitas com data, categoria, banco e status (pago/pendente).
- Tela de extrato consolidando movimentações e faturas.
- Cadastro de bancos e cartões de crédito.
- Sistema de faturas por cartão com ação "Marcar paga" que desconta automaticamente do saldo do banco.
- Cadastro e remoção de categorias.
- Tema dark/light.
- Persistência local com `localStorage`.

## Como executar

Como é um app estático, basta abrir o `index.html` ou servir com:

```bash
python3 -m http.server 4173
```

Depois acesse `http://localhost:4173`.
