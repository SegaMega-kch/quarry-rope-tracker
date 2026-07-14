import { Search, TrackerPage } from "@/app/TrackerPage";

export default async function ToothPage({ searchParams }: { searchParams: Promise<Search> }) {
  return <TrackerPage activeModule="tooth" searchParams={await searchParams} />;
}
