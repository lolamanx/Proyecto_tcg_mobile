"""Build the offline catalog from PokemonTCG and TCGdex source tarballs."""
import json
import re
import sys
import tarfile
import unicodedata
from pathlib import Path


def open_members(archive):
    return {member.name.partition("/")[2]: member for member in archive if member.isfile()}


def key(value):
    return "".join(char for char in unicodedata.normalize("NFD", value.lower()) if char.isalnum())


def tcgdex_metadata(archive, members):
    sets = {}
    for path, member in members.items():
        if not re.fullmatch(r"data/[^/]+/[^/]+\.ts", path):
            continue
        content = archive.extractfile(member).read().decode()
        set_id = re.search(r'\bid:\s*["\x27]([^"\x27]+)', content)
        if set_id:
            sets[path.removesuffix(".ts")] = set_id[1]
    cards = {}
    for path, member in members.items():
        card_path, _, filename = path.rpartition("/")
        if card_path not in sets or not filename.endswith(".ts"):
            continue
        content = archive.extractfile(member).read().decode()
        name = re.search(r"\bname:\s*\{([^}]+)\}", content)
        if not name:
            continue
        translations = dict(re.findall(r'\b(en|es|fr|de|it|pt):\s*"([^"\n]+)"', name[1]))
        if "en" not in translations:
            continue
        variants = re.search(r"\bvariants:\s*\[([^\]]+)\]", content)
        finishes = re.findall(r'\btype:\s*["\x27]([a-zA-Z]+)', variants[1]) if variants else []
        finishes = list(dict.fromkeys(finish if finish in {"normal", "holo", "reverse"} else "other" for finish in finishes))
        aliases = list(dict.fromkeys(value for lang, value in translations.items() if lang != "en" and key(value) != key(translations["en"])))
        cards[(sets[card_path], filename.removesuffix(".ts").lstrip("0"))] = (translations["en"], finishes, aliases)
    return cards


with tarfile.open(sys.argv[1]) as source, tarfile.open(sys.argv[2]) as variants:
    source_members = open_members(source)
    metadata = tcgdex_metadata(variants, open_members(variants))
    def read(path):
        return json.load(source.extractfile(source_members[path]))
    data = {"sets": {}, "cards": []}
    for edition in read("sets/en.json"):
        set_id = edition["id"]
        path = f"cards/en/{set_id}.json"
        if path not in source_members:
            continue
        data["sets"][set_id] = [edition["name"], edition.get("printedTotal") or edition.get("total"),
                                edition.get("ptcgoCode", ""), edition.get("releaseDate", "")]
        for card in read(path):
            number = str(card["number"])
            row = [card["id"], card["name"], set_id, number, card.get("rarity", "")]
            match = metadata.get((set_id, number.lstrip("0")))
            if match and key(match[0]) == key(card["name"]) and (match[1] or match[2]):
                row.extend(match[1:])
            data["cards"].append(row)
    output = Path(__file__).resolve().parents[1] / "public" / "catalog.json"
    output.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f'{len(data["sets"])} sets, {len(data["cards"])} cards, {sum(len(row) > 5 for row in data["cards"])} enriched')
