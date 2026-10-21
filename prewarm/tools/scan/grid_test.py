"""python3 grid_test.py: a long table that is not where the template says (rows drift, columns stretch) is warped back onto it."""
import cv2, numpy as np
import align

rng = np.random.default_rng(3)
W, H = 1654, 2339
xs = [230, 403, 509, 616, 723, 829, 936, 1103, 1269, 1434]                 # 9 columns, widths like the real page 7
ys = [575, 660, 702] + [702 + 42 * k for k in range(1, 30)] + [1960, 2080]  # a tall header, regular rows, a tall last row
tpl = np.full((H, W), 255, np.uint8)
for y in ys: cv2.line(tpl, (xs[0], y), (xs[-1], y), 0, 2)
for x in xs: cv2.line(tpl, (x, ys[0]), (x, ys[-1]), 0, 2)
page = tpl.copy()
for y0, y1 in zip(ys[3:-2], ys[4:-1]):
    for x0, x1 in zip(xs[1:], xs[2:]):
        cv2.putText(page, f'{rng.uniform(30, 38):.1f}', (x0 + 8, y1 - 10), cv2.FONT_HERSHEY_SIMPLEX, 0.7, 60, 2, cv2.LINE_AA)
# the "photo": rows drift by up to ~28 px down the table, columns stretch 2 %, a slight rotation
yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
mapy = yy + 28 * np.sin((yy - ys[0]) / (ys[-1] - ys[0]) * np.pi) + 0.003 * (xx - W / 2)
mapx = xx + 0.02 * (xx - xs[0]) - 6
photo = cv2.remap(page, mapx, mapy, cv2.INTER_LINEAR, borderValue=255)
photo = cv2.GaussianBlur(photo, (0, 0), 1.0)
photo = np.clip(photo.astype(np.float32) * (0.85 + 0.1 * np.sin(xx / 500)) + rng.normal(0, 3, photo.shape), 0, 255).astype(np.uint8)

before = align.line_score(photo, tpl)
fixed, n = align.refine_tables(photo, tpl, [dict(bbox=(xs[0], ys[0], xs[-1], ys[-1]), xs=xs, ys=ys)])
after = align.line_score(fixed, tpl)
print(f'tables refined {n}; template lines under printed lines: before {before:.3f}, after {after:.3f}')
assert n == 1 and after > before + 0.1 and after > 0.9, 'table refinement did not recover the grid'
# a page with no table lines is left alone
blank, n0 = align.refine_tables(np.full((H, W), 255, np.uint8), tpl, [dict(bbox=(xs[0], ys[0], xs[-1], ys[-1]), xs=xs, ys=ys)])
assert n0 == 0
print('grid_test: ok')
