import json
import os
import sqlite3
from contextlib import asynccontextmanager, contextmanager
from datetime import date, timedelta
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

DB_PATH = Path(os.getenv("MEALPILOT_DB", "data/mealpilot.db"))
STATIC = Path(__file__).parent / "static"

@contextmanager
def db():
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(DB_PATH)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    try:
        yield connection
        connection.commit()
    finally:
        connection.close()

def init_db():
    with db() as con:
        con.executescript("""
        CREATE TABLE IF NOT EXISTS recipes (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, ingredients TEXT NOT NULL DEFAULT '[]', instructions TEXT NOT NULL DEFAULT '', favorite INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
        CREATE TABLE IF NOT EXISTS meals (id INTEGER PRIMARY KEY AUTOINCREMENT, day TEXT NOT NULL, slot TEXT NOT NULL CHECK(slot IN ('lunch','dinner')), recipe_id INTEGER, UNIQUE(day, slot), FOREIGN KEY(recipe_id) REFERENCES recipes(id) ON DELETE SET NULL);
        CREATE TABLE IF NOT EXISTS shopping (id INTEGER PRIMARY KEY AUTOINCREMENT, label TEXT NOT NULL, quantity TEXT NOT NULL DEFAULT '', checked INTEGER NOT NULL DEFAULT 0);
        """)
        if con.execute("SELECT COUNT(*) FROM recipes").fetchone()[0] == 0:
            samples = [
                ("Poulet rôti aux légumes", ["4 cuisses de poulet", "600 g de pommes de terre", "3 carottes", "herbes de Provence"], "Préchauffer le four à 200°C. Disposer tous les ingrédients dans un plat, assaisonner puis cuire 45 minutes."),
                ("Pâtes à la tomate", ["400 g de pâtes", "500 ml de coulis de tomate", "1 oignon", "parmesan"], "Faire revenir l'oignon, ajouter la tomate et mijoter 15 minutes. Mélanger aux pâtes cuites."),
                ("Curry de pois chiches", ["400 g de pois chiches", "400 ml de lait de coco", "2 c. à soupe de curry", "200 g de riz"], "Faire revenir le curry, ajouter pois chiches et lait de coco. Mijoter 20 minutes et servir avec le riz."),
            ]
            con.executemany("INSERT INTO recipes(name,ingredients,instructions) VALUES(?,?,?)", [(n, json.dumps(i), p) for n, i, p in samples])

@asynccontextmanager
async def lifespan(_app):
    init_db()
    yield

app = FastAPI(title="MealPilot", lifespan=lifespan)
app.mount("/static", StaticFiles(directory=STATIC), name="static")

class RecipeIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    ingredients: list[str] = []
    instructions: str = ""

class MealIn(BaseModel):
    day: date
    slot: str
    recipe_id: int | None = None

class ShoppingIn(BaseModel):
    label: str = Field(min_length=1, max_length=160)
    quantity: str = Field(default="", max_length=80)

def recipe_dict(row):
    item = dict(row)
    item["ingredients"] = json.loads(item["ingredients"])
    item["favorite"] = bool(item["favorite"])
    return item

@app.get("/api/health")
def health(): return {"status": "ok"}

@app.get("/api/recipes")
def recipes():
    with db() as con: return [recipe_dict(r) for r in con.execute("SELECT * FROM recipes ORDER BY favorite DESC, name")]

@app.post("/api/recipes", status_code=201)
def create_recipe(payload: RecipeIn):
    with db() as con:
        cur = con.execute("INSERT INTO recipes(name,ingredients,instructions) VALUES(?,?,?)", (payload.name.strip(), json.dumps(payload.ingredients), payload.instructions.strip()))
        return recipe_dict(con.execute("SELECT * FROM recipes WHERE id=?", (cur.lastrowid,)).fetchone())

@app.patch("/api/recipes/{recipe_id}/favorite")
def favorite(recipe_id: int):
    with db() as con:
        row = con.execute("SELECT favorite FROM recipes WHERE id=?", (recipe_id,)).fetchone()
        if not row: raise HTTPException(404, "Recette introuvable")
        con.execute("UPDATE recipes SET favorite=? WHERE id=?", (not row[0], recipe_id))
        return {"favorite": not bool(row[0])}

@app.get("/api/meals")
def meals(start: date | None = None):
    start = start or (date.today() - timedelta(days=date.today().weekday()))
    with db() as con:
        rows = con.execute("SELECT m.id,m.day,m.slot,m.recipe_id,r.name recipe_name FROM meals m LEFT JOIN recipes r ON r.id=m.recipe_id WHERE m.day BETWEEN ? AND ? ORDER BY m.day,m.slot", (start.isoformat(), (start + timedelta(days=6)).isoformat()))
        return list(map(dict, rows))

@app.put("/api/meals")
def set_meal(payload: MealIn):
    if payload.slot not in ("lunch", "dinner"): raise HTTPException(400, "Créneau invalide")
    with db() as con:
        if payload.recipe_id and not con.execute("SELECT 1 FROM recipes WHERE id=?", (payload.recipe_id,)).fetchone(): raise HTTPException(404, "Recette introuvable")
        con.execute("INSERT INTO meals(day,slot,recipe_id) VALUES(?,?,?) ON CONFLICT(day,slot) DO UPDATE SET recipe_id=excluded.recipe_id", (payload.day.isoformat(), payload.slot, payload.recipe_id))
    return {"ok": True}

@app.get("/api/shopping")
def shopping():
    with db() as con: return [dict(r) | {"checked": bool(r["checked"])} for r in con.execute("SELECT * FROM shopping ORDER BY checked,id")]

@app.post("/api/shopping", status_code=201)
def add_shopping(payload: ShoppingIn):
    with db() as con:
        cur = con.execute("INSERT INTO shopping(label,quantity) VALUES(?,?)", (payload.label.strip(), payload.quantity.strip()))
        return dict(con.execute("SELECT * FROM shopping WHERE id=?", (cur.lastrowid,)).fetchone())

@app.patch("/api/shopping/{item_id}")
def update_shopping(item_id: int, payload: ShoppingIn | None = None):
    with db() as con:
        row = con.execute("SELECT * FROM shopping WHERE id=?", (item_id,)).fetchone()
        if not row: raise HTTPException(404, "Article introuvable")
        if payload: con.execute("UPDATE shopping SET label=?,quantity=? WHERE id=?", (payload.label.strip(), payload.quantity.strip(), item_id))
        else: con.execute("UPDATE shopping SET checked=? WHERE id=?", (not row["checked"], item_id))
    return {"ok": True}

@app.delete("/api/shopping/{item_id}", status_code=204)
def delete_shopping(item_id: int):
    with db() as con: con.execute("DELETE FROM shopping WHERE id=?", (item_id,))

@app.get("/", include_in_schema=False)
def index(): return FileResponse(STATIC / "index.html")
