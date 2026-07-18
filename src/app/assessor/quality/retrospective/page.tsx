import AuditTypeView from "../audit-view";

export const dynamic = "force-dynamic";
type SearchParams = Promise<{ c?: string }>;

export default async function RetrospectiveReviewsPage({ searchParams }: { searchParams: SearchParams }) {
  const { c } = await searchParams;
  return <AuditTypeView type="retrospective" preselect={c} />;
}
