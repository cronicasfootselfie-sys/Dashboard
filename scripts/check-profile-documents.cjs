/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * Script para verificar cuántos documentos existen en Firestore para un perfil
 * y compararlos con los archivos en Storage.
 * 
 * Requisitos:
 * - GOOGLE_APPLICATION_CREDENTIALS apuntando a un service account con acceso a Firestore+Storage
 * - BACKFILL_BUCKET (opcional, puede pasarse con --bucket)
 * 
 * Uso:
 *   node scripts/check-profile-documents.cjs --profileId ni7VequMC79dIURmIz6a
 */

const admin = require("firebase-admin");

function parseArgs(argv) {
  const out = {
    profileId: null,
    bucket: process.env.BACKFILL_BUCKET || null,
    help: false,
  };

  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      out.help = true;
    } else if (arg === "--profileId" && i + 1 < argv.length) {
      out.profileId = argv[++i];
    } else if (arg === "--bucket" && i + 1 < argv.length) {
      out.bucket = argv[++i];
    }
  }
  return out;
}

function ensureAdmin(projectId, bucket) {
  if (admin.apps.length === 0) {
    const cfg = {};
    if (projectId) cfg.projectId = projectId;
    if (bucket) cfg.storageBucket = bucket;
    admin.initializeApp({
      credential: admin.credential.applicationDefault(),
      ...cfg,
    });
  }
}

function formatDate(timestamp) {
  if (!timestamp) return "N/A";
  try {
    if (timestamp.toDate) {
      return timestamp.toDate().toISOString();
    }
    if (timestamp.seconds) {
      return new Date(timestamp.seconds * 1000).toISOString();
    }
    return new Date(timestamp).toISOString();
  } catch {
    return String(timestamp);
  }
}

function inferDateFromFilename(name) {
  const base = name.split("/").pop() || name;
  const m = base.match(/^(\d{13})/);
  if (!m) return null;
  const ms = Number(m[1]);
  if (!Number.isFinite(ms)) return null;
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

async function checkProfile(db, storage, profileId) {
  console.log(`\n=== VERIFICACIÓN PARA PERFIL: ${profileId} ===\n`);
  
  // 1. Contar documentos en Firestore
  const firestoreSnap = await db.collection("photoHistory")
    .where("profileId", "==", profileId)
    .get();
  
  console.log(`📄 DOCUMENTOS EN FIRESTORE: ${firestoreSnap.size}`);
  
  // Separar por tipo
  const normal = [];
  const rejected = [];
  const backfilled = [];
  const original = [];
  
  const cutoffDate = new Date('2025-12-18T00:00:00.000Z');
  const beforeCutoff = [];
  const afterCutoff = [];
  const dec2025 = [];
  const jan2026 = [];
  
  for (const doc of firestoreSnap.docs) {
    const data = doc.data();
    const date = data.date;
    
    let docDate = null;
    if (date) {
      if (date.toDate) {
        docDate = date.toDate();
      } else if (date.seconds) {
        docDate = new Date(date.seconds * 1000);
      } else {
        docDate = new Date(date);
      }
    }
    
    if (docDate) {
      if (docDate < cutoffDate) {
        beforeCutoff.push({ docId: doc.id, date: docDate, data });
      } else {
        afterCutoff.push({ docId: doc.id, date: docDate, data });
        
        // Clasificar por mes
        if (docDate.getFullYear() === 2025 && docDate.getMonth() === 11) {
          dec2025.push({ docId: doc.id, date: docDate, data });
        } else if (docDate.getFullYear() === 2026 && docDate.getMonth() === 0) {
          jan2026.push({ docId: doc.id, date: docDate, data });
        }
      }
    } else {
      afterCutoff.push({ docId: doc.id, date: null, data });
    }
    
    if (data.rejected === true) {
      rejected.push(doc);
    } else {
      normal.push(doc);
    }
    
    if (data.backfillSource === "storage") {
      backfilled.push(doc);
    } else {
      original.push(doc);
    }
  }
  
  console.log(`  - Normales (correctas): ${normal.length}`);
  console.log(`  - Rejected: ${rejected.length}`);
  console.log(`  - Originales (no backfilled): ${original.length}`);
  console.log(`  - Backfilled: ${backfilled.length}`);
  console.log(`  - Antes de 2025-12-18: ${beforeCutoff.length}`);
  console.log(`  - Desde 2025-12-18: ${afterCutoff.length}`);
  console.log(`  - Diciembre 2025: ${dec2025.length}`);
  console.log(`  - Enero 2026: ${jan2026.length}`);
  
  // 2. Contar archivos en Storage
  if (storage) {
    const bucket = storage.bucket();
    const prefix = `photoHistory/${profileId}/`;
    const [files] = await bucket.getFiles({ prefix });
    
    console.log(`\n📦 ARCHIVOS EN STORAGE: ${files.length}`);
    
    const storageNormal = [];
    const storageRejected = [];
    const storageDec2025 = [];
    const storageJan2026 = [];
    
    for (const file of files) {
      const name = file.name;
      if (name.includes("_rejected.")) {
        storageRejected.push(file);
      } else {
        storageNormal.push(file);
      }
      
      const fileDate = inferDateFromFilename(name);
      if (fileDate) {
        if (fileDate.getFullYear() === 2025 && fileDate.getMonth() === 11) {
          storageDec2025.push(file);
        } else if (fileDate.getFullYear() === 2026 && fileDate.getMonth() === 0) {
          storageJan2026.push(file);
        }
      }
    }
    
    console.log(`  - Normales: ${storageNormal.length}`);
    console.log(`  - Rejected: ${storageRejected.length}`);
    console.log(`  - Diciembre 2025: ${storageDec2025.length}`);
    console.log(`  - Enero 2026: ${storageJan2026.length}`);
    
    // Comparación
    console.log(`\n📊 COMPARACIÓN:`);
    console.log(`  Firestore vs Storage:`);
    console.log(`    Total: ${firestoreSnap.size} vs ${files.length} (diferencia: ${files.length - firestoreSnap.size})`);
    console.log(`    Diciembre 2025: ${dec2025.length} vs ${storageDec2025.length} (diferencia: ${storageDec2025.length - dec2025.length})`);
    console.log(`    Enero 2026: ${jan2026.length} vs ${storageJan2026.length} (diferencia: ${storageJan2026.length - jan2026.length})`);
  }
  
  // 3. Verificar query del dashboard
  console.log(`\n🔍 QUERY DEL DASHBOARD:`);
  try {
    const dashboardQuery = await db.collection("photoHistory")
      .where("profileId", "==", profileId)
      .where("date", ">=", admin.firestore.Timestamp.fromDate(cutoffDate))
      .orderBy("date", "desc")
      .limit(50)
      .get();
    
    console.log(`  Resultados: ${dashboardQuery.size} documentos`);
    console.log(`  (Debería mostrar ${afterCutoff.length} documentos con fecha >= 2025-12-18)`);
    
    if (dashboardQuery.size === 0 && afterCutoff.length > 0) {
      console.log(`\n  ⚠️  PROBLEMA: Hay ${afterCutoff.length} documentos con fecha >= cutoff,`);
      console.log(`     pero la query del dashboard devuelve 0 resultados.`);
      console.log(`     Esto puede indicar un problema con el índice de Firestore.`);
    } else if (dashboardQuery.size < afterCutoff.length) {
      console.log(`  ⚠️  La query devuelve menos resultados de los esperados.`);
      console.log(`     Puede ser un problema de límite (limit=50) o índice.`);
    }
  } catch (e) {
    console.log(`  ❌ Error: ${e.message}`);
    if (e.message.includes("index")) {
      console.log(`\n  ⚠️  FALTA UN ÍNDICE COMPUESTO en Firestore.`);
      console.log(`     Necesitas crear un índice para: photoHistory (profileId, date)`);
      console.log(`     Firestore debería darte un link para crearlo automáticamente.`);
    }
  }
  
  // 4. Mostrar ejemplos de documentos de diciembre 2025
  if (dec2025.length > 0) {
    console.log(`\n📅 EJEMPLOS DE DOCUMENTOS DE DICIEMBRE 2025 (primeros 5):`);
    dec2025
      .sort((a, b) => b.date.getTime() - a.date.getTime())
      .slice(0, 5)
      .forEach(item => {
        console.log(`  - ${formatDate(item.data.date)} | Rejected: ${item.data.rejected || false} | Backfilled: ${item.data.backfillSource === "storage" ? "Sí" : "No"}`);
      });
  } else {
    console.log(`\n⚠️  NO HAY DOCUMENTOS EN FIRESTORE CON FECHA DE DICIEMBRE 2025`);
    if (storage && storageDec2025.length > 0) {
      console.log(`     Pero hay ${storageDec2025.length} archivos en Storage de diciembre 2025.`);
      console.log(`     Esto significa que faltan documentos en Firestore para esas fotos.`);
    }
  }
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    console.log(`
Verificar documentos de un perfil en Firestore y Storage

Uso:
  node scripts/check-profile-documents.cjs --profileId <id> [--bucket <name>]

Env:
  GOOGLE_APPLICATION_CREDENTIALS  (requerido)
  BACKFILL_BUCKET                  (opcional, puede pasarse con --bucket)
    `);
    return;
  }
  
  if (!args.profileId) {
    console.error("Falta --profileId");
    process.exit(1);
  }
  
  ensureAdmin(process.env.BACKFILL_PROJECT_ID, args.bucket);
  const db = admin.firestore();
  const storage = args.bucket ? admin.storage() : null;
  
  await checkProfile(db, storage, args.profileId);
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
