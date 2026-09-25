"""
MIREA Student Portal — backend (FastAPI)

Каждый экземпляр этого backend читает свой INSTANCE_ID из переменной
окружения и добавляет его в каждый ответ (заголовок X-Backend-Instance
и поле instance_id в JSON), чтобы можно было однозначно определить,
какая нода ответила на запрос за балансировщиком Nginx.

Данные (расписание и дедлайны) читаются из JSON-файлов в каталоге
DATA_DIR. Этот каталог монтируется как общий bind mount с хоста в оба
backend-контейнера одновременно, поэтому падение одной ноды не влияет
на доступ к данным — вторая нода продолжает читать и писать тот же
файл на диске хоста.
"""

import json
import os
import threading
from datetime import date as date_cls
from datetime import datetime, timedelta
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware

DATA_DIR = Path(os.environ.get("DATA_DIR", "/app/data"))
SCHEDULE_FILE = DATA_DIR / "schedule.json"
DEADLINES_FILE = DATA_DIR / "deadlines.json"
INSTANCE_ID = os.environ.get("INSTANCE_ID", "unknown")

WEEKDAYS_ORDER = [
    "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday",
]
WEEKDAYS_LABEL_RU = {
    "monday": "Понедельник",
    "tuesday": "Вторник",
    "wednesday": "Среда",
    "thursday": "Четверг",
    "friday": "Пятница",
    "saturday": "Суббота",
    "sunday": "Воскресенье",
}

_write_lock = threading.Lock()

app = FastAPI(title="MIREA Student Portal API", version="1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def stamp_instance(request: Request, call_next):
    """Помечает каждый ответ заголовком с ID ноды, обработавшей запрос."""
    response = await call_next(request)
    response.headers["X-Backend-Instance"] = INSTANCE_ID
    return response


def _load_json(path: Path) -> dict:
    if not path.exists():
        raise HTTPException(status_code=500, detail=f"Файл данных не найден: {path}")
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def _save_json(path: Path, data: dict) -> None:
    tmp_path = path.with_suffix(".tmp")
    with open(tmp_path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    tmp_path.replace(path)


def _week_parity(target_date: date_cls, reference_monday: date_cls) -> str:
    """
    Возвращает "odd" (нечётная, I) или "even" (чётная, II) для недели,
    в которую попадает target_date, относительно reference_monday —
    понедельника опорной (1-й, нечётной) учебной недели.
    """
    monday_of_target_week = target_date - timedelta(days=target_date.weekday())
    weeks_since_reference = (monday_of_target_week - reference_monday).days // 7
    week_number = weeks_since_reference + 1
    return "odd" if week_number % 2 == 1 else "even"


def _pair_start_end(pair_times: dict, pair_num: int):
    time_range = pair_times[str(pair_num)]
    start_str, end_str = [p.strip() for p in time_range.split("–")]
    start_h, start_m = map(int, start_str.split(":"))
    end_h, end_m = map(int, end_str.split(":"))
    return (start_h, start_m), (end_h, end_m)


def _lessons_for_date(schedule: dict, target_date: date_cls) -> list:
    weekday_key = WEEKDAYS_ORDER[target_date.weekday()]
    reference_monday = date_cls.fromisoformat(schedule["reference_monday"])
    parity = _week_parity(target_date, reference_monday)
    raw_lessons = schedule["days"].get(weekday_key, [])
    lessons = [l for l in raw_lessons if l["week"] in ("both", parity)]
    lessons.sort(key=lambda l: l["pair"])
    return lessons


@app.get("/api/health")
def health():
    return {"status": "ok", "instance_id": INSTANCE_ID}


@app.get("/api/instance")
def get_instance():
    """Явный эндпоинт для проверки, какая нода отвечает (для демонстрации балансировки)."""
    return {
        "instance_id": INSTANCE_ID,
        "server_time": datetime.now().isoformat(timespec="seconds"),
    }


@app.get("/api/schedule")
def get_schedule():
    schedule = _load_json(SCHEDULE_FILE)
    return {"instance_id": INSTANCE_ID, **schedule}


@app.get("/api/deadlines")
def get_deadlines():
    deadlines = _load_json(DEADLINES_FILE)
    return {"instance_id": INSTANCE_ID, **deadlines}


@app.post("/api/deadlines/{item_id}/toggle")
def toggle_deadline(item_id: str):
    with _write_lock:
        data = _load_json(DEADLINES_FILE)
        found_item = None
        for subject in data["subjects"].values():
            for item in subject.get("deadlines", []):
                if item["id"] == item_id:
                    item["done"] = not item["done"]
                    found_item = item
                    break
            if found_item:
                break

        if found_item is None:
            raise HTTPException(status_code=404, detail="Дедлайн с таким id не найден")

        _save_json(DEADLINES_FILE, data)
        return {"instance_id": INSTANCE_ID, "item": found_item}


@app.get("/api/upcoming")
def get_upcoming():
    schedule = _load_json(SCHEDULE_FILE)
    pair_times = schedule["pair_times"]
    reference_monday = date_cls.fromisoformat(schedule["reference_monday"])

    now = datetime.now()
    today = now.date()

    todays_lessons = _lessons_for_date(schedule, today)
    remaining_today = []
    for lesson in todays_lessons:
        (_, _), (end_h, end_m) = _pair_start_end(pair_times, lesson["pair"])
        lesson_end = datetime.combine(today, datetime.min.time()).replace(hour=end_h, minute=end_m)
        if lesson_end > now:
            remaining_today.append(lesson)

    if remaining_today:
        target_date = today
        lessons = remaining_today
        is_today = True
    else:
        target_date = None
        lessons = []
        is_today = False
        for offset in range(1, 8):
            candidate = today + timedelta(days=offset)
            candidate_lessons = _lessons_for_date(schedule, candidate)
            if candidate_lessons:
                target_date = candidate
                lessons = candidate_lessons
                break

    enriched_lessons = [
        {**lesson, "time": pair_times[str(lesson["pair"])]} for lesson in lessons
    ]

    return {
        "instance_id": INSTANCE_ID,
        "date": target_date.isoformat() if target_date else None,
        "day_label": WEEKDAYS_LABEL_RU[WEEKDAYS_ORDER[target_date.weekday()]] if target_date else None,
        "week_parity": _week_parity(target_date, reference_monday) if target_date else None,
        "is_today": is_today,
        "lessons": enriched_lessons,
    }
