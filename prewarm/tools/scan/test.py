"""python3 test.py <dir with blank.pdf and page-N.png>: align + read ticks on synthetic photos of the fixture form."""
import sys, cv2, numpy as np
import align, boxes, ticks, synth

d = sys.argv[1]
rng = np.random.default_rng(7)
wrong = total = 0; scores = []
for pg in (0, 1):
    tpl = cv2.imread(f'{d}/page-{pg + 1}.png', cv2.IMREAD_GRAYSCALE)
    bx = boxes.tick_boxes(f'{d}/blank.pdf', pg); cl = boxes.cells(f'{d}/blank.pdf', pg)
    for trial in range(int(sys.argv[2]) if len(sys.argv) > 2 else 20):
        filled, truth = synth.fill(tpl, bx, cl if pg == 1 else [], rng)
        photo = synth.photograph(filled, rng)
        if trial == 0: cv2.imwrite(f'{d}/photo-{pg + 1}.jpg', photo)
        flat, score = align.align_page(photo, tpl)
        scores.append(score)
        if score < 0.80:
            print(f'page {pg + 1} trial {trial}: RETAKE (score {score:.2f})'); continue
        res = ticks.read_ticks(align.ink_layer(flat, tpl), bx)
        for r, t in zip(res, truth['ticks']):
            total += 1
            if r['state'] == 'unsure' or (r['state'] == 'ticked') != t: wrong += 1; print('  miss', pg + 1, trial, r['label'], r['ink'], 'truth', t)
        if trial == 0: cv2.imwrite(f'{d}/ink-{pg + 1}.png', 255 - 255 * align.ink_layer(flat, tpl))
print(f'tick boxes read {total}, wrong or unsure {wrong}; alignment score min {min(scores):.3f} mean {np.mean(scores):.3f}')
