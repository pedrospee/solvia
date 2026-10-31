import type { AccountKindJson, CurrencyJson } from "@solvia/contracts";

// UI texts in Brazilian Portuguese (ADR-0005, D8).
export const kindLabels: Readonly<Record<AccountKindJson, string>> = {
  BANK: "Conta bancária",
  WISE: "Wise",
  CASH: "Dinheiro",
  INVESTMENT: "Investimento",
  CREDIT_CARD: "Cartão de crédito",
  LOAN: "Empréstimo",
  FINANCING: "Financiamento",
  INFORMAL_DEBT: "Dívida informal",
  PERSONAL_DEBT: "Dívida pessoal",
  OTHER_LIABILITY: "Outra dívida",
};

export const currencyLabels: Readonly<Record<CurrencyJson, string>> = {
  EUR: "Euro (€)",
  BRL: "Real (R$)",
};

export const texts = {
  list: {
    title: "Contas",
    newAccount: "Nova conta",
    showArchived: "Mostrar arquivadas",
    assets: "Contas e investimentos",
    liabilities: "Cartões e dívidas",
    loading: "Carregando contas…",
    empty: "Nenhuma conta cadastrada ainda. Cadastre a primeira para começar.",
    emptyGroup: "Nenhuma conta neste grupo.",
    archived: "Arquivada",
    columns: {
      name: "Nome",
      institution: "Instituição",
      kind: "Tipo",
      currency: "Moeda",
      balance: "Saldo",
      owed: "Valor devido",
    },
  },
  balance: {
    loading: "Calculando…",
    unavailable: "Saldo indisponível",
    overdraftUsed: (used: string, limit: string) => `Cheque especial: ${used} de ${limit} em uso`,
    overdraftExceeded: (exceeded: string) => `Limite excedido em ${exceeded}`,
    available: (amount: string) => `Disponível com o limite: ${amount}`,
  },
  form: {
    name: "Nome",
    institution: "Instituição (opcional)",
    kind: "Tipo",
    currency: "Moeda",
    overdraftLimit: "Limite do cheque especial (opcional)",
    overdraftHint: "Ex.: 1.500,00. Deixe vazio se a conta não tem cheque especial.",
    fixedKindAndCurrency: "O tipo e a moeda não mudam depois do cadastro.",
    nameRequired: "Informe o nome da conta.",
    amountInvalid: "Use o formato 1.234,56, com vírgula antes dos centavos.",
    amountTooManyDecimals: "Use no máximo duas casas decimais.",
  },
  create: {
    title: "Nova conta",
    submit: "Cadastrar conta",
    pending: "Cadastrando…",
    cancel: "Cancelar",
  },
  details: {
    back: "Voltar para as contas",
    loading: "Carregando conta…",
    balanceTitle: "Saldo",
    owedTitle: "Valor devido",
    editTitle: "Dados da conta",
    save: "Salvar alterações",
    saving: "Salvando…",
    saved: "Alterações salvas.",
    archivedOn: (date: string) => `Conta arquivada em ${date}.`,
    lifecycleTitle: "Arquivar ou excluir",
    archive: "Arquivar conta",
    unarchive: "Desarquivar conta",
    archiveHint:
      "Uma conta arquivada sai da lista, mas o saldo e as transações dela continuam valendo.",
    delete: "Excluir conta",
    deleteQuestion:
      "Excluir esta conta definitivamente? Só é possível se ela não tiver transações.",
    deleteConfirm: "Sim, excluir",
    deleteCancel: "Não, manter",
  },
} as const;
