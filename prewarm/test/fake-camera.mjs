// A fake phone camera for the Scan pages browser tests (fake image only): getUserMedia gives a canvas stream drawn in the page.
// Use with ctx.addInitScript(fakeCamera). window.__cam.scene is 'none' (carpet only), 'cut' (page off the left edge), 'page'
// (a tilted sheet with ruled lines) or 'upside' (a sheet of printed lines of words, upside down); __cam.blur blurs the scene,
// __cam.deny refuses the camera; __cam.torch lists the torch changes asked for and __cam.tracks the camera tracks handed out.
export function fakeCamera() {
  const W = 1600, H = 1200, cam = window.__cam = { scene: 'none', blur: false, deny: false, torch: [], tracks: [] };
  const c = document.createElement('canvas'); c.width = W; c.height = H; const x = c.getContext('2d');
  const scene = document.createElement('canvas'); scene.width = W; scene.height = H; const y = scene.getContext('2d');
  const words = 'Patient temperature before induction of anaesthesia, warming blanket type and the time it was applied; shivering, comfort and the height and weight'.split(' ');
  let drawn = '';
  const paint = () => { // the scene is drawn again only when it changes (a blur every frame starves the page)
    const key = cam.scene + cam.blur;
    if (key !== drawn) {
      drawn = key; y.filter = 'none'; y.fillStyle = '#3a302a'; y.fillRect(0, 0, W, H);
      if (cam.scene === 'upside') { // an upright portrait sheet of print, turned half round
        y.save(); y.translate(W / 2, H / 2); y.rotate(Math.PI);
        y.fillStyle = '#ecece6'; y.fillRect(-380, -540, 760, 1080); y.fillStyle = '#151515'; y.font = '19px sans-serif';
        for (let l = 0; l < 30; l++) { let t = ''; for (let k = 0; k < 7; k++) t += words[(l * 5 + k * 3) % words.length] + ' '; y.fillText(t, -340, -490 + l * 34); }
        y.restore();
      } else if (cam.scene !== 'none') {
        const dx = cam.scene === 'cut' ? -500 : 0;
        y.save(); y.beginPath(); y.moveTo(380 + dx, 120); y.lineTo(1180 + dx, 190); y.lineTo(1260 + dx, 1060); y.lineTo(300 + dx, 980); y.closePath(); y.clip();
        y.fillStyle = '#e8e8e2'; y.fillRect(0, 0, W, H); y.fillStyle = '#202020';
        for (let i = 0; i < 9; i++) y.fillRect(420 + dx + i * 8, 260 + i * 80, 600, 10);
        y.restore();
      }
      if (cam.blur) { const t = document.createElement('canvas'); t.width = W; t.height = H; const tx = t.getContext('2d'); tx.filter = 'blur(5px)'; tx.drawImage(scene, 0, 0); y.drawImage(t, 0, 0); }
    }
    x.drawImage(scene, 0, 0);
    setTimeout(paint, 50);
  };
  paint();
  navigator.mediaDevices.getUserMedia = async () => {
    if (cam.deny) throw new DOMException('Permission denied', 'NotAllowedError');
    const s = c.captureStream(30), t = s.getVideoTracks()[0];
    t.getCapabilities = () => ({ torch: true });
    t.applyConstraints = async k => { cam.torch.push(k.advanced[0].torch); };
    cam.tracks.push(t);
    return s;
  };
}
