import { Navigate, Route, Routes } from "react-router";
import { AccountDetails } from "./accounts/account-details.tsx";
import { AccountList } from "./accounts/account-list.tsx";
import { NewAccount } from "./accounts/new-account.tsx";
import { CategoryDetails } from "./categories/category-details.tsx";
import { CategoryList } from "./categories/category-list.tsx";
import { NewCategory } from "./categories/new-category.tsx";
import { Layout } from "./layout/layout.tsx";
import { NotFound } from "./layout/not-found.tsx";

// URLs are in pt-BR like the rest of the UI (ADR-0005, D5, D8).
export function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Navigate to="/contas" replace />} />
        <Route path="contas" element={<AccountList />} />
        <Route path="contas/nova" element={<NewAccount />} />
        <Route path="contas/:id" element={<AccountDetails />} />
        <Route path="categorias" element={<CategoryList />} />
        <Route path="categorias/nova" element={<NewCategory />} />
        <Route path="categorias/:id" element={<CategoryDetails />} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}
