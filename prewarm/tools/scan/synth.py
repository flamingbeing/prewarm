"""Made-up 'filled in and photographed' pages from the blank fixture, with known answers, to test the tool on.
No real data anywhere: ticks are crosses, numbers are Hershey-font strokes with wobble."""
import cv2
import numpy as np


def fill(template_gray, boxes, grid_cells, rng):
    img = cv2.cvtColor(template_gray, cv2.COLOR_GRAY2BGR)
    truth = {'ticks': [], 'numbers': []}
    for b in boxes:
        on = bool(rng.random() < 0.5)
        truth['ticks'].append(on)
        if on:
            cross(img, b['rect'], rng)
    for (x0, y0, x1, y1) in grid_cells:
        if x1 - x0 > 300 or y1 - y0 > 200:
            continue
        v = f'{rng.uniform(34, 38):.1f}'
        truth['numbers'].append(((x0, y0, x1, y1), v))
        s = 0.9 + rng.random() * 0.2
        (tw, th), _ = cv2.getTextSize(v, cv2.FONT_HERSHEY_SCRIPT_SIMPLEX, s, 2)
        cv2.putText(img, v, (x0 + (x1 - x0 - tw) // 2 + int(rng.integers(-4, 5)), y0 + (y1 - y0 + th) // 2 + int(rng.integers(-3, 4))),
                    cv2.FONT_HERSHEY_SCRIPT_SIMPLEX, s, (60, 40, 40), 2, cv2.LINE_AA)
    return cv2.cvtColor(img, cv2.COLOR_BGR2GRAY), truth


def photograph(page_gray, rng, tilt=0.12):
    """Page on a dark desk, shot at an angle, uneven light, blur, noise, JPEG."""
    h, w = page_gray.shape
    H, W = int(h * 1.35), int(w * 1.35)
    desk = np.full((H, W), 70, np.uint8)
    off = np.array([(W - w) / 2, (H - h) / 2], np.float32)
    src = np.array([[0, 0], [w, 0], [w, h], [0, h]], np.float32)
    dst = (src + off + rng.uniform(-tilt, tilt, (4, 2)) * np.array([w, h]) * 0.25).astype(np.float32)
    M = cv2.getPerspectiveTransform(src, dst)
    page = cv2.warpPerspective(page_gray, M, (W, H), borderValue=0)
    mask = cv2.warpPerspective(np.full((h, w), 255, np.uint8), M, (W, H))
    img = np.where(mask > 0, page, desk).astype(np.float32)
    yy, xx = np.mgrid[0:H, 0:W]
    light = 0.78 + 0.22 * (xx / W * rng.uniform(-1, 1) + yy / H * rng.uniform(0, 1)) + 0.1
    img = img * np.clip(light, 0.6, 1.0)
    img = cv2.GaussianBlur(img, (0, 0), 1.2) + rng.normal(0, 4, img.shape)
    ok, jpg = cv2.imencode('.jpg', np.clip(img, 0, 255).astype(np.uint8), [cv2.IMWRITE_JPEG_QUALITY, 70])
    return cv2.imdecode(jpg, cv2.IMREAD_COLOR)


def write_text(img, rect, text, rng):
    """Handwriting-ish text centred in a rectangle (img is BGR)."""
    x0, y0, x1, y1 = rect
    sc = 1.0 + rng.random() * 0.25
    (tw, th), _ = cv2.getTextSize(text, cv2.FONT_HERSHEY_SCRIPT_SIMPLEX, sc, 2)
    cv2.putText(img, text, (x0 + max(2, (x1 - x0 - tw) // 2) + int(rng.integers(-3, 4)), y0 + (y1 - y0 + th) // 2 + int(rng.integers(-3, 4))),
                cv2.FONT_HERSHEY_SCRIPT_SIMPLEX, sc, (60, 40, 40), 2, cv2.LINE_AA)


def cross(img, rect, rng):
    x0, y0, x1, y1 = rect; j = lambda: int(rng.integers(-3, 4)); ink = (int(rng.integers(30, 90)),) * 3
    if rng.random() < 0.6:   # one diagonal slash through the box, running a little past its corners
        t = int(rng.integers(2, 4)); e = int(rng.integers(2, 7))
        cv2.line(img, (x0 - e + j(), y1 + e + j()), (x1 + e + j(), y0 - e + j()), ink, t, cv2.LINE_AA)
        return
    cv2.line(img, (x0 - 2 + j(), y0 - 1 + j()), (x1 + 2 + j(), y1 + 1 + j()), ink, 3, cv2.LINE_AA)
    cv2.line(img, (x1 + 2 + j(), y0 - 1 + j()), (x0 - 2 + j(), y1 + 1 + j()), ink, 3, cv2.LINE_AA)
