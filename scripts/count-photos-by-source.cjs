/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * Script para contar fotos rechazadas vs correctas por perfil/usuario.
 * Compara dos fuentes: Firestore photoHistory vs Storage.
 * 
 * Requisitos:
 * - GOOGLE_APPLICATION_CREDENTIALS apuntando a un service account con acceso a Firestore+Storage
 * - BACKFILL_BUCKET (ej: foot-selfie---multiplatform.firebasestorage.app)
 * 
 * Uso:
 *   node scripts/count-photos-by-source.cjs
 *   node scripts/count-photos-by-source.cjs --since 2025-12-19 --until 2026-02-03
 */

const admin = require("firebase-admin");
const XLSX = require("xlsx");
const path = require("path");

function parseArgs(argv) {
  const out = {
    since: "2025-12-19",
    until: "2026-02-03",
    bucket: null,
    help: false,
  };

  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      out.help = true;
    } else if (arg === "--since" && i + 1 < argv.length) {
      out.since = argv[++i];
    } else if (arg === "--until" && i + 1 < argv.length) {
      out.until = argv[++i];
    } else if (arg === "--bucket" && i + 1 < argv.length) {
      out.bucket = argv[++i];
    }
  }
  return out;
}

function help() {
  console.log(`
Cuenta fotos rechazadas vs correctas por perfil/usuario.
Compara Firestore photoHistory vs Storage.

Uso:
  node scripts/count-photos-by-source.cjs [opciones]

Opciones:
  --since <YYYY-MM-DD>  Filtra usuarios creados desde esta fecha (default: 2025-12-19)
  --until <YYYY-MM-DD>  Filtra usuarios creados hasta esta fecha (default: 2026-02-03)
  --bucket <name>       Bucket de Storage (default: BACKFILL_BUCKET env var)
  --help                Muestra esta ayuda

Ejemplos:
  node scripts/count-photos-by-source.cjs
  node scripts/count-photos-by-source.cjs --since 2026-01-01 --until 2026-01-31
`);
}

function ensureAdmin(projectId, bucketName) {
  if (admin.apps.length === 0) {
    const creds = process.env.GOOGLE_APPLICATION_CREDENTIALS;
    if (!creds) {
      console.error("Falta GOOGLE_APPLICATION_CREDENTIALS. Define la variable de entorno.");
      process.exit(1);
    }
    admin.initializeApp({
      credential: admin.credential.applicationDefault(),
      projectId: projectId || process.env.BACKFILL_PROJECT_ID,
      storageBucket: bucketName || process.env.BACKFILL_BUCKET,
    });
  }
}

function isRejectedByName(filename) {
  return typeof filename === "string" && /_rejected\./i.test(filename);
}

function isImageName(name) {
  if (!name) return false;
  const ext = name.split(".").pop()?.toLowerCase();
  return ["jpg", "jpeg", "png", "webp"].includes(ext);
}

async function listFilesUnder(bucket, prefix, limitFiles) {
  const [files] = await bucket.getFiles({ prefix, maxResults: limitFiles || 10000 });
  return files;
}

async function getProfilesFromUsers(db, sinceDate, untilDate) {
  let q = db.collection("users");
  
  if (sinceDate) {
    q = q.where("createdAt", ">=", admin.firestore.Timestamp.fromDate(sinceDate));
  }
  if (untilDate) {
    if (sinceDate) {
      q = q.orderBy("createdAt", "asc");
    } else {
      q = q.where("createdAt", "<=", admin.firestore.Timestamp.fromDate(untilDate));
    }
  }
  
  const usersSnap = await q.get();
  const profiles = [];
  
  for (const userDoc of usersSnap.docs) {
    const userData = userDoc.data();
    
    // Filtro adicional por untilDate si se especificó
    if (untilDate && userData.createdAt) {
      const userCreatedAt = userData.createdAt.toDate();
      if (userCreatedAt > untilDate) {
        continue;
      }
    }
    
    const profilesSnap = await userDoc.ref.collection("profiles").get();
    for (const profileDoc of profilesSnap.docs) {
      profiles.push({
        userId: userDoc.id,
        profileId: profileDoc.id,
        redcap_code: userData.redcap_code || null,
        email: userData.email || null,
        userCreatedAt: userData.createdAt ? userData.createdAt.toDate().toISOString() : null,
      });
    }
  }
  
  return profiles;
}

async function countFromFirestore(db, profileId) {
  const snap = await db.collection("photoHistory")
    .where("profileId", "==", profileId)
    .get();
  
  let rejected = 0;
  let correct = 0;
  let backfilled = 0;
  
  for (const doc of snap.docs) {
    const data = doc.data();
    
    // Excluir documentos creados por backfill
    if (data.backfillSource === "storage") {
      backfilled++;
      continue;
    }
    
    if (data.rejected === true) {
      rejected++;
    } else {
      correct++;
    }
  }
  
  return { rejected, correct, backfilled, total: rejected + correct };
}

async function countFromStorage(bucket, profileId) {
  const prefix = `photoHistory/${profileId}/`;
  const files = await listFilesUnder(bucket, prefix);
  const imageFiles = files.filter((f) => isImageName(f.name));
  
  let rejected = 0;
  let correct = 0;
  
  for (const file of imageFiles) {
    if (isRejectedByName(file.name)) {
      rejected++;
    } else {
      correct++;
    }
  }
  
  return { rejected, correct, total: rejected + correct };
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) return help();
  
  const bucketName = args.bucket || process.env.BACKFILL_BUCKET;
  if (!bucketName) {
    console.error("Falta bucket. Define BACKFILL_BUCKET o usa --bucket <name>.");
    process.exit(1);
  }
  
  let sinceDate = new Date(`${args.since}T00:00:00.000Z`);
  let untilDate = new Date(`${args.until}T23:59:59.999Z`);
  
  if (Number.isNaN(sinceDate.getTime()) || Number.isNaN(untilDate.getTime())) {
    console.error("Formato inválido para fechas. Usa YYYY-MM-DD (ej: 2025-12-19).");
    process.exit(1);
  }
  
  ensureAdmin(null, bucketName);
  const db = admin.firestore();
  const bucket = admin.storage().bucket(bucketName);
  
  console.log("Contando fotos por perfil/usuario...");
  console.log(`- Bucket: ${bucketName}`);
  console.log(`- Usuarios desde: ${sinceDate.toISOString().split("T")[0]}`);
  console.log(`- Usuarios hasta: ${untilDate.toISOString().split("T")[0]}`);
  console.log("\nObteniendo perfiles...\n");
  
  const profiles = await getProfilesFromUsers(db, sinceDate, untilDate);
  console.log(`Perfiles encontrados: ${profiles.length}\n`);
  
  const results = [];
  let processed = 0;
  
  for (const profile of profiles) {
    processed++;
    process.stdout.write(`\rProcesando ${processed}/${profiles.length}: ${profile.profileId}...`);
    
    const [firestoreCounts, storageCounts] = await Promise.all([
      countFromFirestore(db, profile.profileId),
      countFromStorage(bucket, profile.profileId),
    ]);
    
    results.push({
      "Usuario ID": profile.userId,
      "Perfil ID": profile.profileId,
      "REDCap": profile.redcap_code || "",
      "Email": profile.email || "",
      // Firestore
      "Firestore - Rechazadas": firestoreCounts.rejected,
      "Firestore - Correctas": firestoreCounts.correct,
      "Firestore - Total (sin backfill)": firestoreCounts.total,
      "Firestore - Backfilled (excluidas)": firestoreCounts.backfilled,
      // Storage
      "Storage - Rechazadas": storageCounts.rejected,
      "Storage - Correctas": storageCounts.correct,
      "Storage - Total": storageCounts.total,
      // Diferencias
      "Diferencia Rechazadas": storageCounts.rejected - firestoreCounts.rejected,
      "Diferencia Correctas": storageCounts.correct - firestoreCounts.correct,
      "Diferencia Total": storageCounts.total - firestoreCounts.total,
    });
  }
  
  console.log("\n\nGenerando Excel...\n");
  
  // Crear workbook
  const wb = XLSX.utils.book_new();
  
  // Hoja 1: Datos completos
  const ws1 = XLSX.utils.json_to_sheet(results);
  XLSX.utils.book_append_sheet(wb, ws1, "Conteo por Perfil");
  
  // Hoja 2: Resumen
  const totalFirestoreRejected = results.reduce((sum, r) => sum + r["Firestore - Rechazadas"], 0);
  const totalFirestoreCorrect = results.reduce((sum, r) => sum + r["Firestore - Correctas"], 0);
  const totalStorageRejected = results.reduce((sum, r) => sum + r["Storage - Rechazadas"], 0);
  const totalStorageCorrect = results.reduce((sum, r) => sum + r["Storage - Correctas"], 0);
  
  const summary = [
    { "Métrica": "Total Perfiles", "Valor": results.length },
    { "Métrica": "", "Valor": "" },
    { "Métrica": "=== FIRESTORE (sin backfill) ===", "Valor": "" },
    { "Métrica": "Total Rechazadas", "Valor": totalFirestoreRejected },
    { "Métrica": "Total Correctas", "Valor": totalFirestoreCorrect },
    { "Métrica": "Total General", "Valor": totalFirestoreRejected + totalFirestoreCorrect },
    { "Métrica": "", "Valor": "" },
    { "Métrica": "=== STORAGE ===", "Valor": "" },
    { "Métrica": "Total Rechazadas", "Valor": totalStorageRejected },
    { "Métrica": "Total Correctas", "Valor": totalStorageCorrect },
    { "Métrica": "Total General", "Valor": totalStorageRejected + totalStorageCorrect },
    { "Métrica": "", "Valor": "" },
    { "Métrica": "=== DIFERENCIAS ===", "Valor": "" },
    { "Métrica": "Rechazadas (Storage - Firestore)", "Valor": totalStorageRejected - totalFirestoreRejected },
    { "Métrica": "Correctas (Storage - Firestore)", "Valor": totalStorageCorrect - totalFirestoreCorrect },
    { "Métrica": "Total (Storage - Firestore)", "Valor": (totalStorageRejected + totalStorageCorrect) - (totalFirestoreRejected + totalFirestoreCorrect) },
  ];
  
  const ws2 = XLSX.utils.json_to_sheet(summary);
  XLSX.utils.book_append_sheet(wb, ws2, "Resumen");
  
  // Generar nombre de archivo
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, -5);
  const filename = `conteo-fotos-${timestamp}.xlsx`;
  const filepath = path.join(__dirname, filename);
  
  XLSX.writeFile(wb, filepath);
  
  console.log(`✅ Archivo Excel creado: ${filepath}`);
  console.log(`\n=== RESUMEN ===`);
  console.log(`Perfiles procesados: ${results.length}`);
  console.log(`\nFirestore (sin backfill):`);
  console.log(`  Rechazadas: ${totalFirestoreRejected}`);
  console.log(`  Correctas: ${totalFirestoreCorrect}`);
  console.log(`  Total: ${totalFirestoreRejected + totalFirestoreCorrect}`);
  console.log(`\nStorage:`);
  console.log(`  Rechazadas: ${totalStorageRejected}`);
  console.log(`  Correctas: ${totalStorageCorrect}`);
  console.log(`  Total: ${totalStorageRejected + totalStorageCorrect}`);
  console.log(`\nDiferencias:`);
  console.log(`  Rechazadas: ${totalStorageRejected - totalFirestoreRejected}`);
  console.log(`  Correctas: ${totalStorageCorrect - totalFirestoreCorrect}`);
  console.log(`  Total: ${(totalStorageRejected + totalStorageCorrect) - (totalFirestoreRejected + totalFirestoreCorrect)}`);
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
