import { HashRouter, Route, Routes } from "react-router-dom";
import { ItemsProvider } from "./store/ItemsContext";
import { ItemListPage } from "./pages/ItemListPage";
import { QuickRegisterPage } from "./pages/QuickRegisterPage";
import { ItemDetailPage } from "./pages/ItemDetailPage";

export function App() {
  return (
    <ItemsProvider>
      <HashRouter>
        <Routes>
          <Route path="/" element={<ItemListPage />} />
          <Route path="/items/new" element={<QuickRegisterPage />} />
          <Route path="/items/:id" element={<ItemDetailPage />} />
        </Routes>
      </HashRouter>
    </ItemsProvider>
  );
}
