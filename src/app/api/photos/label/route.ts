export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { adminDb } from "@/lib/server/firebaseAdmin";
import { labelPhoto } from "@/lib/server/data";
import { errorResponse, HttpError, jsonResponse, requireAdmin } from "@/lib/server/requireAdmin";

/**
 * POST /api/photos/label  { photoId, isCorrectFoot }
 * → { id, trainingLabels, trainingLabelStatus }
 * El voto se registra con el email del token, no con datos que mande el navegador.
 */
export async function POST(req: Request) {
  try {
    const user = await requireAdmin(req);

    const body = await req.json().catch(() => null);
    const photoId = typeof body?.photoId === "string" ? body.photoId.trim() : "";
    if (!photoId || photoId.includes("/")) throw new HttpError(400, "BAD_PHOTO_ID");
    if (typeof body?.isCorrectFoot !== "boolean") throw new HttpError(400, "BAD_VOTE");

    const result = await labelPhoto(adminDb(), user, photoId, body.isCorrectFoot);
    return jsonResponse(result);
  } catch (e) {
    return errorResponse(e);
  }
}
