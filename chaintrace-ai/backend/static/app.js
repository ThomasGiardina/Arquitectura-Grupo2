/* ============================================================
   ChainTrace-AI — lógica del dashboard (JavaScript vanilla)

   Es una "single page app" muy simple:
   - La sidebar cambia el #hash de la URL (#resumen, #productos, ...).
   - Cada sección es una función que devuelve HTML a partir del estado S.
   - Los datos salen de la API: la cadena completa, la validación y el modelo.
     Todo lo demás (productos, etapas, estadísticas) se calcula acá a partir
     de los bloques de la blockchain.
   ============================================================ */

"use strict";

// ---------- Estado global ----------
const S = {
  chain: [],                                   // todos los bloques
  validacion: { valido: true, bloques: 1 },    // resultado de /api/blockchain/validar
  modelo: null,                                // métricas del modelo de ML
  producto: null,                              // producto seleccionado
  bloque: null,                                // bloque seleccionado en el explorador
  filtroBC: null,                              // producto filtrado en el explorador (null = toda la cadena)
  demoPid: null,                               // lote cargado por el escenario de demo
  tabla: { q: "", pagina: 1 },                 // búsqueda y página del listado de productos
  form: { actor: "", temperatura: "", humedad: "", demora_horas: "", distancia_km: "" },  // valores del formulario de checkpoints
  prediccion: null,                            // predicción en vivo del formulario de checkpoints
};

// ---------- Constantes de presentación ----------
const ACTORES = ["Productor", "Transportista", "Almacén", "Minorista"];
const ETAPA = {
  Productor:     { nombre: "Producción",     icono: "fabrica" },
  Transportista: { nombre: "Transporte",     icono: "camion" },
  Almacén:       { nombre: "Almacén",        icono: "almacen" },
  Minorista:     { nombre: "Punto de venta", icono: "tienda" },
};
const COLOR = { bajo: "var(--bajo)", medio: "var(--medio)", alto: "var(--alto)" };
const VARIABLES = {
  temperatura:  { nombre: "Temperatura", icono: "termo" },
  demora_horas: { nombre: "Demora",      icono: "reloj" },
  humedad:      { nombre: "Humedad",     icono: "gota" },
  distancia_km: { nombre: "Distancia",   icono: "pin" },
};
const POR_PAGINA = 8;

// ============================================================
// Utilidades
// ============================================================

async function api(url, opciones = {}) {
  const r = await fetch(url, { headers: { "Content-Type": "application/json" }, ...opciones });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) {
    let msg = body.detail;
    if (Array.isArray(msg)) msg = msg.map(e => `${e.loc.at(-1)}: ${e.msg}`).join(" · ");
    throw new Error(msg || `Error ${r.status}`);
  }
  return body;
}

function toast(msg, tipo = "error") {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.className = tipo === "info" ? "info" : "";
  t.style.display = "block";
  clearTimeout(t._timer);
  t._timer = setTimeout(() => (t.style.display = "none"), 3500);
}

const ic = (id, clase = "", attrs = "") => `<svg class="i ${clase}" ${attrs}><use href="#i-${id}"/></svg>`;
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const js = v => esc(JSON.stringify(v));   // para pasar valores a onclick="..." de forma segura
const corto = (h, n = 10) => (h || "").slice(0, n);
const plural = (n, s) => `${n} ${s}${n === 1 ? "" : "s"}`;
const pct = x => `${(x * 100).toFixed(1)} %`;
const mayus = s => s ? s[0].toUpperCase() + s.slice(1) : "";

function fecha(ts, enLinea = false) {
  const d = new Date(ts * 1000);
  const dia = d.toLocaleDateString("es-AR", { day: "2-digit", month: "short", year: "numeric" }).replace(".", "");
  const hora = d.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit", hour12: false });
  return enLinea ? `${dia}, ${hora}` : `${dia}<br>${hora}`;
}

function hace(ts) {
  const s = Date.now() / 1000 - ts;
  if (s < 60) return "hace instantes";
  if (s < 3600) return `hace ${Math.floor(s / 60)} min`;
  if (s < 86400) return `hace ${Math.floor(s / 3600)} h`;
  return `hace ${Math.floor(s / 86400)} días`;
}

function copiar(texto) {
  navigator.clipboard.writeText(texto)
    .then(() => toast("Copiado al portapapeles", "info"))
    .catch(() => toast("No se pudo copiar"));
}

// ============================================================
// Datos derivados de la blockchain
// ============================================================

/** Agrupa los bloques por producto y calcula etapa actual, riesgo actual, etc. */
function productos() {
  const mapa = new Map();
  for (const b of S.chain) {
    if (!b.product_id) continue;                       // bloque génesis
    if (b.event_type === "ALTA") {
      mapa.set(b.product_id, { id: b.product_id, nombre: b.data.nombre, origen: b.data.origen, bloques: [] });
    }
    mapa.get(b.product_id)?.bloques.push(b);
  }
  for (const p of mapa.values()) {
    p.cps = p.bloques.filter(b => b.event_type === "CHECKPOINT");
    p.ultimoCp = p.cps.at(-1) || null;
    p.riesgo = p.ultimoCp?.prediction?.nivel || null;
    p.etapa = p.ultimoCp?.actor || null;
    p.actualizado = p.bloques.at(-1).timestamp;
  }
  return [...mapa.values()];
}

const checkpoints = () => S.chain.filter(b => b.event_type === "CHECKPOINT");

function conteoRiesgo(cps) {
  const c = { bajo: 0, medio: 0, alto: 0 };
  cps.forEach(b => b.prediction && c[b.prediction.nivel]++);
  return c;
}

// --- Cómo se muestra cada bloque ---
const alterado = b => !S.validacion.valido && S.validacion.bloque === b.index;
const nivel = b => b.prediction?.nivel || null;
const colorBloque = b => alterado(b) ? "var(--alto)" : (nivel(b) ? COLOR[nivel(b)] : "var(--acento)");
const tonoBloque = b => alterado(b) ? "t-alto" : (nivel(b) ? "t-" + nivel(b) : "t-neutro");

function iconoBloque(b) {
  if (b.event_type === "GENESIS") return "box";
  if (b.event_type === "ALTA") return "doc";
  return ETAPA[b.actor]?.icono || "pin";
}

const badgeRiesgo = n => n ? `<span class="badge ${n}">${n.toUpperCase()}</span>` : `<span class="badge neutro">—</span>`;

function badgeBloque(b) {
  if (alterado(b)) return `<span class="badge alterado">ALTERADO</span>`;
  if (b.event_type === "GENESIS") return `<span class="badge valido">GÉNESIS</span>`;
  if (!nivel(b)) return `<span class="badge neutro">ALTA</span>`;
  return badgeRiesgo(nivel(b));
}

// ============================================================
// Componentes reutilizables
// ============================================================

function cubos(n = 4) {
  const roto = Math.floor(n / 2) - 1;
  return `<div class="cubos" aria-hidden="true">${Array.from({ length: n }, (_, i) =>
    `${i ? '<div class="guion"></div>' : ""}${ic("box", i === roto ? "roto" : "")}`).join("")}</div>`;
}

function bannerIntegridad(textoOk) {
  const v = S.validacion;
  return `
    <section class="banner ${v.valido ? "" : "error"}" data-tour="banner">
      ${ic(v.valido ? "escudo-ok" : "escudo-mal", "escudo")}
      <div class="banner-texto">
        <h2>${v.valido ? "Cadena íntegra" : "Cadena comprometida"}</h2>
        <p>${v.valido ? textoOk : esc(v.motivo)}</p>
      </div>
      <button class="btn-verde btn-grande" onclick="validarManual()">Validar cadena</button>
    </section>`;
}

function stat({ icono, tono, etiqueta, valor, extra = "", der = "" }) {
  return `
    <div class="card stat">
      <div class="stat-icono ${tono}">${ic(icono)}</div>
      <div class="cuerpo">
        <div class="etiqueta">${etiqueta}</div>
        <div class="valor">${valor}</div>
        ${extra ? `<div class="extra">${extra}</div>` : ""}
      </div>
      ${der}
    </div>`;
}

/** Mini gráfico real: cantidad de checkpoints de cada nivel de riesgo */
function miniBarras(c) {
  const max = Math.max(1, c.bajo, c.medio, c.alto);
  return `<div class="mini-barras" title="Checkpoints por riesgo — bajo: ${c.bajo}, medio: ${c.medio}, alto: ${c.alto}">${
    ["bajo", "medio", "alto"].map(n =>
      `<div style="height:${8 + (c[n] / max) * 32}px;background:${COLOR[n]};opacity:${c[n] ? 1 : .3}"></div>`).join("")}</div>`;
}

function statEstado() {
  const ok = S.validacion.valido;
  return stat({
    icono: "link", tono: ok ? "tono-verde" : "tono-rojo", etiqueta: "Estado de la cadena",
    valor: `<span style="color:${ok ? "inherit" : "var(--alto)"}">${ok ? "Íntegra" : "Alterada"}</span>`,
    der: `<span class="pill pill-acento">${plural(S.validacion.bloques, "bloque")}</span>`,
  });
}

function vacioDemo(texto = "Todavía no hay productos registrados.") {
  return `<div class="vacio">${ic("box")}${texto}<br><br>
    <button onclick="cargarEscenario()">${ic("play")}Cargar escenario de demo</button></div>`;
}

function opcionesProductos(sel) {
  return productos().map(p =>
    `<option value="${esc(p.id)}" ${p.id === sel ? "selected" : ""}>${esc(p.id)} — ${esc(p.nombre)}</option>`).join("");
}

function barrasImportancia() {
  if (!S.modelo) return "";
  return Object.entries(S.modelo.importancias).sort((a, b) => b[1] - a[1]).map(([k, v]) => `
    <div class="barra-icono">
      ${ic(VARIABLES[k].icono)}<span>${VARIABLES[k].nombre}</span>
      <div class="fondo"><div class="relleno" style="width:${v * 100}%"></div></div>
      <b>${pct(v)}</b>
    </div>`).join("");
}

// ============================================================
// Vista: RESUMEN
// ============================================================

// Descripción corta de cada etapa, para la lista de actividad
const DESCRIPCION_ETAPA = {
  Productor:     "Salida del origen",
  Transportista: "En tránsito al siguiente destino",
  Almacén:       "Recepción y control de calidad",
  Minorista:     "Disponible en punto de venta",
};

/** "Hoy, 10:24", "Ayer, 18:05" o "02 oct, 09:00" */
function fechaRelativa(ts) {
  const d = new Date(ts * 1000);
  const hora = d.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit", hour12: false });
  const dias = Math.round((new Date().setHours(0, 0, 0, 0) - new Date(d).setHours(0, 0, 0, 0)) / 86400000);
  if (dias === 0) return `Hoy, ${hora}`;
  if (dias === 1) return `Ayer, ${hora}`;
  return `${d.toLocaleDateString("es-AR", { day: "2-digit", month: "short" }).replace(".", "")}, ${hora}`;
}

/** Ítem de la lista de actividad reciente (Resumen) */
function itemActividad(b, p) {
  const titulo = b.event_type === "ALTA" ? "Producto registrado" : ETAPA[b.actor].nombre;
  const sub = b.event_type === "ALTA" ? `${esc(p.nombre)} · ${esc(p.id)}` : DESCRIPCION_ETAPA[b.actor];
  const icono = b.event_type === "ALTA" ? "box" : ETAPA[b.actor].icono;
  return `
    <button class="act ${alterado(b) ? "alterado" : ""}" style="--color:${colorBloque(b)}" onclick="verBloque(${b.index})">
      <span class="punto"></span>
      <span class="circulo ${tonoBloque(b)}">${ic(icono)}</span>
      <span style="min-width:0"><span class="titulo">${titulo}${alterado(b) ? '<span class="tag-alterado">ALTERADO</span>' : ""}</span><span class="sub">${sub}</span></span>
      <span class="hora">${fechaRelativa(b.timestamp)}</span>
      ${badgeBloque(b)}
    </button>`;
}

function vResumen() {
  const prods = productos();
  const cps = checkpoints();
  const c = conteoRiesgo(cps);
  const p = prods.find(x => x.id === S.producto);
  return `
    ${bannerIntegridad("Todos los bloques están validados y sin alteraciones.")}
    <div class="grid g-3" data-tour="stats">
      ${stat({ icono: "box", tono: "tono-teal redondo", etiqueta: "Productos", valor: prods.length })}
      ${stat({ icono: "pin", tono: "tono-azul redondo", etiqueta: "Checkpoints", valor: cps.length })}
      ${stat({ icono: "alerta", tono: "tono-naranja redondo", etiqueta: "Alertas", valor: c.alto, extra: "checkpoints con riesgo alto" })}
    </div>
    <div class="grid g-main-side" style="align-items:start">
      <div class="card" data-tour="actividad">
        <div class="card-titulo">${ic("reloj")}<div><h3>Actividad reciente</h3></div>
          ${prods.length > 1 ? `<div class="der"><select class="sin-icono" onchange="S.producto=this.value;render()">${opcionesProductos(S.producto)}</select></div>` : ""}
        </div>
        ${p ? `<div class="lista-actividad">${p.bloques.map(b => itemActividad(b, p)).join("")}</div>` : vacioDemo()}
      </div>
      <div class="col">
        <div class="card" data-tour="accesos">
          <div class="card-titulo">${ic("rayo")}<div><h3>Accesos rápidos</h3></div></div>
          <div class="accesos-lista">
            <button class="acceso primario" onclick="cargarEscenario()">${ic("play")}Cargar demo${ic("chev", "chev-der")}</button>
            <button class="acceso" onclick="ir('checkpoints')">${ic("mas-simple")}Nuevo checkpoint${ic("chev", "chev-der")}</button>
            <button class="acceso" onclick="ir('blockchain')">${ic("link")}Ver blockchain${ic("chev", "chev-der")}</button>
          </div>
        </div>
        ${p ? loteMini(p, "Lote monitoreado") : ""}
      </div>
    </div>`;
}

// ============================================================
// Vista: PRODUCTOS
// ============================================================

/** Tarjeta compacta de un lote: nombre, riesgo y etapa actual (Resumen y Productos) */
function loteMini(p, titulo) {
  const etapa = p.etapa ? ETAPA[p.etapa] : null;
  return `
    <div class="card lote-mini" data-tour="lote">
      <div class="card-titulo">${ic("box")}<div><h3>${titulo}</h3></div></div>
      <div class="fila-top"><h4>${esc(p.nombre)}</h4><span class="pill">${esc(p.id)}</span></div>
      <div class="duo2">
        <div><div class="tenue">Riesgo actual</div>${p.riesgo ? badgeRiesgo(p.riesgo) : '<span class="tenue chico">Sin checkpoints</span>'}</div>
        <div><div class="tenue">Etapa actual</div><div class="linea">${etapa ? ic(etapa.icono) + etapa.nombre : "Registrado"}</div></div>
      </div>
    </div>`;
}

function vProductos() {
  const prods = productos();
  const origenes = [...new Set(prods.map(p => p.origen))].sort();
  const p = prods.find(x => x.id === S.producto);
  const sinOrigenes = origenes.length === 0;
  return `
    <div class="grid g-3" data-tour="stats">
      ${stat({ icono: "box", tono: "tono-teal redondo", etiqueta: "Productos", valor: prods.length })}
      ${stat({ icono: "alerta", tono: "tono-naranja redondo", etiqueta: "Con riesgo", valor: prods.filter(x => x.riesgo === "alto").length, extra: "lotes con riesgo alto" })}
      ${stat({ icono: "pin", tono: "tono-azul redondo", etiqueta: "Orígenes", valor: origenes.length })}
    </div>
    <div class="grid g-main-side" style="align-items:start">
      <div class="card" data-tour="listado">
        <div class="card-titulo">${ic("lista")}<div><h3>Listado de productos</h3></div></div>
        <div class="campo buscador">${ic("lupa")}<input placeholder="Buscar productos…" autocomplete="off" value="${esc(S.tabla.q)}" oninput="buscarProducto(this.value)"></div>
        <div id="tablaProductos">${tablaProductos()}</div>
      </div>
      <div class="col">
        <div class="card" data-tour="alta">
          <div class="card-titulo">${ic("mas")}<div><h3>Alta de producto</h3></div></div>
          <form class="form-horizontal" autocomplete="off" onsubmit="return altaProducto(event)">
            <label for="altaId">ID del lote</label>
            <input class="sin-icono" id="altaId" name="id" placeholder="Ej. LOTE-025" required>
            <label for="altaNombre">Nombre</label>
            <input class="sin-icono" id="altaNombre" name="nombre" placeholder="Ej. Leche entera 1L" required>
            <label for="altaOrigen">Origen</label>
            <div>
              <select class="sin-icono" id="altaOrigen" name="origen" required onchange="document.getElementById('origenNuevo').hidden = this.value !== '__nuevo__'">
                <option value="" disabled ${sinOrigenes ? "" : "selected"}>Seleccionar origen</option>
                ${origenes.map(o => `<option value="${esc(o)}">${esc(o)}</option>`).join("")}
                <option value="__nuevo__" ${sinOrigenes ? "selected" : ""}>+ Nuevo origen…</option>
              </select>
              <input class="sin-icono" id="origenNuevo" name="origen_nuevo" placeholder="Nombre del nuevo origen" style="margin-top:8px" ${sinOrigenes ? "" : "hidden"}>
            </div>
            <button type="submit" class="btn-submit">Registrar producto ${ic("chev")}</button>
          </form>
        </div>
        ${p ? loteMini(p, "Detalle") : ""}
      </div>
    </div>`;
}

function tablaProductos() {
  const prods = productos();
  if (!prods.length) return vacioDemo();
  const t = S.tabla;
  const q = t.q.trim().toLowerCase();
  const lista = prods.filter(p => !q || [p.id, p.nombre, p.origen].some(x => x.toLowerCase().includes(q)));

  const paginas = Math.max(1, Math.ceil(lista.length / POR_PAGINA));
  t.pagina = Math.min(t.pagina, paginas);
  const visibles = lista.slice((t.pagina - 1) * POR_PAGINA, t.pagina * POR_PAGINA);

  const filas = visibles.map(p => {
    const etapa = p.etapa ? ETAPA[p.etapa] : { icono: "doc", nombre: "Registrado" };
    return `
      <tr class="${p.id === S.producto ? "sel" : ""}" onclick="S.producto=${js(p.id)};render()">
        <td>${esc(p.id)}</td>
        <td>${esc(p.nombre)}</td>
        <td><span class="etapa-txt">${ic(etapa.icono)}${etapa.nombre}</span></td>
        <td>${badgeRiesgo(p.riesgo)}</td>
      </tr>`;
  }).join("");

  return `
    <div class="tabla-wrap"><table class="simple">
      <thead><tr><th>Lote</th><th>Nombre</th><th>Etapa</th><th>Riesgo</th></tr></thead>
      <tbody>${filas || `<tr><td colspan="4" class="vacio">Ningún producto coincide con la búsqueda.</td></tr>`}</tbody>
    </table></div>
    ${paginas > 1 ? `
    <div class="paginacion">
      <span class="tenue">Mostrando ${visibles.length} de ${plural(lista.length, "producto")}</span>
      ${Array.from({ length: paginas }, (_, i) => `<button class="${i + 1 === t.pagina ? "" : "btn-borde"}" onclick="irPagina(${i + 1})">${i + 1}</button>`).join("")}
    </div>` : ""}`;
}

function refrescarTabla() { document.getElementById("tablaProductos").innerHTML = tablaProductos(); }
function buscarProducto(texto) { S.tabla.q = texto; S.tabla.pagina = 1; refrescarTabla(); }
function irPagina(n) { S.tabla.pagina = n; refrescarTabla(); }

// ============================================================
// Vista: CHECKPOINTS
// ============================================================

function vCheckpoints() {
  const prods = productos();
  const cps = checkpoints();
  const hoy = new Date().toDateString();
  const deHoy = cps.filter(b => new Date(b.timestamp * 1000).toDateString() === hoy).length;
  const prom = cps.length ? cps.reduce((s, b) => s + b.data.temperatura, 0) / cps.length : null;
  const f = S.form;
  const num = (name, label, icono, unidad, attrs) => `
    <label for="cp-${name}">${label}</label>
    <div class="campo">${ic(icono)}<input id="cp-${name}" name="${name}" type="number" placeholder="${unidad}" value="${f[name]}" ${attrs} required oninput="prediccionEnVivo()"></div>`;

  return `
    <div class="grid g-3" data-tour="stats">
      ${stat({ icono: "box", tono: "tono-teal redondo", etiqueta: "Hoy", valor: deHoy, extra: `${plural(cps.length, "checkpoint")} en total` })}
      ${stat({ icono: "alerta", tono: "tono-naranja redondo", etiqueta: "Riesgo alto", valor: conteoRiesgo(cps).alto })}
      ${stat({ icono: "termo", tono: "tono-azul redondo", etiqueta: "Temp. promedio", valor: prom === null ? "—" : `${prom.toFixed(1)} °C` })}
    </div>
    <div class="grid g-checkpoints">
      <div class="card" data-tour="form-cp">
        <div class="card-titulo">${ic("mas")}<div><h3>Nuevo checkpoint</h3></div></div>
        ${prods.length ? `
        <form id="formCheckpoint" class="form-horizontal" autocomplete="off" onsubmit="return registrarCheckpoint(event)">
          <label for="cp-producto">Producto</label>
          <select class="sin-icono" id="cp-producto" name="producto_id" required>
            <option value="" disabled selected>Seleccionar producto</option>
            ${prods.map(p => `<option value="${esc(p.id)}">${esc(p.nombre)} (${esc(p.id)})</option>`).join("")}
          </select>
          <label for="cp-actor">Actor</label>
          <select class="sin-icono" id="cp-actor" name="actor" required onchange="S.form.actor=this.value">
            <option value="" disabled ${f.actor ? "" : "selected"}>Seleccionar actor</option>
            ${ACTORES.map(a => `<option ${a === f.actor ? "selected" : ""}>${a}</option>`).join("")}
          </select>
          ${num("temperatura", "Temperatura", "termo", "°C", 'step="0.1"')}
          ${num("humedad", "Humedad", "gota", "%", 'step="0.1" min="0" max="100"')}
          ${num("demora_horas", "Demora", "reloj", "horas", 'step="0.1" min="0"')}
          ${num("distancia_km", "Distancia", "ruta", "km", 'step="1" min="0"')}
          <button type="submit" class="btn-submit">${ic("play")}Registrar checkpoint</button>
        </form>` : vacioDemo("Primero registrá un producto.")}
      </div>
      <div class="card" data-tour="prediccion">
        <div class="card-titulo">${ic("rayo")}<div><h3>Predicción</h3></div></div>
        <div id="panelPred">${panelPred()}</div>
      </div>
      <div class="card" data-tour="ultimos">
        <div class="card-titulo">${ic("reloj")}<div><h3>Últimos checkpoints</h3></div></div>
        ${cps.length
          ? `<div class="lista-cps">${cps.slice(-4).reverse().map(itemCheckpoint).join("")}</div>`
          : `<div class="vacio">${ic("pin")}Todavía no hay checkpoints.</div>`}
      </div>
    </div>`;
}

const ESTADO_CORTO = { Productor: "Salida", Transportista: "En tránsito", Almacén: "Recepción", Minorista: "Disponible" };

function itemCheckpoint(b) {
  return `
    <button class="cp" onclick="verBloque(${b.index})">
      <span class="circulo ${tonoBloque(b)}">${ic(iconoBloque(b))}</span>
      <span style="min-width:0">
        <b>${esc(b.actor)}</b>
        <span class="sub">${ESTADO_CORTO[b.actor]}</span>
        <span class="hora">${fechaRelativa(b.timestamp)} · ${esc(b.product_id)}</span>
      </span>
      ${badgeBloque(b)}
    </button>`;
}

/** Recuadro con la predicción en vivo + las 3 variables que más pesan en el modelo */
function panelPred() {
  const p = S.prediccion;
  const colores = ["linear-gradient(90deg,#1fb58a,#34d399)", "linear-gradient(90deg,#2f7fd8,#4c9ef5)", "linear-gradient(90deg,#7c5bd6,#a07cf0)"];
  const top3 = S.modelo ? Object.entries(S.modelo.importancias).sort((a, b) => b[1] - a[1]).slice(0, 3) : [];
  return `
    ${p
      ? `<div class="pred-grande ${p.nivel}">${ic(p.nivel === "bajo" ? "escudo-ok" : "escudo-mal")}${p.nivel.toUpperCase()}</div>
         <div class="pred-conf"><span class="tenue">Confianza de la predicción</span><b>${pct(p.probabilidad)}</b></div>`
      : `<div class="pred-grande vacia">${ic("escudo-ok")}Completá las lecturas</div>
         <div class="pred-conf"><span class="tenue">Confianza de la predicción</span><b>—</b></div>`}
    ${top3.map(([k, v], i) => `
      <div class="barra">
        <div class="cab"><span>${VARIABLES[k].nombre}</span><span>${pct(v)}</span></div>
        <div class="fondo"><div class="relleno" style="width:${v * 100}%;background:${colores[i]}"></div></div>
      </div>`).join("")}`;
}

/** Pide al modelo una predicción de las lecturas del formulario, sin registrar nada */
let timerPred;
function prediccionEnVivo() {
  const form = document.getElementById("formCheckpoint");
  if (!form) return;
  const lecturas = {};
  let completo = true;
  for (const k of ["temperatura", "humedad", "demora_horas", "distancia_km"]) {
    S.form[k] = form.elements[k].value;
    lecturas[k] = parseFloat(form.elements[k].value);
    if (Number.isNaN(lecturas[k])) completo = false;
  }
  clearTimeout(timerPred);
  timerPred = setTimeout(async () => {
    S.prediccion = null;
    if (completo) {
      try { S.prediccion = await api("/api/modelo/predecir", { method: "POST", body: JSON.stringify(lecturas) }); }
      catch { S.prediccion = null; }
    }
    const panel = document.getElementById("panelPred");
    if (panel) panel.innerHTML = panelPred();
  }, 150);
}

// ============================================================
// Vista: BLOCKCHAIN
// ============================================================

function vBlockchain() {
  const prods = productos();
  const lista = S.filtroBC ? S.chain.filter(b => b.product_id === S.filtroBC) : S.chain;
  if (!lista.some(b => b.index === S.bloque)) S.bloque = lista[0]?.index ?? null;
  const sel = S.chain.find(b => b.index === S.bloque);

  return `
    ${bannerIntegridad("Todos los bloques están correctamente enlazados.")}
    <div class="grid g-main-side" style="align-items:start">
      <div class="card" data-tour="explorador">
        <div class="card-titulo">${ic("box")}<div><h3>Explorador de bloques</h3></div>
          ${prods.length > 1 ? `<div class="der"><select class="sin-icono" onchange="S.filtroBC=this.value||null;S.bloque=null;render()">
            <option value="">Toda la cadena</option>${opcionesProductos(S.filtroBC)}
          </select></div>` : ""}
        </div>
        <div class="lista-actividad">${lista.map(itemBloque).join("")}</div>
      </div>
      <div class="col">
        ${sel ? detalleBloque(sel) : ""}
        <div class="card" data-tour="acciones">
          <div class="card-titulo">${ic("rayo")}<div><h3>Acciones</h3></div></div>
          <div class="accesos-lista">
            <button class="acceso primario" onclick="validarManual()">${ic("play")}Validar cadena${ic("chev", "chev-der")}</button>
            <button class="acceso" ${sel ? "" : "disabled"} onclick="simularAtaque(${S.bloque})">${ic("escudo-linea")}Simular ataque
              <span class="tenue chico" style="margin-left:auto">bloque #${S.bloque ?? "—"}</span>${ic("chev")}</button>
          </div>
        </div>
      </div>
    </div>`;
}

/** Fila del explorador: número de bloque, tipo, fecha y estado */
function itemBloque(b) {
  const sub = b.event_type === "GENESIS" ? "GENESIS" : b.event_type === "ALTA" ? "Alta de producto" : esc(b.actor);
  const fechaCorta = new Date(b.timestamp * 1000).toLocaleDateString("es-AR", { day: "2-digit", month: "short", year: "numeric" }).replace(".", "");
  return `
    <button class="act ${b.index === S.bloque ? "sel" : ""} ${alterado(b) ? "alterado" : ""}" style="--color:${colorBloque(b)}" onclick="S.bloque=${b.index};render()">
      <span class="punto"></span>
      <span class="circulo ${tonoBloque(b)}">${ic("box")}</span>
      <span style="min-width:0"><span class="titulo">#${b.index}${alterado(b) ? '<span class="tag-alterado">ALTERADO</span>' : ""}</span><span class="sub">${sub}</span></span>
      <span class="hora">${fechaCorta}</span>
      ${b.event_type === "GENESIS" && !alterado(b) ? '<span class="badge valido">VÁLIDO</span>' : badgeBloque(b)}
    </button>`;
}

function detalleBloque(b) {
  const prod = productos().find(p => p.id === b.product_id);
  const copia = t => `<button class="btn-icono" title="Copiar" onclick="copiar(${js(t)})">${ic("copiar")}</button>`;
  const riesgo = b.prediction
    ? `<span style="color:${COLOR[b.prediction.nivel]}">${mayus(b.prediction.nivel)} (${Math.round(b.prediction.probabilidad * 100)} %)</span>`
    : `<span class="tenue">Sin predicción</span>`;
  const fila = (icono, clave, valor) => `<div class="det">${ic(icono)}<span class="k">${clave}</span><span class="v">${valor}</span></div>`;
  return `
    <div class="card" data-tour="detalle-bloque">
      <div class="card-titulo">${ic("doc")}<div><h3>Detalle del bloque</h3></div><span class="der tenue">Bloque #${b.index}</span></div>
      <div class="detalle-lista">
        ${fila("box", "Producto", prod ? esc(prod.id) : "—")}
        ${fila("usuario", "Actor", esc(b.actor))}
        ${fila("doc", "Evento", b.event_type)}
        ${fila("calendario", "Fecha", fecha(b.timestamp, true))}
        ${fila("tendencia", "Riesgo", riesgo)}
        ${fila("numeral", "Hash", `<span class="mono">${corto(b.hash, 12)}…</span>${copia(b.hash)}`)}
        ${fila("link", "Hash previo", b.index ? `<span class="mono">${corto(b.previous_hash, 12)}…</span>${copia(b.previous_hash)}` : '<span class="tenue">— (primer bloque)</span>')}
        ${alterado(b) ? fila("escudo-mal", "Integridad", '<span style="color:var(--alto)">El contenido no coincide con el hash</span>') : ""}
      </div>
    </div>`;
}

// ============================================================
// Vista: MODELO ML
// ============================================================

function vModelo() {
  const m = S.modelo;
  if (!m) return `<div class="vacio">Cargando modelo…</div>`;
  const C = 2 * Math.PI * 88;
  return `
    <div class="grid g-4" data-tour="stats">
      ${stat({ icono: "diana", tono: "tono-teal", etiqueta: "Exactitud en test", valor: pct(m.accuracy) })}
      ${stat({ icono: "arbol", tono: "tono-teal", etiqueta: "Árboles del bosque", valor: m.n_estimators })}
      ${stat({ icono: "capas", tono: "tono-teal", etiqueta: "Profundidad máxima", valor: m.max_depth })}
      ${stat({ icono: "db", tono: "tono-teal", etiqueta: "Muestras del dataset", valor: m.muestras.toLocaleString("es-AR"), extra: "80 % entrenamiento · 20 % test" })}
    </div>
    <div class="grid g-2">
      <div class="card" data-tour="desempeno">
        <div class="card-titulo">${ic("barras")}<div><h3>Desempeño del modelo</h3></div>
          <button class="btn-verde btn-chico der" id="btnEntrenar" onclick="reentrenar()">${ic("refresh")}Reentrenar modelo</button></div>
        <div class="donut-wrap">
          <div class="donut">
            <svg viewBox="0 0 200 200">
              <circle cx="100" cy="100" r="88" fill="none" stroke="#123a40" stroke-width="16"/>
              <circle cx="100" cy="100" r="88" fill="none" stroke="url(#gradDonut)" stroke-width="16" stroke-linecap="round" stroke-dasharray="${m.accuracy * C} ${C}"/>
              <defs><linearGradient id="gradDonut" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#1fb5a3"/><stop offset="1" stop-color="#3fe0cc"/></linearGradient></defs>
            </svg>
            <div class="centro"><b>${(m.accuracy * 100).toFixed(1)}<small>%</small></b><span>Exactitud<br>en test</span></div>
          </div>
          <div class="desc-modelo">
            El modelo <b>RandomForest</b> clasifica el riesgo de ruptura de la cadena de frío (bajo, medio o alto) a partir de variables de sensores y logística.
            <div class="item">${ic("db")}Entrenado con dataset sintético</div>
            <div class="item">${ic("engranaje")}Validado con un conjunto de prueba separado (20 %)</div>
          </div>
        </div>
      </div>
      <div class="card" data-tour="importancia">
        <div class="card-titulo">${ic("barras")}<div><h3>Importancia de variables</h3><p>Cuánto pesa cada variable en las decisiones del bosque</p></div></div>
        ${barrasImportancia()}
      </div>
    </div>
    <div class="grid g-2">
      <div class="card" data-tour="interpreta">
        <div class="card-titulo">${ic("foco")}<div><h3>Cómo interpreta el riesgo</h3><p>El modelo aprende patrones a partir de las variables de la cadena de frío</p></div></div>
        <div class="lista-cajas">
          <div class="caja">${ic("termo")}<span style="color:inherit;font-size:inherit">Temperatura entre <em>2–8 °C</em> se considera segura.</span></div>
          <div class="caja">${ic("gota")}<span style="color:inherit;font-size:inherit">Humedad ideal entre <em>40–60 %</em>.</span></div>
          <div class="caja">${ic("reloj")}<span style="color:inherit;font-size:inherit">Mayor <em>demora</em> en el transporte aumenta el riesgo.</span></div>
          <div class="caja">${ic("pin")}<span style="color:inherit;font-size:inherit"><em>Distancias más largas</em> incrementan la probabilidad de ruptura.</span></div>
        </div>
      </div>
      <div class="card" data-tour="limitaciones">
        <div class="card-titulo">${ic("alerta", "", 'style="color:var(--alto)"')}<div><h3>Limitaciones</h3><p>Aspectos a considerar al interpretar los resultados</p></div></div>
        <div class="lista-cajas">
          <div class="caja">${ic("db")}<div><b>Entrenado con dataset sintético</b><span>Los resultados reflejan patrones de datos simulados.</span></div></div>
          <div class="caja">${ic("frasco")}<div><b>Modelo en fase de prototipo</b><span>Diseñado con fines demostrativos.</span></div></div>
          <div class="caja">${ic("info")}<div><b>Requiere reentrenamiento con datos reales</b><span>Antes de usarse con sensores y condiciones operativas reales.</span></div></div>
        </div>
      </div>
    </div>`;
}

// ============================================================
// Vista: DEMO
// ============================================================

function vDemo() {
  const p = productos().find(x => x.id === S.demoPid);
  const bTransp = p?.cps.find(b => b.actor === "Transportista");
  const nAtaque = bTransp?.index;
  const atacado = bTransp && alterado(bTransp);
  const v = S.validacion;

  const paso = (n, color, colorSig, icono, tono, titulo, texto, accion, hecho = false) => `
    <div class="paso ${hecho ? "hecho" : ""}" style="--color:${color};--color-sig:${colorSig}">
      <span class="numero">${hecho ? "✓" : n}</span>
      <div class="icono-evento ${tono}">${ic(icono)}</div>
      <div><b>${titulo}</b><p>${texto}</p></div>
      <div>${accion}</div>
    </div>`;
  const ok = txt => `<span class="estado-ok">${ic("check")}${txt}</span>`;

  return `
    <section class="banner" data-tour="banner-demo">
      <div class="play-grande">${ic("play")}</div>
      <div class="banner-texto">
        <h2>Escenario de demo</h2>
        <p>Probá el sistema con un lote de ejemplo.</p>
      </div>
      ${cubos(4).replace("roto", "")}
      <div class="botones">
        <button class="btn-grande" onclick="cargarEscenario()">${ic("play")}Cargar escenario demo</button>
        <button class="btn-borde" onclick="reiniciar()">${ic("reiniciar")}Reiniciar demo</button>
      </div>
    </section>
    <div class="grid g-main-side demo-grid">
      <div class="card" data-tour="pasos">
        <div class="card-titulo">${ic("lista")}<div><h3>Pasos de la demo</h3><p>Recorrido recomendado para la presentación</p></div></div>
        <div class="pasos">
          ${paso(1, "var(--acento)", "var(--azul)", "box", "tono-teal", "Cargar lote de ejemplo",
                 "Carga 5 lotes en distintas etapas. El protagonista es un lote de leche con su recorrido completo: productor, transportista, almacén y minorista.",
                 p ? ok(`Cargado (${esc(p.id)})`) : `<button class="btn-verde btn-chico" onclick="cargarEscenario()">Cargar lote ${ic("flecha")}</button>`, !!p)}
          ${paso(2, "var(--azul)", "var(--medio)", "doc", "tono-azul", "Revisar checkpoints",
                 "Recorré los eventos registrados en cada etapa y la predicción del modelo en cada uno.",
                 `<button class="btn-azul btn-chico" ${p ? "" : "disabled"} onclick="ir('resumen',{producto:${js(S.demoPid)}})">Ir a Resumen ${ic("flecha")}</button>`)}
          ${paso(3, "var(--medio)", "#f08a4a", "alerta", "tono-rojo", "Observar la predicción de riesgo alto",
                 "En el transporte la temperatura llega a 14 °C: el modelo detecta una falla de frío y marca riesgo ALTO.",
                 `<button class="btn-azul btn-chico" ${p ? "" : "disabled"} onclick="verBloque(${nAtaque ?? "null"})">Ver bloque ${ic("flecha")}</button>`)}
          ${paso(4, "#f08a4a", "var(--acento)", "escudo-rayo", "tono-rojo", `Simular ataque al bloque #${nAtaque ?? "—"}`,
                 "Alguien edita el bloque del transportista para ocultar la falla: baja la temperatura a 4 °C y el riesgo a bajo.",
                 atacado ? ok("Bloque alterado") : `<button class="btn-peligro btn-chico" ${p ? "" : "disabled"} onclick="simularAtaque(${nAtaque ?? "null"})">Simular ataque ${ic("flecha")}</button>`, atacado)}
          ${paso(5, "var(--acento)", "var(--acento)", "link", "tono-teal", "Validar cadena y detectar la manipulación",
                 "La validación recalcula los hashes y señala exactamente qué bloque fue alterado.",
                 atacado && !v.valido ? ok("Detectado") : `<button class="btn-verde btn-chico" onclick="validarManual()">Validar cadena ${ic("flecha")}</button>`, atacado && !v.valido)}
        </div>
      </div>
      <div class="col">
        ${p ? `
        <div class="card lote-ejemplo" data-tour="lote-ejemplo">
          <div class="card-titulo">${ic("box")}<div><h3>Lote del ejemplo</h3></div></div>
          <div class="lote-cab">
            <div><h4>${esc(p.nombre)}</h4><span class="lote-id">${esc(p.id)}</span></div>
            <div class="riesgo-der"><span class="tenue">Riesgo actual</span>${p.riesgo ? badgeRiesgo(p.riesgo) : '<span class="badge neutro">—</span>'}</div>
          </div>
          <div class="recorrido">
            ${ACTORES.map((a, i) => {
              // Cada círculo toma el color del riesgo que predijo el modelo en esa etapa
              const cp = p.cps.find(b => b.actor === a);
              const titulo = cp ? `${a}: riesgo ${alterado(cp) ? "alterado" : nivel(cp)}` : `${a}: sin checkpoint`;
              return `${i ? `<span class="flecha-rec">${ic("flecha")}</span>` : ""}
                <div class="paso-rec" title="${titulo}">
                  <span class="circulo ${cp ? tonoBloque(cp) : "t-neutro vacio-rec"}">${ic(ETAPA[a].icono)}</span>
                  <span>${a}</span>
                </div>`;
            }).join("")}
          </div>
        </div>` : `<div class="card">${vacioDemo("Todavía no cargaste el lote de ejemplo.")}</div>`}
        ${resultadoDemo(nAtaque)}
      </div>
    </div>
    <div class="card accesos" data-tour="accesos-demo">
      <div class="titulo-accesos">${ic("rayo")}<div><h3 class="acento" style="font-size:18px">Accesos rápidos</h3><span class="tenue">Navegá directamente a las secciones durante la demo</span></div></div>
      <button class="accion" onclick="ir('blockchain')">${ic("box")}<div><b>Ir a Blockchain</b><span>Ver bloques y hashes</span></div>${ic("flecha")}</button>
      <button class="accion" onclick="ir('checkpoints')">${ic("pin")}<div><b>Ir a Checkpoints</b><span>Predicción en vivo</span></div>${ic("flecha")}</button>
      <button class="accion" onclick="ir('modelo')">${ic("barras")}<div><b>Ir a Modelo ML</b><span>Métricas del modelo</span></div>${ic("flecha")}</button>
    </div>`;
}

function resultadoDemo(nAtaque) {
  const v = S.validacion;
  if (!v.valido) return `
    <div class="resultado error">
      <h3>${ic("alerta")}Resultado obtenido</h3>
      <div class="cuerpo">${ic("bloque-roto", "", 'style="color:var(--alto)"')}
        <div><h4>El bloque #${v.bloque} fue alterado</h4><span class="tenue">${esc(v.motivo)}. La validación detectó la manipulación.</span></div></div>
    </div>`;
  return `
    <div class="resultado">
      <h3>${ic("info", "", 'style="color:var(--medio)"')}Resultado esperado</h3>
      <div class="cuerpo">${ic("bloque-roto", "", 'style="color:var(--tenue)"')}
        <div><h4>${nAtaque ? `El bloque #${nAtaque} va a quedar marcado como alterado` : "La validación va a detectar el bloque alterado"}</h4>
        <span class="tenue">Después del ataque, su contenido ya no coincide con su hash y la validación de la cadena lo señala. Por ahora la cadena está íntegra.</span></div></div>
    </div>`;
}

// ============================================================
// Vista: AYUDA
// ============================================================

/** Preguntas frecuentes: las que probablemente hagan en la presentación */
function preguntasFrecuentes() {
  const acc = S.modelo ? pct(S.modelo.accuracy) : "82,6 %";
  return [
    ["¿De dónde salen los datos?",
     "Es un prototipo: las lecturas de sensores se simulan con el formulario de Checkpoints y con el escenario de demo. En un sistema real llegarían de sensores IoT (termómetros y medidores de humedad en camiones y cámaras de frío)."],
    ["¿Qué diferencia hay con una base de datos común?",
     "En una base de datos, alguien con acceso puede cambiar un dato viejo y nadie lo nota. En la blockchain cada bloque guarda el hash del anterior: si se modifica un dato, su hash deja de coincidir y la validación indica exactamente qué bloque se alteró. Probalo con «Simular ataque»."],
    ["¿Por qué una blockchain propia y no Ethereum?",
     "En una cadena de suministro los participantes son conocidos (productores, transportistas, almacenes), así que no hace falta una red pública ni criptomonedas. Se usa una blockchain permisionada, como hace la industria (por ejemplo, IBM Food Trust con Hyperledger Fabric). Además no requiere wallets, gas ni internet."],
    ["¿Por qué Machine Learning tradicional y no un LLM?",
     "El problema es clasificar 4 números (temperatura, humedad, demora y distancia) en 3 niveles de riesgo. Un RandomForest es el modelo indicado para datos tabulares: es liviano, rápido, interpretable y corre local. Un LLM sería más lento, más caro, menos preciso con números y necesitaría una API externa."],
    [`¿Por qué la exactitud es ${acc}?`,
     "Es la proporción de lecturas del conjunto de prueba (el 20 % que el modelo no vio al entrenar) que clasificó bien. El dataset es sintético y tiene ruido a propósito, así que es una exactitud de prototipo: con datos reales habría que reentrenar el modelo."],
    ["¿Qué significa la confianza de una predicción?",
     "Es la probabilidad que el modelo le asigna al nivel de riesgo elegido. Un RandomForest tiene 200 árboles que «votan»: si el 93 % de los votos dice ALTO, la confianza es 93 %."],
    ["¿Qué es la prueba de trabajo?",
     "Para agregar un bloque hay que encontrar un número (nonce) que haga que su hash empiece con «000». Ilustra el «minado» de las blockchains reales sin que la demo sea lenta."],
    ["Simulé un ataque, ¿cómo vuelvo atrás?",
     "Los bloques alterados no se pueden «arreglar»: esa es la gracia de la blockchain. Para empezar de nuevo, andá a Demo y usá «Reiniciar demo» y después «Cargar escenario demo»."],
    ["¿Dónde se guardan los datos?",
     "La cadena completa se guarda en el archivo backend/chain.json y el modelo entrenado en backend/model.joblib. Todo queda en la computadora donde corre el servidor."],
  ];
}

function vAyuda() {
  const flujo = [
    ["termo", "t-neutro", "1. Lectura de sensores", "Un actor (productor, transportista, almacén o minorista) reporta temperatura, humedad, demora y distancia."],
    ["cerebro", "tono-azul", "2. Predicción", "La API le pasa las lecturas al modelo de ML, que predice el riesgo: bajo, medio o alto."],
    ["box", "tono-teal", "3. Registro en la blockchain", "Los datos y la predicción se guardan en un bloque nuevo, minado y encadenado al anterior por su hash."],
    ["escudo-ok", "tono-verde", "4. Validación", "Se recalculan los hashes de toda la cadena: cualquier dato alterado queda en evidencia."],
    ["casa", "tono-naranja", "5. Consulta", "El dashboard muestra el recorrido de cada lote, sus riesgos y el estado de la cadena."],
  ];
  const guias = ["resumen", "productos", "checkpoints", "blockchain", "modelo", "demo"];
  const iconos = { resumen: "casa", productos: "box", checkpoints: "pin", blockchain: "red", modelo: "barras-nav", demo: "play-linea" };
  return `
    <section class="banner" data-tour="banner-ayuda">
      <div class="play-grande">${ic("ayuda")}</div>
      <div class="banner-texto">
        <h2>¿Cómo funciona ChainTrace-AI?</h2>
        <p>Registra cada etapa de la cadena de frío en una blockchain y usa Machine Learning para anticipar el riesgo de que un producto llegue en mal estado.</p>
      </div>
      <div class="botones">
        <button class="btn-grande" onclick="ir('demo')">${ic("play")}Ir a la demo</button>
      </div>
    </section>
    <div class="grid g-main-side">
      <div class="card" data-tour="flujo">
        <div class="card-titulo">${ic("ruta")}<div><h3>Cómo funciona</h3><p>El recorrido de un dato, desde el sensor hasta el dashboard</p></div></div>
        <div class="flujo">
          ${flujo.map(([icono, tono, titulo, texto]) => `
            <div class="flujo-paso">
              <span class="circulo ${tono}">${ic(icono)}</span>
              <div><b>${titulo}</b><span>${texto}</span></div>
            </div>`).join("")}
        </div>
      </div>
      <div class="card" data-tour="guias">
        <div class="card-titulo">${ic("lista")}<div><h3>Guías por sección</h3><p>Te lleva a la sección y te la explica paso a paso</p></div></div>
        <div class="accesos-lista">
          ${guias.map(v => `<button class="acceso" onclick="verGuia('${v}')">${ic(iconos[v])}${VISTAS[v].titulo}${ic("chev", "chev-der")}</button>`).join("")}
        </div>
        <p class="tenue chico" style="margin:12px 0 0">También podés tocar el botón <b>?</b> de abajo a la derecha en cualquier sección.</p>
      </div>
    </div>
    <div class="card" data-tour="faq">
      <div class="card-titulo">${ic("ayuda")}<div><h3>Preguntas frecuentes</h3></div></div>
      <div class="faq">
        ${preguntasFrecuentes().map(([p, r]) => `<details><summary>${p}${ic("chev")}</summary><p>${r}</p></details>`).join("")}
      </div>
    </div>`;
}

/** Va a una sección y arranca su guía */
function verGuia(vista) {
  ir(vista);
  setTimeout(iniciarTour, 350);
}

// ============================================================
// Navegación
// ============================================================

const VISTAS = {
  resumen:     { titulo: "Resumen",     sub: "Vista general del sistema",                 render: vResumen },
  productos:   { titulo: "Productos",   sub: "Gestión simple de lotes",                                   render: vProductos },
  checkpoints: { titulo: "Checkpoints", sub: "Registro de eventos",                                      render: vCheckpoints, despues: prediccionEnVivo },
  blockchain:  { titulo: "Blockchain",  sub: "Visualización y validación de bloques",        render: vBlockchain },
  modelo:      { titulo: "Modelo ML",   sub: "Desempeño y explicabilidad del modelo de clasificación de riesgo", render: vModelo },
  demo:        { titulo: "Demo",        sub: "Escenario guiado para la presentación del sistema",         render: vDemo },
  ayuda:       { titulo: "Ayuda",       sub: "Cómo funciona el sistema y cómo usarlo",                    render: vAyuda },
};

function vistaActual() {
  const v = location.hash.slice(1);
  return VISTAS[v] ? v : "resumen";
}

/** Cambia de sección; `cambios` permite preseleccionar producto, bloque, etc. */
function ir(vista, cambios = {}) {
  Object.assign(S, cambios);
  if (vistaActual() === vista && location.hash) render();
  else location.hash = vista;
}

function verBloque(index) {
  if (index === null || index === undefined) return;
  const b = S.chain.find(x => x.index === index);
  // Si el bloque no está en el filtro actual, se muestra toda la cadena
  ir("blockchain", { bloque: index, filtroBC: b?.product_id === S.filtroBC ? S.filtroBC : null });
}

function render() {
  const nombre = vistaActual();
  const vista = VISTAS[nombre];
  document.title = `${vista.titulo} · ChainTrace-AI`;
  document.getElementById("tituloVista").textContent = vista.titulo;
  document.getElementById("subVista").textContent = vista.sub;
  document.querySelectorAll(".nav a").forEach(a => a.classList.toggle("activo", a.dataset.vista === nombre));
  document.querySelector(".nav a.activo").scrollIntoView({ block: "nearest", inline: "nearest" });  // en celular la nav es horizontal
  moverIndicador();
  const mini = document.getElementById("estadoMini");
  mini.className = "estado-mini" + (S.validacion.valido ? "" : " mal");
  mini.lastElementChild.textContent = S.validacion.valido ? "Cadena íntegra" : "Cadena alterada";
  mini.title = mini.lastElementChild.textContent;  // se ve al pasar el mouse con la sidebar contraída
  document.getElementById("vista").innerHTML = vista.render();
  vista.despues?.();
}

window.addEventListener("hashchange", () => {
  render();
  window.scrollTo(0, 0);
});

// ============================================================
// Carga de datos y acciones
// ============================================================

async function cargarDatos() {
  const [chain, validacion] = await Promise.all([api("/api/blockchain"), api("/api/blockchain/validar")]);
  S.chain = chain;
  S.validacion = validacion;
  if (!S.modelo) S.modelo = await api("/api/modelo/info");

  const prods = productos();
  if (!prods.some(p => p.id === S.demoPid)) {
    // Reconoce el último lote cargado por el escenario de demo
    S.demoPid = [...prods].reverse().find(p => p.nombre === "Leche entera 1L" && /^LOTE-\d{3}$/.test(p.id))?.id ?? null;
  }
  // Por defecto se muestra el lote de la demo (o el último registrado)
  if (!prods.some(p => p.id === S.producto)) S.producto = S.demoPid ?? prods.at(-1)?.id ?? null;
}

async function refrescar() {
  await cargarDatos();
  render();
}

async function validarManual() {
  try {
    await refrescar();
    const v = S.validacion;
    toast(v.valido ? `Cadena íntegra: ${plural(v.bloques, "bloque")} verificados` : v.motivo, v.valido ? "info" : "error");
  } catch (e) { toast(e.message); }
}

async function cargarEscenario() {
  try {
    const r = await api("/api/demo/escenario", { method: "POST" });
    S.demoPid = r.producto_id;
    S.producto = r.producto_id;
    toast(`Escenario cargado: ${plural(r.productos.length, "lote")} (${r.producto_id} es el de la demo)`, "info");
    await refrescar();
  } catch (e) { toast(e.message); }
}

async function reiniciar() {
  if (!confirm("¿Reiniciar la blockchain? Se borran todos los bloques.")) return;
  try {
    await api("/api/demo/reset", { method: "POST" });
    Object.assign(S, { producto: null, bloque: null, filtroBC: null, demoPid: null });
    toast("Cadena reiniciada", "info");
    await refrescar();
  } catch (e) { toast(e.message); }
}

async function simularAtaque(index) {
  if (index === null || index === undefined) return;
  try {
    await api(`/api/blockchain/manipular/${index}`, { method: "POST" });
    toast(`Se alteró el bloque #${index} sin recalcular su hash`, "info");
    await refrescar();
  } catch (e) { toast(e.message); }
}

async function reentrenar() {
  const btn = document.getElementById("btnEntrenar");
  btn.disabled = true;
  btn.querySelector("svg").classList.add("girando");
  try {
    S.modelo = await api("/api/modelo/entrenar", { method: "POST" });
    toast("Modelo reentrenado", "info");
    render();
  } catch (e) {
    toast(e.message);
    btn.disabled = false;
  }
}

async function altaProducto(ev) {
  ev.preventDefault();
  const datos = Object.fromEntries(new FormData(ev.target));
  const origen = datos.origen === "__nuevo__" ? (datos.origen_nuevo || "").trim() : datos.origen;
  if (!origen) { toast("Indicá el origen del producto"); return false; }
  const f = { id: datos.id.trim(), nombre: datos.nombre.trim(), origen };
  try {
    await api("/api/productos", { method: "POST", body: JSON.stringify(f) });
    S.producto = f.id;
    toast(`Producto ${f.id} registrado`, "info");
    await refrescar();
  } catch (e) { toast(e.message); }
  return false;
}

async function registrarCheckpoint(ev) {
  ev.preventDefault();
  const f = Object.fromEntries(new FormData(ev.target));
  for (const k of ["temperatura", "humedad", "demora_horas", "distancia_km"]) f[k] = parseFloat(f[k]);
  try {
    const b = await api("/api/checkpoints", { method: "POST", body: JSON.stringify(f) });
    S.producto = f.producto_id;
    toast(`Bloque #${b.index} minado — riesgo ${b.prediction.nivel}`, "info");
    await refrescar();
  } catch (e) { toast(e.message); }
  return false;
}

// ---------- Resaltado deslizante de la sección activa ----------

const navHorizontal = window.matchMedia("(max-width: 960px)");  // en celular la nav es una barra horizontal

/** Lleva el resaltado hasta la sección activa (con animación, salvo en la primera ubicación) */
function moverIndicador(animar = true) {
  const ind = document.getElementById("navIndicador");
  const activo = document.querySelector(".nav a.activo");
  if (!ind || !activo) return;
  const primeraVez = !ind.style.height;
  ind.classList.toggle("sin-anim", !animar || primeraVez);
  ind.style.transform = `translate(${activo.offsetLeft}px, ${activo.offsetTop}px)`;
  ind.style.height = `${activo.offsetHeight}px`;
  // En la sidebar vertical el ancho lo da el CSS (sigue a la sidebar al contraerla)
  ind.style.width = navHorizontal.matches ? `${activo.offsetWidth}px` : "";
  if (!animar || primeraVez) {
    void ind.offsetWidth;  // fuerza a aplicar la posición sin transición antes de reactivarla
    ind.classList.remove("sin-anim");
  }
}

window.addEventListener("resize", () => moverIndicador(false));

// ---------- Sidebar contraíble (la preferencia se recuerda en el navegador) ----------

function aplicarSidebar(contraida) {
  document.body.classList.toggle("sidebar-contraida", contraida);
  const btn = document.getElementById("toggleSidebar");
  const texto = contraida ? "Expandir menú" : "Contraer menú";
  btn.title = texto;
  btn.setAttribute("aria-label", texto);
  btn.setAttribute("aria-expanded", String(!contraida));
  btn.querySelector(".txt").textContent = texto;
}

function alternarSidebar() {
  const contraida = !document.body.classList.contains("sidebar-contraida");
  aplicarSidebar(contraida);
  try { localStorage.setItem("sidebarContraida", contraida ? "1" : "0"); } catch { /* sin almacenamiento: no pasa nada */ }
}

try { aplicarSidebar(localStorage.getItem("sidebarContraida") === "1"); } catch { aplicarSidebar(false); }

// Arranque
refrescar().catch(e => toast(e.message));
