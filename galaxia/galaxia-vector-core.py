#!/usr/bin/env python3
"""
Galaxia Vector Core — Lokale Semantic-Suche mit Ollama Embeddings + LanceDB
100% kostenlos, 100% lokal, keine API Keys

Usage:
    python3 galaxia-vector-core.py index   # Indexiert alle Dateien
    python3 galaxia-vector-core.py search "query"  # Semantic Search
    python3 galaxia-vector-core.py spawn "Planet-Name" "Ziel"  # Neuen Planet spawnen
"""

import os
import sys
import json
import hashlib
import subprocess
from pathlib import Path
from datetime import datetime

# Konfiguration
GALAXIA_ROOT = Path(os.environ.get("GALAXIA_ROOT", "/root/galaxia"))
VECTOR_DB_PATH = GALAXIA_ROOT / "vector_db"
PLANETS_PATH = GALAXIA_ROOT / "planets"
OLLAMA_URL = os.environ.get("OLLAMA_URL", "http://localhost:11434")
EMBED_MODEL = "nomic-embed-text"  # Kostenlos, 137M params, perfekt fuer Embeddings

# Unterstuetzte Dateitypen
SUPPORTED_EXTENSIONS = {".md", ".txt", ".py", ".sh", ".json", ".yaml", ".yml", ".js", ".ts"}


def check_dependencies():
    """Pruefe ob LanceDB und Ollama verfuegbar sind."""
    try:
        import lancedb
        return True
    except ImportError:
        print("LanceDB nicht installiert. Installiere mit:")
        print("  pip install lancedb")
        return False


def get_embedding(text: str) -> list:
    """Hole Embedding von Ollama (kostenlos, lokal)."""
    import requests
    resp = requests.post(
        f"{OLLAMA_URL}/api/embed",
        json={"model": EMBED_MODEL, "input": text},
        timeout=30,
    )
    resp.raise_for_status()
    data = resp.json()
    return data["embeddings"][0]


def chunk_text(text: str, chunk_size: int = 500, overlap: int = 50) -> list:
    """Teile Text in Chunks fuer bessere Suche."""
    words = text.split()
    chunks = []
    for i in range(0, len(words), chunk_size - overlap):
        chunk = " ".join(words[i : i + chunk_size])
        if chunk.strip():
            chunks.append(chunk)
    return chunks


def index_files(root_path: str = None):
    """Indexiere alle Dateien im Galaxia-Universum."""
    import lancedb
    import pyarrow as pa

    if root_path is None:
        root_path = str(GALAXIA_ROOT.parent)

    print(f"Indexiere Dateien in: {root_path}")

    db = lancedb.connect(str(VECTOR_DB_PATH))
    records = []

    for dirpath, _, filenames in os.walk(root_path):
        # Skip hidden dirs, node_modules, etc.
        if any(skip in dirpath for skip in [".git", "node_modules", "__pycache__", "vector_db"]):
            continue

        for filename in filenames:
            filepath = Path(dirpath) / filename
            if filepath.suffix not in SUPPORTED_EXTENSIONS:
                continue

            try:
                content = filepath.read_text(encoding="utf-8", errors="ignore")
            except Exception:
                continue

            if not content.strip():
                continue

            chunks = chunk_text(content)
            for i, chunk in enumerate(chunks):
                file_hash = hashlib.md5(f"{filepath}:{i}".encode()).hexdigest()
                try:
                    embedding = get_embedding(chunk)
                    records.append({
                        "id": file_hash,
                        "path": str(filepath),
                        "chunk_index": i,
                        "content": chunk[:2000],
                        "vector": embedding,
                        "indexed_at": datetime.now().isoformat(),
                    })
                    print(f"  ✓ {filepath.name} (chunk {i + 1}/{len(chunks)})")
                except Exception as e:
                    print(f"  ✗ {filepath.name}: {e}")

    if records:
        # Erstelle oder ueberschreibe Tabelle
        try:
            db.drop_table("galaxia_docs")
        except Exception:
            pass
        db.create_table("galaxia_docs", records)
        print(f"\n✓ {len(records)} Chunks indexiert in {VECTOR_DB_PATH}")
    else:
        print("Keine Dateien zum Indexieren gefunden.")


def search(query: str, top_k: int = 5):
    """Semantic Search ueber das gesamte Galaxia-Universum."""
    import lancedb

    db = lancedb.connect(str(VECTOR_DB_PATH))

    try:
        table = db.open_table("galaxia_docs")
    except Exception:
        print("Kein Index gefunden. Erst indexieren: python3 galaxia-vector-core.py index")
        return []

    query_embedding = get_embedding(query)
    results = table.search(query_embedding).limit(top_k).to_list()

    print(f"\n🔍 Suche: '{query}' — {len(results)} Treffer\n")
    for i, r in enumerate(results, 1):
        score = r.get("_distance", "?")
        print(f"  {i}. [{score:.4f}] {r['path']}")
        preview = r["content"][:200].replace("\n", " ")
        print(f"     {preview}...")
        print()

    return results


def spawn_planet(name: str, goal: str):
    """Spawne einen neuen Planeten im Galaxia-Universum."""
    planet_dir = PLANETS_PATH / name
    planet_dir.mkdir(parents=True, exist_ok=True)

    # Planet README
    readme = f"""# Planet: {name}
## Ziel: {goal}
## Erstellt: {datetime.now().isoformat()}
## Status: ACTIVE

### Pipeline
- [ ] Research
- [ ] Build
- [ ] Launch
- [ ] Revenue

### Revenue
| Datum | Betrag | Quelle |
|-------|--------|--------|
| — | — | — |

### Notizen
(Automatisch von Galaxia Vector Core erstellt)
"""
    (planet_dir / "README.md").write_text(readme)
    (planet_dir / "data").mkdir(exist_ok=True)
    (planet_dir / "output").mkdir(exist_ok=True)

    print(f"🪐 Planet '{name}' gespawnt in {planet_dir}")
    print(f"   Ziel: {goal}")
    print(f"   Verzeichnis: {planet_dir}")

    # Index den neuen Planeten
    try:
        index_files(str(planet_dir))
    except Exception:
        pass

    return str(planet_dir)


def status():
    """Zeige Galaxia Status: Planeten, Index, Revenue."""
    print("=" * 50)
    print("  PFEIFER GALAXIA OS — STATUS")
    print("=" * 50)

    # Planeten zaehlen
    if PLANETS_PATH.exists():
        planets = [p for p in PLANETS_PATH.iterdir() if p.is_dir()]
        print(f"\n🪐 Planeten: {len(planets)}")
        for p in planets:
            readme = p / "README.md"
            status_line = "UNKNOWN"
            if readme.exists():
                for line in readme.read_text().split("\n"):
                    if "Status:" in line:
                        status_line = line.split("Status:")[-1].strip()
                        break
            print(f"   • {p.name} — {status_line}")
    else:
        print("\n🪐 Planeten: 0 (noch keine gespawnt)")

    # Vector DB
    if VECTOR_DB_PATH.exists():
        try:
            import lancedb
            db = lancedb.connect(str(VECTOR_DB_PATH))
            table = db.open_table("galaxia_docs")
            count = table.count_rows()
            print(f"\n🔍 Vector-Index: {count} Chunks")
        except Exception:
            print("\n🔍 Vector-Index: Nicht initialisiert")
    else:
        print("\n🔍 Vector-Index: Nicht erstellt")

    # Modelle
    print("\n🧠 Modelle (Ollama):")
    try:
        result = subprocess.run(
            ["ollama", "list"], capture_output=True, text=True, timeout=5
        )
        if result.returncode == 0:
            for line in result.stdout.strip().split("\n")[1:]:
                if line.strip():
                    print(f"   • {line.split()[0]}")
        else:
            print("   Ollama nicht erreichbar")
    except Exception:
        print("   Ollama nicht installiert")

    print()


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        return

    cmd = sys.argv[1].lower()

    if cmd == "index":
        if not check_dependencies():
            sys.exit(1)
        root = sys.argv[2] if len(sys.argv) > 2 else None
        index_files(root)

    elif cmd == "search":
        if len(sys.argv) < 3:
            print("Usage: galaxia-vector-core.py search 'query'")
            sys.exit(1)
        if not check_dependencies():
            sys.exit(1)
        search(" ".join(sys.argv[2:]))

    elif cmd == "spawn":
        if len(sys.argv) < 4:
            print("Usage: galaxia-vector-core.py spawn 'name' 'goal'")
            sys.exit(1)
        spawn_planet(sys.argv[2], " ".join(sys.argv[3:]))

    elif cmd == "status":
        status()

    else:
        print(f"Unbekannter Befehl: {cmd}")
        print(__doc__)


if __name__ == "__main__":
    main()
