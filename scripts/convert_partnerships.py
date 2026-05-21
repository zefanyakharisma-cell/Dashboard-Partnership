"""
Convert data/partnerships.source.json into a normalized multi-table layout
matching the README schema, with deduped institutions and a derived status.

Outputs to data/:
  - institutions.json   (deduped by canonical key)
  - departments.json    (derived from implementing_unit prefix)
  - agreements.json     (FK to institution_id, department_id)
  - meta.json           (counts, status breakdown, today date)

Run: python3 scripts/convert_partnerships.py
"""

from __future__ import annotations

import json
import re
import unicodedata
from datetime import date, datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "data" / "partnerships.source.json"
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
        # Only accept the fix if it looks like it reduced obvious mojibake.
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
    """Parse 'YYYY-MM-DD' or 'YYYY-MM-DD HH:MM:SS' into a date, or None."""
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
    """Return one of:
    Active | Expired | Auto-renewed | Open-ended | Pending Approval |
    Renewal In Progress | Ended | Unknown
    """
    note_l = (note or "").lower()

    # Explicit overrides from notes
    if any(p in note_l for p in ENDED_PATTERNS) or note_l.startswith("end"):
        return "Ended"
    if "proses pembaruan" in note_l:
        return "Renewal In Progress"
    if any(p in note_l for p in PENDING_PATTERNS):
        return "Pending Approval"

    # Hard dates
    if end_kind == "date":
        return "Active" if end_date_val >= TODAY else "Expired"

    # Auto-renewed: check renewal_info date if present
    if end_kind == "auto_renewed":
        if renewal_date:
            # Past renewal date with no manual override = still auto-renewing
            return "Auto-renewed"
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
    """Source has booleans mou/moa/ia. Return primary type string.
    If all three are false (a few records), fall back to scanning agenda."""
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

# Trailing location qualifiers that vary across rows for the same partner.
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
    """Strip trailing location qualifiers and parenthetical suffixes used
    only to distinguish faculties of the same partner. Keep faculty marker
    in display name, but key dedup on the trimmed stem.

    NOTE: we still keep faculty parentheticals as separate institutions
    when they appear -- the same university with different faculties is
    treated as multiple institutions to preserve the agreement scope.
    """
    name = partner.strip()
    # Repeatedly strip trailing ", <country>" tails
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
# Department derivation
# ---------------------------------------------------------------------------

# Implementing units like "FBE-Hotel Management" -> department "FBE",
# "Universitas" -> "Universitas", "Pusat Karir" -> "Pusat Karir", etc.

FACULTY_PREFIXES = {
    "FBE", "FTI", "FHIK", "FTSP", "FK", "FKG", "FKIP", "FBS", "FBE & FBS",
    "FBS & FBE", "FBE-Hotel Management & ",  # safety; we strip below
}


def split_unit(implementing_unit: str | None):
    if not implementing_unit:
        return None, None
    u = implementing_unit.strip()
    # Normalise oddities like "FBE-Hotel Management & \nCreative Tourism"
    u = re.sub(r"\s+", " ", u)
    if "-" in u:
        dept, _, program = u.partition("-")
        return dept.strip(), program.strip()
    return u, None


# ---------------------------------------------------------------------------
# Main conversion
# ---------------------------------------------------------------------------

def convert():
    src = json.loads(SRC.read_text(encoding="utf-8"))

    institutions: dict[str, dict] = {}
    departments: dict[str, dict] = {}
    agreements: list[dict] = []

    def get_or_create_institution(partner, country, kind, city=None, address=None):
        partner_clean = clean_str(partner) or "Unknown"
        loc = country if kind == "International" else city
        key = institution_key(partner_clean, loc)
        if key in institutions:
            inst = institutions[key]
            # Backfill missing fields if a later record has more detail
            if address and not inst.get("address"):
                inst["address"] = clean_str(address)
            if city and not inst.get("city"):
                inst["city"] = clean_str(city)
            if country and not inst.get("country"):
                inst["country"] = clean_str(country)
            return inst["id"]
        inst_id = f"inst-{len(institutions) + 1:04d}"
        institutions[key] = {
            "id": inst_id,
            "name": partner_clean,
            "canonical_name": canonical_institution_name(partner_clean),
            "kind": kind,                       # 'International' | 'Domestic'
            "country": clean_str(country),
            "city": clean_str(city),
            "address": clean_str(address),
        }
        return inst_id

    def get_or_create_department(implementing_unit, scope):
        dept_short, program = split_unit(implementing_unit)
        if not dept_short:
            dept_short = "Unspecified"
        key = dept_short.lower()
        if key in departments:
            return departments[key]["id"]
        dept_id = f"dept-{slugify(dept_short)[:24] or 'unspecified'}"
        # Avoid collision when two short names slugify the same
        suffix = 2
        base = dept_id
        while any(d["id"] == dept_id for d in departments.values()):
            dept_id = f"{base}-{suffix}"
            suffix += 1
        departments[key] = {
            "id": dept_id,
            "short": dept_short,
            "name": dept_short,
            "is_faculty": dept_short.upper() in {
                "FBE", "FTI", "FHIK", "FTSP", "FK", "FKG", "FKIP", "FBS",
            },
        }
        return departments[key]["id"]

    def process(row, kind):
        partner = row.get("partner") or "Unknown"
        country = row.get("country") if kind == "International" else "Indonesia"
        city = row.get("city") if kind == "Domestic" else None
        address = row.get("address") if kind == "Domestic" else None

        inst_id = get_or_create_institution(partner, country, kind, city, address)
        dept_id = get_or_create_department(
            row.get("implementing_unit"), row.get("scope")
        )

        start_date = parse_iso_date(row.get("start_date"))
        end_kind, end_date_val = classify_end_date(row.get("end_date"))
        renewal_date = parse_iso_date(row.get("renewal_info"))

        note = clean_str(row.get("note"))
        status = derive_status(end_kind, end_date_val, renewal_date, note)

        atype = derive_type(row.get("agreement_type"))

        # Synthesize a code: e.g. INT-0007 / DOM-0093 (preserve the source 'no')
        prefix = "INT" if kind == "International" else "DOM"
        code = f"{prefix}-{int(row['no']):04d}"

        agreements.append({
            "id": f"agr-{prefix.lower()}-{int(row['no']):04d}",
            "code": code,
            "source_no": row["no"],
            "kind": kind,
            "title": clean_str(partner),         # human title — partner + agenda summary
            "type": atype,                       # MoU | MoA | IA | Unknown
            "status": status,                    # derived
            "institution_id": inst_id,
            "department_id": dept_id,
            "implementing_unit": clean_str(row.get("implementing_unit")),
            "scope": clean_str(row.get("scope")),
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

    # Sort outputs for stable diffs
    inst_list = sorted(institutions.values(), key=lambda x: x["id"])
    dept_list = sorted(departments.values(), key=lambda x: x["id"])
    agreements.sort(key=lambda x: (x["kind"], x["source_no"]))

    # Status histogram for sanity-check
    status_counts: dict[str, int] = {}
    type_counts: dict[str, int] = {}
    kind_counts: dict[str, int] = {}
    for a in agreements:
        status_counts[a["status"]] = status_counts.get(a["status"], 0) + 1
        type_counts[a["type"]] = type_counts.get(a["type"], 0) + 1
        kind_counts[a["kind"]] = kind_counts.get(a["kind"], 0) + 1

    meta = {
        "today": TODAY.isoformat(),
        "totals": {
            "agreements": len(agreements),
            "institutions": len(inst_list),
            "departments": len(dept_list),
        },
        "by_status": dict(sorted(status_counts.items(), key=lambda kv: -kv[1])),
        "by_type": type_counts,
        "by_kind": kind_counts,
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
