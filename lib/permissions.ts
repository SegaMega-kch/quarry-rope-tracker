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

export function canCreateExcavator(role: string) {
  return role === "shift" || canManageLocations(role);
}

export function canManageLocationArchive(role: string) {
  return role === "shift" || canManageLocations(role);
}

export function canManageRopeTypes(role: string) {
  return role === "shift" || canManageLocations(role);
}

export function canManageYakno(role: string) {
  return role === "shift" || canManageLocations(role);
}

export function canManageRequests(role: string) {
  return role === "boss" || role === "admin";
}
