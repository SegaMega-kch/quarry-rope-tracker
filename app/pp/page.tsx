import { Search, TrackerPage } from "../TrackerPage";

export default async function PpPage({ searchParams }: { searchParams: Promise<Search> }) {
  return <TrackerPage activeModule="pp" searchParams={await searchParams} />;
}
