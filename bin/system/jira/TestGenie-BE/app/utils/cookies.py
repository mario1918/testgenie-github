
import base64, hmac, hashlib
from typing import Optional

class CookieSigner:
    """
    Tiny HMAC-based signer to protect cookie integrity using your app secret_key.
    Not encryption—just tamper detection.
    """
    def __init__(self, secret: str) -> None:
        self.secret = secret.encode("utf-8")

    def _mac(self, value: bytes) -> bytes:
        return hmac.new(self.secret, value, hashlib.sha256).digest()

    def sign(self, value: str) -> str:
        raw = value.encode("utf-8")
        mac = self._mac(raw)
        return base64.urlsafe_b64encode(raw + mac).decode().rstrip("=")

    def unsign(self, token: str) -> str:
        data = base64.urlsafe_b64decode(token + "===")
        raw, mac = data[:-32], data[-32:]
        if not hmac.compare_digest(self._mac(raw), mac):
            raise ValueError("Bad signature")
        return raw.decode("utf-8")
