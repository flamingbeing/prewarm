// Read on phone: one page lined up with the form and cut into cells off the main thread (js/scan-phone.js sends the page).
import { planPage } from './scan-read.js';
self.onmessage = e => {
  const { gray, w, h, pg, fields, tpl } = e.data;
  try {
    const r = planPage(gray, w, h, pg, fields, tpl);
    self.postMessage(r, r.crops.map(c => c.data.buffer));
  } catch (err) { self.postMessage({ error: String(err?.message || err) }); }
};
