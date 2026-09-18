# 現行モデル(v0)と提案モデル(v1)を同じ光源で比較する。1方向・グレースケール・黒地。
# 出力は ASCII のみ(コンソールの文字化け回避)。
import numpy as np

def blur(img, sigma):
    if sigma <= 0: return img
    r = int(3 * sigma)
    x = np.arange(-r, r + 1)
    k = np.exp(-x**2 / (2 * sigma**2)); k /= k.sum()
    out = np.apply_along_axis(lambda m: np.convolve(m, k, mode="same"), 0, img)
    out = np.apply_along_axis(lambda m: np.convolve(m, k, mode="same"), 1, out)
    return out

def streak_1d(src, tau, passes):
    out = src.copy()
    for p in range(passes):
        b = 8 ** p
        att = np.exp(-b / tau)
        acc = np.zeros_like(out); w = 1.0
        for s in range(8):
            sh = np.zeros_like(out)
            if s * b < out.shape[1]: sh[:, s * b:] = out[:, : out.shape[1] - s * b]
            acc += sh * w; w *= att
        out = acc
    return out

def passes_for(tau):
    reach = tau * np.log(400)
    return int(min(4, max(1, np.ceil(np.log(reach) / np.log(8)))))

W, H = 1000, 61
cy, cx = H // 2, 40
yy, xx = np.mgrid[0:H, 0:W]
rr = np.hypot(yy - cy, xx - cx)
disk = np.clip(1.0 - (rr - 3.0) / 1.0, 0, 1)      # 白飛びした円(半径3px)
tau = (0.002 + 0.05 * 0.4 ** 1.6) * 1440           # 長さ=40 → 約19px

def measure(black):
    axis = black[cy, cx:]
    sat_w = (black > 0.97).sum(axis=0)[cx:]
    vis = int(np.argmax(axis < 0.02)) if (axis < 0.02).any() else len(axis)
    ds = [0, 5, 10, 20, 30, 40, 60, 80, 120, 160, 240]
    return (" ".join(f"{axis[d]:.2f}" for d in ds), " ".join(f"{sat_w[d]:d}" for d in ds), vis, ds)

def v0(g, I0):
    gain = 0.03 * 100 ** (g / 100)
    st = streak_1d(disk * I0, tau, passes_for(tau))
    star = np.maximum(st - disk * I0, 0)
    return 1 - np.exp(-star * gain)

def v1(g, I0, beta=0.3, tail_k=3.5, core_sigma=1.2, tail_sigma=4.0, gmax=1.0):
    gain = 0.02 * (gmax / 0.02) ** (g / 100)
    core_src = blur(disk, core_sigma) * I0
    tail_src = blur(disk, tail_sigma) * I0
    core = np.maximum(streak_1d(core_src, tau, passes_for(tau)) - core_src, 0)
    tail = np.maximum(streak_1d(tail_src, tau * tail_k, passes_for(tau * tail_k)) - tail_src, 0)
    star = core + beta * tail
    return 1 - np.exp(-star * gain)

print(f"tau={tau:.1f}px  (length slider 40, preview 1440)")
for name, fn in [("v0 current", v0), ("v1 proposed", v1)]:
    print(f"== {name}")
    for I0, label in [(1.0, "window-like I0=1"), (3.0, "lamp-like I0=3")]:
        for g in [30, 60, 90]:
            axis, satw, vis, ds = measure(fn(g, I0))
            print(f"[{label}] gain={g:2d}  visible_len={vis:4d}px")
            print(f"    axis  r={ds}: {axis}")
            print(f"    satW  r={ds}: {satw}")
