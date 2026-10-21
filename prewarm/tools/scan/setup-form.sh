#!/bin/sh
# One-off, per version of the paper form: work out where every field sits.
#   sh setup-form.sh <blank form.docx> <form-data dir>      (about 10 minutes for the real form; needs LibreOffice)
# form-data/ is made from the real form: keep it out of git (it is in .gitignore).
set -e
BLANK=$(realpath "$1"); OUT=$2; HERE=$(cd "$(dirname "$0")" && pwd)
mkdir -p "$OUT"; OUT=$(realpath "$OUT")
node "$HERE/locate.mjs" "$BLANK" "$OUT"
cp "$BLANK" "$OUT/blank.docx"
# RENDERER=word renders with Microsoft Word (pip install docx2pdf): same layout as the printed paper. Otherwise LibreOffice,
# where the fonts matter: install Carlito (Calibri-metric) first or its pages will not match the paper.
if [ "$RENDERER" = "word" ]; then
  (cd "$OUT" && ${PYTHON:-python3} -c "from docx2pdf import convert; convert('blank.docx', 'blank.pdf')")
else
  (cd "$OUT" && soffice --headless --convert-to pdf blank.docx >/dev/null 2>&1)
fi
(cd "$OUT" && pdftoppm -r 200 -png blank.pdf page)
${PYTHON:-python3} "$HERE/locate.py" "$OUT"
