#!/usr/bin/env python3

import csv
import json
import re
import sys
from pathlib import Path

SUFFIX_MAP = {
    "": "-",
    "ALY": "Alley",
    "AVE": "Avenue",
    "BLVD": "Boulevard",
    "CIR": "Circle",
    "CT": "Court",
    "DR": "Drive",
    "EXPY": "Expressway",
    "HL": "Hill",
    "HWY": "Highway",
    "LN": "Lane",
    "LOOP": "Loop",
    "PARK": "Park",
    "PATH": "Path",
    "PL": "Place",
    "RD": "Road",
    "ROW": "Row",
    "ST": "Street",
    "TER": "Terrace",
    "WALK": "Walk",
    "WAY": "Way",
}

BLOCKED_TYPES = {"PLZ", "PSGE", "RAMP", "STPS", "STWY", "TUNL", "XING"}
BLOCKED_TERMS = (
    "ACCESS",
    "EASEMENT",
    "NORTHBOUND",
    "SOUTHBOUND",
    "EASTBOUND",
    "WESTBOUND",
    "PARKING LOT",
    "TOLL PLAZA",
    "TRANSBAY",
    "UNNAMED",
)
MANUAL_INCLUDE = {
    "AVENUE OF THE PALMS",
    "BROADWAY",
    "EL CAMINO DEL MAR",
    "GREAT HWY",
    "LA PLAYA",
    "SOUTH PARK",
    "THE EMBARCADERO",
}
MANUAL_EXCLUDE = {
    "CANDLESTICK POINT SRA",
    "CCSF PARKING LOT",
    "CHURCH PARKING LOT",
    "EASEMENT",
    "GGP ACCESS ROAD",
    "LETTERMAN HOSPITAL ACCESS",
    "LONG BRIDGE VARA",
    "MISSION CREEK",
    "SFGH ACCESS",
    "WEST ACCESS",
}
TITLE_FIXES = {
    "10Th": "10th",
    "11Th": "11th",
    "12Th": "12th",
    "14Th": "14th",
    "15Th": "15th",
    "16Th": "16th",
    "17Th": "17th",
    "18Th": "18th",
    "19Th": "19th",
    "20Th": "20th",
    "21St": "21st",
    "22Nd": "22nd",
    "23Rd": "23rd",
    "24Th": "24th",
    "25Th": "25th",
    "26Th": "26th",
    "27Th": "27th",
    "28Th": "28th",
    "29Th": "29th",
    "30Th": "30th",
    "31St": "31st",
    "32Nd": "32nd",
    "33Rd": "33rd",
    "34Th": "34th",
    "35Th": "35th",
    "36Th": "36th",
    "37Th": "37th",
    "38Th": "38th",
    "39Th": "39th",
    "3Rd": "3rd",
    "40Th": "40th",
    "41St": "41st",
    "42Nd": "42nd",
    "43Rd": "43rd",
    "44Th": "44th",
    "45Th": "45th",
    "46Th": "46th",
    "47Th": "47th",
    "48Th": "48th",
    "4Th": "4th",
    "5Th": "5th",
    "6Th": "6th",
    "7Th": "7th",
    "8Th": "8th",
    "9Th": "9th",
    "Avenue Of The Palms": "Avenue Of The Palms",
    "El Camino Del Mar": "El Camino Del Mar",
    "Great Hwy": "Great Highway",
    "Mcallister": "McAllister",
    "Mccoppin": "McCoppin",
    "Ofarrell": "O'Farrell",
    "Oshaughnessy": "O'Shaughnessy",
    "South Van Ness": "South Van Ness",
    "The Embarcadero": "Embarcadero",
}
SPECIAL_ENTRY_OVERRIDES = {
    "GREAT HWY": {"name": "Great Highway", "suffix": "-"},
}


def normalize_name(value: str) -> str:
    return re.sub(r"\s+", " ", value.strip().lower())


def titleize_name(name: str) -> str:
    if re.search(r"\d", name):
        titled = name.title()
    else:
        titled = name.title() if name.upper() == name else name
    titled = re.sub(r"\b0+(\d+)(St|Nd|Rd|Th)\b", lambda m: f"{int(m.group(1))}{m.group(2).lower()}", titled)
    return TITLE_FIXES.get(titled, titled)


def is_playable(full_name: str, street_type: str) -> bool:
    if not full_name or full_name in MANUAL_EXCLUDE:
        return False
    if street_type in BLOCKED_TYPES:
        return False
    if full_name in MANUAL_INCLUDE:
        return True
    if street_type not in SUFFIX_MAP:
        return False
    if any(term in full_name for term in BLOCKED_TERMS):
        return False
    if full_name.startswith("FORT MASON ") or full_name.startswith("FORT MILEY "):
        return False
    if full_name.endswith(" SRA"):
        return False
    return True


def load_overrides(path: Path) -> dict:
    if not path.exists():
        return {}
    return json.loads(path.read_text(encoding="utf-8"))


def build_entries(csv_path: Path, overrides: dict) -> list:
    entries = []
    seen = set()

    with csv_path.open(newline="", encoding="utf-8-sig") as handle:
        reader = csv.DictReader(handle)
        for row in reader:
            full_name = (row.get("FullStreetName") or "").strip()
            street_name = (row.get("StreetName") or "").strip()
            street_type = (row.get("StreetType") or "").strip().upper()

            if not street_name or not is_playable(full_name, street_type):
                continue

            special = SPECIAL_ENTRY_OVERRIDES.get(full_name, {})
            display_name = special.get("name", titleize_name(street_name))
            display_suffix = special.get("suffix", SUFFIX_MAP[street_type])
            full_key = normalize_name(display_name + " " + display_suffix)
            if full_key in seen:
                continue
            seen.add(full_key)

            key = normalize_name(street_name)
            entries.append({
                "name": display_name,
                "suffix": display_suffix,
                "district": overrides.get(key, "Citywide"),
            })

    return entries


def write_js(entries: list, output_path: Path) -> None:
    lines = [
        "window.STREET_DATA = [",
    ]
    for entry in entries:
        lines.append(
            "  { name: "
            + json.dumps(entry["name"])
            + ", suffix: "
            + json.dumps(entry["suffix"])
            + ", district: "
            + json.dumps(entry["district"])
            + " },"
        )
    lines.append("];")
    lines.append("")
    output_path.write_text("\n".join(lines), encoding="utf-8")


def main() -> int:
    if len(sys.argv) < 2:
        print("Usage: python3 scripts/build_street_data.py <input-csv> [output-js]")
        return 1

    csv_path = Path(sys.argv[1]).expanduser().resolve()
    output_path = Path(sys.argv[2]).resolve() if len(sys.argv) > 2 else Path("street-data.js").resolve()
    overrides_path = Path(__file__).resolve().parent / "district_overrides.json"

    overrides = load_overrides(overrides_path)
    entries = build_entries(csv_path, overrides)
    write_js(entries, output_path)

    print(f"Wrote {len(entries)} streets to {output_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
