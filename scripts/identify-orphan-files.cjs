/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * Script para identificar archivos huérfanos/duplicados en Storage.
 * 
 * Basado en el análisis: la app móvil tenía un bug que creaba múltiples archivos
 * en Storage para la misma foto rechazada, pero solo el último creaba documento en Firestore.
 * 
 * Requisitos:
 * - GOOGLE_APPLICATION_CREDENTIALS apuntando a un service account con acceso a Firestore+Storage
 * - BACKFILL_BUCKET (ej: foot-selfie---multiplatform.firebasestorage.app)
 * 
 * Uso:
 *   node scripts/identify-orphan-files.cjs
 *   node scripts/identify-orphan-files.cjs --since 2025-12-19 --until 2026-02-03
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
Identifica archivos huérfanos/duplicados en Storage.

Un archivo se considera huérfano si:
- Existe en Storage pero NO tiene documento en Firestore
- O es un duplicado de otro archivo (mismo capturedAt pero diferente timestamp en nombre)

Uso:
  node scripts/identify-orphan-files.cjs [opciones]

Opciones:
  --since <YYYY-MM-DD>  Filtra usuarios creados desde esta fecha (default: 2025-12-19)
  --until <YYYY-MM-DD>  Filtra usuarios creados hasta esta fecha (default: 2026-02-03)
  --bucket <name>       Bucket de Storage (default: BACKFILL_BUCKET env var)
  --help                Muestra esta ayuda
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

function extractTimestampFromFilename(filename) {
  // Formato esperado: {timestamp}_rejected.jpg o {timestamp}.jpg
  const match = filename.match(/^(\d+)(?:_rejected)?\./);
  return match ? parseInt(match[1], 10) : null;
}

function inferCapturedAtFromFilename(filename) {
  // El formato correcto según la app móvil corregida es:
  // {profileId}_{capturedTimestamp}_rejected.jpg
  // Pero los archivos antiguos pueden tener solo {timestamp}_rejected.jpg
  const timestamp = extractTimestampFromFilename(filename);
  if (!timestamp) return null;
  
  // Si el timestamp tiene 13 dígitos, es milisegundos
  // Si tiene 10 dígitos, es segundos
  if (timestamp.toString().length === 13) {
    return new Date(timestamp);
  } else if (timestamp.toString().length === 10) {
    return new Date(timestamp * 1000);
  }
  return null;
}

async function listFilesUnder(bucket, prefix) {
  const [files] = await bucket.getFiles({ prefix, maxResults: 10000 });
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
    
    if (untilDate && userData.createdAt) {
      const userCreatedAt = userData.createdAt.toDate();
      if (userCreatedAt > untilDate) continue;
    }
    
    const profilesSnap = await userDoc.ref.collection("profiles").get();
    for (const profileDoc of profilesSnap.docs) {
      profiles.push({
        userId: userDoc.id,
        profileId: profileDoc.id,
        redcap_code: userData.redcap_code || null,
      });
    }
  }
  
  return profiles;
}

async function getFirestoreDocsForProfile(db, profileId) {
  const snap = await db.collection("photoHistory")
    .where("profileId", "==", profileId)
    .get();
  
  const docs = new Map();
  
  for (const doc of snap.docs) {
    const data = doc.data();
    const storagePath = data.storagePath;
    const imageUrl = data.imageUrl;
    
    // Indexar por storagePath si existe
    if (storagePath) {
      docs.set(storagePath, { docId: doc.id, data, source: "storagePath" });
    }
    
    // También indexar por imageUrl normalizado (sin token)
    if (imageUrl && typeof imageUrl === "string") {
      const urlWithoutToken = imageUrl.split("&token=")[0].split("?token=")[0];
      if (urlWithoutToken) {
        docs.set(`url:${urlWithoutToken}`, { docId: doc.id, data, source: "imageUrl" });
      }
    }
    
    // Indexar por capturedAt si existe (para detectar duplicados)
    if (data.capturedAt) {
      const capturedMs = data.capturedAt.toMillis();
      const key = `captured:${capturedMs}`;
      if (!docs.has(key)) {
        docs.set(key, []);
      }
      docs.get(key).push({ docId: doc.id, data });
    }
  }
  
  return docs;
}

async function analyzeProfile(db, bucket, profileId) {
  const prefix = `photoHistory/${profileId}/`;
  const files = await listFilesUnder(bucket, prefix);
  const imageFiles = files.filter((f) => isImageName(f.name));
  
  const firestoreDocs = await getFirestoreDocsForProfile(db, profileId);
  
  const orphans = []; // Archivos sin documento en Firestore
  const duplicates = []; // Múltiples archivos para el mismo capturedAt
  const valid = []; // Archivos con documento en Firestore
  
  // Agrupar por capturedAt inferido
  const byCapturedAt = new Map();
  
  for (const file of imageFiles) {
    const storagePath = file.name;
    const capturedAt = inferCapturedAtFromFilename(storagePath);
    const isRejected = isRejectedByName(storagePath);
    
    // Verificar si tiene documento en Firestore
    const hasDocByPath = firestoreDocs.has(storagePath);
    
    // Verificar por URL (necesitaríamos construirla, pero es más complejo)
    // Por ahora solo verificamos por path
    
    if (hasDocByPath) {
      valid.push({
        storagePath,
        capturedAt: capturedAt ? capturedAt.toISOString() : null,
        isRejected,
        hasDocument: true,
      });
    } else {
      // Es huérfano
      orphans.push({
        storagePath,
        capturedAt: capturedAt ? capturedAt.toISOString() : null,
        isRejected,
        hasDocument: false,
      });
      
      // Agrupar por capturedAt para detectar duplicados
      if (capturedAt) {
        const key = capturedAt.getTime();
        if (!byCapturedAt.has(key)) {
          byCapturedAt.set(key, []);
        }
        byCapturedAt.get(key).push({
          storagePath,
          capturedAt: capturedAt.toISOString(),
          isRejected,
        });
      }
    }
  }
  
  // Identificar duplicados (múltiples archivos con mismo capturedAt)
  for (const [capturedMs, files] of byCapturedAt.entries()) {
    if (files.length > 1) {
      duplicates.push({
        capturedAt: new Date(capturedMs).toISOString(),
        files: files.map(f => f.storagePath),
        count: files.length,
      });
    }
  }
  
  return {
    profileId,
    totalFiles: imageFiles.length,
    valid: valid.length,
    orphans: orphans.length,
    duplicates: duplicates.length,
    orphanFiles: orphans,
    duplicateGroups: duplicates,
  };
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
  
  console.log("Identificando archivos huérfanos y duplicados...");
  console.log(`- Bucket: ${bucketName}`);
  console.log(`- Usuarios desde: ${sinceDate.toISOString().split("T")[0]}`);
  console.log(`- Usuarios hasta: ${untilDate.toISOString().split("T")[0]}`);
  console.log("\nObteniendo perfiles...\n");
  
  const profiles = await getProfilesFromUsers(db, sinceDate, untilDate);
  console.log(`Perfiles encontrados: ${profiles.length}\n`);
  
  const results = [];
  let processed = 0;
  let totalOrphans = 0;
  let totalDuplicates = 0;
  
  for (const profile of profiles) {
    processed++;
    process.stdout.write(`\rProcesando ${processed}/${profiles.length}: ${profile.profileId}...`);
    
    const analysis = await analyzeProfile(db, bucket, profile.profileId);
    
    totalOrphans += analysis.orphans;
    totalDuplicates += analysis.duplicates;
    
    results.push({
      "Usuario ID": profile.userId,
      "Perfil ID": profile.profileId,
      "REDCap": profile.redcap_code || "",
      "Total Archivos Storage": analysis.totalFiles,
      "Archivos con Documento": analysis.valid,
      "Archivos Huérfanos": analysis.orphans,
      "Grupos de Duplicados": analysis.duplicates,
    });
  }
  
  console.log("\n\nGenerando Excel...\n");
  
  // Crear workbook
  const wb = XLSX.utils.book_new();
  
  // Hoja 1: Resumen por perfil
  const ws1 = XLSX.utils.json_to_sheet(results);
  XLSX.utils.book_append_sheet(wb, ws1, "Resumen por Perfil");
  
  // Hoja 2: Archivos huérfanos (detalle)
  const allOrphans = [];
  for (const profile of profiles) {
    const analysis = await analyzeProfile(db, bucket, profile.profileId);
    for (const orphan of analysis.orphanFiles) {
      allOrphans.push({
        "Usuario ID": profile.userId,
        "Perfil ID": profile.profileId,
        "REDCap": profile.redcap_code || "",
        "Archivo": orphan.storagePath,
        "CapturedAt": orphan.capturedAt || "",
        "Es Rechazada": orphan.isRejected ? "Sí" : "No",
      });
    }
  }
  
  if (allOrphans.length > 0) {
    const ws2 = XLSX.utils.json_to_sheet(allOrphans);
    XLSX.utils.book_append_sheet(wb, ws2, "Archivos Huérfanos");
  }
  
  // Hoja 3: Duplicados (detalle)
  const allDuplicates = [];
  for (const profile of profiles) {
    const analysis = await analyzeProfile(db, bucket, profile.profileId);
    for (const dup of analysis.duplicateGroups) {
      allDuplicates.push({
        "Usuario ID": profile.userId,
        "Perfil ID": profile.profileId,
        "REDCap": profile.redcap_code || "",
        "CapturedAt": dup.capturedAt,
        "Cantidad Duplicados": dup.count,
        "Archivos": dup.files.join("; "),
      });
    }
  }
  
  if (allDuplicates.length > 0) {
    const ws3 = XLSX.utils.json_to_sheet(allDuplicates);
    XLSX.utils.book_append_sheet(wb, ws3, "Duplicados");
  }
  
  // Hoja 4: Resumen general
  const summary = [
    { "Métrica": "Total Perfiles Analizados", "Valor": results.length },
    { "Métrica": "", "Valor": "" },
    { "Métrica": "Total Archivos en Storage", "Valor": results.reduce((s, r) => s + r["Total Archivos Storage"], 0) },
    { "Métrica": "Archivos con Documento", "Valor": results.reduce((s, r) => s + r["Archivos con Documento"], 0) },
    { "Métrica": "Archivos Huérfanos", "Valor": totalOrphans },
    { "Métrica": "Grupos de Duplicados", "Valor": totalDuplicates },
    { "Métrica": "", "Valor": "" },
    { "Métrica": "Porcentaje Huérfanos", "Valor": `${((totalOrphans / results.reduce((s, r) => s + r["Total Archivos Storage"], 0)) * 100).toFixed(2)}%` },
  ];
  
  const ws4 = XLSX.utils.json_to_sheet(summary);
  XLSX.utils.book_append_sheet(wb, ws4, "Resumen General");
  
  // Generar nombre de archivo
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, -5);
  const filename = `archivos-huerfanos-${timestamp}.xlsx`;
  const filepath = path.join(__dirname, filename);
  
  XLSX.writeFile(wb, filepath);
  
  console.log(`✅ Archivo Excel creado: ${filepath}`);
  console.log(`\n=== RESUMEN ===`);
  console.log(`Perfiles analizados: ${results.length}`);
  console.log(`Total archivos en Storage: ${results.reduce((s, r) => s + r["Total Archivos Storage"], 0)}`);
  console.log(`Archivos con documento: ${results.reduce((s, r) => s + r["Archivos con Documento"], 0)}`);
  console.log(`Archivos huérfanos: ${totalOrphans}`);
  console.log(`Grupos de duplicados: ${totalDuplicates}`);
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
