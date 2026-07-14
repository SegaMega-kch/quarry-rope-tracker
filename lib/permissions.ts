const elevatedRoles = new Set(["boss", "storekeeper", "admin"]);

export function canWriteOff(role: string) {
  return elevatedRoles.has(role);
}

export function canExport(role: string) {
  return elevatedRoles.has(role);
}

export function canManageLocations(role: string) {
  return role === "storekeeper" || role === "admin";
}

export function canManageRequests(role: string) {
  return role === "boss" || role === "admin";
}
