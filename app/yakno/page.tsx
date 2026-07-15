import { Search, TrackerPage } from "../TrackerPage";

export default async function YaknoPage({ searchParams }: { searchParams: Promise<Search> }) {
  return <TrackerPage activeModule="yakno" searchParams={await searchParams} />;
}
