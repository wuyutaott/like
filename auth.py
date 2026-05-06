import os
import secrets
from urllib.parse import urlencode, quote

import httpx
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import RedirectResponse

router = APIRouter()

GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
GOOGLE_USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo"


def _cfg(key: str, required: bool = True) -> str:
    val = os.environ.get(key, "").strip()
    if required and not val:
        raise RuntimeError(f"Missing required env var: {key}")
    return val


def owner_email() -> str:
    return _cfg("OWNER_EMAIL").lower()


def current_user(request: Request) -> dict | None:
    return request.session.get("user")


def is_owner(request: Request) -> bool:
    user = current_user(request)
    return bool(user) and (user.get("email") or "").lower() == owner_email()


def require_owner(request: Request) -> None:
    if not is_owner(request):
        raise HTTPException(status_code=401, detail="请先用所有者账号登录")


@router.get("/google/login")
def login(request: Request, next: str = "/"):
    state = secrets.token_urlsafe(32)
    request.session["oauth_state"] = state
    request.session["next"] = next or "/"
    params = {
        "client_id": _cfg("GOOGLE_CLIENT_ID"),
        "redirect_uri": _cfg("OAUTH_REDIRECT_URI"),
        "response_type": "code",
        "scope": "openid email profile",
        "state": state,
        "access_type": "online",
        "prompt": "select_account",
    }
    return RedirectResponse(f"{GOOGLE_AUTH_URL}?{urlencode(params)}")


@router.get("/google/callback")
async def callback(request: Request, code: str = "", state: str = "", error: str = ""):
    if error:
        return RedirectResponse(f"/?login_error={quote(error)}")
    saved = request.session.pop("oauth_state", None)
    if not saved or saved != state:
        raise HTTPException(400, "OAuth state 不匹配，疑似 CSRF")
    next_url = request.session.pop("next", "/") or "/"

    async with httpx.AsyncClient(timeout=15.0) as client:
        token_resp = await client.post(
            GOOGLE_TOKEN_URL,
            data={
                "code": code,
                "client_id": _cfg("GOOGLE_CLIENT_ID"),
                "client_secret": _cfg("GOOGLE_CLIENT_SECRET"),
                "redirect_uri": _cfg("OAUTH_REDIRECT_URI"),
                "grant_type": "authorization_code",
            },
        )
        token_resp.raise_for_status()
        access_token = token_resp.json().get("access_token")
        if not access_token:
            raise HTTPException(502, "Google 未返回 access_token")

        info_resp = await client.get(
            GOOGLE_USERINFO_URL,
            headers={"Authorization": f"Bearer {access_token}"},
        )
        info_resp.raise_for_status()
        info = info_resp.json()

    request.session["user"] = {
        "email": (info.get("email") or "").lower(),
        "name": info.get("name"),
        "picture": info.get("picture"),
    }
    return RedirectResponse(next_url)


@router.post("/logout")
def logout(request: Request):
    request.session.pop("user", None)
    return {"ok": True}


@router.get("/me")
def me(request: Request):
    user = current_user(request)
    return {"user": user, "is_owner": is_owner(request)}
