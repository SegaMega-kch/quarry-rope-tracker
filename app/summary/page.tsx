import { Search, TrackerPage } from "../TrackerPage";

export default async function SummaryPage({ searchParams }: { searchParams: Promise<Search> }) {
  return <TrackerPage activeModule="summary" searchParams={await searchParams} />;
}
