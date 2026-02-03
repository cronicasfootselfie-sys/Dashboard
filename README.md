This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

## Backfill de fotos (Storage -> Firestore)

El dashboard **NO lista Storage**; solo muestra lo que exista como documento en la colección **Firestore `photoHistory`**.
Si tienes archivos en `gs://.../photoHistory/<profileId>/` (por ejemplo `*_rejected.jpg`) pero no aparecen en el dashboard,
normalmente es porque **no existe el documento correspondiente en Firestore**.

Este repo incluye un script idempotente que:
- Lista objetos en Storage bajo `photoHistory/<profileId>/`
- Busca docs existentes en Firestore `photoHistory` con `profileId == <profileId>`
- **Crea únicamente los docs faltantes** (no duplica)

### Requisitos

- Un **service account** con permisos para **Firestore** y **Cloud Storage**.
- Variable `GOOGLE_APPLICATION_CREDENTIALS` apuntando al JSON del service account.
- Variable `BACKFILL_BUCKET` con el nombre del bucket (ej: `foot-selfie---multiplatform.firebasestorage.app`).

### Ejecución (recomendado con dry-run primero)

```bash
# 1) Vista previa (no escribe nada)
npm run backfill:photoHistory -- --profileId Drdv005RAKYmic6rF7ES --dry-run

# 2) Ejecutar (crea docs faltantes)
npm run backfill:photoHistory -- --profileId Drdv005RAKYmic6rF7ES
```

Para analizar/crear **solo desde una fecha** (ej: corte 18/12/2025):

```bash
npm run backfill:photoHistory -- --dry-run --since 2025-12-18
```

Para hacer backfill **solo de imágenes rechazadas** (archivos `*_rejected.*`):

```bash
npm run backfill:photoHistory -- --dry-run --since 2025-12-18 --only-rejected
```

Si tu bucket tiene muchas carpetas “viejas/test” y quieres procesar solo los perfiles existentes en Firestore
(subcolección `users/*/profiles/*`), usa:

```bash
npm run backfill:photoHistory -- --dry-run --since 2025-12-18 --only-rejected --profile-source firestore-profiles
```

Si quieres que la lista salga **exactamente desde `users`** (y además filtrar por `users.createdAt`):

```bash
npm run backfill:photoHistory -- --dry-run --since 2025-12-18 --only-rejected ^
  --profile-source firestore-users ^
  --users-since 2025-12-18
```

Y para personalizar el texto que se guarda cuando el archivo es `*_rejected.*`:

```bash
npm run backfill:photoHistory -- --profileId Drdv005RAKYmic6rF7ES --dry-run --since 2025-12-18 ^
  --rejected-summary "No se detectaron lesiones." ^
  --rejected-message "Foto rechazada."
```

Notas:
- Por defecto el script intenta asegurar un `firebaseStorageDownloadTokens` en cada objeto faltante para construir un `imageUrl`
  estable tipo `firebasestorage.googleapis.com/...&token=...`. Si no quieres que el script toque metadata del objeto, usa:

```bash
npm run backfill:photoHistory -- --profileId Drdv005RAKYmic6rF7ES --no-set-token
```