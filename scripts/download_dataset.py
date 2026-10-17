"""Download and safely extract the QuickBooks Hackathon 2026 dataset into data/raw/."""
import argparse
import shutil
import sys
import tarfile
import urllib.request
from pathlib import Path, PurePosixPath

URL = (
    "https://huggingface.co/datasets/CL251215/QuickBooks-Hackathon-2026"
    "/resolve/main/hackathon-100-participant.tar.gz"
)
ROOT = Path(__file__).resolve().parent.parent
ARCHIVE = ROOT / "data" / "hackathon-100-participant.tar.gz"
RAW = ROOT / "data" / "raw"
DONE_MARKER = RAW / ".extracted"


def is_junk(name: str) -> bool:
    parts = PurePosixPath(name).parts
    return any(p == "__MACOSX" or p == ".DS_Store" or p.startswith("._") for p in parts)


def download(url: str, dest: Path) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_suffix(dest.suffix + ".part")
    print(f"Downloading {url}")
    with urllib.request.urlopen(url) as resp, open(tmp, "wb") as out:
        shutil.copyfileobj(resp, out)
    tmp.replace(dest)
    print(f"Saved {dest} ({dest.stat().st_size / 1e6:.1f} MB)")


def safe_extract(archive: Path, dest: Path) -> int:
    dest.mkdir(parents=True, exist_ok=True)
    root = dest.resolve()
    count = 0
    with tarfile.open(archive, "r:gz") as tar:
        for member in tar:
            if is_junk(member.name):
                continue
            target = (dest / member.name).resolve()
            if root != target and root not in target.parents:
                raise RuntimeError(f"Unsafe path in archive: {member.name}")
            if not (member.isfile() or member.isdir()):
                print(f"Skipping non-regular member: {member.name}")
                continue
            tar.extract(member, dest, filter="data")
            count += member.isfile()
    return count


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--force", action="store_true", help="re-download and re-extract")
    args = ap.parse_args()

    if DONE_MARKER.exists() and not args.force:
        print(f"Dataset already extracted at {RAW}; use --force to redo.")
        return 0
    if args.force or not ARCHIVE.exists():
        download(URL, ARCHIVE)
    else:
        print(f"Archive already present: {ARCHIVE}")
    n = safe_extract(ARCHIVE, RAW)
    DONE_MARKER.write_text(f"{n} files\n")
    print(f"Extracted {n} files into {RAW}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
