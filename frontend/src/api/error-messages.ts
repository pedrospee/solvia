import { ApiRequestError } from "./call-api.ts";

const UNREACHABLE = "Não foi possível conectar à API. Verifique se ela está rodando (npm run dev).";

// What the user reads for each stable API code (ADR-0003), in pt-BR (ADR-0005, D8). The API's
// own messages are in English and meant for developers; screens never show them.
const messages: Readonly<Record<string, string>> = {
  NETWORK_ERROR: UNREACHABLE,
  UNEXPECTED_RESPONSE: UNREACHABLE,
  INTERNAL_ERROR: "A API encontrou um erro inesperado. Tente novamente.",
  VALIDATION_FAILED: "Algum campo não está no formato esperado.",
  INVALID_REQUEST: "A API não conseguiu ler a requisição.",
  PAYLOAD_TOO_LARGE: "Os dados enviados são grandes demais.",
  HOST_NOT_ALLOWED: "A API recusou o acesso. Abra o Solvia pelo endereço local (127.0.0.1).",
  ORIGIN_NOT_ALLOWED: "A API recusou o acesso. Abra o Solvia pelo endereço local (127.0.0.1).",
  ROUTE_NOT_FOUND: "A API não reconhece esta operação.",
  ACCOUNT_NOT_FOUND: "Conta não encontrada. Ela pode ter sido excluída.",
  ACCOUNT_IN_USE:
    "Esta conta tem transações e não pode ser excluída. Arquive-a: ela sai da lista e o histórico é mantido.",
  CATEGORY_NOT_FOUND: "Categoria não encontrada. Ela pode ter sido excluída.",
  CATEGORY_IN_USE:
    "Esta categoria tem transações e não pode ser excluída. Arquive-a: ela deixa de ser oferecida e o histórico é mantido.",
  CATEGORY_HAS_CHILDREN:
    "Esta categoria tem subcategorias e não pode ser excluída. Exclua ou mova as subcategorias antes.",
  CATEGORY_HAS_ACTIVE_CHILDREN: "Arquive as subcategorias antes de arquivar a categoria principal.",
  CATEGORY_PARENT_ARCHIVED:
    "A categoria principal está arquivada. Desarquive-a antes, ou escolha outra.",
  INVALID_CATEGORY:
    "A categoria não foi aceita. Confira o nome e a categoria principal: ela precisa ser do mesmo tipo e não pode ser uma subcategoria.",
  INVALID_ACCOUNT:
    "A conta não foi aceita. Confira o nome e o limite do cheque especial: ele só vale para contas bancárias e deve ser maior que zero.",
};

/** The message for a failed call, chosen by its code, never by the API's text. */
export function errorMessage(error: unknown): string {
  if (error instanceof ApiRequestError) {
    return messages[error.code] ?? `Algo deu errado (${error.code}).`;
  }
  return "Algo deu errado.";
}
