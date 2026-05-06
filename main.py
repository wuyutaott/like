import os
from pathlib import Path
from typing import Optional

from dotenv import load_dotenv

load_dotenv(Path(__file__).parent / ".env")

from fastapi import Depends, FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from starlette.middleware.sessions import SessionMiddleware

import db as database
from auth import require_owner, router as auth_router

database.init_db()

BASE = Path(__file__).parent
app = FastAPI(title="Like · 我的网络收藏夹")
app.add_middleware(
    SessionMiddleware,
    secret_key=os.environ["SESSION_SECRET"],
    same_site="lax",
    https_only=os.environ.get("SESSION_HTTPS_ONLY", "false").lower() == "true",
    max_age=60 * 60 * 24 * 30,
)
app.include_router(auth_router, prefix="/auth")
app.mount("/static", StaticFiles(directory=BASE / "static"), name="static")


@app.get("/")
def index() -> FileResponse:
    return FileResponse(BASE / "static" / "index.html")


# ---------- Schemas ----------
class CategoryIn(BaseModel):
    name: str = Field(min_length=1, max_length=60)
    parent_id: Optional[int] = None


class CategoryPatch(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=60)
    parent_id: Optional[int] = None


class BookmarkIn(BaseModel):
    category_id: int
    title: str = Field(min_length=1, max_length=200)
    url: str = Field(min_length=1, max_length=2000)
    description: Optional[str] = ""


class BookmarkPatch(BaseModel):
    category_id: Optional[int] = None
    title: Optional[str] = Field(default=None, min_length=1, max_length=200)
    url: Optional[str] = Field(default=None, min_length=1, max_length=2000)
    description: Optional[str] = None


class DeveloperIn(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    url: str = Field(min_length=1, max_length=500)
    avatar_url: Optional[str] = Field(default=None, max_length=500)
    reason: Optional[str] = ""


class DeveloperPatch(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=100)
    url: Optional[str] = Field(default=None, min_length=1, max_length=500)
    avatar_url: Optional[str] = Field(default=None, max_length=500)
    reason: Optional[str] = None


# ---------- Categories (read public, write owner-only) ----------
@app.get("/api/categories")
def list_categories():
    with database.connect() as db:
        rows = db.execute(
            "SELECT id, name, parent_id, sort_order "
            "FROM categories "
            "ORDER BY (parent_id IS NOT NULL), parent_id, sort_order, id"
        ).fetchall()
    return [dict(r) for r in rows]


@app.post("/api/categories", status_code=201, dependencies=[Depends(require_owner)])
def create_category(body: CategoryIn):
    with database.connect() as db:
        if body.parent_id is not None:
            parent = db.execute(
                "SELECT parent_id FROM categories WHERE id=?", (body.parent_id,)
            ).fetchone()
            if not parent:
                raise HTTPException(404, "父分类不存在")
            if parent["parent_id"] is not None:
                raise HTTPException(400, "仅支持两级分类")
        cur = db.execute(
            "INSERT INTO categories(name, parent_id) VALUES (?, ?)",
            (body.name.strip(), body.parent_id),
        )
        db.commit()
        return {
            "id": cur.lastrowid,
            "name": body.name.strip(),
            "parent_id": body.parent_id,
            "sort_order": 0,
        }


@app.patch("/api/categories/{cid}", dependencies=[Depends(require_owner)])
def update_category(cid: int, body: CategoryPatch):
    data = body.model_dump(exclude_unset=True)
    if not data:
        return {"ok": True}
    with database.connect() as db:
        current = db.execute("SELECT id FROM categories WHERE id=?", (cid,)).fetchone()
        if not current:
            raise HTTPException(404, "分类不存在")

        if "parent_id" in data:
            new_parent = data["parent_id"]
            if new_parent == cid:
                raise HTTPException(400, "不能成为自己的父分类")
            if new_parent is not None:
                p = db.execute(
                    "SELECT parent_id FROM categories WHERE id=?", (new_parent,)
                ).fetchone()
                if not p:
                    raise HTTPException(404, "父分类不存在")
                if p["parent_id"] is not None:
                    raise HTTPException(400, "父分类必须是一级分类")
                kids = db.execute(
                    "SELECT COUNT(*) AS c FROM categories WHERE parent_id=?", (cid,)
                ).fetchone()["c"]
                if kids > 0:
                    raise HTTPException(400, "已有子分类的分类不能再被嵌套")

        if "name" in data:
            data["name"] = data["name"].strip()

        sets = ", ".join(f"{k}=?" for k in data)
        db.execute(f"UPDATE categories SET {sets} WHERE id=?", (*data.values(), cid))
        db.commit()
    return {"ok": True}


@app.delete("/api/categories/{cid}", dependencies=[Depends(require_owner)])
def delete_category(cid: int):
    with database.connect() as db:
        if not db.execute("SELECT id FROM categories WHERE id=?", (cid,)).fetchone():
            raise HTTPException(404, "分类不存在")
        db.execute("DELETE FROM categories WHERE id=?", (cid,))
        db.commit()
    return {"ok": True}


# ---------- Bookmarks (read public, write owner-only) ----------
@app.get("/api/bookmarks")
def list_bookmarks(category_id: Optional[int] = None, q: Optional[str] = None):
    sql = (
        "SELECT id, category_id, title, url, description, created_at, updated_at "
        "FROM bookmarks"
    )
    where, args = [], []
    if category_id is not None:
        where.append(
            "(category_id = ? OR category_id IN "
            "(SELECT id FROM categories WHERE parent_id = ?))"
        )
        args.extend([category_id, category_id])
    if q:
        where.append("(title LIKE ? OR url LIKE ? OR description LIKE ?)")
        like = f"%{q.strip()}%"
        args.extend([like, like, like])
    if where:
        sql += " WHERE " + " AND ".join(where)
    sql += " ORDER BY updated_at DESC, id DESC"

    with database.connect() as db:
        rows = db.execute(sql, args).fetchall()
    return [dict(r) for r in rows]


@app.post("/api/bookmarks", status_code=201, dependencies=[Depends(require_owner)])
def create_bookmark(body: BookmarkIn):
    with database.connect() as db:
        if not db.execute(
            "SELECT id FROM categories WHERE id=?", (body.category_id,)
        ).fetchone():
            raise HTTPException(404, "分类不存在")
        cur = db.execute(
            "INSERT INTO bookmarks(category_id, title, url, description) "
            "VALUES (?, ?, ?, ?)",
            (
                body.category_id,
                body.title.strip(),
                body.url.strip(),
                (body.description or "").strip(),
            ),
        )
        db.commit()
        return _fetch_bookmark(db, cur.lastrowid)


@app.patch("/api/bookmarks/{bid}", dependencies=[Depends(require_owner)])
def update_bookmark(bid: int, body: BookmarkPatch):
    data = body.model_dump(exclude_unset=True)
    if not data:
        return {"ok": True}
    with database.connect() as db:
        if not db.execute("SELECT id FROM bookmarks WHERE id=?", (bid,)).fetchone():
            raise HTTPException(404, "书签不存在")
        if "category_id" in data:
            if not db.execute(
                "SELECT id FROM categories WHERE id=?", (data["category_id"],)
            ).fetchone():
                raise HTTPException(404, "目标分类不存在")
        for key in ("title", "url", "description"):
            if key in data and data[key] is not None:
                data[key] = data[key].strip()

        parts = [f"{k}=?" for k in data] + ["updated_at=CURRENT_TIMESTAMP"]
        sql = f"UPDATE bookmarks SET {', '.join(parts)} WHERE id=?"
        db.execute(sql, (*data.values(), bid))
        db.commit()
        return _fetch_bookmark(db, bid)


@app.delete("/api/bookmarks/{bid}", dependencies=[Depends(require_owner)])
def delete_bookmark(bid: int):
    with database.connect() as db:
        if not db.execute("SELECT id FROM bookmarks WHERE id=?", (bid,)).fetchone():
            raise HTTPException(404, "书签不存在")
        db.execute("DELETE FROM bookmarks WHERE id=?", (bid,))
        db.commit()
    return {"ok": True}


def _fetch_bookmark(db, bid: int) -> dict:
    row = db.execute(
        "SELECT id, category_id, title, url, description, created_at, updated_at "
        "FROM bookmarks WHERE id=?",
        (bid,),
    ).fetchone()
    return dict(row)


# ---------- Developers (read public, write owner-only) ----------
@app.get("/api/developers")
def list_developers(q: Optional[str] = None):
    sql = (
        "SELECT id, name, url, avatar_url, reason, created_at, updated_at "
        "FROM developers"
    )
    where, args = [], []
    if q:
        where.append("(name LIKE ? OR url LIKE ? OR reason LIKE ?)")
        like = f"%{q.strip()}%"
        args.extend([like, like, like])
    if where:
        sql += " WHERE " + " AND ".join(where)
    sql += " ORDER BY updated_at DESC, id DESC"
    with database.connect() as db:
        rows = db.execute(sql, args).fetchall()
    return [dict(r) for r in rows]


@app.post("/api/developers", status_code=201, dependencies=[Depends(require_owner)])
def create_developer(body: DeveloperIn):
    with database.connect() as db:
        cur = db.execute(
            "INSERT INTO developers(name, url, avatar_url, reason) "
            "VALUES (?, ?, ?, ?)",
            (
                body.name.strip(),
                body.url.strip(),
                (body.avatar_url or "").strip() or None,
                (body.reason or "").strip(),
            ),
        )
        db.commit()
        return _fetch_developer(db, cur.lastrowid)


@app.patch("/api/developers/{did}", dependencies=[Depends(require_owner)])
def update_developer(did: int, body: DeveloperPatch):
    data = body.model_dump(exclude_unset=True)
    if not data:
        return {"ok": True}
    with database.connect() as db:
        if not db.execute("SELECT id FROM developers WHERE id=?", (did,)).fetchone():
            raise HTTPException(404, "Developer 不存在")
        for key in ("name", "url", "avatar_url", "reason"):
            if key in data and data[key] is not None:
                cleaned = data[key].strip()
                data[key] = cleaned if cleaned else (None if key == "avatar_url" else "")
        parts = [f"{k}=?" for k in data] + ["updated_at=CURRENT_TIMESTAMP"]
        sql = f"UPDATE developers SET {', '.join(parts)} WHERE id=?"
        db.execute(sql, (*data.values(), did))
        db.commit()
        return _fetch_developer(db, did)


@app.delete("/api/developers/{did}", dependencies=[Depends(require_owner)])
def delete_developer(did: int):
    with database.connect() as db:
        if not db.execute("SELECT id FROM developers WHERE id=?", (did,)).fetchone():
            raise HTTPException(404, "Developer 不存在")
        db.execute("DELETE FROM developers WHERE id=?", (did,))
        db.commit()
    return {"ok": True}


def _fetch_developer(db, did: int) -> dict:
    row = db.execute(
        "SELECT id, name, url, avatar_url, reason, created_at, updated_at "
        "FROM developers WHERE id=?",
        (did,),
    ).fetchone()
    return dict(row)
