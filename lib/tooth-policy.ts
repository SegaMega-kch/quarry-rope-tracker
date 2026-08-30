export const toothCraneLocation = "Вешала под 30т краном";
export const toothCraneGround = "Земля под 30т краном";

export function shouldScrapUnloadedTeeth(condition: string, locationName?: string | null) {
  return condition === "USED" && locationName === toothCraneLocation;
}
