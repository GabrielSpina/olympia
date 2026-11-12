"use strict";

const OWNER = "GabrielSpina";
const DATA_REPO = "olympia-dados";
const API = `https://api.github.com/repos/${OWNER}/${DATA_REPO}/contents/`;
const $ = (id) => document.getElementById(id);
const state = { notebook: [], divisions: [], mode: "none", busy: false };
const SPORTS = ["Jiu-jitsu", "Judô", "Wrestling", "Sambo"];
let editingId = null;

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

function notice(message, error = false) {
  $("notice").textContent = message;
  $("notice").classList.toggle("error", error);
}

function validNotebook(rows) {
  return Array.isArray(rows) && rows.every((r) => r && typeof r.id === "string" && /^\d{4}-\d\d-\d\d$/.test(r.date));
}

function validDivisions(rows) {
  return Array.isArray(rows) && rows.every((d) => d && typeof d.name === "string" && Array.isArray(d.rows));
}

function decodeBase64(value) {
  const binary = atob(value.replace(/\s/g, ""));
  return new TextDecoder().decode(Uint8Array.from(binary, (char) => char.charCodeAt(0)));
}

function encodeBase64(value) {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(binary);
}

async function githubFile(name, token) {
  const response = await fetch(API + encodeURIComponent(name), {
    headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${token}`, "X-GitHub-Api-Version": "2022-11-28" },
    cache: "no-store",
  });
  if (!response.ok) throw new Error(response.status === 404 ? "Repositório ou arquivo não encontrado; confira o acesso do token." : `GitHub respondeu ${response.status}.`);
  const file = await response.json();
  return { sha: file.sha, data: JSON.parse(decodeBase64(file.content)) };
}

async function loadGithub(token) {
  notice("Carregando seus dados…");
  const [notebook, treinos] = await Promise.all([githubFile("notebook.json", token), githubFile("treinos.json", token)]);
  if (!validNotebook(notebook.data) || !validDivisions(treinos.data)) throw new Error("Os arquivos JSON não têm o formato esperado.");
  state.notebook = notebook.data;
  state.divisions = treinos.data;
  state.mode = "github";
  sessionStorage.setItem("olympia-token", token);
  render();
  notice("Conectado ao repositório privado. Suas alterações serão salvas no GitHub.");
}

async function saveRecord(id, changes) {
  if (state.busy || state.mode === "none") return false;
  state.busy = true;
  renderNotebook();
  try {
    if (state.mode === "github") {
      const token = sessionStorage.getItem("olympia-token");
      if (!token) throw new Error("Conecte o token novamente.");
      let saved = false;
      for (let attempt = 0; attempt < 3; attempt++) {
        const file = await githubFile("notebook.json", token);
        if (!validNotebook(file.data)) throw new Error("Notebook inválido no repositório privado.");
        const row = file.data.find((item) => item.id === id);
        if (!row) throw new Error("Este registro não existe mais no Notebook.");
        Object.assign(row, changes);
        row.updatedAt = new Date().toISOString();
        const response = await fetch(API + "notebook.json", {
          method: "PUT",
          headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${token}`, "Content-Type": "application/json", "X-GitHub-Api-Version": "2022-11-28" },
          body: JSON.stringify({ message: `Atualizar Notebook ${row.date}`, content: encodeBase64(JSON.stringify(file.data, null, 2) + "\n"), sha: file.sha }),
        });
        if (response.status === 409) continue;
        if (!response.ok) throw new Error(`Não foi possível salvar no GitHub (${response.status}).`);
        state.notebook = file.data;
        saved = true;
        break;
      }
      if (!saved) throw new Error("O arquivo mudou durante a gravação. Tente novamente.");
      notice("Alteração salva no GitHub.");
    } else if (state.mode === "local") {
      const row = state.notebook.find((item) => item.id === id);
      if (!row) throw new Error("Registro não encontrado.");
      Object.assign(row, changes);
      row.updatedAt = new Date().toISOString();
      localStorage.setItem("olympia-local-notebook", JSON.stringify(state.notebook));
      notice("Alteração salva neste navegador. Conecte o GitHub para guardar no repositório privado.");
    }
    return true;
  } catch (error) {
    notice(error.message, true);
    return false;
  } finally {
    state.busy = false;
    renderNotebook();
  }
}

function openEditor(id) {
  const row = state.notebook.find((item) => item.id === id);
  if (!row || state.busy) return;
  editingId = id;
  $("edit-date").textContent = new Date(`${row.date}T12:00:00`).toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  const current = String(row.session || "").trim();
  const match = current.toUpperCase().match(/\b(ARMS|DELTS|BACK|CHEST|LEG|REST)$/);
  const selected = match ? match[1] : current;
  const select = $("edit-session");
  select.querySelector('option[data-current="true"]')?.remove();
  if (selected && !["ARMS", "DELTS", "BACK", "CHEST", "LEG", "REST"].includes(selected)) {
    const option = new Option(`${current} (registro atual)`, current);
    option.dataset.current = "true";
    select.prepend(option);
  }
  select.value = selected || "REST";
  for (const checkbox of $("edit-form").querySelectorAll('input[name="sport"]')) checkbox.checked = Array.isArray(row.sports) && row.sports.includes(checkbox.value);
  $("edit-dialog").showModal();
  $("edit-session").focus();
}

function renderNotebook() {
  const month = $("month-filter").value;
  const query = $("search-filter").value.trim().toLocaleLowerCase("pt-BR");
  const rows = state.notebook.filter((r) => (!month || r.date.startsWith(month)) && (!query || `${r.session ?? ""} ${r.notes ?? ""} ${(r.sports || []).join(" ")}`.toLocaleLowerCase("pt-BR").includes(query))).sort((a, b) => b.date.localeCompare(a.date) || b.sourceRow - a.sourceRow);
  const workouts = rows.filter((r) => !/^rest\b/i.test(String(r.session ?? "").trim()));
  const done = workouts.filter((r) => r.status === "done").length;
  const skipped = workouts.filter((r) => r.status === "skipped").length;
  $("done-count").textContent = state.notebook.length ? String(done) : "—";
  $("notebook-summary").innerHTML = `<span class="chip"><strong>${workouts.length}</strong> treinos no filtro</span><span class="chip"><strong>${done}</strong> feitos</span><span class="chip"><strong>${skipped}</strong> não feitos</span>`;
  $("notebook-list").innerHTML = rows.length ? rows.map((r) => {
    const dateObject = new Date(`${r.date}T12:00:00`);
    const weekday = dateObject.toLocaleDateString("pt-BR", { weekday: "long" });
    const date = dateObject.toLocaleDateString("pt-BR", { day: "numeric", month: "short", year: "numeric" });
    const note = [r.notes, typeof r.weightKg === "number" ? `${r.weightKg} kg` : null].filter(Boolean).join(" · ");
    const status = r.status === "done" ? "Feito" : r.status === "skipped" ? "Não feito" : "Sem marcação";
    const rest = /^rest\b/i.test(String(r.session ?? "").trim());
    const sports = Array.isArray(r.sports) ? r.sports.filter((sport) => SPORTS.includes(sport)) : [];
    const activity = (name) => `<button class="entry-title activity-name" type="button" data-edit="${escapeHtml(r.id)}" aria-label="Editar atividades de ${escapeHtml(date)}" ${state.busy ? "disabled" : ""}>${escapeHtml(name)} <span class="activity-pencil" aria-hidden="true">✎</span></button>`;
    return `<article class="entry"><div class="entry-date">${escapeHtml(weekday)}<small>${escapeHtml(date)}</small></div><div class="entry-main"><div class="activity-list">${activity(rest ? "Sem musculação" : r.session || "Treino")}${sports.map(activity).join("")}</div><div class="entry-hint">Clique em uma atividade para editar o dia</div><p>${escapeHtml(rest ? "Descanso" : status)}${note ? ` · ${escapeHtml(note)}` : ""}</p></div><div class="entry-actions">${rest ? "<span class=\"chip\">Descanso</span>" : `<button class="status-button done ${r.status === "done" ? "active" : ""}" data-id="${escapeHtml(r.id)}" data-status="done" ${state.busy ? "disabled" : ""}>✓ Fiz</button><button class="status-button skipped ${r.status === "skipped" ? "active" : ""}" data-id="${escapeHtml(r.id)}" data-status="skipped" ${state.busy ? "disabled" : ""}>× Não fiz</button>`}</div></article>`;
  }).join("") : `<div class="empty">${state.mode === "none" ? "Conecte seus dados para ver o Notebook." : "Nenhum registro neste filtro."}</div>`;
}

function renderTreinos() {
  const selected = $("division-filter").value || "GymDivision 13-2";
  $("division-filter").innerHTML = state.divisions.map((d) => `<option value="${escapeHtml(d.name)}" ${d.name === selected ? "selected" : ""}>${escapeHtml(d.name)}</option>`).join("");
  const division = state.divisions.find((d) => d.name === selected) || state.divisions[0];
  if (!division) { $("training-grid").innerHTML = '<div class="empty">Conecte seus dados para ver os treinos.</div>'; return; }
  if (division.name === "GymDivision 13-2" || division.name === "GymDivision 13-1") {
    const columns = division.name === "GymDivision 13-2" ? ["B", "C", "D", "E", "F"] : ["B", "D", "E", "C"];
    const header = division.rows.find((r) => r.row === 1)?.cells || {};
    $("training-grid").className = "training-grid";
    $("training-grid").innerHTML = columns.map((column) => {
      const groups = [];
      for (const row of division.rows.filter((r) => r.row > 1)) {
        const value = row.cells[column];
        if (!value) continue;
        const previous = division.rows.find((r) => r.row === row.row - 1);
        const isHeading = row.row === 2 || !previous || !previous.cells[column];
        if (isHeading) groups.push({ heading: value, items: [] });
        else if (groups.length) groups[groups.length - 1].items.push(value);
      }
      return `<article class="day-card"><h3>${escapeHtml(header[column] || column)}</h3>${groups.map((g) => `<div class="group"><h4>${escapeHtml(g.heading)}</h4><ol>${g.items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ol></div>`).join("")}</article>`;
    }).join("");
  } else {
    const columns = ["C", "D", "E", "F"];
    $("training-grid").className = "table-wrap";
    $("training-grid").innerHTML = `<table class="raw-table"><thead><tr><th>Linha</th>${columns.map((c) => `<th>${c}</th>`).join("")}</tr></thead><tbody>${division.rows.map((r) => `<tr><td>${r.row}</td>${columns.map((c) => `<td>${escapeHtml(r.cells[c])}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
  }
}

function render() { renderNotebook(); renderTreinos(); }

function activateTab(name) {
  for (const tab of ["notebook", "treinos"]) {
    const active = tab === name;
    $(`tab-${tab}`).classList.toggle("active", active);
    $(`tab-${tab}`).setAttribute("aria-selected", String(active));
    $(`${tab}-panel`).hidden = !active;
  }
}

const todayParts = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit" }).formatToParts(new Date()).map((part) => [part.type, part.value]));
$("month-filter").value = `${todayParts.year}-${todayParts.month}`;
$("month-filter").addEventListener("input", renderNotebook);
$("search-filter").addEventListener("input", renderNotebook);
$("division-filter").addEventListener("change", renderTreinos);
$("tab-notebook").addEventListener("click", () => activateTab("notebook"));
$("tab-treinos").addEventListener("click", () => activateTab("treinos"));
$("notebook-list").addEventListener("click", (event) => {
  const statusButton = event.target.closest("button[data-status]");
  if (statusButton) { saveRecord(statusButton.dataset.id, { status: statusButton.dataset.status }); return; }
  const editButton = event.target.closest("button[data-edit]");
  if (editButton) openEditor(editButton.dataset.edit);
});
$("edit-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const session = $("edit-session").value.trim();
  if (!session || session.length > 120 || !editingId) return;
  const row = state.notebook.find((item) => item.id === editingId);
  if (!row) return;
  const sports = [...$("edit-form").querySelectorAll('input[name="sport"]:checked')].map((input) => input.value).filter((value) => SPORTS.includes(value));
  const changes = { session, sports };
  if (/^rest\b/i.test(String(row.session || "").trim()) && !/^rest\b/i.test(session) && row.status === "done") changes.status = "planned";
  $("save-edit-button").disabled = true;
  const saved = await saveRecord(editingId, changes);
  $("save-edit-button").disabled = false;
  if (saved) { $("edit-dialog").close(); editingId = null; }
});
$("close-edit-button").addEventListener("click", () => $("edit-dialog").close());
$("cancel-edit-button").addEventListener("click", () => $("edit-dialog").close());
$("edit-dialog").addEventListener("close", () => { editingId = null; });
$("settings-button").addEventListener("click", () => $("settings-dialog").showModal());
$("connect-button").addEventListener("click", async () => {
  try { await loadGithub($("token-input").value.trim()); $("token-input").value = ""; $("settings-dialog").close(); }
  catch (error) { notice(error.message, true); }
});
$("disconnect-button").addEventListener("click", () => {
  sessionStorage.removeItem("olympia-token");
  state.mode = "none"; state.notebook = []; state.divisions = [];
  render(); notice("Desconectado."); $("settings-dialog").close();
});
$("load-files-button").addEventListener("click", async () => {
  try {
    const notebookFile = $("notebook-file").files[0], treinosFile = $("treinos-file").files[0];
    if (!notebookFile || !treinosFile) throw new Error("Selecione os dois arquivos JSON.");
    const [notebook, divisions] = await Promise.all([notebookFile.text().then(JSON.parse), treinosFile.text().then(JSON.parse)]);
    if (!validNotebook(notebook) || !validDivisions(divisions)) throw new Error("Os arquivos JSON não têm o formato esperado.");
    const local = JSON.parse(localStorage.getItem("olympia-local-notebook") || "null");
    const marks = new Map((validNotebook(local) ? local : []).filter((r) => r.updatedAt).map((r) => [r.id, r]));
    state.notebook = notebook.map((r) => marks.has(r.id) ? { ...r, status: marks.get(r.id).status, session: marks.get(r.id).session, sports: marks.get(r.id).sports, updatedAt: marks.get(r.id).updatedAt } : r);
    state.divisions = divisions; state.mode = "local";
    sessionStorage.removeItem("olympia-token");
    render(); notice("Arquivos abertos. Alterações salvas apenas neste navegador."); $("settings-dialog").close();
  } catch (error) { notice(error.message, true); }
});

render();
const savedToken = sessionStorage.getItem("olympia-token");
if (savedToken) loadGithub(savedToken).catch((error) => notice(error.message, true));
else notice("Conecte o repositório privado em Dados para começar.");

