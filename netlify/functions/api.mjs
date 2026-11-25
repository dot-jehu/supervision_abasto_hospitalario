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
  const KEY = process.env.SESTAH_CLAVE;
  const ADM = process.env.SESTAH_CLAVE_ADMIN;
  if (!KEY || !ADM) return json({ error: "El servidor no tiene configuradas las claves de acceso." }, 500);

  const k = req.headers.get("x-sestah-clave") || "";
  const isAdmin = k === ADM;
  if (!isAdmin && k !== KEY) return json({ error: "Clave de acceso inválida." }, 401);

  const store = getStore({ name: "sestah", consistency: "strong" });
  const path = new URL(req.url).pathname;

  try {
    if (req.method === "GET" && path === "/api/data") {
      const out = { admin: isAdmin };
      for (const c of COLS) {
        out[c] = {};
        const { blobs } = await store.list({ prefix: c + "/" });
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
      if (JSON.stringify(data).length > 300000) return json({ error: "Documento demasiado grande." }, 413);
      await store.setJSON(col + "/" + id, data);
      return json({ ok: true });
    }

    return json({ error: "Ruta no encontrada." }, 404);
  } catch (e) {
    console.error("SESTAH api error", e);
    return json({ error: "Error del almacenamiento. Revise los registros de la función." }, 500);
  }
};

export const config = { path: ["/api/data", "/api/doc"] };
