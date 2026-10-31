import type { CategoryNatureJson } from "@solvia/contracts";

// UI texts in Brazilian Portuguese (ADR-0005, D8).
export const natureLabels: Readonly<Record<CategoryNatureJson, string>> = {
  INCOME: "Receita",
  EXPENSE: "Despesa",
};

export const groupTitles: Readonly<Record<CategoryNatureJson, string>> = {
  INCOME: "Receitas",
  EXPENSE: "Despesas",
};

export const texts = {
  list: {
    title: "Categorias",
    newCategory: "Nova categoria",
    addChild: (parent: string) => `Adicionar subcategoria em ${parent}`,
    addChildShort: "+ subcategoria",
    loading: "Carregando categorias…",
    empty: "Nenhuma categoria cadastrada ainda. Cadastre a primeira para começar.",
    emptyGroup: "Nenhuma categoria neste grupo.",
  },
  form: {
    name: "Nome",
    nature: "Tipo",
    parent: "Categoria principal",
    noParent: "Nenhuma (esta é uma categoria principal)",
    archivedParent: (name: string) => `${name} (arquivada)`,
    parentHint: "Uma subcategoria tem o mesmo tipo da categoria principal.",
    fixedNature: "O tipo não muda depois do cadastro.",
    hasChildren:
      "Esta categoria tem subcategorias, então não pode virar subcategoria: são no máximo dois níveis.",
    nameRequired: "Informe o nome da categoria.",
  },
  create: {
    title: "Nova categoria",
    submit: "Cadastrar categoria",
    pending: "Cadastrando…",
    cancel: "Cancelar",
  },
  details: {
    back: "Voltar para as categorias",
    loading: "Carregando categoria…",
    childOf: "Subcategoria de",
    childrenTitle: "Subcategorias",
    editTitle: "Dados da categoria",
    save: "Salvar alterações",
    saving: "Salvando…",
    saved: "Alterações salvas.",
    archivedOn: (date: string) => `Categoria arquivada em ${date}.`,
  },
  lifecycle: {
    title: "Arquivar ou excluir",
    hint: "Uma categoria arquivada sai da lista e não é oferecida em novas transações; as transações antigas continuam com ela.",
    archive: "Arquivar categoria",
    unarchive: "Desarquivar categoria",
    delete: "Excluir categoria",
    deleteQuestion:
      "Excluir esta categoria definitivamente? Só é possível se ela não tiver subcategorias nem transações.",
  },
} as const;
