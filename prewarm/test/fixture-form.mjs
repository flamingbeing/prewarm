// A small made-up Word form with the same structures as the study's data collection form (the real one is not in this
// repo): Subject ID / Date of Entry boxes, rows with Word tick boxes, blank lines and 24-hour times, a readings grid and
// a Name / Signature / Date line. For the unit and browser tests of the Form view's Word file.
const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml"';
const run = t => `<w:r><w:t xml:space="preserve">${t}</w:t></w:r>`;
const box = () => `<w:sdt><w:sdtPr><w14:checkbox><w14:checked w14:val="0"/><w14:checkedState w14:val="2612" w14:font="MS Gothic"/><w14:uncheckedState w14:val="2610" w14:font="MS Gothic"/></w14:checkbox></w:sdtPr><w:sdtContent><w:r><w:t>☐</w:t></w:r></w:sdtContent></w:sdt>`;
const p = (...parts) => `<w:p><w:pPr><w:rPr><w:color w:val="D9D9D9"/><w:sz w:val="20"/></w:rPr></w:pPr>${parts.join('')}</w:p>`;
const tc = (inner, w = 1200) => `<w:tc><w:tcPr><w:tcW w:w="${w}" w:type="dxa"/><w:tcBorders><w:right w:val="single" w:sz="4"/></w:tcBorders></w:tcPr>${inner}</w:tc>`;
const tr = cells => `<w:tr>${cells.join('')}</w:tr>`;
const tbl = rows => `<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/></w:tblPr>${rows.join('')}</w:tbl>`;
const head = () => tbl([tr([tc(p(run('Subject ID:'))), ...Array(5).fill(tc(p(), 500)), tc(p(), 288), tc(p(run('Date of Entry:'))), ...Array(6).fill(tc(p(), 580))])]);
const row = (label, ...paras) => tr([tc(p(run(label))), tc(paras.join(''), 6000)]);
const sign = () => p(run('Name:                                   Signature:                                   Date:'));
const page = () => `<w:p><w:r><w:br w:type="page"/></w:r></w:p>`;

export function fixtureXml() {
  const pre = tbl([
    tr([tc(p(run('PATIENT DEMOGRAPHICS')))]),
    row('Age', p(run('_________'), run('_  years old'))),
    row('Gender', p(box(), run('Male                 '), box(), run(' Female'))),
    row('Hyperlipidaemia', p(box(), run(' Yes          '), box(), run(' No')), p(run('If yes, is the patient on statins?     '), box(), run(' Yes     '), box(), run(' No'))),
  ]);
  const grid = tbl([
    tr([tc(p(run('Time (00:00)'))), ...[0, 5, 10].map(() => tc(p(), 600))]),
    tr([tc(p(run('Time (min)'))), ...[0, 5, 10].map(m => tc(p(run(String(m))), 600))]),
    ...['Core', 'Chest'].map(l => tr([tc(p(run(l))), ...[0, 5, 10].map(() => tc(p(), 600))])),
  ]);
  const intervention = tbl([
    tr([tc(p(run('RANDOMISATION')))]),
    tr([tc(p(box(), run(' 30-minute prewarming     '), box(), run(' 10-minute prewarming     '), box(), run(' No prewarming')))]),
    row('Time that gown was put on', p(run('__ _'), run('_  :'), run('  __ __  (24 hour clock)  '))),
  ]);
  const body = [head(), p(run('PREOPERATIVE')), pre, sign(), page(), head(), intervention, p(run('Temperature every 5 minutes')), grid, p(box(), run(' Vital Signs Data Collected ')), sign()].join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:document ${W}><w:body>${body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1000" w:right="1000" w:bottom="1000" w:left="1000"/></w:sectPr></w:body></w:document>`;
}

// the files of a .docx holding fixtureXml(), with someone's name in its file details (to check they're removed)
export function fixtureFiles() {
  return {
    '[Content_Types].xml': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>',
    '_rels/.rels': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>',
    'word/document.xml': fixtureXml(),
    'docProps/core.xml': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:creator>Test Author</dc:creator><cp:lastModifiedBy>Test Editor</cp:lastModifiedBy></cp:coreProperties>',
  };
}

// A second made-up form with the history and discharge rows that carry follow-up questions (for wordform.test.mjs)
export function fixtureXmlHistory() {
  const t = tbl([
    tr([tc(p(run('MEDICAL HISTORY')))]),
    row('Ischaemic Heart Disease', p(box(), run(' Yes          '), box(), run(' No')), p(run('If yes, previous MI?     '), box(), run(' Yes     '), box(), run(' No'), run('   how long ago? _________'), run('_  years'))),
    row('Atrial Fibrillation', p(box(), run(' Yes     '), box(), run(' No'))),
    tr([tc(p(run('DISCHARGE')))]),
    row('Atrial Fibrillation', p(box(), run(' Yes     '), box(), run(' No'), run('     '), box(), run(' New Onset     '), box(), run(' Existing'))),
  ]);
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:document ${W}><w:body>${head()}${t}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1000" w:right="1000" w:bottom="1000" w:left="1000"/></w:sectPr></w:body></w:document>`;
}
