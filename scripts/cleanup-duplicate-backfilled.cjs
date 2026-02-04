/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * Script para limpiar documentos backfilled duplicados de imágenes rejected.
 * 
 * Agrupa documentos backfilled rejected por tamaño de archivo (más preciso que timestamp)
 * y elimina duplicados, manteniendo solo uno por grupo.
 * 
 * Requisitos:
 * - GOOGLE_APPLICATION_CREDENTIALS apuntando a un service account con acceso a Firestore+Storage
 * - BACKFILL_BUCKET (ej: foot-selfie---multiplatform.firebasestorage.app)
 * 
 * Uso:
 *   node scripts/cleanup-duplicate-backfilled.cjs --profileId <id> --dry-run
 *   node scripts/cleanup-duplicate-backfilled.cjs --since 2025-12-19 --until 2026-02-03
 */

const admin = require("firebase-admin");
const XLSX = require("xlsx");
const path = require("path");

function parseArgs(argv) {
  const out = {
    profileId: null,
    since: "2025-12-19",
    until: "2026-02-03",
    bucket: null,
    dryRun: false,
    help: false,
  };

  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      out.help = true;
    } else if (arg === "--profileId" && i + 1 < argv.length) {
      out.profileId = argv[++i];
    } else if (arg === "--since" && i + 1 < argv.length) {
      out.since = argv[++i];
    } else if (arg === "--until" && i + 1 < argv.length) {
      out.until = argv[++i];
    } else if (arg === "--bucket" && i + 1 < argv.length) {
      out.bucket = argv[++i];
    } else if (arg === "--dry-run") {
      out.dryRun = true;
    }
  }
  return out;
}

function help() {
  console.log(`
Limpia documentos backfilled duplicados de imágenes rejected, agrupando por tamaño de archivo.

Las imágenes duplicadas (misma foto subida múltiples veces) tienen el mismo tamaño,
por lo que agrupa por tamaño y mantiene solo uno por grupo.

Uso:
  node scripts/cleanup-duplicate-backfilled.cjs [opciones]

Opciones:
  --profileId <id>      Limpia solo un perfil específico
  --since <YYYY-MM-DD>  Filtra usuarios creados desde (default: 2025-12-19)
  --until <YYYY-MM-DD>  Filtra usuarios creados hasta (default: 2026-02-03)
  --bucket <name>       Bucket de Storage (default: BACKFILL_BUCKET env var)
  --dry-run             Solo muestra qué se eliminaría, no elimina nada
  --help                Muestra esta ayuda

Ejemplos:
  node scripts/cleanup-duplicate-backfilled.cjs --dry-run
  node scripts/cleanup-duplicate-backfilled.cjs --profileId 1b4FpE9yZnfCKvPuyHPy --dry-run
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

function decodeStoragePathFromFirebaseUrl(url) {
  try {
    if (!url) return null;
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

async function getFileSize(bucket, storagePath) {
  try {
    const file = bucket.file(storagePath);
    const [metadata] = await file.getMetadata();
    return metadata.size ? parseInt(metadata.size, 10) : null;
  } catch {
    return null;
  }
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

function groupByFileSize(docsWithSize) {
  // Agrupa documentos por tamaño de archivo
  const groups = new Map();
  
  for (const item of docsWithSize) {
    const size = item.size;
    if (size === null) {
      // Si no se pudo obtener el tamaño, poner en grupo especial
      const key = "unknown";
      if (!groups.has(key)) {
        groups.set(key, []);
      }
      groups.get(key).push(item);
    } else {
      const key = size.toString();
      if (!groups.has(key)) {
        groups.set(key, []);
      }
      groups.get(key).push(item);
    }
  }
  
  return groups;
}

async function cleanupProfile(db, bucket, profileId, dryRun) {
  // Primero obtener TODOS los documentos (normales y rejected) para el conteo
  const allSnap = await db.collection("photoHistory")
    .where("profileId", "==", profileId)
    .get();
  
  // Separar normales y rejected
  const allNormal = [];
  const allRejected = [];
  
  for (const doc of allSnap.docs) {
    const data = doc.data();
    if (data.rejected === true) {
      allRejected.push(doc);
    } else {
      allNormal.push(doc);
    }
  }
  
  // Ahora trabajar solo con rejected para la limpieza
  const snap = await db.collection("photoHistory")
    .where("profileId", "==", profileId)
    .where("rejected", "==", true) // SOLO rejected
    .get();
  
  // Separar documentos backfilled de los originales (solo rejected)
  const backfilled = [];
  const originals = [];
  
  for (const doc of snap.docs) {
    const data = doc.data();
    if (data.backfillSource === "storage") {
      backfilled.push(doc);
    } else {
      originals.push(doc);
    }
  }
  
  if (backfilled.length === 0) {
    return { 
      kept: originals.length, 
      deleted: 0, 
      groups: 0, 
      duplicateGroups: 0, 
      originals: originals.length,
      backfilledTotal: 0,
      normalCount: allNormal.length,
      rejectedBefore: allRejected.length,
      rejectedAfter: originals.length,
      rejectedDeleted: 0,
    };
  }
  
  // Obtener tamaño de archivo para cada documento backfilled
  const backfilledWithSize = [];
  for (const doc of backfilled) {
    const data = doc.data();
    const storagePath = data.storagePath || decodeStoragePathFromFirebaseUrl(data.imageUrl);
    
    let size = null;
    if (storagePath) {
      size = await getFileSize(bucket, storagePath);
    }
    
    backfilledWithSize.push({
      doc,
      data,
      storagePath,
      size,
    });
  }
  
  // Agrupar por tamaño de archivo
  const groups = groupByFileSize(backfilledWithSize);
  
  let kept = 0;
  let deleted = 0;
  const toDelete = [];
  let duplicateGroups = 0;
  
  for (const [sizeKey, groupItems] of groups.entries()) {
    if (groupItems.length <= 1) {
      // No hay duplicados en este grupo, mantenerlo
      kept += groupItems.length;
      continue;
    }
    
    // Hay duplicados (mismo tamaño)
    duplicateGroups++;
    
    // Verificar si hay un documento original con el mismo tamaño
    // (aunque esto es raro, ya que los originales no deberían tener backfillSource)
    const groupSize = sizeKey !== "unknown" ? parseInt(sizeKey, 10) : null;
    let hasOriginal = false;
    
    if (groupSize !== null) {
      // Verificar si algún original tiene el mismo tamaño
      for (const orig of originals) {
        const origData = orig.data();
        const origStoragePath = origData.storagePath || decodeStoragePathFromFirebaseUrl(origData.imageUrl);
        if (origStoragePath) {
          const origSize = await getFileSize(bucket, origStoragePath);
          if (origSize === groupSize) {
            hasOriginal = true;
            break;
          }
        }
      }
    }
    
    if (hasOriginal) {
      // Hay un original con este tamaño, eliminar todos los backfilled
      toDelete.push(...groupItems.map(item => item.doc));
      deleted += groupItems.length;
    } else {
      // No hay original, mantener el más reciente backfilled, eliminar los demás
      // Ordenar por fecha de creación del documento (más reciente primero)
      groupItems.sort((a, b) => {
        const aTime = a.doc.createTime?.toMillis() || 0;
        const bTime = b.doc.createTime?.toMillis() || 0;
        return bTime - aTime;
      });
      
      // Mantener el primero (más reciente)
      kept += 1;
      // Eliminar los demás
      if (groupItems.length > 1) {
        toDelete.push(...groupItems.slice(1).map(item => item.doc));
        deleted += groupItems.length - 1;
      }
    }
  }
  
  // También mantener documentos originales (nunca se eliminan)
  const totalKept = kept + originals.length;
  
  // VERIFICACIÓN DE SEGURIDAD: Asegurar que NUNCA se eliminen fotos normales (correctas)
  // Solo se eliminan rejected backfilled duplicadas
  const safeToDelete = [];
  for (const doc of toDelete) {
    const data = doc.data();
    // DOBLE VERIFICACIÓN: Solo eliminar si es rejected Y backfilled
    if (data.rejected === true && data.backfillSource === "storage") {
      safeToDelete.push(doc);
    } else {
      console.warn(`⚠️  SEGURIDAD: Se intentó eliminar un documento que NO es rejected backfilled. DocId: ${doc.id}, rejected: ${data.rejected}, backfillSource: ${data.backfillSource}`);
    }
  }
  
  // Ajustar contador de eliminados a los que realmente se eliminarán (solo los seguros)
  const actualDeleted = safeToDelete.length;
  
  // Eliminar documentos duplicados (solo los seguros)
  if (!dryRun && safeToDelete.length > 0) {
    let batch = db.batch();
    let ops = 0;
    
    for (const doc of safeToDelete) {
      batch.delete(doc.ref);
      ops++;
      
      if (ops >= 400) {
        await batch.commit();
        batch = db.batch();
        ops = 0;
      }
    }
    
    if (ops > 0) {
      await batch.commit();
    }
  }
  
  return {
    kept: totalKept,
    deleted: actualDeleted,
    groups: groups.size,
    duplicateGroups,
    originals: originals.length,
    backfilledTotal: backfilled.length,
    // Información adicional para el reporte
    normalCount: allNormal.length,
    rejectedBefore: allRejected.length,
    rejectedAfter: totalKept, // rejected que quedarán después
    rejectedDeleted: actualDeleted,
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
  
  ensureAdmin(null, bucketName);
  const db = admin.firestore();
  const bucket = admin.storage().bucket(bucketName);
  
  console.log("Limpieza de documentos backfilled duplicados (SOLO REJECTED)");
  console.log("Agrupado por tamaño de archivo");
  console.log(`- Bucket: ${bucketName}`);
  console.log(`- Modo: ${args.dryRun ? "DRY-RUN (no eliminará nada)" : "REAL (eliminará documentos)"}`);
  console.log("");
  
  let profiles = [];
  
  if (args.profileId) {
    profiles = [{ profileId: args.profileId, userId: null, redcap_code: null }];
  } else {
    let sinceDate = new Date(`${args.since}T00:00:00.000Z`);
    let untilDate = new Date(`${args.until}T23:59:59.999Z`);
    
    if (Number.isNaN(sinceDate.getTime()) || Number.isNaN(untilDate.getTime())) {
      console.error("Formato inválido para fechas. Usa YYYY-MM-DD (ej: 2025-12-19).");
      process.exit(1);
    }
    
    console.log(`Obteniendo perfiles desde ${sinceDate.toISOString().split("T")[0]} hasta ${untilDate.toISOString().split("T")[0]}...\n`);
    profiles = await getProfilesFromUsers(db, sinceDate, untilDate);
  }
  
  console.log(`Perfiles a procesar: ${profiles.length}\n`);
  
  const results = [];
  let totalKept = 0;
  let totalDeleted = 0;
  let totalDuplicateGroups = 0;
  let totalOriginals = 0;
  let totalBackfilled = 0;
  let totalNormal = 0;
  let totalRejectedBefore = 0;
  let totalRejectedAfter = 0;
  let processed = 0;
  
  for (const profile of profiles) {
    processed++;
    process.stdout.write(`\rProcesando ${processed}/${profiles.length}: ${profile.profileId}...`);
    
    const result = await cleanupProfile(db, bucket, profile.profileId, args.dryRun);
    
    totalKept += result.kept;
    totalDeleted += result.deleted;
    totalDuplicateGroups += result.duplicateGroups;
    totalOriginals += result.originals;
    totalBackfilled += result.backfilledTotal;
    totalNormal += result.normalCount;
    totalRejectedBefore += result.rejectedBefore;
    totalRejectedAfter += result.rejectedAfter;
    
    // Incluir todos los perfiles en el reporte, no solo los que tienen duplicados
    results.push({
      "Usuario ID": profile.userId || "",
      "Perfil ID": profile.profileId,
      "REDCap": profile.redcap_code || "",
      // ANTES de limpieza
      "Normales (Correctas)": result.normalCount,
      "Rejected ANTES": result.rejectedBefore,
      "Rejected Originales": result.originals,
      "Rejected Backfilled": result.backfilledTotal,
      // DUPLICADOS
      "Grupos de Duplicados": result.duplicateGroups,
      "Rejected Duplicadas a Eliminar": result.rejectedDeleted,
      // DESPUÉS de limpieza
      "Rejected DESPUÉS": result.rejectedAfter,
      "Total DESPUÉS (Normales + Rejected)": result.normalCount + result.rejectedAfter,
    });
  }
  
  console.log("\n\n=== RESUMEN ===");
  console.log(`Perfiles procesados: ${profiles.length}`);
  console.log(`\nANTES de limpieza:`);
  console.log(`  Imágenes Normales (Correctas): ${totalNormal}`);
  console.log(`  Imágenes Rejected: ${totalRejectedBefore}`);
  console.log(`    - Originales: ${totalOriginals}`);
  console.log(`    - Backfilled: ${totalBackfilled}`);
  console.log(`  Total ANTES: ${totalNormal + totalRejectedBefore}`);
  console.log(`\nDuplicados encontrados:`);
  console.log(`  Grupos de duplicados: ${totalDuplicateGroups}`);
  console.log(`  Rejected duplicadas a eliminar: ${totalDeleted}`);
  console.log(`\nDESPUÉS de limpieza:`);
  console.log(`  Imágenes Normales (Correctas): ${totalNormal} (sin cambios)`);
  console.log(`  Imágenes Rejected: ${totalRejectedAfter}`);
  console.log(`  Total DESPUÉS: ${totalNormal + totalRejectedAfter}`);
  console.log(`\nReducción: ${totalRejectedBefore - totalRejectedAfter} rejected eliminadas`);
  
  if (args.dryRun) {
    console.log("\n⚠️  MODO DRY-RUN: No se eliminó nada. Ejecuta sin --dry-run para eliminar.");
  } else {
    console.log("\n✅ Limpieza completada.");
  }
  
  // Generar Excel con resultados
  const wb = XLSX.utils.book_new();
  
  // Hoja 1: Detalle por perfil
  const ws1 = XLSX.utils.json_to_sheet(results);
  XLSX.utils.book_append_sheet(wb, ws1, "Detalle por Perfil");
  
  // Hoja 2: Resumen general
  const summary = [
    { "Métrica": "Perfiles Procesados", "Valor": profiles.length },
    { "Métrica": "", "Valor": "" },
    { "Métrica": "=== ANTES DE LIMPIEZA ===", "Valor": "" },
    { "Métrica": "Imágenes Normales (Correctas)", "Valor": totalNormal },
    { "Métrica": "Imágenes Rejected", "Valor": totalRejectedBefore },
    { "Métrica": "  - Originales", "Valor": totalOriginals },
    { "Métrica": "  - Backfilled", "Valor": totalBackfilled },
    { "Métrica": "Total ANTES", "Valor": totalNormal + totalRejectedBefore },
    { "Métrica": "", "Valor": "" },
    { "Métrica": "=== DUPLICADOS ENCONTRADOS ===", "Valor": "" },
    { "Métrica": "Grupos de Duplicados", "Valor": totalDuplicateGroups },
    { "Métrica": `Rejected Duplicadas ${args.dryRun ? "a Eliminar" : "Eliminadas"}`, "Valor": totalDeleted },
    { "Métrica": "", "Valor": "" },
    { "Métrica": "=== DESPUÉS DE LIMPIEZA ===", "Valor": "" },
    { "Métrica": "Imágenes Normales (Correctas)", "Valor": totalNormal },
    { "Métrica": "Imágenes Rejected", "Valor": totalRejectedAfter },
    { "Métrica": "Total DESPUÉS", "Valor": totalNormal + totalRejectedAfter },
    { "Métrica": "", "Valor": "" },
    { "Métrica": "=== REDUCCIÓN ===", "Valor": "" },
    { "Métrica": "Rejected Eliminadas", "Valor": totalRejectedBefore - totalRejectedAfter },
    { "Métrica": "Porcentaje de Reducción", "Valor": totalRejectedBefore > 0 ? `${((totalDeleted / totalRejectedBefore) * 100).toFixed(2)}%` : "0%" },
  ];
  
  const ws2 = XLSX.utils.json_to_sheet(summary);
  XLSX.utils.book_append_sheet(wb, ws2, "Resumen General");
  
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, -5);
  const filename = `limpieza-duplicados-${args.dryRun ? "dryrun-" : ""}${timestamp}.xlsx`;
  const filepath = path.join(__dirname, filename);
  
  XLSX.writeFile(wb, filepath);
  console.log(`\n✅ Excel generado: ${filepath}`);
  console.log(`   - Hoja 1: Detalle por perfil (${results.length} perfiles)`);
  console.log(`   - Hoja 2: Resumen general`);
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
