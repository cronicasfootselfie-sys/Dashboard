/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * Script para listar usuarios con sus perfiles y encontrar el usuario de un perfil específico.
 * 
 * Requisitos:
 * - GOOGLE_APPLICATION_CREDENTIALS apuntando a un service account con acceso a Firestore
 * 
 * Uso:
 *   node scripts/list-users-profiles.cjs
 *   node scripts/list-users-profiles.cjs --profileId 22m3pTt5EncYWq6BWHk6
 *   node scripts/list-users-profiles.cjs --redcap H2M-12-275
 *   node scripts/list-users-profiles.cjs --output json
 */

const admin = require("firebase-admin");
const XLSX = require("xlsx");
const path = require("path");
const fs = require("fs");

function parseArgs(argv) {
  const out = {
    profileId: null,
    redcap: null,
    output: "table", // "table" | "json" | "excel"
    since: null, // YYYY-MM-DD
    until: null, // YYYY-MM-DD
    help: false,
  };

  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      out.help = true;
    } else if (arg === "--profileId" && i + 1 < argv.length) {
      out.profileId = argv[++i];
    } else if (arg === "--redcap" && i + 1 < argv.length) {
      out.redcap = argv[++i];
    } else if (arg === "--output" && i + 1 < argv.length) {
      out.output = argv[++i];
    } else if (arg === "--since" && i + 1 < argv.length) {
      out.since = argv[++i];
    } else if (arg === "--until" && i + 1 < argv.length) {
      out.until = argv[++i];
    }
  }
  return out;
}

function help() {
  console.log(`
Lista usuarios con sus perfiles.

Uso:
  node scripts/list-users-profiles.cjs [opciones]

Opciones:
  --profileId <id>    Busca el usuario de un perfil específico
  --redcap <code>      Filtra por código REDCap
  --since <YYYY-MM-DD> Filtra usuarios creados desde esta fecha (default: 2025-12-19)
  --until <YYYY-MM-DD> Filtra usuarios creados hasta esta fecha (default: 2026-02-03)
  --output <format>    Formato de salida: "table" (default), "json" o "excel"
  --help               Muestra esta ayuda

Ejemplos:
  node scripts/list-users-profiles.cjs
  node scripts/list-users-profiles.cjs --profileId 22m3pTt5EncYWq6BWHk6
  node scripts/list-users-profiles.cjs --redcap H2M-12-275
  node scripts/list-users-profiles.cjs --since 2025-12-19 --until 2026-02-03
  node scripts/list-users-profiles.cjs --output json
`);
}

function ensureAdmin(projectId) {
  if (admin.apps.length === 0) {
    const creds = process.env.GOOGLE_APPLICATION_CREDENTIALS;
    if (!creds) {
      console.error("Falta GOOGLE_APPLICATION_CREDENTIALS. Define la variable de entorno.");
      process.exit(1);
    }
    admin.initializeApp({
      credential: admin.credential.applicationDefault(),
      projectId: projectId || process.env.BACKFILL_PROJECT_ID,
    });
  }
}

async function findUserByProfileId(db, profileId) {
  const usersSnap = await db.collection("users").get();
  
  for (const userDoc of usersSnap.docs) {
    const profilesSnap = await userDoc.ref.collection("profiles").get();
    for (const profileDoc of profilesSnap.docs) {
      if (profileDoc.id === profileId) {
        const userData = userDoc.data();
        const profileData = profileDoc.data();
        return {
          userId: userDoc.id,
          profileId: profileDoc.id,
          userData,
          profileData,
        };
      }
    }
  }
  return null;
}

async function listAllUsersWithProfiles(db, redcapFilter, sinceDate, untilDate) {
  let q = db.collection("users");
  
  // Filtrar por createdAt si se especifica
  if (sinceDate) {
    q = q.where("createdAt", ">=", admin.firestore.Timestamp.fromDate(sinceDate));
  }
  if (untilDate) {
    // Para until, usamos <= pero necesitamos orderBy para combinar where
    if (sinceDate) {
      q = q.orderBy("createdAt", "asc");
    } else {
      q = q.where("createdAt", "<=", admin.firestore.Timestamp.fromDate(untilDate));
    }
  }
  
  if (redcapFilter) {
    // Si hay filtro de redcap, necesitamos hacer la query de otra manera
    // porque no podemos combinar múltiples where sin index
    if (sinceDate || untilDate) {
      console.warn("⚠️  No se puede combinar --redcap con --since/--until sin index. Filtrando después...");
    } else {
      q = q.where("redcap_code", "==", redcapFilter);
    }
  }
  
  const usersSnap = await q.get();
  const results = [];
  
  for (const userDoc of usersSnap.docs) {
    const userData = userDoc.data();
    
    // Filtro adicional por redcap si se especificó (después de obtener docs)
    if (redcapFilter && userData.redcap_code !== redcapFilter) {
      continue;
    }
    
    // Filtro adicional por untilDate si se especificó (porque Firestore where <= requiere orderBy)
    if (untilDate && userData.createdAt) {
      const userCreatedAt = userData.createdAt.toDate();
      if (userCreatedAt > untilDate) {
        continue;
      }
    }
    
    const profilesSnap = await userDoc.ref.collection("profiles").get();
    const profiles = [];
    
    for (const profileDoc of profilesSnap.docs) {
      profiles.push({
        profileId: profileDoc.id,
        ...profileDoc.data(),
      });
    }
    
    results.push({
      userId: userDoc.id,
      redcap_code: userData.redcap_code || null,
      email: userData.email || null,
      createdAt: userData.createdAt ? userData.createdAt.toDate().toISOString() : null,
      profiles: profiles,
      profilesCount: profiles.length,
    });
  }
  
  return results;
}

function printTable(results) {
  console.log("\n=== PARES USUARIO - PERFIL ===\n");
  
  if (results.length === 0) {
    console.log("No se encontraron usuarios.");
    return;
  }
  
  // Formato simple: usuario -> perfil
  let totalPairs = 0;
  for (const user of results) {
    if (user.profiles.length === 0) {
      console.log(`${user.userId} -> (sin perfiles)`);
    } else {
      for (const profile of user.profiles) {
        console.log(`${user.userId} -> ${profile.profileId}`);
        totalPairs++;
      }
    }
  }
  
  console.log(`\n=== RESUMEN ===`);
  console.log(`Usuarios: ${results.length}`);
  console.log(`Pares usuario-perfil: ${totalPairs}`);
  console.log(`\n=== DETALLE ===\n`);
  
  for (const user of results) {
    console.log(`Usuario: ${user.userId}`);
    if (user.redcap_code) console.log(`  REDCap: ${user.redcap_code}`);
    if (user.email) console.log(`  Email: ${user.email}`);
    if (user.createdAt) console.log(`  Creado: ${user.createdAt}`);
    console.log(`  Perfiles (${user.profilesCount}):`);
    
    if (user.profiles.length === 0) {
      console.log(`    (sin perfiles)`);
    } else {
      for (const profile of user.profiles) {
        console.log(`    - ${profile.profileId}`);
      }
    }
    console.log("");
  }
}

function printJson(results) {
  console.log(JSON.stringify(results, null, 2));
}

function exportToExcel(results, sinceDate, untilDate) {
  // Crear un array plano con todos los pares usuario-perfil
  const rows = [];
  
  for (const user of results) {
    if (user.profiles.length === 0) {
      // Usuario sin perfiles
      rows.push({
        "Usuario ID": user.userId,
        "Perfil ID": "(sin perfiles)",
        "REDCap": user.redcap_code || "",
        "Email": user.email || "",
        "Fecha Creación": user.createdAt || "",
      });
    } else {
      // Un row por cada perfil
      for (const profile of user.profiles) {
        rows.push({
          "Usuario ID": user.userId,
          "Perfil ID": profile.profileId,
          "REDCap": user.redcap_code || "",
          "Email": user.email || "",
          "Fecha Creación": user.createdAt || "",
        });
      }
    }
  }
  
  // Crear workbook
  const wb = XLSX.utils.book_new();
  
  // Hoja 1: Lista completa
  const ws1 = XLSX.utils.json_to_sheet(rows);
  XLSX.utils.book_append_sheet(wb, ws1, "Usuarios-Perfiles");
  
  // Hoja 2: Resumen
  const summary = [
    { "Métrica": "Total Usuarios", "Valor": results.length },
    { "Métrica": "Total Pares Usuario-Perfil", "Valor": rows.length },
    { "Métrica": "Fecha Desde", "Valor": sinceDate ? sinceDate.toISOString().split("T")[0] : "Todos" },
    { "Métrica": "Fecha Hasta", "Valor": untilDate ? untilDate.toISOString().split("T")[0] : "Todos" },
  ];
  const ws2 = XLSX.utils.json_to_sheet(summary);
  XLSX.utils.book_append_sheet(wb, ws2, "Resumen");
  
  // Generar nombre de archivo con timestamp
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, -5);
  const filename = `usuarios-perfiles-${timestamp}.xlsx`;
  const filepath = path.join(__dirname, filename);
  
  // Escribir archivo
  XLSX.writeFile(wb, filepath);
  
  console.log(`\n✅ Archivo Excel creado: ${filepath}`);
  console.log(`   - ${rows.length} filas en la hoja "Usuarios-Perfiles"`);
  console.log(`   - Resumen en la hoja "Resumen"`);
  
  return filepath;
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) return help();
  
  ensureAdmin();
  const db = admin.firestore();
  
  // Caso 1: Buscar usuario de un perfil específico
  if (args.profileId) {
    console.log(`Buscando usuario del perfil: ${args.profileId}...\n`);
    const result = await findUserByProfileId(db, args.profileId);
    
    if (!result) {
      console.log(`❌ No se encontró el perfil ${args.profileId}`);
      process.exit(1);
    }
    
    if (args.output === "json") {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(`✅ Perfil encontrado:\n`);
      console.log(`  Perfil ID: ${result.profileId}`);
      console.log(`  Usuario ID: ${result.userId}`);
      console.log(`  REDCap: ${result.userData.redcap_code || "(sin código)"}`);
      console.log(`  Email: ${result.userData.email || "(sin email)"}`);
      if (result.userData.createdAt) {
        console.log(`  Usuario creado: ${result.userData.createdAt.toDate().toISOString()}`);
      }
      console.log(`\n  Datos del perfil:`);
      console.log(JSON.stringify(result.profileData, null, 4));
    }
    return;
  }
  
  // Caso 2: Listar todos los usuarios con sus perfiles
  // Fechas por defecto: 19 dic 2025 - 3 feb 2026
  let sinceDate = args.since ? new Date(`${args.since}T00:00:00.000Z`) : new Date("2025-12-19T00:00:00.000Z");
  let untilDate = args.until ? new Date(`${args.until}T23:59:59.999Z`) : new Date("2026-02-03T23:59:59.999Z");
  
  if (Number.isNaN(sinceDate.getTime())) {
    console.error("Formato inválido para --since. Usa YYYY-MM-DD (ej: 2025-12-19).");
    process.exit(1);
  }
  if (Number.isNaN(untilDate.getTime())) {
    console.error("Formato inválido para --until. Usa YYYY-MM-DD (ej: 2026-02-03).");
    process.exit(1);
  }
  
  console.log(`Filtrando usuarios creados desde: ${sinceDate.toISOString()}`);
  console.log(`Hasta: ${untilDate.toISOString()}\n`);
  
  const results = await listAllUsersWithProfiles(db, args.redcap, sinceDate, untilDate);
  
  if (args.output === "json") {
    printJson(results);
  } else if (args.output === "excel") {
    exportToExcel(results, sinceDate, untilDate);
    // También mostrar un resumen en consola
    console.log(`\n=== RESUMEN ===`);
    console.log(`Usuarios: ${results.length}`);
    const totalPairs = results.reduce((sum, u) => sum + (u.profiles.length || 1), 0);
    console.log(`Pares usuario-perfil: ${totalPairs}`);
  } else {
    printTable(results);
  }
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
