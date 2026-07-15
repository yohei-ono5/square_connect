import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useItems } from "../store/ItemsContext";

export function QuickRegisterPage() {
  const { addItem } = useItems();
  const navigate = useNavigate();
  const [title, setTitle] = useState("");
  const [price, setPrice] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const canSubmit = title.trim().length > 0 && price.trim().length > 0 && !submitting;

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    // 本実装ではここでWorkerを呼び、SKU重複チェック→Square非公開作成を行う。今はモックなので同期的に作成する。
    addItem({ title: title.trim(), price: Number(price) });
    navigate("/");
  }

  return (
    <div className="screen">
      <div className="header">
        <Link to="/" className="back-link">
          ← 下書き一覧に戻る
        </Link>
        <h1>クイック登録</h1>
        <p className="subtitle">商品名と金額だけでSquareへ非公開登録します。SKUは自動採番されます。</p>
      </div>

      <form className="content" onSubmit={handleSubmit}>
        <div className="field">
          <label htmlFor="title">商品名</label>
          <input
            id="title"
            className="input"
            placeholder="例：ディズニー Tシャツ"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            autoFocus
          />
        </div>
        <div className="field">
          <label htmlFor="price">金額（円）</label>
          <input
            id="price"
            className="input"
            type="number"
            min={0}
            placeholder="例：3000"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
          />
        </div>
        <button type="submit" className="btn btn-primary btn-block" disabled={!canSubmit}>
          登録
        </button>
        <p className="hint">
          ブランド・カテゴリ・サイズ・写真・採寸・コンディションはあとから商品詳細編集画面で追加できます。
        </p>
      </form>
    </div>
  );
}
