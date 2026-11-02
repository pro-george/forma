#!/usr/bin/env python3
"""Draw section.svg: the KUMO base cut through its axis at H = 100, from the same numbers
as the parameters in kumo_commands.json. Run: python3 section.py > section.svg"""
H = 100; Db = 185; Dt = 125; bore = 54; ch = 0.5; neck_d = 62; cap_d = 66; cap_top_d = 47; cap_z = 7; neck_h = 15
hole_top = 42; top_bore = 44; tbd = 3; cs_s = 3; cs_d = 6; rib_h = 1.05; p1 = 60; p2 = 77; pd = 1.5
chan_d = 7; chan_z = 5; slot = 5.5

prof = [(bore / 2 + ch, 0), (p1 / 2, 0), (p1 / 2, pd), (p2 / 2, pd), (p2 / 2, 0), (Db / 2, 0), (Dt / 2, H),
        (neck_d / 2, H), (neck_d / 2, H + cap_z), (cap_d / 2, H + cap_z), (cap_top_d / 2, H + neck_h),
        (top_bore / 2, H + neck_h), (top_bore / 2, H + neck_h - tbd),
        (hole_top / 2, H + neck_h - tbd - (top_bore - hole_top) / 2),
        (hole_top / 2, H + cs_s + cs_d), (bore / 2, H + cs_s), (bore / 2, ch)]
S = 4.0
W = int(Db * S + 460)
Hh = int((H + neck_h) * S + 250)


def X(r): return W / 2 + r * S
def Y(z): return Hh - 110 - z * S


def poly(pts, fill, stroke="#1b1b1b", sw=1.6):
    return (f'<polygon points="{" ".join(f"{X(r):.1f},{Y(z):.1f}" for r, z in pts)}" fill="{fill}" '
            f'stroke="{stroke}" stroke-width="{sw}" stroke-linejoin="round"/>')


def dim(x1, y1, x2, y2, label, dx=0, dy=-6, anchor="middle"):
    return (f'<line x1="{x1:.1f}" y1="{y1:.1f}" x2="{x2:.1f}" y2="{y2:.1f}" stroke="#2b5d8a" stroke-width="1"/>'
            f'<line x1="{x1:.1f}" y1="{y1 - 4:.1f}" x2="{x1:.1f}" y2="{y1 + 4:.1f}" stroke="#2b5d8a"/>'
            f'<line x1="{x2:.1f}" y1="{y2 - 4:.1f}" x2="{x2:.1f}" y2="{y2 + 4:.1f}" stroke="#2b5d8a"/>'
            f'<text x="{(x1 + x2) / 2 + dx:.1f}" y="{(y1 + y2) / 2 + dy:.1f}" text-anchor="{anchor}" fill="#2b5d8a">{label}</text>')


def vdim(x, z1, z2, label):
    return (f'<line x1="{x:.1f}" y1="{Y(z1):.1f}" x2="{x:.1f}" y2="{Y(z2):.1f}" stroke="#2b5d8a" stroke-width="1"/>'
            f'<line x1="{x - 4:.1f}" y1="{Y(z1):.1f}" x2="{x + 4:.1f}" y2="{Y(z1):.1f}" stroke="#2b5d8a"/>'
            f'<line x1="{x - 4:.1f}" y1="{Y(z2):.1f}" x2="{x + 4:.1f}" y2="{Y(z2):.1f}" stroke="#2b5d8a"/>'
            f'<text x="{x + 8:.1f}" y="{(Y(z1) + Y(z2)) / 2 + 5:.1f}" fill="#2b5d8a">{label}</text>')


out = [f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {Hh}" width="{W}" height="{Hh}" '
       f'font-family="Inter,Helvetica,Arial,sans-serif" font-size="14">',
       f'<rect width="{W}" height="{Hh}" fill="#fbfaf7"/>',
       '<defs><pattern id="h" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">'
       '<line x1="0" y1="0" x2="0" y2="6" stroke="#6b5a3e" stroke-width="1"/></pattern></defs>']
rib = [(Db / 2 + rib_h * 1.1, 0), (Dt / 2 + rib_h * 1.1, H)]
for sgn in (1, -1):
    out.append(poly([(sgn * r, z) for r, z in prof], "#d9d2c3"))
    out.append(f'<polyline points="{" ".join(f"{X(sgn * r):.1f},{Y(z):.1f}" for r, z in rib)}" fill="none" '
               f'stroke="#8a5a2b" stroke-width="1.2" stroke-dasharray="4 3"/>')
out.append(poly([(neck_d / 2, H), (cap_d / 2, H), (cap_d / 2, H + cap_z), (neck_d / 2, H + cap_z)], "url(#h)", "#1b1b1b", 1.2))
cx = X(45); cy = Y(chan_z); r = chan_d / 2 * S; yy = cy + (r ** 2 - (slot / 2 * S) ** 2) ** 0.5
out.append(f'<path d="M{cx - slot / 2 * S:.1f},{Y(0):.1f} L{cx - slot / 2 * S:.1f},{yy:.1f} A{r:.1f},{r:.1f} 0 1 1 '
           f'{cx + slot / 2 * S:.1f},{yy:.1f} L{cx + slot / 2 * S:.1f},{Y(0):.1f} Z" fill="#fbfaf7" stroke="#1b1b1b" stroke-width="1.2"/>')
out.append(f'<line x1="{W / 2}" y1="{Y(-8)}" x2="{W / 2}" y2="{Y(H + neck_h + 8)}" stroke="#999" stroke-dasharray="8 4 2 4"/>')
out.append(dim(X(-Db / 2), Y(-22), X(Db / 2), Y(-22), "D_bottom 185 at the rib valleys · Ø187.4 over the ridges"))
out.append(dim(X(-Dt / 2), Y(H + 22), X(Dt / 2), Y(H + 22), "D_top 125"))
out.append(dim(X(-bore / 2), Y(H / 2), X(bore / 2), Y(H / 2), "bore Ø54 (0.5 chamfer at the bottom)"))
out.append(vdim(X(Db / 2 + 30), 0, H, "H = 100"))
out.append(vdim(X(cap_d / 2 + 40), H, H + neck_h, "neck_h 15"))
out.append(vdim(X(cap_d / 2 + 16), H, H + cap_z, "cap_z 7"))
out.append(f'<text x="{X(0)}" y="62" text-anchor="middle" fill="#333">'
           f'cap Ø66 → Ø47 · top bore Ø44 × 3 deep · Ø42 · 45° countersink Ø42 → Ø54 from z = H+3 to H+9</text>')
out.append(f'<text x="{X(-p2 / 2 - 6)}" y="{Y(pd + 5)}" text-anchor="end" fill="#555">bottom pocket Ø60–Ø77 × 1.5 deep</text>')
out.append(f'<text x="{X(-Db / 2 + 4)}" y="{Y(H * 0.62)}" fill="#8a5a2b">97 ribs · w 2.1 · h 1.05 · R0.55 shoulders (dashed = ridge line)</text>')
out.append(f'<text x="{X(-cap_d / 2 - 6)}" y="{Y(H + cap_z / 2 - 1.5)}" text-anchor="end" fill="#333">4 bayonet lugs Ø62 → Ø66 (hatched),</text>')
out.append(f'<text x="{X(-cap_d / 2 - 6)}" y="{Y(H + cap_z / 2 - 6)}" text-anchor="end" fill="#333">steps 5° / 30° / 55° at z = H, H+3, H+4.5</text>')
out.append(f'<text x="{cx}" y="{Y(0) + 36}" text-anchor="middle" fill="#555">cable channel Ø7 at z 5, slot 5.5 to the bottom (runs along +Y)</text>')
out.append(f'<text x="20" y="30" font-size="18" font-weight="600" fill="#1b1b1b">KUMO Base · Cone Wide · D125 — section through the axis, H = 100 (mm)</text>')
out.append('</svg>')
print("\n".join(out))
