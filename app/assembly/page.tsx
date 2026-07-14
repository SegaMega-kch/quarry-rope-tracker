import { Search, TrackerPage } from "@/app/TrackerPage";

export default async function AssemblyPage({ searchParams }: { searchParams: Promise<Search> }) {
  return <TrackerPage activeModule="assembly" searchParams={await searchParams} />;
}
