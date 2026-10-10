export function isMobilePhotoRequest(request: Request) {
  if (request.headers.get("x-rapmas-mobile-photo") !== "1") return false;
  const hint = request.headers.get("sec-ch-ua-mobile");
  const agent = request.headers.get("user-agent") ?? "";
  return hint === "?1" || /Android|iPhone|iPad|iPod|Mobile|Tablet/i.test(agent) || (/Macintosh/i.test(agent) && hint !== "?0");
}
