/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * Backfill de Firestore `photoHistory` a partir de objetos en Storage:
 * - NO duplica: solo crea docs si no existe un doc que apunte al mismo storagePath.
 * - Restringe por profileId (recomendado) o recorre todos los folders bajo photoHistory/.
 *
 * Requisitos:
 * - GOOGLE_APPLICATION_CREDENTIALS apuntando a un service account con acceso a Firestore+Storage
 * - BACKFILL_PROJECT_ID (opcional si el service account ya lo incluye)
 * - BACKFILL_BUCKET (ej: foot-selfie---multiplatform.firebasestorage.app)
 *
 * Uso:
 *   node scripts/backfill-photoHistory.cjs --profileId Drdv005... --dry-run
 *   node scripts/backfill-photoHistory.cjs --profileId Drdv005...
 */

const admin = require("firebase-admin");
const crypto = require("crypto");

function parseArgs(argv) {
  const out = {
    profileId: null,
    bucket: process.env.BACKFILL_BUCKET || process.env.FIREBASE_STORAGE_BUCKET || process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || null,
    projectId: process.env.BACKFILL_PROJECT_ID || process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || null,
    prefix: "photoHistory/",
    dryRun: false,
    setToken: true,
    since: null, // YYYY-MM-DD
    rejectedSummary: "No se reconocio la planta del pie.",
    rejectedMessage: "No se reconocio la planta del pie.",
    onlyRejected: false,
    profileSource: "storage", // "storage" | "firestore-profiles" | "firestore-users"
    usersSince: null, // YYYY-MM-DD (filtro por users.createdAt)
    limitUsers: null,
    limitProfilesPerUser: null,
    updateExistingBackfilledRejected: false,
    forceRejectedText: false,
    limitProfiles: null,
    limitFiles: null,
  };

  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--profileId") out.profileId = argv[++i] || null;
    else if (a === "--bucket") out.bucket = argv[++i] || null;
    else if (a === "--projectId") out.projectId = argv[++i] || null;
    else if (a === "--prefix") out.prefix = argv[++i] || "photoHistory/";
    else if (a === "--dry-run") out.dryRun = true;
    else if (a === "--set-token") out.setToken = true;
    else if (a === "--no-set-token") out.setToken = false;
    else if (a === "--since") out.since = argv[++i] || null;
    else if (a === "--rejected-summary") out.rejectedSummary = argv[++i] || "";
    else if (a === "--rejected-message") out.rejectedMessage = argv[++i] || "";
    else if (a === "--only-rejected") out.onlyRejected = true;
    else if (a === "--profile-source") out.profileSource = argv[++i] || "storage";
    else if (a === "--users-since") out.usersSince = argv[++i] || null;
    else if (a === "--limit-users") out.limitUsers = Number(argv[++i] || "");
    else if (a === "--limit-profiles-per-user") out.limitProfilesPerUser = Number(argv[++i] || "");
    else if (a === "--update-existing-backfilled-rejected") out.updateExistingBackfilledRejected = true;
    else if (a === "--force-rejected-text") out.forceRejectedText = true;
    else if (a === "--limit-profiles") out.limitProfiles = Number(argv[++i] || "");
    else if (a === "--limit-files") out.limitFiles = Number(argv[++i] || "");
    else if (a === "--help" || a === "-h") out.help = true;
  }
  return out;
}

function help() {
  console.log(`
Backfill photoHistory (Storage -> Firestore)

Env:
  BACKFILL_BUCKET         (requerido)  ej: foot-selfie---multiplatform.firebasestorage.app
  GOOGLE_APPLICATION_CREDENTIALS      ruta al JSON del service account
  BACKFILL_PROJECT_ID     (opcional)

Args:
  --profileId <id>        (recomendado) procesa solo un perfil
  --bucket <name>         override bucket
  --projectId <id>        override projectId
  --prefix <pfx>          default: photoHistory/
  --since <YYYY-MM-DD>    procesa solo archivos con fecha >= since (según nombre; si no se puede inferir, se incluye)
  --rejected-summary <s>  summary por defecto para docs creados de archivos *_rejected.*
  --rejected-message <s>  message/inferenceMeta.message por defecto para *_rejected.*
  --only-rejected          solo considera/crea docs para archivos *_rejected.*
  --profile-source <src>   "storage" (default) lista carpetas desde Storage,
                           "firestore-profiles" usa Firestore collectionGroup('profiles'),
                           "firestore-users" usa Firestore users/*/profiles/* (recomendado)
  --users-since <YYYY-MM-DD> filtra usuarios por users.createdAt >= users-since (solo para profile-source firestore-users)
  --limit-users <n>          limita usuarios (solo firestore-users)
  --limit-profiles-per-user <n> limita perfiles por usuario (solo firestore-users)
  --update-existing-backfilled-rejected  actualiza docs YA creados por este backfill (backfillSource=storage) con rejected=true que no tengan summary/message
  --force-rejected-text      junto con --update-existing-backfilled-rejected, sobreescribe el texto aunque ya exista
  --dry-run               no escribe nada (solo imprime)
  --set-token             asegura download token en objetos (default)
  --no-set-token          no modifica metadata de objetos
  --limit-profiles <n>    limita número de perfiles a procesar (si no pasas --profileId)
  --limit-files <n>       limita archivos por perfil (debug)

Ejemplos:
  node scripts/backfill-photoHistory.cjs --profileId Drdv005RAKYmic6rF7ES --dry-run
  node scripts/backfill-photoHistory.cjs --profileId Drdv005RAKYmic6rF7ES
`);
}

function decodeStoragePathFromFirebaseUrl(url) {
  // https://firebasestorage.googleapis.com/v0/b/<bucket>/o/<ENCODED_PATH>?alt=media&token=...
  try {
    const marker = "/o/";
    const idx = url.indexOf(marker);
    if (idx < 0) return null;
    const rest = url.slice(idx + marker.length);
    const encodedPath = rest.split("?")[0];
    return decodeURIComponent(encodedPath);
  } catch {
    return null;
  }
}

function inferDateFromFilename(name) {
  // name: photoHistory/<profileId>/<millis>_rejected.jpg
  const base = name.split("/").pop() || name;
  const m = base.match(/^(\d{13})/);
  if (!m) return null;
  const ms = Number(m[1]);
  if (!Number.isFinite(ms)) return null;
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

function isRejectedByName(name) {
  return /_rejected\.(jpg|jpeg|png|webp)$/i.test(name);
}

function isImageName(name) {
  return /\.(jpg|jpeg|png|webp)$/i.test(name);
}

function ensureAdmin(projectId, bucket) {
  if (admin.apps.length) return;
  const cfg = {};
  if (projectId) cfg.projectId = projectId;
  if (bucket) cfg.storageBucket = bucket;
  admin.initializeApp({
    credential: admin.credential.applicationDefault(),
    ...cfg,
  });
}

async function listProfilePrefixes(bucket, prefix, limitProfiles) {
  // Devuelve ["photoHistory/<profileId>/", ...]
  const [, , apiResponse] = await bucket.getFiles({ prefix, delimiter: "/" });
  const prefixes = (apiResponse && apiResponse.prefixes) || [];
  const list = Array.isArray(prefixes) ? prefixes : [];
  const out = list.filter((p) => typeof p === "string" && p.startsWith(prefix));
  return typeof limitProfiles === "number" && Number.isFinite(limitProfiles)
    ? out.slice(0, limitProfiles)
    : out;
}

async function listFilesUnder(bucket, folderPrefix, limitFiles) {
  const files = [];
  let pageToken = undefined;
  while (true) {
    const [page, nextQuery] = await bucket.getFiles({
      prefix: folderPrefix,
      autoPaginate: false,
      pageToken,
    });
    for (const f of page) {
      if (f && typeof f.name === "string") files.push(f);
      if (typeof limitFiles === "number" && files.length >= limitFiles) return files.slice(0, limitFiles);
    }
    pageToken = nextQuery && nextQuery.pageToken;
    if (!pageToken) break;
  }
  return files;
}

async function listProfileIdsFromFirestore(db, limitProfiles) {
  // Lee IDs de docs en subcolección "profiles" bajo users/*/profiles/*
  // Nota: Si tienes miles, esto puede tardar; usa --limit-profiles para muestreo.
  const snap = await db.collectionGroup("profiles").select().get();
  const ids = [];
  snap.forEach((d) => ids.push(d.id));
  const unique = Array.from(new Set(ids));
  return typeof limitProfiles === "number" && Number.isFinite(limitProfiles)
    ? unique.slice(0, limitProfiles)
    : unique;
}

async function listProfileIdsFromUsers(db, usersSinceDate, limitUsers, limitProfilesPerUser) {
  // Fuente recomendada: users/*/profiles/*
  // - filtra usuarios por createdAt si se especifica
  // - recolecta profileIds desde la subcolección profiles
  let q = db.collection("users");
  if (usersSinceDate) {
    // Firestore suele requerir index cuando combinas where + orderBy
    q = q.where("createdAt", ">=", admin.firestore.Timestamp.fromDate(usersSinceDate)).orderBy("createdAt", "asc");
  }

  const snap = await q.get();
  const userDocs = snap.docs;
  const sliced = (typeof limitUsers === "number" && Number.isFinite(limitUsers))
    ? userDocs.slice(0, limitUsers)
    : userDocs;

  const ids = [];
  for (const u of sliced) {
    const ps = await u.ref.collection("profiles").get().catch(() => null);
    if (!ps) continue;
    const profDocs = ps.docs;
    const profSliced = (typeof limitProfilesPerUser === "number" && Number.isFinite(limitProfilesPerUser))
      ? profDocs.slice(0, limitProfilesPerUser)
      : profDocs;
    for (const p of profSliced) ids.push(p.id);
  }

  return Array.from(new Set(ids));
}

async function loadExistingStoragePathsForProfile(db, profileId) {
  // Cargamos TODOS los campos (no solo imageUrl) para poder ver storagePath también
  const snap = await db.collection("photoHistory").where("profileId", "==", profileId).get();
  const set = new Set();
  snap.forEach((doc) => {
    const data = doc.data() || {};
    
    // 1. Si tiene storagePath explícito, usarlo directamente (más confiable)
    if (typeof data.storagePath === "string" && data.storagePath.trim()) {
      set.add(data.storagePath.trim());
    }
    
    // 2. Si no, intentar extraer del imageUrl
    const url = data.imageUrl;
    if (typeof url === "string") {
      const path = decodeStoragePathFromFirebaseUrl(url);
      if (path) set.add(path);
      // También agregar el imageUrl completo como fallback (por si hay variaciones de token)
      // pero normalizado (sin token para comparar)
      const urlWithoutToken = url.split("&token=")[0].split("?token=")[0];
      if (urlWithoutToken) set.add(`url:${urlWithoutToken}`);
    }
  });
  return { count: snap.size, paths: set };
}

async function patchExistingBackfilledRejected({
  db,
  profileId,
  dryRun,
  rejectedSummary,
  rejectedMessage,
  forceRejectedText,
}) {
  const snap = await db.collection("photoHistory").where("profileId", "==", profileId).get();
  let candidates = 0;
  let patched = 0;

  let batch = db.batch();
  let ops = 0;

  for (const docSnap of snap.docs) {
    const d = docSnap.data() || {};
    const isBackfilled = d.backfillSource === "storage";
    const isRejected = d.rejected === true;
    if (!isBackfilled || !isRejected) continue;

    const hasSummary = typeof d.summary === "string" && d.summary.trim().length > 0;
    const hasMessage = typeof d.message === "string" && d.message.trim().length > 0;
    const hasInfMsg = typeof d.inferenceMeta?.message === "string" && d.inferenceMeta.message.trim().length > 0;
    if (!forceRejectedText && hasSummary && hasMessage && hasInfMsg) continue;

    candidates++;
    if (dryRun) continue;

    batch.set(
      docSnap.ref,
      {
        summary: rejectedSummary,
        message: rejectedSummary,
        inferenceMeta: {
          ...(d.inferenceMeta || {}),
          message: rejectedMessage || rejectedSummary,
        },
        backfilledPatchedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
    ops++;
    patched++;
    if (ops >= 400) {
      await batch.commit();
      batch = db.batch();
      ops = 0;
    }
  }

  if (!dryRun && ops > 0) await batch.commit();
  return { candidates, patched };
}

async function getOrCreateDownloadToken(file, doSetToken) {
  const [meta] = await file.getMetadata();
  const md = (meta && meta.metadata) || {};
  let tokens = md.firebaseStorageDownloadTokens || md.downloadTokens || null;
  if (typeof tokens === "string" && tokens.trim()) {
    return tokens.split(",")[0].trim();
  }
  if (!doSetToken) return null;

  const token = crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString("hex");
  await file.setMetadata({
    metadata: {
      ...(md || {}),
      firebaseStorageDownloadTokens: token,
    },
  });
  return token;
}

function buildFirebaseDownloadUrl(bucketName, storagePath, token) {
  const encoded = encodeURIComponent(storagePath);
  const base = `https://firebasestorage.googleapis.com/v0/b/${bucketName}/o/${encoded}?alt=media`;
  return token ? `${base}&token=${encodeURIComponent(token)}` : base;
}

async function backfillProfile({
  db,
  bucket,
  bucketName,
  profileId,
  folderPrefix,
  dryRun,
  setToken,
  limitFiles,
  sinceDate,
  rejectedSummary,
  rejectedMessage,
  onlyRejected,
  updateExistingBackfilledRejected,
  forceRejectedText,
}) {
  console.log(`\n== Perfil: ${profileId} ==`);

  const existing = await loadExistingStoragePathsForProfile(db, profileId);
  console.log(`Firestore docs existentes: ${existing.count}`);

  if (updateExistingBackfilledRejected) {
    const r = await patchExistingBackfilledRejected({
      db,
      profileId,
      dryRun,
      rejectedSummary,
      rejectedMessage,
      forceRejectedText,
    });
    if (r.candidates > 0) {
      console.log(
        dryRun
          ? `Docs backfilled rejected para parchar (faltaba summary/message): ${r.candidates}`
          : `Docs backfilled rejected parchados: ${r.patched}`
      );
    }
  }

  const files = await listFilesUnder(bucket, folderPrefix, limitFiles);
  const imageFiles = files.filter((f) => isImageName(f.name));
  console.log(`Archivos en Storage: ${imageFiles.length} (imágenes)`);

  const missing = [];
  for (const f of imageFiles) {
    if (!f.name) continue;
    if (!f.name.includes(`/${profileId}/`)) continue;
    
    // Verificar si ya existe: por storagePath directo o por URL normalizada
    const storagePath = f.name;
    if (existing.paths.has(storagePath)) continue;
    
    // También verificar si hay un doc con imageUrl que apunte al mismo archivo
    // (normalizando la URL sin token)
    const tempUrl = buildFirebaseDownloadUrl(bucketName, storagePath, null);
    const urlWithoutToken = tempUrl.split("&token=")[0].split("?token=")[0];
    if (existing.paths.has(`url:${urlWithoutToken}`)) continue;

    if (onlyRejected && !isRejectedByName(f.name)) continue;

    // filtro por fecha (si aplica) usando el timestamp del nombre
    if (sinceDate) {
      const inferred = inferDateFromFilename(f.name);
      if (inferred && inferred < sinceDate) continue;
    }

    missing.push(f);
  }

  console.log(`Faltantes (sin doc en Firestore): ${missing.length}`);
  if (missing.length === 0) return { created: 0, skipped: imageFiles.length, missing: 0 };

  if (dryRun) {
    console.log(`--dry-run: no se escribirá nada. Ejemplos de faltantes:`);
    missing.slice(0, 10).forEach((f) => console.log(`  - ${f.name}`));
    return { created: 0, skipped: imageFiles.length - missing.length, missing: missing.length };
  }

  let batch = db.batch();
  let ops = 0;
  let created = 0;

  for (const f of missing) {
    const storagePath = f.name;
    const rejected = isRejectedByName(storagePath);

    // Fecha: intenta por filename; si no, usa timeCreated del objeto
    let d = inferDateFromFilename(storagePath);
    if (!d) {
      const [meta] = await f.getMetadata().catch(() => [null]);
      const tc = meta && meta.timeCreated ? new Date(meta.timeCreated) : null;
      d = tc && !Number.isNaN(tc.getTime()) ? tc : new Date();
    }

    const token = await getOrCreateDownloadToken(f, setToken).catch((e) => {
      console.warn(`WARN: no se pudo obtener/setear token para ${storagePath}: ${e?.message || e}`);
      return null;
    });
    const imageUrl = buildFirebaseDownloadUrl(bucketName, storagePath, token);

    const ref = db.collection("photoHistory").doc();
    const doc = {
      id: ref.id,
      profileId,
      date: admin.firestore.Timestamp.fromDate(d),
      capturedAt: admin.firestore.Timestamp.fromDate(d),
      imageUrl,
      rejected,
      // Nota: no seteamos resultDetails; esto solo desbloquea visualización en dashboard.
      backfilledAt: admin.firestore.FieldValue.serverTimestamp(),
      backfillSource: "storage",
      storagePath,
    };

    if (rejected) {
      doc.summary = rejectedSummary;
      doc.message = rejectedSummary;
      doc.inferenceMeta = { message: rejectedMessage || rejectedSummary };
    }

    batch.set(ref, doc);

    ops++;
    created++;
    if (ops >= 400) {
      await batch.commit();
      batch = db.batch();
      ops = 0;
    }
  }

  if (ops > 0) await batch.commit();
  console.log(`Creados: ${created}`);
  return { created, skipped: imageFiles.length - missing.length, missing: missing.length };
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) return help();
  if (!args.bucket) {
    console.error("Falta bucket. Define BACKFILL_BUCKET o usa --bucket <name>.");
    process.exit(1);
  }

  let sinceDate = null;
  if (args.since) {
    const d = new Date(`${args.since}T00:00:00.000Z`);
    if (Number.isNaN(d.getTime())) {
      console.error("Formato inválido para --since. Usa YYYY-MM-DD (ej: 2025-12-18).");
      process.exit(1);
    }
    sinceDate = d;
  }

  let usersSinceDate = null;
  if (args.usersSince) {
    const d = new Date(`${args.usersSince}T00:00:00.000Z`);
    if (Number.isNaN(d.getTime())) {
      console.error("Formato inválido para --users-since. Usa YYYY-MM-DD (ej: 2025-12-18).");
      process.exit(1);
    }
    usersSinceDate = d;
  }

  ensureAdmin(args.projectId, args.bucket);
  const db = admin.firestore();
  const bucket = admin.storage().bucket(args.bucket);

  console.log("Backfill photoHistory");
  console.log(`- bucket: ${args.bucket}`);
  console.log(`- prefix: ${args.prefix}`);
  console.log(`- setToken: ${args.setToken}`);
  console.log(`- dryRun: ${args.dryRun}`);
  if (sinceDate) console.log(`- since: ${args.since}`);
  console.log(`- onlyRejected: ${args.onlyRejected}`);
  console.log(`- profileSource: ${args.profileSource}`);
  if (usersSinceDate) console.log(`- usersSince: ${args.usersSince}`);
  console.log(`- updateExistingBackfilledRejected: ${args.updateExistingBackfilledRejected}`);
  console.log(`- forceRejectedText: ${args.forceRejectedText}`);

  let prefixes = [];
  if (args.profileId) {
    prefixes = [`${args.prefix}${args.profileId}/`];
  } else {
    if (args.profileSource === "firestore-profiles") {
      const ids = await listProfileIdsFromFirestore(db, args.limitProfiles);
      prefixes = ids.map((id) => `${args.prefix}${id}/`);
    } else if (args.profileSource === "firestore-users") {
      const ids = await listProfileIdsFromUsers(db, usersSinceDate, args.limitUsers, args.limitProfilesPerUser);
      prefixes = ids.map((id) => `${args.prefix}${id}/`);
    } else {
      prefixes = await listProfilePrefixes(bucket, args.prefix, args.limitProfiles);
    }
  }

  if (prefixes.length === 0) {
    console.log("No se encontraron perfiles bajo el prefix dado.");
    return;
  }

  let totals = { created: 0, missing: 0, profiles: 0 };
  for (const pfx of prefixes) {
    const parts = pfx.split("/").filter(Boolean);
    const profileId = parts[1]; // photoHistory/<profileId>/
    if (!profileId) continue;
    totals.profiles++;
    const r = await backfillProfile({
      db,
      bucket,
      bucketName: args.bucket,
      profileId,
      folderPrefix: pfx,
      dryRun: args.dryRun,
      setToken: args.setToken,
      limitFiles: args.limitFiles,
      sinceDate,
      rejectedSummary: args.rejectedSummary,
      rejectedMessage: args.rejectedMessage,
      onlyRejected: args.onlyRejected,
      updateExistingBackfilledRejected: args.updateExistingBackfilledRejected,
      forceRejectedText: args.forceRejectedText,
    });
    totals.created += r.created;
    totals.missing += r.missing;
  }

  console.log("\n== RESUMEN ==");
  console.log(`Perfiles procesados: ${totals.profiles}`);
  console.log(`Docs creados:        ${totals.created}`);
  console.log(`Faltantes detectados:${totals.missing}`);
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});

