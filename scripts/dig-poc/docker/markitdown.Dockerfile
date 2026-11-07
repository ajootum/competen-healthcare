# COMPETEN-DIG-001 proof of concept: MarkItDown with only what a PowerPoint, Word and PDF need. Benchmark runs are --network none.
FROM python:3.12-slim
RUN pip install --no-cache-dir 'markitdown[pptx,docx,pdf]' && pip freeze > /freeze.txt
