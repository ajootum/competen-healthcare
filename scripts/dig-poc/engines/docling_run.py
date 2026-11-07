# COMPETEN-DIG-001 proof of concept. Docling, offline, on a local file. For a PowerPoint it uses its declarative backend (no models).
# For a PDF, its layout, table and OCR models, baked into the image at build: nothing can download at run time, because the run has no network.
import json, sys, time
from docling.document_converter import DocumentConverter

src, out, label = sys.argv[1], sys.argv[2], sys.argv[3]
t0 = time.time()
if src.endswith(".pdf"):
    from docling.datamodel.base_models import InputFormat
    from docling.datamodel.pipeline_options import PdfPipelineOptions
    from docling.document_converter import PdfFormatOption
    opts = PdfPipelineOptions(artifacts_path="/models")
    conv = DocumentConverter(format_options={InputFormat.PDF: PdfFormatOption(pipeline_options=opts)})
else:
    conv = DocumentConverter()
t1 = time.time()
res = conv.convert(src)
doc = res.document
pages = sorted(doc.pages.keys()) if doc.pages else []
slides = [{"n": p, "text": doc.export_to_markdown(page_no=p, image_placeholder="")} for p in pages]
md = doc.export_to_markdown(image_placeholder="")
open(f"{out}/{label}.md", "w", encoding="utf-8").write(md)
json.dump({"engine": label, "seconds": time.time() - t0, "startSeconds": t1 - t0, "slides": slides, "tables": len(doc.tables), "pictures": len(doc.pictures), "markdownBytes": len(md.encode("utf-8"))}, open(f"{out}/{label}.json", "w", encoding="utf-8"))
print("units", len(slides), "tables", len(doc.tables), "pictures", len(doc.pictures))
