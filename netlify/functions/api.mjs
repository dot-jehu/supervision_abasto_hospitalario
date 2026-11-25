// SESTAH · API de almacenamiento compartido (Netlify Functions + Netlify Blobs)
// Acceso controlado por dos claves definidas como variables de entorno en Netlify:
//   SESTAH_CLAVE        -> supervisores (capturan, validan, dan seguimiento)
//   SESTAH_CLAVE_ADMIN  -> administración (además modifica carteras, catálogo y parámetros)
import { getStore } from "@netlify/blobs";

const COLS = ["cuestionarios", "alertas", "perfiles", "config"];
const ID_OK = /^[A-Za-z0-9_.:@+\-]{1,200}$/;

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });

export default async (req) => {
  const KEY = (process.env.SESTAH_CLAVE || "").trim();
  const ADM = (process.env.SESTAH_CLAVE_ADMIN || "").trim();
  const isDiag = new URL(req.url).pathname === "/api/estado";
  if (!isDiag && (!KEY || !ADM)) return json({ error: "El servidor no tiene configuradas las claves de acceso (SESTAH_CLAVE y SESTAH_CLAVE_ADMIN)." }, 500);

  // Diagnóstico sin clave: solo informa si la configuración está completa, nunca los valores.
  if (new URL(req.url).pathname === "/api/estado") {
    let almacenamiento = "ok";
    try {
      await getStore({ name: "sestah", consistency: "strong" }).list({ prefix: "config/" });
    } catch (e) {
      almacenamiento = "error: " + String(e && e.message || e).slice(0, 200);
    }
    return json({ funcion: true, claveSupervision: !!KEY, claveAdministracion: !!ADM, almacenamiento });
  }
  const k = req.headers.get("x-sestah-clave") || "";
  const isAdmin = k === ADM;
  if (!isAdmin && k !== KEY) return json({ error: "Clave de acceso inválida." }, 401);

  const store = getStore({ name: "sestah", consistency: "strong" });
  const path = new URL(req.url).pathname;

  try {
    if (req.method === "GET" && path === "/api/data") {
      const out = { admin: isAdmin };
      const sinCatalogo = new URL(req.url).searchParams.get("catalogo") === "0";
      for (const c of COLS) {
        out[c] = {};
        let { blobs } = await store.list({ prefix: c + "/" });
        if (sinCatalogo && c === "config") blobs = blobs.filter((b) => b.key !== "config/catalogo");
        const vals = await Promise.all(blobs.map((b) => store.get(b.key, { type: "json" })));
        blobs.forEach((b, i) => {
          if (vals[i]) out[c][b.key.slice(c.length + 1)] = vals[i];
        });
      }
      return json(out);
    }

    if (req.method === "PUT" && path === "/api/doc") {
      const body = await req.json().catch(() => null);
      const { col, id, data } = body || {};
      if (!COLS.includes(col) || typeof id !== "string" || !ID_OK.test(id) || !data || typeof data !== "object" || Array.isArray(data))
        return json({ error: "Solicitud inválida." }, 400);
      if (col === "config" && !isAdmin) return json({ error: "Solo la administración puede modificar la configuración." }, 403);
      const limite = col === "config" && id === "catalogo" ? 4000000 : 300000;
      if (JSON.stringify(data).length > limite) return json({ error: "Documento demasiado grande." }, 413);
      await store.setJSON(col + "/" + id, data);
      return json({ ok: true });
    }

    if (req.method === "POST" && path === "/api/reset") {
      if (!isAdmin) return json({ error: "Solo la administración puede reiniciar los datos." }, 403);
      const body = await req.json().catch(() => ({}));
      if (body.confirmacion !== "BORRAR") return json({ error: "Falta la confirmación BORRAR." }, 400);
      const cols = ["cuestionarios", "alertas"];
      if (body.perfiles) cols.push("perfiles");
      let eliminados = 0;
      for (const c of cols) {
        const { blobs } = await store.list({ prefix: c + "/" });
        for (const b of blobs) { await store.delete(b.key); eliminados++; }
      }
      console.log("SESTAH reinicio de datos", cols.join(","), eliminados);
      return json({ ok: true, eliminados, colecciones: cols });
    }

    return json({ error: "Ruta no encontrada." }, 404);
  } catch (e) {
    console.error("SESTAH api error", e);
    return json({ error: "Error del almacenamiento. Revise los registros de la función." }, 500);
  }
};

export const config = { path: ["/api/data", "/api/doc", "/api/estado", "/api/reset"] };
