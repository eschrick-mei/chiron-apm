"""
Chiron APM - Authentication & Authorization

Simple JWT-based auth for multi-user support.
Designed for a small team — not a full IAM system.

Users are stored in a JSON file (users.json) for simplicity.
Can be swapped for a database later.
"""

import json
import hashlib
import secrets
import logging
import os
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Optional
from functools import wraps

from fastapi import Request, HTTPException, Depends
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pydantic import BaseModel

logger = logging.getLogger(__name__)

# JWT implementation using PyJWT
try:
    import jwt as pyjwt
    HAS_JWT = True
except ImportError:
    HAS_JWT = False
    logger.warning("PyJWT not installed. Auth will be disabled. Run: pip install PyJWT")


# =============================================================================
# Configuration
# =============================================================================

JWT_SECRET = os.environ.get("CHIRON_JWT_SECRET", "chiron-dev-secret-change-in-production")
JWT_ALGORITHM = "HS256"
JWT_EXPIRY_HOURS = int(os.environ.get("CHIRON_JWT_EXPIRY_HOURS", "24"))
AUTH_ENABLED = os.environ.get("CHIRON_AUTH_ENABLED", "false").lower() == "true"
USERS_FILE = Path(__file__).parent / "users.json"


# =============================================================================
# Models
# =============================================================================

class UserRole:
    ADMIN = "admin"       # Full access: configure, manage users, acknowledge
    OPERATOR = "operator"  # Can acknowledge alerts, verify, export
    VIEWER = "viewer"      # Read-only access


class User(BaseModel):
    username: str
    display_name: str
    role: str = UserRole.VIEWER
    email: Optional[str] = None
    active: bool = True


class LoginRequest(BaseModel):
    username: str
    password: str


class LoginResponse(BaseModel):
    token: str
    user: User
    expires_at: str


class TokenPayload(BaseModel):
    sub: str  # username
    role: str
    display_name: str
    exp: float


# =============================================================================
# User Store (JSON file)
# =============================================================================

def _hash_password(password: str, salt: str = "") -> str:
    """Hash a password with optional salt."""
    return hashlib.sha256(f"{salt}{password}".encode()).hexdigest()


def _load_users() -> dict:
    """Load users from JSON file."""
    if not USERS_FILE.exists():
        # Create default admin user on first run
        default_users = {
            "admin": {
                "display_name": "Admin",
                "role": UserRole.ADMIN,
                "email": "",
                "password_hash": _hash_password("chiron2026", "admin"),
                "salt": "admin",
                "active": True,
            }
        }
        USERS_FILE.write_text(json.dumps(default_users, indent=2))
        logger.info(f"Created default users file at {USERS_FILE}")
        return default_users

    return json.loads(USERS_FILE.read_text())


def _save_users(users: dict):
    """Save users to JSON file."""
    USERS_FILE.write_text(json.dumps(users, indent=2))


def verify_credentials(username: str, password: str) -> Optional[User]:
    """Verify username/password and return User if valid."""
    users = _load_users()
    user_data = users.get(username)

    if not user_data:
        return None

    if not user_data.get("active", True):
        return None

    salt = user_data.get("salt", "")
    expected_hash = user_data.get("password_hash", "")

    if _hash_password(password, salt) != expected_hash:
        return None

    return User(
        username=username,
        display_name=user_data.get("display_name", username),
        role=user_data.get("role", UserRole.VIEWER),
        email=user_data.get("email"),
        active=True,
    )


def create_user(username: str, password: str, display_name: str, role: str = UserRole.VIEWER, email: str = "") -> User:
    """Create a new user."""
    users = _load_users()
    if username in users:
        raise ValueError(f"User '{username}' already exists")

    salt = secrets.token_hex(8)
    users[username] = {
        "display_name": display_name,
        "role": role,
        "email": email,
        "password_hash": _hash_password(password, salt),
        "salt": salt,
        "active": True,
    }
    _save_users(users)

    return User(username=username, display_name=display_name, role=role, email=email, active=True)


def list_users() -> list[User]:
    """List all users."""
    users = _load_users()
    return [
        User(
            username=uname,
            display_name=data.get("display_name", uname),
            role=data.get("role", UserRole.VIEWER),
            email=data.get("email"),
            active=data.get("active", True),
        )
        for uname, data in users.items()
    ]


# =============================================================================
# JWT Token Operations
# =============================================================================

def create_token(user: User) -> str:
    """Create a JWT token for a user."""
    if not HAS_JWT:
        raise HTTPException(status_code=500, detail="PyJWT not installed")

    payload = {
        "sub": user.username,
        "role": user.role,
        "display_name": user.display_name,
        "exp": datetime.now(timezone.utc) + timedelta(hours=JWT_EXPIRY_HOURS),
        "iat": datetime.now(timezone.utc),
    }
    return pyjwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


def decode_token(token: str) -> TokenPayload:
    """Decode and validate a JWT token."""
    if not HAS_JWT:
        raise HTTPException(status_code=500, detail="PyJWT not installed")

    try:
        payload = pyjwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        return TokenPayload(
            sub=payload["sub"],
            role=payload["role"],
            display_name=payload.get("display_name", payload["sub"]),
            exp=payload["exp"],
        )
    except pyjwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except pyjwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")


# =============================================================================
# FastAPI Dependencies
# =============================================================================

security = HTTPBearer(auto_error=False)


async def get_current_user(
    request: Request,
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security),
) -> Optional[User]:
    """
    Extract current user from JWT token.

    When AUTH_ENABLED=false, returns a default anonymous user.
    When AUTH_ENABLED=true, requires valid JWT token.
    """
    if not AUTH_ENABLED:
        # Auth disabled — return anonymous user with full access
        return User(username="anonymous", display_name="Anonymous", role=UserRole.ADMIN)

    if not credentials:
        raise HTTPException(status_code=401, detail="Authentication required")

    payload = decode_token(credentials.credentials)
    return User(
        username=payload.sub,
        display_name=payload.display_name,
        role=payload.role,
    )


def require_role(*roles: str):
    """Dependency that requires the user to have one of the specified roles."""
    async def check_role(user: User = Depends(get_current_user)):
        if not AUTH_ENABLED:
            return user
        if user.role not in roles:
            raise HTTPException(
                status_code=403,
                detail=f"Requires role: {', '.join(roles)}"
            )
        return user
    return check_role
