import { Search, TrackerPage } from "@/app/TrackerPage";

export default async function RopePage({ searchParams }: { searchParams: Promise<Search> }) {
  return <TrackerPage activeModule="rope" searchParams={await searchParams} />;
}
