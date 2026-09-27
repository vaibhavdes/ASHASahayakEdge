"""Mirror the phone's model here so phones can download it over local Wi-Fi.

    cd cloud && python -m scripts.fetch_model
"""

from pathlib import Path

import httpx

from app.config import MODELS

REPO = "Xenova/paraphrase-multilingual-MiniLM-L12-v2"
FILES = ["config.json", "tokenizer.json", "tokenizer_config.json", "special_tokens_map.json", "onnx/model_quantized.onnx"]


def main():
    target = MODELS / REPO / "resolve" / "main"
    with httpx.Client(follow_redirects=True, timeout=300) as http:
        for name in FILES:
            dest: Path = target / name
            if dest.exists():
                print(f"have {name}")
                continue
            dest.parent.mkdir(parents=True, exist_ok=True)
            print(f"downloading {name} ...")
            with http.stream("GET", f"https://huggingface.co/{REPO}/resolve/main/{name}") as r:
                r.raise_for_status()
                with open(dest, "wb") as f:
                    for chunk in r.iter_bytes():
                        f.write(chunk)
    print(f"model mirrored at {target}")


if __name__ == "__main__":
    main()
