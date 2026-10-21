"""Tick or no tick for each box, from ink on the aligned page. Anything in between is returned as 'unsure'.

The nurses mark a box with a slash or cross, often running past its edges. The printed box is already removed from the
ink layer, so what is left is the stroke: score = stroke pixels INSIDE the box / the box's side. Only the inside counts,
so a slash that overshoots into the space around the box (or a neighbour's tail) does not tick the wrong box. A slash or
cross is well above 0.7; a clean empty box is near 0; a stray speck or a misaligned printed edge is a fraction."""
import numpy as np

CLEAR_TICK, CLEAR_EMPTY = 0.5, 0.15


def read_ticks(ink, boxes, pad=0):
    res = []
    for b in boxes:
        x0, y0, x1, y1 = b['rect']
        side = max(1, max(x1 - x0, y1 - y0))
        patch = ink[max(0, y0 - pad):y1 + pad, max(0, x0 - pad):x1 + pad]
        score = float(patch.sum()) / side if patch.size else 0.0
        state = 'ticked' if score >= CLEAR_TICK else 'empty' if score <= CLEAR_EMPTY else 'unsure'
        # the middle of the box: a slash through the box crosses it, a neighbour's overshoot tail does not
        qx, qy = (x1 - x0) // 4, (y1 - y0) // 4
        mid = ink[y0 + qy:y1 - qy, x0 + qx:x1 - qx]
        center = float(mid.sum()) / (0.5 * side) if mid.size else 0.0
        res.append(dict(b, ink=round(score, 2), center=round(center, 2), state=state))
    return res
