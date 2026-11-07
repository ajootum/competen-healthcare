# COMPETEN-DIG-001 proof of concept: Docling's own smallest install for PowerPoint alone (no layout or OCR models). Benchmark runs are --network none.
FROM python:3.12-slim
RUN pip install --no-cache-dir 'docling-slim[format-pptx]' && pip freeze > /freeze.txt
