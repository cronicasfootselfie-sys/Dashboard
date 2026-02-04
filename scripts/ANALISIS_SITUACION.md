# 📊 Análisis de la Situación Actual - Dashboard FootSelfie

**Fecha del análisis**: 3 de febrero de 2026  
**Rango de usuarios analizados**: 19 dic 2025 - 3 feb 2026

---

## 🔍 Problema Inicial Identificado

### Síntoma
- **Imágenes rechazadas en Firebase Storage no aparecían en el dashboard**
- Las imágenes existían en Storage pero faltaban documentos en Firestore `photoHistory`
- El dashboard solo muestra fotos que tienen documentos en Firestore

### Causa Raíz (ACTUALIZADA)

**Bug identificado en la app móvil** (ya corregido):

1. **ID determinístico incorrecto**: Se generaba con `DateTime.now().millisecondsSinceEpoch` cada vez que se guardaba una foto rechazada
   - ❌ **ANTES**: `final timestamp = DateTime.now().millisecondsSinceEpoch` (cambiaba en cada reintento)
   - ✅ **AHORA**: `final capturedTimestamp = widget.capturedAt.millisecondsSinceEpoch` (constante para la misma foto)

2. **Consecuencias del bug**:
   - Múltiples archivos en Storage: cada reintento creaba un nuevo archivo con timestamp diferente
   - Archivos huérfanos: solo el último intento exitoso creaba el documento en Firestore, dejando archivos anteriores sin documento
   - Sin protección: no había protección contra múltiples llamadas simultáneas

3. **Solución implementada en la app móvil**:
   - ID determinístico basado en `capturedAt` (constante para la misma foto)
   - Flag `_isSavingRejected` para evitar múltiples llamadas simultáneas
   - Verificación de existencia en Storage antes de subir

**Impacto**:
- Antes: múltiples archivos en Storage, muchos sin documento en Firestore (archivos huérfanos)
- Ahora: un solo archivo por foto, consistencia entre Storage y Firestore

**Nota**: El problema ya está corregido en la app móvil. Los archivos huérfanos existentes pueden:
- Eliminarse manualmente si no son necesarios
- Recuperarse creando documentos en Firestore con el ID esperado

---

## 📈 Análisis de Datos Actual

### Resumen Ejecutivo

| Métrica | Firestore (sin backfill) | Storage | Diferencia |
|---------|-------------------------|---------|------------|
| **Fotos Rechazadas** | 418 | 2,445 | **+2,027** ⚠️ |
| **Fotos Correctas** | 633 | 663 | +30 |
| **Total** | 1,051 | 3,108 | **+2,057** |

### Hallazgos Clave

1. **2,027 imágenes rechazadas en Storage sin documento en Firestore**
   - ⚠️ **Estas son probablemente archivos huérfanos/duplicados** creados por el bug anterior
   - Cada reintento de guardado creaba un nuevo archivo, pero solo el último creaba documento
   - Representa el **83% de las imágenes rechazadas** en Storage
   - Solo el 17% de las rechazadas tienen documento en Firestore

2. **30 imágenes correctas en Storage sin documento en Firestore**
   - Mucho menor que las rechazadas
   - Pueden ser también archivos huérfanos o casos edge

3. **52 perfiles analizados** (del rango de fechas especificado)
   - Todos tienen al menos 1 perfil asociado
   - Cada usuario tiene exactamente 1 perfil

4. **El bug ya está corregido en la app móvil**
   - Los nuevos archivos no deberían tener este problema
   - Los archivos existentes son legado del bug anterior

---

## 🛠️ Soluciones Implementadas

### 1. Script de Backfill (`backfill-photoHistory.cjs`)

**Propósito**: Crear documentos faltantes en Firestore para imágenes que existen en Storage

**Características**:
- ✅ **Idempotente**: No crea duplicados (verifica por `storagePath` y `imageUrl`)
- ✅ **Filtrado por perfil**: Puede procesar un perfil específico o todos
- ✅ **Solo rechazadas**: Opción `--only-rejected` para procesar solo imágenes rechazadas
- ✅ **Fuente de perfiles**: Puede usar Storage, Firestore profiles, o Firestore users
- ✅ **Filtrado por fecha**: `--users-since` para filtrar usuarios por `createdAt`
- ✅ **Marcado de backfill**: Los documentos creados tienen `backfillSource: "storage"` para identificarlos
- ✅ **Texto personalizado**: Permite establecer `summary` y `message` para imágenes rechazadas

**Mejoras recientes**:
- Detección mejorada de duplicados (verifica `storagePath` directo y `imageUrl` normalizado)
- Soporte para actualizar documentos backfilled existentes

### 2. Script de Listado de Usuarios-Perfiles (`list-users-profiles.cjs`)

**Propósito**: Listar todos los usuarios con sus perfiles asociados

**Características**:
- ✅ Filtrado por rango de fechas (`createdAt` del usuario)
- ✅ Exportación a Excel con formato estructurado
- ✅ Búsqueda de usuario por `profileId`
- ✅ Filtrado por código REDCap

### 3. Script de Conteo Comparativo (`count-photos-by-source.cjs`)

**Propósito**: Comparar conteos entre Firestore y Storage

**Características**:
- ✅ Cuenta fotos rechazadas vs correctas en ambas fuentes
- ✅ Excluye documentos backfilled del conteo de Firestore
- ✅ Genera Excel con desglose por perfil
- ✅ Calcula diferencias entre fuentes

### 4. Corrección del Dashboard (`PhotosGallery.tsx`)

**Cambios realizados**:
- ❌ **Revertido**: Se intentó agregar deduplicación visual pero ocultaba fotos legítimas
- ✅ **Estado actual**: Muestra todas las fotos sin filtrado adicional

---

## 📋 Estado Actual de los Datos

### Documentos en Firestore `photoHistory`

- **Total documentos**: 1,051 (sin contar backfilled)
- **Rechazadas**: 418
- **Correctas**: 633
- **Documentos backfilled**: Desconocido (marcados con `backfillSource: "storage"`)

### Archivos en Storage

- **Total archivos**: 3,108 imágenes
- **Rechazadas**: 2,445 (archivos con `*_rejected.*`)
- **Correctas**: 663

### Discrepancia

- **2,057 archivos en Storage sin documento en Firestore**
- Principalmente imágenes rechazadas (2,027 de 2,057)

---

## 🎯 Próximos Pasos Recomendados

### Opción A: Backfill Completo (Recomendado)

**Objetivo**: Sincronizar todos los documentos faltantes

**Comando sugerido**:
```bash
npm run backfill:photoHistory -- \
  --profile-source firestore-users \
  --users-since 2025-12-19 \
  --only-rejected \
  --rejected-summary "No se reconocio la planta del pie." \
  --rejected-message "No se reconocio la planta del pie."
```

**Ventajas**:
- ✅ Todas las imágenes rechazadas aparecerán en el dashboard
- ✅ Datos completos y sincronizados
- ✅ Mejor experiencia de usuario

**Consideraciones**:
- ⚠️ Creará ~2,027 documentos nuevos en Firestore
- ⚠️ Puede tomar tiempo (depende de la cantidad de perfiles)
- ⚠️ Los documentos tendrán `backfillSource: "storage"` para identificarlos

### Opción B: Backfill Incremental por Perfil

**Objetivo**: Procesar perfiles específicos que más lo necesiten

**Proceso**:
1. Revisar el Excel `conteo-fotos-*.xlsx`
2. Identificar perfiles con mayor diferencia (Storage vs Firestore)
3. Ejecutar backfill por perfil:
   ```bash
   npm run backfill:photoHistory -- \
     --profileId <profileId> \
     --only-rejected
   ```

**Ventajas**:
- ✅ Control granular
- ✅ Puede ejecutarse en etapas
- ✅ Menor riesgo si algo falla

### Opción C: Investigar Causa en la App Móvil

**Objetivo**: Prevenir que el problema continúe ocurriendo

**Preguntas a investigar**:
- ¿Por qué la app no crea documentos en Firestore para imágenes rechazadas?
- ¿Hay algún error en el flujo de guardado?
- ¿Falta manejo de errores o reintentos?

**Recomendación**: Hacer esto **en paralelo** con el backfill

---

## 🔧 Herramientas Disponibles

### Scripts NPM

1. **`npm run backfill:photoHistory`**
   - Backfill de documentos faltantes
   - Ver `scripts/backfill-photoHistory.cjs --help` para opciones

2. **`npm run list:users-profiles`**
   - Listar usuarios y perfiles
   - Exportar a Excel con `--output excel`

3. **`npm run count:photos`**
   - Contar fotos por fuente
   - Genera Excel comparativo

### Archivos Generados

- `scripts/usuarios-perfiles-*.xlsx`: Lista de usuarios y perfiles
- `scripts/conteo-fotos-*.xlsx`: Conteo comparativo Firestore vs Storage

---

## ⚠️ Problemas Conocidos

### 1. Duplicados Potenciales

**Situación**: El backfill puede crear documentos duplicados si:
- Un documento existente no tiene `storagePath` explícito
- El `imageUrl` no se puede decodificar correctamente
- Hay variaciones en los tokens de descarga

**Mitigación**: 
- ✅ Mejora reciente en detección de duplicados
- ⚠️ Puede haber duplicados creados antes de la mejora

**Solución futura**: Script de limpieza de duplicados (si es necesario)

### 2. Dashboard Muestra Duplicados Visuales

**Situación**: Fotos que aparecen duplicadas en el dashboard

**Causa**: 
- Múltiples documentos en Firestore apuntando al mismo archivo
- O fotos tomadas en el mismo segundo (se ven iguales por formato de fecha)

**Estado**: 
- ❌ Intentamos deduplicación visual pero ocultaba fotos legítimas
- ✅ Actualmente se muestran todas las fotos

---

## 📊 Métricas de Calidad de Datos

### Cobertura de Documentos

- **Firestore vs Storage (Correctas)**: 95.4% (633/663)
- **Firestore vs Storage (Rechazadas)**: 17.1% (418/2,445) ⚠️
- **Firestore vs Storage (Total)**: 33.8% (1,051/3,108) ⚠️

### Conclusión

**El problema es principalmente con imágenes rechazadas**: Solo el 17% tiene documento en Firestore, mientras que las correctas tienen 95% de cobertura.

---

## 🚀 Recomendación Final

### Acción Inmediata

1. **Ejecutar backfill completo para imágenes rechazadas**:
   ```bash
   npm run backfill:photoHistory -- \
     --profile-source firestore-users \
     --users-since 2025-12-19 \
     --only-rejected \
     --rejected-summary "No se reconocio la planta del pie." \
     --rejected-message "No se reconocio la planta del pie." \
     --dry-run  # Primero en modo dry-run para verificar
   ```

2. **Verificar resultados** con `npm run count:photos` después del backfill

3. **Investigar causa en app móvil** para prevenir futuros problemas

### Acción a Mediano Plazo

- Monitorear discrepancias periódicamente
- Considerar automatizar el backfill si el problema persiste
- Mejorar el flujo de guardado en la app móvil

---

## 📝 Notas Técnicas

### Estructura de Datos

**Firestore `photoHistory`**:
- `profileId`: ID del perfil
- `date`: Timestamp de captura
- `imageUrl`: URL de descarga de Firebase Storage
- `storagePath`: Ruta en Storage (si existe)
- `rejected`: Boolean
- `summary`: Texto descriptivo
- `backfillSource`: "storage" si fue creado por backfill

**Storage**:
- Ruta: `photoHistory/{profileId}/{timestamp}[_rejected].{ext}`
- Formato rechazadas: `*_rejected.jpg`

### Identificación de Backfilled

Los documentos creados por el backfill tienen:
- `backfillSource: "storage"`
- `backfilledAt: Timestamp`
- `storagePath: string` (siempre presente)

Esto permite:
- Excluirlos de conteos si es necesario
- Identificarlos para actualizaciones futuras
- Rastrear cuáles fueron creados por el script

---

**Última actualización**: 3 de febrero de 2026
