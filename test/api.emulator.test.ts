// Pruebas de integración de las rutas API contra los emuladores de Firebase.
// Correr con: npm run test:emulators   (requiere firebase-tools y Java 11+)
// Solo se ejecutan si hay emuladores y el proyecto es "demo-*", así nunca tocan producción.
import { beforeAll, describe, expect, it } from "vitest";
import { Timestamp } from "firebase-admin/firestore";

const FS_HOST = process.env.FIRESTORE_EMULATOR_HOST;
const AUTH_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST;
const PROJECT = process.env.GCLOUD_PROJECT ?? "";
const enabled = !!FS_HOST && !!AUTH_HOST && PROJECT.startsWith("demo-");

type Json = any;

async function call(handler: (req: Request) => Promise<Response>, path: string, opts: { token?: string; method?: string; body?: unknown } = {}) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
  const req = new Request(`http://localhost${path}`, {
    method: opts.method ?? "GET",
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  const res = await handler(req);
  return { status: res.status, body: (await res.json()) as Json, headers: res.headers };
}

describe.skipIf(!enabled)("API del dashboard (emuladores)", () => {
  const CUTOFF = new Date("2025-12-18T00:00:00.000Z");
  const tokens: Record<string, string> = {};
  let routes: {
    patients: typeof import("@/app/api/patients/route");
    photos: typeof import("@/app/api/photos/route");
    label: typeof import("@/app/api/photos/label/route");
    redcapReport: typeof import("@/app/api/redcap_report/route");
    redcapLog: typeof import("@/app/api/redcap_log/route");
    redcapReportLegacy: typeof import("@/app/redcap_report/route");
  };

  async function signIn(email: string) {
    const r = await fetch(
      `http://${AUTH_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fake-api-key`,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password: "secret123", returnSecureToken: true }) }
    );
    const j = await r.json();
    if (!j.idToken) throw new Error("signIn falló: " + JSON.stringify(j));
    return j.idToken as string;
  }

  beforeAll(async () => {
    delete process.env.REDCAP_TOKEN; // las rutas REDCap no deben llamar al REDCap real en pruebas

    await fetch(`http://${FS_HOST}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: "DELETE" });
    await fetch(`http://${AUTH_HOST}/emulator/v1/projects/${PROJECT}/accounts`, { method: "DELETE" });

    const { adminAuth, adminDb } = await import("@/lib/server/firebaseAdmin");
    const auth = adminAuth();
    const db = adminDb();

    for (const [uid, email] of [
      ["admin-doc", "coordinadora@upch.pe"],
      ["admin-claim", "claim@upch.pe"],
      ["admin-2", "evaluador@upch.pe"],
      ["paciente", "paciente@gmail.com"],
    ]) {
      await auth.createUser({ uid, email, password: "secret123" });
    }
    await auth.setCustomUserClaims("admin-claim", { admin: true });
    await db.doc("admins/admin-doc").set({ role: "full" });
    await db.doc("admins/admin-2").set({ role: "restricted" });

    // Pacientes
    await db.doc("users/u1").set({ redcap_code: "PA-001" });
    await db.doc("users/u1/profiles/p1a").set({ name: "A" });
    await db.doc("users/u1/profiles/p1b").set({ name: "B" });
    await db.doc("users/u2").set({ redcap_code: " PA-002 " });
    await db.doc("users/u2/profiles/p2").set({});
    await db.doc("users/u3").set({ redcap_code: "PA-003" }); // sin perfiles → no aparece
    await db.doc("users/u4").set({ redcap_code: "" });
    await db.doc("users/u4/profiles/p4").set({});
    await db.doc("users/u5").set({ other: 1 });
    await db.doc("users/u5/profiles/p5").set({});
    await db.doc("users/u6").set({ redcap_code: "PA-001" }); // código repetido
    await db.doc("users/u6/profiles/p6").set({});

    // Fotos: 25 de p1a desde la fecha de corte, 3 anteriores y 2 de p2
    const batch = db.batch();
    for (let i = 0; i < 25; i++) {
      batch.set(db.doc(`photoHistory/ph-${String(i).padStart(2, "0")}`), {
        profileId: "p1a",
        date: Timestamp.fromDate(new Date(CUTOFF.getTime() + (i + 1) * 3_600_000)),
        imageUrl: `https://example.test/${i}.jpg`,
        summary: `foto ${i}`,
      });
    }
    for (let i = 0; i < 3; i++) {
      batch.set(db.doc(`photoHistory/old-${i}`), { profileId: "p1a", date: Timestamp.fromDate(new Date(CUTOFF.getTime() - (i + 1) * 86_400_000)) });
    }
    for (let i = 0; i < 2; i++) {
      batch.set(db.doc(`photoHistory/p2-${i}`), { profileId: "p2", date: Timestamp.fromDate(new Date(CUTOFF.getTime() + 86_400_000)) });
    }
    await batch.commit();

    tokens.adminDoc = await signIn("coordinadora@upch.pe");
    tokens.adminClaim = await signIn("claim@upch.pe");
    tokens.admin2 = await signIn("evaluador@upch.pe");
    tokens.patient = await signIn("paciente@gmail.com");

    routes = {
      patients: await import("@/app/api/patients/route"),
      photos: await import("@/app/api/photos/route"),
      label: await import("@/app/api/photos/label/route"),
      redcapReport: await import("@/app/api/redcap_report/route"),
      redcapLog: await import("@/app/api/redcap_log/route"),
      redcapReportLegacy: await import("@/app/redcap_report/route"),
    };
  });

  describe("control de acceso", () => {
    it("sin token → 401 NO_TOKEN", async () => {
      const r = await call(routes.patients.GET, "/api/patients");
      expect(r).toMatchObject({ status: 401, body: { error: "NO_TOKEN" } });
    });

    it("token inválido → 401 INVALID_TOKEN", async () => {
      const r = await call(routes.patients.GET, "/api/patients", { token: "no-es-un-token" });
      expect(r).toMatchObject({ status: 401, body: { error: "INVALID_TOKEN" } });
    });

    it("usuario sin admins/{uid} ni claim → 403 NOT_ADMIN", async () => {
      const r = await call(routes.patients.GET, "/api/patients", { token: tokens.patient });
      expect(r).toMatchObject({ status: 403, body: { error: "NOT_ADMIN" } });
      const p = await call(routes.photos.GET, "/api/photos?profileId=p1a", { token: tokens.patient });
      expect(p.status).toBe(403);
    });

    it("admin por custom claim también entra", async () => {
      const r = await call(routes.patients.GET, "/api/patients", { token: tokens.adminClaim });
      expect(r.status).toBe(200);
    });

    it("las respuestas no se cachean", async () => {
      const r = await call(routes.patients.GET, "/api/patients", { token: tokens.adminDoc });
      expect(r.headers.get("cache-control")).toContain("no-store");
    });
  });

  describe("GET /api/patients", () => {
    it("devuelve usuarios con código REDCap y su primer perfil", async () => {
      const r = await call(routes.patients.GET, "/api/patients", { token: tokens.adminDoc });
      expect(r.status).toBe(200);
      expect(r.body.patients).toEqual([
        { userId: "u1", profileId: "p1a", redcapCode: "PA-001" },
        { userId: "u6", profileId: "p6", redcapCode: "PA-001" },
        { userId: "u2", profileId: "p2", redcapCode: "PA-002" },
      ]);
    });
  });

  describe("GET /api/photos", () => {
    it("valida parámetros", async () => {
      expect((await call(routes.photos.GET, "/api/photos", { token: tokens.adminDoc })).body.error).toBe("MISSING_PROFILE_ID");
      expect((await call(routes.photos.GET, "/api/photos?profileId=p1a&limit=abc", { token: tokens.adminDoc })).body.error).toBe("BAD_LIMIT");
      const badCursor = await call(routes.photos.GET, "/api/photos?profileId=p1a&cursor=p2-0", { token: tokens.adminDoc });
      expect(badCursor).toMatchObject({ status: 400, body: { error: "BAD_CURSOR" } });
    });

    it("pagina por cursor, en orden descendente y sin fotos anteriores al corte", async () => {
      const seen: string[] = [];
      const sizes: number[] = [];
      let cursor: string | null = null;
      let lastSeconds = Infinity;
      do {
        const q: string = `/api/photos?profileId=p1a&limit=10${cursor ? `&cursor=${cursor}` : ""}`;
        const r = await call(routes.photos.GET, q, { token: tokens.adminDoc });
        expect(r.status).toBe(200);
        sizes.push(r.body.photos.length);
        for (const p of r.body.photos) {
          expect(p.profileId).toBe("p1a");
          expect(typeof p.date.seconds).toBe("number");
          expect(p.date.seconds * 1000).toBeGreaterThanOrEqual(CUTOFF.getTime());
          expect(p.date.seconds).toBeLessThan(lastSeconds);
          lastSeconds = p.date.seconds;
          seen.push(p.id);
        }
        cursor = r.body.nextCursor;
      } while (cursor);

      expect(sizes).toEqual([10, 10, 5]);
      expect(new Set(seen).size).toBe(25);
      expect(seen[0]).toBe("ph-24");
      expect(seen.some((id) => id.startsWith("old-"))).toBe(false);
    });

    it("limita el tamaño de página a 200", async () => {
      const r = await call(routes.photos.GET, "/api/photos?profileId=p1a&limit=5000", { token: tokens.adminDoc });
      expect(r.body.photos).toHaveLength(25);
      expect(r.body.nextCursor).toBeNull();
    });
  });

  describe("POST /api/photos/label", () => {
    const label = (token: string, body: unknown) => call(routes.label.POST, "/api/photos/label", { token, method: "POST", body });

    it("valida el cuerpo y la existencia de la foto", async () => {
      expect((await label(tokens.adminDoc, { photoId: "ph-00" })).body.error).toBe("BAD_VOTE");
      expect((await label(tokens.adminDoc, { photoId: "a/b", isCorrectFoot: true })).body.error).toBe("BAD_PHOTO_ID");
      expect(await label(tokens.adminDoc, { photoId: "no-existe", isCorrectFoot: true })).toMatchObject({ status: 404, body: { error: "PHOTO_NOT_FOUND" } });
      expect((await label(tokens.patient, { photoId: "ph-00", isCorrectFoot: true })).status).toBe(403);
    });

    it("registra votos con el email del token y recalcula el consenso", async () => {
      const first = await label(tokens.adminDoc, { photoId: "ph-00", isCorrectFoot: true, labeledBy: "falso@x.com" });
      expect(first.status).toBe(200);
      expect(Object.keys(first.body.trainingLabels)).toEqual(["coordinadora@upch.pe"]);
      expect(first.body.trainingLabels["coordinadora@upch.pe"]).toMatchObject({ isCorrectFoot: true, labeledBy: "coordinadora@upch.pe", userId: "admin-doc" });
      expect(typeof first.body.trainingLabels["coordinadora@upch.pe"].labeledAt.seconds).toBe("number");
      expect(first.body.trainingLabelStatus).toMatchObject({ consensus: "correct", totalVoters: 1, correctVotes: 1, incorrectVotes: 0, lastLabeledBy: "coordinadora@upch.pe" });

      // Repetir el mismo voto no cambia nada
      const again = await label(tokens.adminDoc, { photoId: "ph-00", isCorrectFoot: true });
      expect(again.body.trainingLabelStatus).toEqual(first.body.trainingLabelStatus);

      // Otro evaluador vota en contra → conflicto
      const second = await label(tokens.admin2, { photoId: "ph-00", isCorrectFoot: false });
      expect(second.body.trainingLabelStatus).toMatchObject({ consensus: "conflict", totalVoters: 2, correctVotes: 1, incorrectVotes: 1, lastLabeledBy: "evaluador@upch.pe" });

      // La primera cambia su voto → todos en contra
      const changed = await label(tokens.adminDoc, { photoId: "ph-00", isCorrectFoot: false });
      expect(changed.body.trainingLabelStatus).toMatchObject({ consensus: "incorrect", totalVoters: 2, correctVotes: 0, incorrectVotes: 2 });

      // Lo guardado es lo que devuelve la galería
      const page = await call(routes.photos.GET, "/api/photos?profileId=p1a&limit=200", { token: tokens.adminDoc });
      const stored = page.body.photos.find((p: Json) => p.id === "ph-00");
      expect(stored.trainingLabelStatus.consensus).toBe("incorrect");
      expect(stored.summary).toBe("foto 0");
    });
  });

  describe("rutas REDCap", () => {
    const cases = [
      ["/api/redcap_report", () => routes.redcapReport.POST],
      ["/api/redcap_log", () => routes.redcapLog.POST],
      ["/redcap_report", () => routes.redcapReportLegacy.POST],
    ] as const;

    for (const [path, handler] of cases) {
      it(`${path}: exige sesión de administrador`, async () => {
        const body = { reportId: "1219" };
        expect((await call(handler(), path, { method: "POST", body })).status).toBe(401);
        expect((await call(handler(), path, { method: "POST", body, token: tokens.patient })).status).toBe(403);
        // Con admin pasa el control y llega a la lógica de REDCap (aquí sin token de REDCap)
        const ok = await call(handler(), path, { method: "POST", body, token: tokens.adminDoc });
        expect(ok).toMatchObject({ status: 500, body: { error: "Falta REDCAP_TOKEN" } });
      });
    }
  });
});
