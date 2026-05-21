"""
Convert data/partnerships_1.json into a normalized multi-table layout
matching the README schema, with deduped institutions and a derived status.

Outputs to data/:
  - institutions.json   (deduped by canonical key, with institution_type tags)
  - departments.json    (derived from per-agreement `units` array)
  - agreements.json     (FK to institution_id, department_id; preserves units/scope arrays)
  - meta.json           (counts, status breakdown, today date)

Run: python3 scripts/convert_partnerships.py
"""

from __future__ import annotations

import json
import re
import unicodedata
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "data" / "partnerships_1.json"
OUT_DIR = ROOT / "data"

TODAY = date(2026, 5, 21)


# ---------------------------------------------------------------------------
# String cleanup
# ---------------------------------------------------------------------------

def fix_mojibake(s: str) -> str:
    """Source has UTF-8 bytes interpreted as Latin-1 then re-encoded.
    The reverse trick (encode latin-1, decode utf-8) usually restores it.
    Falls back to original if that round-trip fails."""
    if not isinstance(s, str):
        return s
    try:
        fixed = s.encode("latin-1").decode("utf-8")
        if "Ã" in s or "Â" in s or "â" in s or "Å" in s:
            return fixed
        return s
    except (UnicodeEncodeError, UnicodeDecodeError):
        return s


def clean_str(s):
    if s is None:
        return None
    s = fix_mojibake(s)
    s = s.replace("\r\n", "\n").strip()
    return s or None


def slugify(s: str) -> str:
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode("ascii")
    s = re.sub(r"[^A-Za-z0-9]+", "-", s).strip("-").lower()
    return s


# ---------------------------------------------------------------------------
# Date parsing
# ---------------------------------------------------------------------------

ISO_DATE = re.compile(r"^(\d{4})-(\d{2})-(\d{2})")


def parse_iso_date(value):
    if not value or not isinstance(value, str):
        return None
    m = ISO_DATE.match(value)
    if not m:
        return None
    try:
        return date(int(m.group(1)), int(m.group(2)), int(m.group(3)))
    except ValueError:
        return None


SENTINEL_OPEN = {"no limit", "auto renewed", "auto-renewed", "auto renewed ", "active"}
SENTINEL_NA = {"n/a", "tdk jelas/auto renewed", "can be ended"}


def classify_end_date(raw):
    """Return (kind, parsed_date_or_None) where kind is one of:
    'date', 'auto_renewed', 'no_limit', 'na', 'unknown'."""
    if not raw:
        return ("unknown", None)
    s = str(raw).strip().lower()
    d = parse_iso_date(raw)
    if d:
        return ("date", d)
    if s in SENTINEL_OPEN or s.startswith("auto"):
        return ("auto_renewed", None)
    if "no limit" in s:
        return ("no_limit", None)
    if s in SENTINEL_NA or s == "n/a":
        return ("na", None)
    return ("unknown", None)


# ---------------------------------------------------------------------------
# Status derivation
# ---------------------------------------------------------------------------

PENDING_PATTERNS = (
    "belum pengusulan",
    "belum pengajuan",
    "belum kirim",
    "tidak bisa diinput",
    "tidak diinput",
    "tidak jadi tt",
    "berkas tidak ada",
    "pending",
    "proses pembaruan",
)
ENDED_PATTERNS = ("\nend", " end", "end.", "(end)")


def derive_status(end_kind, end_date_val, renewal_date, note):
    note_l = (note or "").lower()

    if any(p in note_l for p in ENDED_PATTERNS) or note_l.startswith("end"):
        return "Ended"
    if "proses pembaruan" in note_l:
        return "Renewal In Progress"
    if any(p in note_l for p in PENDING_PATTERNS):
        return "Pending Approval"

    if end_kind == "date":
        return "Active" if end_date_val >= TODAY else "Expired"

    if end_kind == "auto_renewed":
        return "Auto-renewed"

    if end_kind == "no_limit":
        return "Open-ended"

    if end_kind == "na":
        return "Unknown"

    return "Unknown"


# ---------------------------------------------------------------------------
# Agreement type
# ---------------------------------------------------------------------------

def derive_type(at):
    if not at:
        return "Unknown"
    if at.get("mou"):
        return "MoU"
    if at.get("moa"):
        return "MoA"
    if at.get("ia"):
        return "IA"
    return "Unknown"


# ---------------------------------------------------------------------------
# Institution canonicalization
# ---------------------------------------------------------------------------

TRAILING_LOCATIONS = (
    "indonesia", "japan", "korea", "china", "p. r. china", "p.r. china",
    "taiwan", "malaysia", "philippines", "philippine", "thailand", "uk",
    "usa", "germany", "australia", "the netherlands", "netherlands",
    "switzerland", "singapore", "cambodia", "bangladesh", "mongolia",
    "lithuania", "poland", "portugal", "hongkong", "hong kong", "irlandia",
    "rep. of korea", "macau", "india", "iraq", "timor-leste", "new zealand",
    "united arab emirates", "united arab emirates (uae)", "canada", "france",
    "romania", "latvia", "hungary", "jakarta", "surabaya", "bandung",
    "yogyakarta", "semarang", "jakarta pusat", "jakarta selatan",
    "tangerang", "tangerang ", "kupang", "malang", "medan", "manado",
    "sidoarjo", "makassar", "palopo", "salatiga", "surakarta", "papua",
    "bali", "sumatera", "nta", "ntt", "ntb", "jember", "kediri", "bogor",
    "gresik", "pasuruan", "mojokerto", "pekalongan", "batam", "lombok",
    "minahasa", "ambon", "jayapura", "bireuen", "bukittinggi", "denpasar",
    "sorong", "wonosobo", "klaten", "kudus", "purwokerto", "samarinda",
    "tegal", "temanggung", "rembang", "melawi", "pontianak",
    "pematang siantar", "banjarmasin", "banyumas", "cimahi", "padang",
    "palembang", "toba", "tana toraja", "makale", "sumedang",
)

LOCATION_SUFFIX_RE = re.compile(
    r",\s*(" + "|".join(re.escape(x) for x in TRAILING_LOCATIONS) + r")\s*$",
    re.IGNORECASE,
)


def canonical_institution_name(partner: str) -> str:
    name = partner.strip()
    prev = None
    while prev != name:
        prev = name
        name = LOCATION_SUFFIX_RE.sub("", name).strip()
    return name


def institution_key(partner_clean: str, country_or_city: str | None) -> str:
    base = canonical_institution_name(partner_clean).lower()
    base = re.sub(r"\s+", " ", base).strip()
    loc = (country_or_city or "").lower().strip()
    return f"{base}||{loc}"


# ---------------------------------------------------------------------------
# Scope / units normalization (new partnerships_1 schema)
# ---------------------------------------------------------------------------

SCOPE_LABELS = {
    "learning": "Learning",
    "research": "Research",
    "student_affairs": "Student Affairs",
    "community_service": "Community Service",
}


def normalize_scope_array(scope):
    """Old schema: scope was a faculty string. New schema: scope is an array
    of category tags ('learning', 'research', ...). Return (tags_array, label_string).
    """
    if not scope:
        return [], None
    if isinstance(scope, str):
        s = clean_str(scope)
        return ([s] if s else []), s
    tags = [clean_str(s) for s in scope if clean_str(s)]
    label = ", ".join(SCOPE_LABELS.get(t, t.replace("_", " ").title()) for t in tags) or None
    return tags, label


def normalize_units(units):
    if not units:
        return []
    if isinstance(units, str):
        s = clean_str(units)
        return [s] if s else []
    return [clean_str(u) for u in units if clean_str(u)]


def normalize_institution_types(itypes):
    if not itypes:
        return []
    if isinstance(itypes, str):
        s = clean_str(itypes)
        return [s] if s else []
    return [clean_str(t) for t in itypes if clean_str(t)]


# Map institution_type tags to display names. The single dominant type
# becomes the institution.type display label (the dashboard expects a string).
INSTITUTION_TYPE_LABELS = {
    "education": "Education",
    "industry": "Industry",
    "government": "Government",
    "organization": "Organization",
    "foundation": "Foundation",
}


# ---------------------------------------------------------------------------
# Main conversion
# ---------------------------------------------------------------------------

def convert():
    src = json.loads(SRC.read_text(encoding="utf-8"))

    institutions: dict[str, dict] = {}
    departments: dict[str, dict] = {}
    agreements: list[dict] = []
    # Track institution_type tags per institution for later aggregation.
    inst_type_tags: dict[str, dict[str, int]] = {}

    def get_or_create_institution(partner, country, kind, city=None, address=None, itypes=None):
        partner_clean = clean_str(partner) or "Unknown"
        loc = country if kind == "International" else city
        key = institution_key(partner_clean, loc)
        if key in institutions:
            inst = institutions[key]
            if address and not inst.get("address"):
                inst["address"] = clean_str(address)
            if city and not inst.get("city"):
                inst["city"] = clean_str(city)
            if country and not inst.get("country"):
                inst["country"] = clean_str(country)
            for t in (itypes or []):
                inst_type_tags[inst["id"]][t] = inst_type_tags[inst["id"]].get(t, 0) + 1
            return inst["id"]
        inst_id = f"inst-{len(institutions) + 1:04d}"
        institutions[key] = {
            "id": inst_id,
            "name": partner_clean,
            "canonical_name": canonical_institution_name(partner_clean),
            "kind": kind,
            "country": clean_str(country),
            "city": clean_str(city),
            "address": clean_str(address),
        }
        inst_type_tags[inst_id] = {}
        for t in (itypes or []):
            inst_type_tags[inst_id][t] = inst_type_tags[inst_id].get(t, 0) + 1
        return inst_id

    def get_or_create_department(unit_short):
        if not unit_short:
            unit_short = "Unspecified"
        key = unit_short.lower()
        if key in departments:
            return departments[key]["id"]
        dept_id = f"dept-{slugify(unit_short)[:32] or 'unspecified'}"
        suffix = 2
        base = dept_id
        while any(d["id"] == dept_id for d in departments.values()):
            dept_id = f"{base}-{suffix}"
            suffix += 1
        departments[key] = {
            "id": dept_id,
            "short": unit_short,
            "name": unit_short,
            "is_faculty": False,
        }
        return departments[key]["id"]

    def process(row, kind):
        partner = row.get("partner") or "Unknown"
        country = row.get("country") if kind == "International" else "Indonesia"
        city = row.get("city") if kind == "Domestic" else None
        address = row.get("address") if kind == "Domestic" else None
        itypes = normalize_institution_types(row.get("institution_type"))

        inst_id = get_or_create_institution(
            partner, country, kind, city, address, itypes=itypes,
        )

        units = normalize_units(row.get("units"))
        # Primary department: first unit, or 'Unspecified' if none provided.
        primary_unit = units[0] if units else None
        dept_id = get_or_create_department(primary_unit)
        # Register the rest of the units as departments too, so they appear in filters.
        unit_dept_ids = [dept_id]
        for u in units[1:]:
            unit_dept_ids.append(get_or_create_department(u))

        start_date = parse_iso_date(row.get("start_date"))
        end_kind, end_date_val = classify_end_date(row.get("end_date"))
        renewal_date = parse_iso_date(row.get("renewal_info"))

        note = clean_str(row.get("note"))
        status = derive_status(end_kind, end_date_val, renewal_date, note)

        atype = derive_type(row.get("agreement_type"))

        scope_tags, scope_label = normalize_scope_array(row.get("scope"))

        prefix = "INT" if kind == "International" else "DOM"
        code = f"{prefix}-{int(row['no']):04d}"

        agreements.append({
            "id": f"agr-{prefix.lower()}-{int(row['no']):04d}",
            "code": code,
            "source_no": row["no"],
            "kind": kind,
            "title": clean_str(partner),
            "type": atype,
            "status": status,
            "institution_id": inst_id,
            "department_id": dept_id,
            "implementing_unit": primary_unit,
            "units": units,
            "unit_department_ids": unit_dept_ids,
            "scope": scope_label,
            "scope_tags": scope_tags,
            "institution_type": itypes,
            "new_partner": bool(row.get("new_partner")),
            "agenda": clean_str(row.get("agenda")),
            "degree_program": bool(row.get("degree_program")),
            "non_degree_program": bool(row.get("non_degree_program")),
            "start_date": start_date.isoformat() if start_date else None,
            "start_date_raw": row.get("start_date"),
            "end_date": end_date_val.isoformat() if end_date_val else None,
            "end_date_raw": row.get("end_date"),
            "end_date_kind": end_kind,
            "renewal_date": renewal_date.isoformat() if renewal_date else None,
            "renewal_info_raw": row.get("renewal_info"),
            "note": note,
            "realization": clean_str(row.get("realization")) if isinstance(row.get("realization"), str) else row.get("realization"),
        })

    for row in src.get("international", []):
        process(row, "International")
    for row in src.get("domestic", []):
        process(row, "Domestic")

    # Fold the aggregated institution_type tags onto each institution.
    for inst in institutions.values():
        tags = inst_type_tags.get(inst["id"], {})
        sorted_tags = sorted(tags.items(), key=lambda kv: (-kv[1], kv[0]))
        inst["institution_types"] = [t for t, _ in sorted_tags]
        primary = sorted_tags[0][0] if sorted_tags else None
        inst["type"] = INSTITUTION_TYPE_LABELS.get(primary, primary.title() if primary else "Other")

    # Sort outputs for stable diffs
    inst_list = sorted(institutions.values(), key=lambda x: x["id"])
    dept_list = sorted(departments.values(), key=lambda x: x["id"])
    agreements.sort(key=lambda x: (x["kind"], x["source_no"]))

    status_counts: dict[str, int] = {}
    type_counts: dict[str, int] = {}
    kind_counts: dict[str, int] = {}
    inst_type_counts: dict[str, int] = {}
    scope_counts: dict[str, int] = {}
    new_partner_count = 0
    for a in agreements:
        status_counts[a["status"]] = status_counts.get(a["status"], 0) + 1
        type_counts[a["type"]] = type_counts.get(a["type"], 0) + 1
        kind_counts[a["kind"]] = kind_counts.get(a["kind"], 0) + 1
        for t in a.get("institution_type", []) or []:
            inst_type_counts[t] = inst_type_counts.get(t, 0) + 1
        for s in a.get("scope_tags", []) or []:
            scope_counts[s] = scope_counts.get(s, 0) + 1
        if a.get("new_partner"):
            new_partner_count += 1

    meta = {
        "today": TODAY.isoformat(),
        "source": "data/partnerships_1.json",
        "totals": {
            "agreements": len(agreements),
            "institutions": len(inst_list),
            "departments": len(dept_list),
            "new_partners": new_partner_count,
        },
        "by_status": dict(sorted(status_counts.items(), key=lambda kv: -kv[1])),
        "by_type": type_counts,
        "by_kind": kind_counts,
        "by_institution_type": dict(sorted(inst_type_counts.items(), key=lambda kv: -kv[1])),
        "by_scope": dict(sorted(scope_counts.items(), key=lambda kv: -kv[1])),
    }

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    (OUT_DIR / "institutions.json").write_text(
        json.dumps(inst_list, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    (OUT_DIR / "departments.json").write_text(
        json.dumps(dept_list, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    (OUT_DIR / "agreements.json").write_text(
        json.dumps(agreements, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    (OUT_DIR / "meta.json").write_text(
        json.dumps(meta, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )

    print(json.dumps(meta, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    convert()
