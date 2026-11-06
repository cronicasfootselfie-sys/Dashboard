export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { adminDb } from "@/lib/server/firebaseAdmin";
import { listPatients } from "@/lib/server/data";
import { errorResponse, jsonResponse, requireAdmin } from "@/lib/server/requireAdmin";

/** GET /api/patients → { patients: [{ userId, profileId, redcapCode }] } */
export async function GET(req: Request) {
  try {
    await requireAdmin(req);
    const patients = await listPatients(adminDb());
    return jsonResponse({ patients });
  } catch (e) {
    return errorResponse(e);
  }
}
