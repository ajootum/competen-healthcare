# COMPETEN-DIG-001 proof of concept. MarkItDown, offline, on a local file, one slide per section. No LLM client is passed.
import json, re, sys, time
from markitdown import MarkItDown

deck, out = sys.argv[1], sys.argv[2]
t0 = time.time()
md = MarkItDown(enable_plugins=False)
r = md.convert(deck)
text = r.text_content
parts = re.split(r"<!-- Slide number: (\d+) -->", text)
slides = [{"n": int(parts[i]), "text": parts[i + 1]} for i in range(1, len(parts) - 1, 2)]
open(out + "/markitdown.md", "w", encoding="utf-8").write(text)
json.dump({"engine": "markitdown", "seconds": time.time() - t0, "slides": slides, "markdownBytes": len(text.encode("utf-8"))}, open(out + "/markitdown.json", "w", encoding="utf-8"))
print("slides", len(slides))
