
from fastapi import APIRouter, Request, HTTPException
from fastapi.responses import RedirectResponse, JSONResponse
from typing import Dict, Optional
import os, time, secrets, base64, hashlib
import httpx
import logging

from app.core.config import settings
from app.utils.cookies import CookieSigner

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/auth/atlassian", tags=["auth:atlassian"])

# ===== Minimal runtime config =====
JIRA_BASE_URL = os.getenv("JIRA_BASE_URL")  # e.g., https://yourcompany.atlassian.net
if not JIRA_BASE_URL:
    raise RuntimeError("JIRA_BASE_URL is required (e.g., https://yourcompany.atlassian.net)")

# One-time constant: set your Atlassian OAuth 3LO client id here once.
CLIENT_ID = os.getenv("ATLASSIAN_CLIENT_ID", "").strip() or "REPLACE_WITH_YOUR_CLIENT_ID"

AUTH_URL = "https://auth.atlassian.com/authorize"
TOKEN_URL = "https://auth.atlassian.com/oauth/token"
ME_URL = "https://api.atlassian.com/me"
ACCESSIBLE_RESOURCES_URL = "https://api.atlassian.com/oauth/token/accessible-resources"

STATE_TTL_SEC = 10 * 60
STATE_STORE: Dict[str, Dict[str, float]] = {}

signer = CookieSigner(settings.secret_key)

def cookie_opts(days: int = 30):
    return {
        "httponly": True,
        "secure": False,           # set False only on HTTP dev
        "samesite": "lax",
        "max_age": days * 24 * 60 * 60,
        "path": "/",
    }

def b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")

def gen_code_verifier() -> str:
    return b64url(os.urandom(32))

def code_challenge(verifier: str) -> str:
    digest = hashlib.sha256(verifier.encode("ascii")).digest()
    return b64url(digest)

def prune_state_store():
    now = time.time()
    for k in [k for k,v in STATE_STORE.items() if v["expires_at"] < now]:
        del STATE_STORE[k]

def external_callback_url(request: Request) -> str:
    scheme = request.headers.get("x-forwarded-proto", request.url.scheme)
    host = request.headers.get("x-forwarded-host", request.headers.get("host", "localhost:8000"))
    return f"{scheme}://{host}/api/auth/atlassian/callback"

@router.get("/login")
async def start_login(request: Request):
    if CLIENT_ID == "REPLACE_WITH_YOUR_CLIENT_ID":
        raise HTTPException(status_code=500, detail="Set ATLASSIAN_CLIENT_ID env or edit CLIENT_ID in auth_atlassian.py")
    prune_state_store()

    state = secrets.token_urlsafe(24)
    verifier = gen_code_verifier()
    challenge = code_challenge(verifier)
    STATE_STORE[state] = {"code_verifier": verifier, "expires_at": time.time() + STATE_TTL_SEC}

    redirect_uri = external_callback_url(request)
    scopes = "read:jira-user read:jira-work offline_access"

    url = (
    f"{AUTH_URL}"
    f"?audience=api.atlassian.com"
    f"&client_id={CLIENT_ID}"
    f"&scope={httpx.QueryParams({'s': scopes})['s']}"
    f"&redirect_uri={httpx.QueryParams({'r': redirect_uri})['r']}"
    f"&state={state}"
    f"&response_type=code"
    f"&code_challenge={challenge}"
    f"&code_challenge_method=S256"
    )
    logger.info(f"Redirecting to Atlassian auth URL")
    return RedirectResponse(url)

@router.get("/callback")
async def oauth_callback(request: Request):
    code = request.query_params.get("code")
    state = request.query_params.get("state")
    if not code or not state:
        raise HTTPException(status_code=400, detail="Missing code/state")

    stash = STATE_STORE.pop(state, None)
    if not stash or stash["expires_at"] < time.time():
        raise HTTPException(status_code=400, detail="Invalid or expired state")
    verifier = stash["code_verifier"]
    redirect_uri = external_callback_url(request)
    logger.debug(f"Redirect URI used in token exchange: {redirect_uri}")

    async with httpx.AsyncClient(timeout=20) as client:
        token_res = await client.post(TOKEN_URL, json={
            "grant_type": "authorization_code",
            "client_id": CLIENT_ID,
            "code": code,
            "redirect_uri": redirect_uri,
            "code_verifier": verifier,
        })
        if token_res.status_code != 200:
            raise HTTPException(status_code=400, detail=f"Token exchange failed: {token_res.text}")
        token_json = token_res.json()
        access_token = token_json.get("access_token")
        if not access_token:
            raise HTTPException(status_code=400, detail="No access_token")

        me_res = await client.get(ME_URL, headers={"Authorization": f"Bearer {access_token}"})
        if me_res.status_code != 200:
            raise HTTPException(status_code=400, detail=f"/me failed: {me_res.text}")
        account_id = me_res.json().get("account_id")
        if not account_id:
            raise HTTPException(status_code=400, detail="No account_id in /me")

        cloud_id: Optional[str] = None
        sites_res = await client.get(ACCESSIBLE_RESOURCES_URL, headers={"Authorization": f"Bearer {access_token}"})
        if sites_res.status_code == 200:
            want = JIRA_BASE_URL.rstrip("/").lower()
            for s in sites_res.json():
                url = (s.get("url") or "").rstrip("/").lower()
                if url == want:
                    cloud_id = s.get("id")
                    break

    # set cookies and bounce to app root
    resp = RedirectResponse(url="/")
    resp.set_cookie("jiraAccountId", signer.sign(account_id), **cookie_opts())
    if cloud_id:
        resp.set_cookie("jiraCloudId", signer.sign(cloud_id), **cookie_opts())
    return resp

@router.get("/me")
async def whoami(request: Request):
    acc = request.cookies.get("jiraAccountId")
    if not acc:
        return JSONResponse({"error": "Not authenticated"}, status_code=401)
    try:
        account_id = signer.unsign(acc)
    except Exception:
        return JSONResponse({"error": "Invalid cookie"}, status_code=401)
    cloud_id = None
    c = request.cookies.get("jiraCloudId")
    if c:
        try:
            cloud_id = signer.unsign(c)
        except Exception:
            cloud_id = None
    return {"accountId": account_id, "cloudId": cloud_id, "site": JIRA_BASE_URL}
