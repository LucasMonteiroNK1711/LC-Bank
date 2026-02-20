# LC Bank - Gerenciador Financeiro

Aplicação web responsiva para controle de finanças pessoais com foco em UX de banco digital.

## Funcionalidades

- Dashboard inicial com métricas de saldo atual, receitas/despesas pagas e saldo previsto do mês.
- Cadastro de despesas e receitas com data, categoria, banco e status (pago/pendente).
- Edição de movimentações por modal (botão **Editar** na lista de movimentações).
- Opção de forma de pagamento nas movimentações (débito/PIX/transferência ou cartão de crédito).
- Compras no cartão geram faturas automaticamente e parcelamentos criam lançamentos para os meses subsequentes.
- Cada cartão tem dia de vencimento; o fechamento é automático em 5 dias antes do vencimento (ex.: vencimento dia 10, compras até dia 05 entram na próxima fatura dia 10; após isso, vão para a fatura do mês seguinte).
- Tela de extrato consolidando movimentações e faturas.
- Filtros no extrato por mês, tipo (despesa/receita) e categoria.
- Seletor de mês no dashboard para análise mensal dos indicadores.
- Dashboard com gráfico de linha da evolução mês a mês do resultado (sobrou/faltou no fechamento).
- Dashboard com visão de saldo por banco.
- Cadastro de bancos e cartões de crédito.
- Sistema de faturas por cartão com ação "Marcar paga" que desconta automaticamente do saldo do banco, sem necessidade de cadastro manual de fatura.
- Botão de ajuste de saldo por banco informando o novo saldo desejado; o sistema calcula automaticamente a diferença e registra no extrato.
- Cadastro e remoção de categorias.
- Tema dark/light.
- Persistência local com `localStorage` e opção de sincronização em nuvem (Firebase Firestore + login Google) para acessar os dados em múltiplos dispositivos.

## Como executar

Como é um app estático, basta abrir o `index.html` ou servir com:

```bash
python3 -m http.server 4173
```

Depois acesse `http://localhost:4173`.

## Sincronização em nuvem (multi-dispositivo)

1. Crie um projeto no [Firebase Console](https://console.firebase.google.com/).
2. Ative **Authentication > Google** e **Firestore Database**.
3. Em **Project settings > Your apps > Web app**, copie o objeto de configuração JSON.
4. No Dashboard do LC Bank, clique em **Conectar nuvem** e cole esse JSON.
5. Faça login com sua conta Google.

Após conectar, os dados passam a sincronizar automaticamente com o Firestore e você pode abrir o app no celular/tablet/computador usando a mesma conta.

> Para melhorar performance em celular, os SDKs do Firebase agora são carregados sob demanda (somente quando a nuvem está configurada/conectada).


## Publicação do projeto (GitHub Pages)

Este repositório já inclui workflow para deploy automático em **GitHub Pages** (`.github/workflows/deploy-pages.yml`).

### Passo a passo

1. Suba este projeto para um repositório no GitHub.
2. Em **Settings > Pages**, deixe a origem como **GitHub Actions**.
3. Faça push para a branch `main` (ou `work`, conforme workflow).
4. Aguarde o workflow **Deploy LC Bank to GitHub Pages** concluir.
5. A URL publicada ficará em `https://SEU_USUARIO.github.io/NOME_DO_REPO/`.

### Importante (para login Google/Firebase)

Se você ativar sincronização em nuvem, adicione o domínio do GitHub Pages em:

- **Firebase Authentication > Settings > Authorized domains**
- e confirme que o mesmo domínio está permitido na configuração do projeto Firebase.

Sem isso, o login Google pode falhar em produção.
