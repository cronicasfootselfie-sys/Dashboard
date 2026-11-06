export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { adminDb } from "@/lib/server/firebaseAdmin";
import { listPhotos, parsePageSize } from "@/lib/server/data";
import { errorResponse, HttpError, jsonResponse, requireAdmin } from "@/lib/server/requireAdmin";

/**
 * GET /api/photos?profileId=...&limit=20&cursor=<photoId>
 * → { photos: [...], nextCursor: string | null }
 */
export async function GET(req: Request) {
  try {
    await requireAdmin(req);
    const params = new URL(req.url).searchParams;
    const profileId = params.get("profileId")?.trim();
    if (!profileId) throw new HttpError(400, "MISSING_PROFILE_ID");

    const result = await listPhotos(adminDb(), {
      profileId,
      pageSize: parsePageSize(params.get("limit")),
      cursor: params.get("cursor"),
    });
    return jsonResponse(result);
  } catch (e) {
    return errorResponse(e);
  }
}
