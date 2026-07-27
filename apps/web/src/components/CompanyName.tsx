import { useItems } from "../store/ItemsContext";

export function CompanyName() {
  const { companyName } = useItems();
  if (!companyName) return null;

  return <p className="company-name">{companyName}</p>;
}
