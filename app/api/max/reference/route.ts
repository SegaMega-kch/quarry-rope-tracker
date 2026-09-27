import { loadReferenceConfig, readReferenceSecret } from "../../../../lib/max-reference-config";
import { openReferenceState } from "../../../../lib/max-reference-state";
import { handleReferenceWebhook } from "../../../../lib/max-reference-webhook";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const path = process.env.MAX_REFERENCE_CONFIG;
  if (!path) return new Response(null, { status: 404 });
  try {
    const config = loadReferenceConfig(path);
    return await handleReferenceWebhook(request, readReferenceSecret(config), config,
      () => openReferenceState(config.stateDatabase, config));
  } catch { return new Response(null, { status: 503 }); }
}
