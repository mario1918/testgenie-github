"""
Zephyr Authentication Utilities
Handles JWT token generation and URL canonicalization for Zephyr Squad API.
"""

import jwt
import time
import hashlib
from urllib.parse import urlsplit, parse_qsl, quote
from typing import Tuple, Optional


class ZephyrAuthHelper:
    """Helper class for Zephyr Squad API authentication."""
    
    @staticmethod
    def pct_encode(s: str) -> str:
        """
        RFC3986 encoding with space as %20 (not '+'); keep '~' unescaped.
        
        Args:
            s: String to encode
            
        Returns:
            Percent-encoded string
        """
        return quote(str(s), safe="~")
    
    @staticmethod
    def canonicalize(
        base_url: str, 
        method: str, 
        uri: str, 
        query_params: str = ""
    ) -> Tuple[str, str, str]:
        """
        Canonicalize request for JWT Query String Hash (QSH) calculation.
        
        Args:
            base_url: Base URL of the API
            method: HTTP method (GET, POST, etc.)
            uri: Request URI
            query_params: Query parameters string
            
        Returns:
            Tuple of (request_path, canonical_query, qsh)
        """
        method = method.upper()
        
        # Extract path + query from uri
        sp = urlsplit(uri)
        path = sp.path or uri
        qs_uri = sp.query or ""
        
        # Base prefix from base_url (e.g. '/connect')
        base_prefix = (urlsplit(base_url).path or "").rstrip("/")
        
        # Build the path you will request (include '/connect' if needed)
        if base_prefix and not path.startswith(base_prefix):
            request_path = f"{base_prefix}/{path.lstrip('/')}"
        else:
            request_path = path
        
        # Build the QSH path by STRIPPING the base prefix
        qsh_path = request_path
        if base_prefix and qsh_path.startswith(base_prefix):
            qsh_path = qsh_path[len(base_prefix):]
            if not qsh_path.startswith("/"):
                qsh_path = "/" + qsh_path
        
        # Merge query strings, drop 'jwt', encode, sort
        merged_qs = "&".join(q for q in (qs_uri, query_params) if q)
        pairs = parse_qsl(merged_qs, keep_blank_values=True, strict_parsing=False)
        pairs = [(k, v) for (k, v) in pairs if k.lower() != "jwt"]
        
        multimap = {}
        for k, v in pairs:
            ek, ev = ZephyrAuthHelper.pct_encode(k), ZephyrAuthHelper.pct_encode(v)
            multimap.setdefault(ek, []).append(ev)
        
        for k in multimap:
            multimap[k].sort()
        
        items = sorted(multimap.items(), key=lambda kv: kv[0])
        canonical_query = "&".join(f"{k}={','.join(vs)}" for k, vs in items)
        
        # Compute QSH
        canonical_request = f"{method}&{qsh_path}&{canonical_query}"
        qsh = hashlib.sha256(canonical_request.encode("utf-8")).hexdigest()
        
        return request_path, canonical_query, qsh
    
    @staticmethod
    def generate_jwt_token(
        access_key: str,
        secret_key: str,
        method: str,
        uri: str,
        base_url: str,
        query_params: str = "",
        account_id: Optional[str] = None
    ) -> str:
        """
        Generate JWT token for Zephyr Squad API authentication.
        
        Args:
            access_key: Zephyr access key
            secret_key: Zephyr secret key
            method: HTTP method
            uri: Request URI
            base_url: API base URL
            query_params: Query parameters
            account_id: Optional account ID
            
        Returns:
            JWT token string
        """
        now = int(time.time())
        _, _, qsh = ZephyrAuthHelper.canonicalize(base_url, method, uri, query_params)
        
        payload = {
            "sub": account_id or access_key,
            "qsh": qsh,
            "iss": access_key,
            "iat": now,
            "exp": now + 3600,  # 1 hour expiry
        }
        
        token = jwt.encode(payload, secret_key, algorithm="HS256")
        return token if isinstance(token, str) else token.decode("utf-8")
