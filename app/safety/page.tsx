import { Search, TrackerPage } from "@/app/TrackerPage";

export default async function SafetyPage({ searchParams }: { searchParams: Promise<Search> }) {
  return <TrackerPage activeModule="safety" searchParams={await searchParams} />;
}
