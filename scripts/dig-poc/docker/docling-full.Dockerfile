# COMPETEN-DIG-001 proof of concept: full Docling on CPU-only torch, with its layout, table and OCR models baked in, to measure what a scanned page costs.
# Benchmark runs are --network none, so no file can leave and no model can download at run time.
FROM python:3.12-slim
RUN apt-get update && apt-get install -y --no-install-recommends libgl1 libglib2.0-0 && rm -rf /var/lib/apt/lists/*
RUN pip install --no-cache-dir torch torchvision --index-url https://download.pytorch.org/whl/cpu
RUN pip install --no-cache-dir docling && pip freeze > /freeze.txt
RUN docling-tools models download -o /models
