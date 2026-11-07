# COMPETEN-DIG-001 proof of concept: the existing Node engines, on the same image the render work simulated a function with.
# Versions match package.json on main. Built once with network; every benchmark run is --network none.
FROM public.ecr.aws/lambda/nodejs:22
WORKDIR /poc
RUN echo '{"name":"dig-poc","private":true,"type":"module"}' > package.json \
 && npm i --no-audit --no-fund --omit=dev --save-exact sharp@0.35.5 jszip@3.10.1 unpdf@1.8.1 mammoth@1.12.0 @hyzyla/pdfium@3.0.0 @matbee/libreoffice-converter@2.7.2 pdf-lib@1.17.1 @pdf-lib/fontkit@1.1.1
ENTRYPOINT []
