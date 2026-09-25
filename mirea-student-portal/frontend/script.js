const WEEKDAY_ORDER = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
const WEEKDAY_LABEL = {
  monday: "Понедельник", tuesday: "Вторник", wednesday: "Среда",
  thursday: "Четверг", friday: "Пятница", saturday: "Суббота", sunday: "Воскресенье",
};

let scheduleCache = null;
let currentParity = "odd";

/* ---------------- Node indicator ---------------- */

function noteInstance(instanceId) {
  if (!instanceId) return;
  document.getElementById("nodeLabel").textContent = `узел: ${instanceId}`;
}

async function apiGet(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`${path} → HTTP ${res.status}`);
  const headerInstance = res.headers.get("X-Backend-Instance");
  const data = await res.json();
  noteInstance(headerInstance || data.instance_id);
  return data;
}

async function apiPost(path) {
  const res = await fetch(path, { method: "POST" });
  if (!res.ok) throw new Error(`${path} → HTTP ${res.status}`);
  const headerInstance = res.headers.get("X-Backend-Instance");
  const data = await res.json();
  noteInstance(headerInstance || data.instance_id);
  return data;
}

/* ---------------- Tabs ---------------- */

function setupTabs() {
  const buttons = document.querySelectorAll(".tabs__item");
  buttons.forEach((btn) => {
    btn.addEventListener("click", () => {
      buttons.forEach((b) => b.classList.remove("is-active"));
      btn.classList.add("is-active");
      document.querySelectorAll(".panel").forEach((p) => p.classList.remove("is-active"));
      document.getElementById(`panel-${btn.dataset.tab}`).classList.add("is-active");
    });
  });
}

/* ---------------- Upcoming tab ---------------- */

function renderUpcoming(data) {
  const stateEl = document.getElementById("upcomingState");
  const headerEl = document.getElementById("upcomingHeader");
  const listEl = document.getElementById("upcomingList");

  if (!data.date || data.lessons.length === 0) {
    stateEl.hidden = false;
    stateEl.textContent = "На ближайшую неделю занятий не найдено.";
    headerEl.hidden = true;
    listEl.innerHTML = "";
    return;
  }

  stateEl.hidden = true;
  headerEl.hidden = false;

  const parityLabel = data.week_parity === "odd" ? "нечётная неделя · I" : "чётная неделя · II";
  document.getElementById("upcomingEyebrow").textContent =
    (data.is_today ? "Сегодня осталось" : "Ближайшие занятия") + ` · ${parityLabel}`;

  const dateObj = new Date(data.date + "T00:00:00");
  const dateLabel = dateObj.toLocaleDateString("ru-RU", { day: "numeric", month: "long" });
  document.getElementById("upcomingDate").textContent = `${data.day_label}, ${dateLabel}`;

  listEl.innerHTML = data.lessons.map((lesson) => `
    <div class="lesson-card">
      <div class="lesson-card__time">${lesson.time.split("–")[0]}<br>${lesson.time.split("–")[1]}</div>
      <div>
        <div class="lesson-card__subject">${lesson.subject}</div>
        <div class="lesson-card__meta">${[lesson.teacher, lesson.location].filter(Boolean).join(" · ")}</div>
      </div>
      <div class="lesson-card__type">${lesson.type}</div>
    </div>
  `).join("");
}

async function loadUpcoming() {
  try {
    const data = await apiGet("/api/upcoming");
    renderUpcoming(data);
  } catch (e) {
    document.getElementById("upcomingState").textContent = "Не удалось загрузить данные.";
  }
}

/* ---------------- Schedule tab ---------------- */

function renderSchedule() {
  if (!scheduleCache) return;
  const grid = document.getElementById("scheduleGrid");

  grid.innerHTML = WEEKDAY_ORDER.filter((day) => scheduleCache.days[day]?.length).map((day) => {
    const lessons = scheduleCache.days[day]
      .filter((l) => l.week === "both" || l.week === currentParity)
      .sort((a, b) => a.pair - b.pair);

    if (lessons.length === 0) return "";

    const lessonsHtml = lessons.map((l) => `
      <div class="day-card__lesson">
        <span class="day-card__lesson-pair">${l.pair} пара · ${scheduleCache.pair_times[l.pair]}</span>
        ${l.subject} <span style="color: var(--text-faint)">(${l.type})</span>
        <div class="day-card__lesson-meta">${[l.teacher, l.location].filter(Boolean).join(" · ")}</div>
      </div>
    `).join("");

    return `
      <div class="day-card">
        <div class="day-card__title">${WEEKDAY_LABEL[day]}</div>
        ${lessonsHtml}
      </div>
    `;
  }).join("");
}

function setupWeekToggle() {
  const buttons = document.querySelectorAll(".week-toggle__btn");
  buttons.forEach((btn) => {
    btn.addEventListener("click", () => {
      buttons.forEach((b) => b.classList.remove("is-active"));
      btn.classList.add("is-active");
      currentParity = btn.dataset.parity;
      renderSchedule();
    });
  });
}

async function loadSchedule() {
  try {
    const data = await apiGet("/api/schedule");
    scheduleCache = data;
    document.getElementById("scheduleState").hidden = true;
    document.getElementById("weekToggle").hidden = false;
    renderSchedule();
  } catch (e) {
    document.getElementById("scheduleState").textContent = "Не удалось загрузить расписание.";
  }
}

/* ---------------- Deadlines tab ---------------- */

function formatDue(dueIso) {
  const d = new Date(dueIso + "T00:00:00");
  return d.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function isOverdue(dueIso) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return new Date(dueIso + "T00:00:00") < today;
}

function renderDeadlines(data) {
  const grid = document.getElementById("deadlinesGrid");
  const subjects = Object.values(data.subjects);

  grid.innerHTML = subjects.map((subject) => {
    if (subject.deadlines.length === 0) {
      return `
        <div class="subject-card">
          <div class="subject-card__title">${subject.name}</div>
          <div class="subject-card__note">${subject.note || "Дедлайны пока не заданы."}</div>
        </div>
      `;
    }

    const rows = subject.deadlines.map((item) => `
      <div class="deadline-row ${item.done ? "is-done" : ""} ${isOverdue(item.due) ? "is-overdue" : ""}" data-id="${item.id}">
        <button class="deadline-row__check" aria-label="Отметить выполненным">${item.done ? "✓" : ""}</button>
        <div class="deadline-row__title">${item.title}</div>
        <div class="deadline-row__due">${formatDue(item.due)}</div>
      </div>
    `).join("");

    return `
      <div class="subject-card">
        <div class="subject-card__title">${subject.name}</div>
        ${rows}
      </div>
    `;
  }).join("");

  grid.querySelectorAll(".deadline-row__check").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      const row = e.target.closest(".deadline-row");
      const id = row.dataset.id;
      try {
        const result = await apiPost(`/api/deadlines/${id}/toggle`);
        row.classList.toggle("is-done", result.item.done);
        btn.textContent = result.item.done ? "✓" : "";
      } catch (err) {
        console.error("Не удалось обновить статус дедлайна", err);
      }
    });
  });
}

async function loadDeadlines() {
  try {
    const data = await apiGet("/api/deadlines");
    document.getElementById("deadlinesState").hidden = true;
    renderDeadlines(data);
  } catch (e) {
    document.getElementById("deadlinesState").textContent = "Не удалось загрузить список заданий.";
  }
}

/* ---------------- Init ---------------- */

document.addEventListener("DOMContentLoaded", () => {
  setupTabs();
  setupWeekToggle();
  loadUpcoming();
  loadSchedule();
  loadDeadlines();
});
