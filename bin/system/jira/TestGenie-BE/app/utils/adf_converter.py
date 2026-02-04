"""
Atlassian Document Format (ADF) conversion utilities.
Handles conversion between plain text and ADF format used by Jira.
"""
from typing import Optional, List, Dict, Any


def text_to_adf(text: str) -> Dict[str, Any]:
    """
    Convert plain text (with newlines) to a minimal ADF document.
    
    Args:
        text: Plain text string with optional newlines
        
    Returns:
        ADF document dictionary
    """
    lines = (text or "").splitlines() or [""]
    content = []
    for line in lines:
        if line.strip() == "":
            content.append({"type": "paragraph"})
        else:
            content.append({
                "type": "paragraph",
                "content": [{"type": "text", "text": line}]
            })
    return {"type": "doc", "version": 1, "content": content}


def adf_to_text(node: Optional[Dict[str, Any]], list_stack: Optional[List[Dict[str, Any]]] = None) -> str:
    """
    Convert Jira ADF (dict) to readable plain text.
    
    Handles:
    - Paragraphs, headings, hardBreak
    - Ordered/bulleted lists with proper numbering (respects attrs.order)
    - Skips media but preserves list/paragraph structure
    
    Args:
        node: ADF node dictionary
        list_stack: Internal stack for tracking list context
        
    Returns:
        Plain text representation of the ADF content
    """
    if node is None:
        return ""
    if list_stack is None:
        list_stack = []  # stack of dicts: {"type": "ol"/"ul", "idx": int, "start": int}

    t = node.get("type") if isinstance(node, dict) else None

    def join_blocks(parts: List[str]) -> str:
        """Join with newlines, collapse 3+ newlines to max 2"""
        txt = "\n".join(p for p in parts if p is not None)
        while "\n\n\n" in txt:
            txt = txt.replace("\n\n\n", "\n\n")
        return txt.strip()

    def render_children(n: Dict[str, Any]) -> str:
        """Render all child nodes"""
        parts = []
        for c in (n.get("content") or []):
            parts.append(adf_to_text(c, list_stack))
        return join_blocks(parts)

    # Text node
    if t == "text":
        return node.get("text", "")

    # Explicit line break
    if t == "hardBreak":
        return "\n"

    # Paragraph / Heading
    if t in {"paragraph", "heading"}:
        inner = []
        for c in (node.get("content") or []):
            inner.append(adf_to_text(c, list_stack))
        # If empty paragraph, keep a blank line to separate blocks
        s = "".join(inner).strip()
        return s if s else ""

    # Ordered list
    if t == "orderedList":
        start = int(node.get("attrs", {}).get("order", 1))
        list_stack.append({"type": "ol", "idx": start, "start": start})
        items = []
        for li in (node.get("content") or []):
            items.append(adf_to_text(li, list_stack))
        list_stack.pop()
        return "\n".join(items)

    # Bullet list
    if t == "bulletList":
        list_stack.append({"type": "ul"})
        items = []
        for li in (node.get("content") or []):
            items.append(adf_to_text(li, list_stack))
        list_stack.pop()
        return "\n".join(items)

    # List item
    if t == "listItem":
        # Determine prefix from current list context
        prefix = "- "
        if list_stack and list_stack[-1]["type"] == "ol":
            n = list_stack[-1]["idx"]
            prefix = f"{n}. "
            list_stack[-1]["idx"] += 1

        # Render children (usually paragraphs)
        line_parts = []
        for c in (node.get("content") or []):
            line_parts.append(adf_to_text(c, list_stack))
        line = " ".join(p for p in line_parts if p).strip()
        
        # If children contain multiple lines, keep only first line on bullet and indent the rest
        if "\n" in line:
            first, *rest = line.splitlines()
            rest_text = "\n   ".join(r.strip() for r in rest if r.strip())
            return (prefix + first.strip()) + ("\n   " + rest_text if rest_text else "")
        return prefix + line if line else prefix.strip()

    # Media / mediaSingle — text-only mode: skip, but leave a blank line to keep structure
    if t in {"mediaSingle", "media"}:
        return ""

    # Doc root or any other container: render children
    if t in {"doc", "blockquote", "panel", "table", "tableRow", "tableCell"} or "content" in node:
        return render_children(node)

    # Fallback
    return ""
