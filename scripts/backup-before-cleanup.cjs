/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * Script para crear backup de documentos que se van a eliminar antes de la limpieza.
 * 
 * Guarda todos los documentos backfilled rejected duplicados que serán eliminados
 * en un archivo JSON para poder restaurarlos si es necesario.
 * 
 * Requisitos:
 * - GOOGLE_APPLICATION_CREDENTIALS apuntando a un service account con acceso a Firestore+Storage
 * - BACKFILL_BUCKET (ej: foot-selfie---multiplatform.firebasestorage.app)
 * 
 * Uso:
 *   node scripts/backup-before-cleanup.cjs
 */

const admin = require("firebase-admin");
const fs = require("fs");
const path = require("path");

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
  const groups = new Map();
  
  for (const item of docsWithSize) {
    const size = item.size;
    if (size === null) {
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

async function identifyDuplicatesToDelete(db, bucket, profileId) {
  const snap = await db.collection("photoHistory")
    .where("profileId", "==", profileId)
    .where("rejected", "==", true)
    .get();
  
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
    return [];
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
  
  const toDelete = [];
  
  for (const [sizeKey, groupItems] of groups.entries()) {
    if (groupItems.length <= 1) {
      // No hay duplicados, no se elimina nada
      continue;
    }
    
    // Hay duplicados
    const groupSize = sizeKey !== "unknown" ? parseInt(sizeKey, 10) : null;
    let hasOriginal = false;
    
    if (groupSize !== null) {
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
      // Hay original, eliminar todos los backfilled
      toDelete.push(...groupItems.map(item => ({
        docId: item.doc.id,
        data: item.data,
        storagePath: item.storagePath,
        size: item.size,
      })));
    } else {
      // No hay original, mantener el más reciente, eliminar los demás
      groupItems.sort((a, b) => {
        const aTime = a.doc.createTime?.toMillis() || 0;
        const bTime = b.doc.createTime?.toMillis() || 0;
        return bTime - aTime;
      });
      
      // Eliminar todos excepto el primero
      if (groupItems.length > 1) {
        toDelete.push(...groupItems.slice(1).map(item => ({
          docId: item.doc.id,
          data: item.data,
          storagePath: item.storagePath,
          size: item.size,
        })));
      }
    }
  }
  
  return toDelete;
}

async function main() {
  const bucketName = process.env.BACKFILL_BUCKET;
  if (!bucketName) {
    console.error("Falta BACKFILL_BUCKET. Define la variable de entorno.");
    process.exit(1);
  }
  
  ensureAdmin(null, bucketName);
  const db = admin.firestore();
  const bucket = admin.storage().bucket(bucketName);
  
  const sinceDate = new Date("2025-12-19T00:00:00.000Z");
  const untilDate = new Date("2026-02-03T23:59:59.999Z");
  
  console.log("Creando backup de documentos que se eliminarán...");
  console.log(`- Bucket: ${bucketName}`);
  console.log(`- Rango: ${sinceDate.toISOString().split("T")[0]} hasta ${untilDate.toISOString().split("T")[0]}`);
  console.log("");
  
  const profiles = await getProfilesFromUsers(db, sinceDate, untilDate);
  console.log(`Perfiles a procesar: ${profiles.length}\n`);
  
  const backup = {
    timestamp: new Date().toISOString(),
    totalProfiles: profiles.length,
    documents: [],
  };
  
  let processed = 0;
  let totalToDelete = 0;
  
  for (const profile of profiles) {
    processed++;
    process.stdout.write(`\rProcesando ${processed}/${profiles.length}: ${profile.profileId}...`);
    
    const toDelete = await identifyDuplicatesToDelete(db, bucket, profile.profileId);
    
    for (const item of toDelete) {
      // Convertir Timestamps a strings para JSON
      const docData = { ...item.data };
      if (docData.date && docData.date.toDate) {
        docData.date = docData.date.toDate().toISOString();
      }
      if (docData.capturedAt && docData.capturedAt.toDate) {
        docData.capturedAt = docData.capturedAt.toDate().toISOString();
      }
      if (docData.backfilledAt && docData.backfilledAt.toDate) {
        docData.backfilledAt = docData.backfilledAt.toDate().toISOString();
      }
      
      backup.documents.push({
        profileId: profile.profileId,
        userId: profile.userId,
        redcap_code: profile.redcap_code,
        docId: item.docId,
        storagePath: item.storagePath,
        fileSize: item.size,
        data: docData,
      });
    }
    
    totalToDelete += toDelete.length;
  }
  
  console.log(`\n\nTotal documentos a eliminar: ${totalToDelete}`);
  
  // Guardar backup
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, -5);
  const filename = `backup-duplicados-eliminar-${timestamp}.json`;
  const filepath = path.join(__dirname, filename);
  
  fs.writeFileSync(filepath, JSON.stringify(backup, null, 2), "utf8");
  
  console.log(`\n✅ Backup creado: ${filepath}`);
  console.log(`   - ${backup.documents.length} documentos guardados`);
  console.log(`   - ${backup.totalProfiles} perfiles procesados`);
  console.log(`\n⚠️  IMPORTANTE: Este backup contiene los documentos que se ELIMINARÁN.`);
  console.log(`   Guárdalo en un lugar seguro antes de ejecutar la limpieza.`);
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
