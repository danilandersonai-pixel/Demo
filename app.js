(() => {
  "use strict";

  const STORAGE_KEY = "vibe-journal:entries:v1";

  const form = document.getElementById("entry-form");
  const dateInput = document.getElementById("entry-date");
  const tagsInput = document.getElementById("entry-tags");
  const notesInput = document.getElementById("entry-notes");
  const promptsList = document.getElementById("prompts-list");
  const addPromptBtn = document.getElementById("add-prompt");
  const cancelEditBtn = document.getElementById("cancel-edit");
  const saveBtn = document.getElementById("save-btn");
  const entriesEl = document.getElementById("entries");
  const emptyEl = document.getElementById("empty");
  const statsEl = document.getElementById("stats");
  const searchInput = document.getElementById("search");
  const exportBtn = document.getElementById("export-btn");
  const importInput = document.getElementById("import-input");

  const entryTpl = document.getElementById("entry-template");
  const promptTpl = document.getElementById("prompt-template");

  /** @type {{id:string,date:string,tags:string[],notes:string,prompts:{title:string,body:string}[]}[]} */
  let entries = load();
  let editingId = null;
  let filter = "";

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  function save() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  }

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function todayISO() {
    const d = new Date();
    const tz = d.getTimezoneOffset() * 60000;
    return new Date(d - tz).toISOString().slice(0, 10);
  }

  function parseTags(str) {
    return str
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
  }

  function formatDate(iso) {
    try {
      const d = new Date(iso + "T00:00:00");
      return d.toLocaleDateString("ru-RU", {
        weekday: "short",
        day: "2-digit",
        month: "long",
        year: "numeric",
      });
    } catch {
      return iso;
    }
  }

  function addPromptRow(value = { title: "", body: "" }) {
    const node = promptTpl.content.firstElementChild.cloneNode(true);
    node.querySelector(".prompt-title").value = value.title || "";
    node.querySelector(".prompt-body").value = value.body || "";
    node.querySelector(".remove-prompt").addEventListener("click", () => {
      node.remove();
    });
    promptsList.appendChild(node);
  }

  function readPrompts() {
    const rows = [...promptsList.querySelectorAll(".prompt-row")];
    return rows
      .map((r) => ({
        title: r.querySelector(".prompt-title").value.trim(),
        body: r.querySelector(".prompt-body").value.trim(),
      }))
      .filter((p) => p.title || p.body);
  }

  function resetForm() {
    editingId = null;
    form.reset();
    dateInput.value = todayISO();
    promptsList.innerHTML = "";
    addPromptRow();
    saveBtn.textContent = "Сохранить";
    cancelEditBtn.hidden = true;
  }

  function startEdit(entry) {
    editingId = entry.id;
    dateInput.value = entry.date;
    tagsInput.value = entry.tags.join(", ");
    notesInput.value = entry.notes;
    promptsList.innerHTML = "";
    if (entry.prompts.length === 0) {
      addPromptRow();
    } else {
      entry.prompts.forEach(addPromptRow);
    }
    saveBtn.textContent = "Обновить";
    cancelEditBtn.hidden = false;
    form.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function deleteEntry(id) {
    if (!confirm("Удалить запись?")) return;
    entries = entries.filter((e) => e.id !== id);
    save();
    render();
    if (editingId === id) resetForm();
  }

  function matches(entry, q) {
    if (!q) return true;
    const hay = [
      entry.date,
      entry.notes,
      entry.tags.join(" "),
      ...entry.prompts.flatMap((p) => [p.title, p.body]),
    ]
      .join("\n")
      .toLowerCase();
    return hay.includes(q.toLowerCase());
  }

  function render() {
    const sorted = [...entries].sort((a, b) =>
      a.date < b.date ? 1 : a.date > b.date ? -1 : 0
    );
    const visible = sorted.filter((e) => matches(e, filter));

    entriesEl.innerHTML = "";
    visible.forEach((entry) => {
      const node = entryTpl.content.firstElementChild.cloneNode(true);
      node.dataset.id = entry.id;
      node.querySelector(".entry-date").textContent = formatDate(entry.date);

      const tagsEl = node.querySelector(".tags");
      entry.tags.forEach((t) => {
        const tag = document.createElement("span");
        tag.className = "tag";
        tag.textContent = "#" + t;
        tagsEl.appendChild(tag);
      });

      node.querySelector(".entry-notes").textContent = entry.notes;

      const promptsEl = node.querySelector(".entry-prompts");
      entry.prompts.forEach((p) => {
        const card = document.createElement("div");
        card.className = "prompt-card";
        if (p.title) {
          const t = document.createElement("div");
          t.className = "pt";
          t.textContent = p.title;
          card.appendChild(t);
        }
        if (p.body) {
          const b = document.createElement("div");
          b.className = "pb";
          b.textContent = p.body;
          card.appendChild(b);
        }
        promptsEl.appendChild(card);
      });

      node
        .querySelector(".edit-btn")
        .addEventListener("click", () => startEdit(entry));
      node
        .querySelector(".delete-btn")
        .addEventListener("click", () => deleteEntry(entry.id));

      entriesEl.appendChild(node);
    });

    emptyEl.hidden = visible.length !== 0;
    if (entries.length === 0) {
      emptyEl.textContent = "Пока пусто. Запиши, над чем сегодня кодил.";
    } else if (visible.length === 0) {
      emptyEl.textContent = "Ничего не найдено по запросу.";
    }

    const totalPrompts = entries.reduce((n, e) => n + e.prompts.length, 0);
    statsEl.textContent = `${entries.length} записей · ${totalPrompts} промптов`;
  }

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const entry = {
      id: editingId || uid(),
      date: dateInput.value || todayISO(),
      tags: parseTags(tagsInput.value),
      notes: notesInput.value.trim(),
      prompts: readPrompts(),
    };
    if (!entry.notes) return;
    if (editingId) {
      entries = entries.map((x) => (x.id === editingId ? entry : x));
    } else {
      entries.push(entry);
    }
    save();
    resetForm();
    render();
  });

  addPromptBtn.addEventListener("click", () => addPromptRow());
  cancelEditBtn.addEventListener("click", resetForm);

  searchInput.addEventListener("input", (e) => {
    filter = e.target.value;
    render();
  });

  exportBtn.addEventListener("click", () => {
    const blob = new Blob([JSON.stringify(entries, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `vibe-journal-${todayISO()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  });

  importInput.addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      if (!Array.isArray(data)) throw new Error("invalid format");
      const existing = new Map(entries.map((x) => [x.id, x]));
      data.forEach((item) => {
        if (item && item.id && item.date && typeof item.notes === "string") {
          existing.set(item.id, {
            id: item.id,
            date: item.date,
            tags: Array.isArray(item.tags) ? item.tags : [],
            notes: item.notes,
            prompts: Array.isArray(item.prompts) ? item.prompts : [],
          });
        }
      });
      entries = [...existing.values()];
      save();
      render();
    } catch (err) {
      alert("Не удалось импортировать: " + err.message);
    } finally {
      importInput.value = "";
    }
  });

  resetForm();
  render();
})();
