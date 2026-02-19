# LC Bank - Gerenciador Financeiro

Aplicação web responsiva para controle de finanças pessoais com foco em UX de banco digital.

## Funcionalidades

- Dashboard inicial com métricas de saldo atual, receitas/despesas pagas e saldo previsto do mês.
- Cadastro de despesas e receitas com data, categoria, banco e status (pago/pendente).
- Opção de forma de pagamento nas movimentações (débito/PIX/transferência ou cartão de crédito).
- Compras no cartão geram faturas automaticamente e parcelamentos criam lançamentos para os meses subsequentes.
- Cada cartão tem dia de vencimento; o fechamento é automático em 5 dias antes do vencimento (ex.: vencimento dia 10, compras até dia 05 entram na próxima fatura dia 10; após isso, vão para a fatura do mês seguinte).
- Tela de extrato consolidando movimentações e faturas.
- Cadastro de bancos e cartões de crédito.
- Sistema de faturas por cartão com ação "Marcar paga" que desconta automaticamente do saldo do banco, sem necessidade de cadastro manual de fatura.
- Botão de ajuste manual de saldo por banco, registrando o ajuste no extrato.
- Cadastro e remoção de categorias.
- Tema dark/light.
- Persistência local com `localStorage`.

## Como executar

Como é um app estático, basta abrir o `index.html` ou servir com:

```bash
python3 -m http.server 4173
```

Depois acesse `http://localhost:4173`.
