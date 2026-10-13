export type ProductionAccessActor = { login: string; role: string };

const fourthShiftLogin = "4 смена";

/** Access is intentionally account-specific: the shift role by itself is not enough. */
export function canUseProduction(actor: ProductionAccessActor) {
  return actor.role === "admin" || actor.login === fourthShiftLogin;
}
